// server/routes/chat.ts
import { Router, Response } from 'express';
import { GEMINI_T1_INPUT_COST, GEMINI_T1_OUTPUT_COST, GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST, GEMINI_CHAT_MODEL_T1, GEMINI_CHAT_MODEL_T2, GEMINI_API_KEYS } from '../lib/gemini.js';
import { selectTier, confirmUsed, getActiveKeyIndex } from '../lib/searchQuota.js';
import { streamGeminiChat } from '../lib/geminiChat.js';
import { chatRepo } from '../db/repositories/chatRepo.js';
import { messageRepo } from '../db/repositories/messageRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { getUserLimits, getEffectivePlan } from '../lib/planLimits.js';
import { getBillingUserId, getBillingUser } from '../lib/billing.js';
import { retrieveContextWithRefs, SectionReference } from '../rag/index.js';
import { SseWriter } from '../lib/sseStream.js';
import { AuthRequest } from '../types.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const router = Router();

const MAX_TOKENS = 4096;

// ── Selective web search ──────────────────────────────────────────────────
// When any of these patterns match the user's query, Google Search grounding
// is enabled so Gemini can fetch live CBDT/CBIC notifications, Budget updates,
// and case-law mentions. The local RAG reference is still injected as
// supplementary context.
const WEB_SEARCH_PATTERNS = [
  // Recent / latest info
  /\b(latest|recent|updated?|current|upcoming)\s+(change|circular|notification|amendment|rule|budget|reform|rate|threshold)/i,
  /\blatest\b/i,
  /\b(news|update|announcement)\b/i,

  // Specific time references
  /\b(today|yesterday|this\s+week|this\s+month|right\s+now|currently)\b/i,

  // Specific years (2024+)
  /\b20(2[4-9]|[3-9]\d)\b/,

  // Specific months / dates
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2}\b/i,
  /\b\d{1,2}[\/-]\d{1,2}[\/-]20\d{2}\b/,

  // FY / AY references
  /\b(fy|ay)\s*20\d{2}/i,

  // Government / regulatory
  /\b(budget\s+20\d{2}|union\s+budget|finance\s+(act|bill))\b/i,
  /\b(circular|notification|press\s+release|CBDT|CBIC|gazette)\b/i,
  /\b(announced?|introduced|notified|amended)\s+in\s+20\d{2}/i,

  // Old-vs-new / comparison / renumbering queries (common when users ask
  // about the IT Act 2025 vs 1961 transition or GST rate changes)
  /\bold\b[\s\S]{0,30}\bnew\b/i,
  /\bnew\b[\s\S]{0,30}\bold\b/i,
  /\b(old|new)\s+(act|section|regime|rule|law|provision|code)\b/i,
  /\b(compare|comparison|versus|difference|differences|differ|replaced?)\b/i,
  /\b\d{2,4}\s*(?:vs|versus|→|->)\s*\d{2,4}\b/i,
  /\bvs\b/i,

  // IT Act version references
  /\b(it|income\s+tax)\s+act\s+(1961|2025|2026)\b/i,
  /\bact\s+(1961|2025|2026)\b/i,
  /\brenumbering\b/i,
  /\brenumbered\b/i,

  // "Is this still applicable" / "has this changed" — signals the user wants
  // a freshness check, not a generic lookup
  /\b(still\s+(applicable|valid|in\s+force)|has\s+this\s+changed|any\s+changes)\b/i,
];

function shouldEnableWebSearch(query: string): boolean {
  return WEB_SEARCH_PATTERNS.some(p => p.test(query));
}

// ── Plan-based message limits ──
// Counts messages against the BILLING user (inviter for shared-pool members,
// self for standalone users). Pairs with usageRepo.logWithBilling below.
function getMessageCount(billingUserId: string, period: 'day' | 'month'): number {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // IST
  let since: string;
  if (period === 'day') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    since = start.toISOString().replace('Z', '');
  } else {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    since = start.toISOString().replace('Z', '');
  }
  return usageRepo.countByBillingUser(billingUserId, since);
}

const SYSTEM_INSTRUCTION = `You are "Smartbiz AI" — an expert on Indian Income Tax, GST, and financial planning.

RULES:
- SCOPE: Only Indian tax, GST, deductions, capital gains, financial planning. Politely decline other topics.
- Default to FY 2025-26 (AY 2026-27). IT Act 2025 replaced IT Act 1961 (effective 1 Apr 2026).
- Scale response to complexity: short for factual lookups, detailed for analysis/comparisons.
- Use Markdown tables for rates/comparisons/thresholds. Use Indian number format (₹1,50,000).
- For charts: \`\`\`json-chart {"type":"bar","title":"...","data":[{"name":"Label","value":12345}]} \`\`\`
- NEVER fabricate section numbers, rates, or policy changes. Say "I'm not certain" if unsure.
- Lead with the answer. No filler, no tangential sections, no padding.
- If question is vague/incomplete, ask a clarifying question instead of guessing.
- If reference text is injected, use it silently as additional context — NEVER mention "the reference", "provided context", or "provided text". Always answer from your full knowledge; the reference is supplementary, never a limitation.
- Cite section numbers (both old and new Act). Mention consulting a CA for official filing.
- GST slabs (post 56th Council): 0% essentials, 5% daily needs, 18% standard, 40% demerit, 3% gold.
- NEW REGIME FY 2025-26: 0-4L nil, 4-8L 5%, 8-12L 10%, 12-16L 15%, 16-20L 20%, 20-24L 25%, 24L+ 30%. Std deduction ₹75K, rebate 87A ≤₹12L (max ₹60K).
- NEW REGIME FY 2024-25: 0-3L nil, 3-7L 5%, 7-10L 10%, 10-12L 15%, 12-15L 20%, 15L+ 30%. Std deduction ₹50K (post July Budget ₹75K), rebate 87A ≤₹7L.
- OLD REGIME (all FYs): Below-60: 0-2.5L nil, 2.5-5L 5%, 5-10L 20%, 10L+ 30%. Senior(60-80): 0-3L nil. Super-senior(80+): 0-5L nil. Std deduction ₹50K, rebate 87A ≤₹5L (max ₹12.5K).

HANDLING ATTACHED DOCUMENTS:
- If the user attaches a document and asks a vague question, your response MUST focus on the attached document's content.
- Describe what the document contains, highlight key information, and invite the user to ask specific questions.
- Do NOT ignore the attachment and answer a generic tax question instead.`;

const MAX_HISTORY_MESSAGES = 6; // 3 turns — keeps context tight, reduces tokens

// Attachment limits per plan
// Plan-based attachment-per-message ceiling. Uses the standalone plan defaults;
// plugin overrides don't apply here (attachments PER MESSAGE, not monthly quota).
const ATTACHMENTS_PER_MESSAGE: Record<string, number> = {
  free: 1,
  pro: 3,
  enterprise: 5,
  'enterprise-shared': 5,
};

router.post('/chat', async (req: AuthRequest, res: Response) => {
  const { chatId, message, fileContext, fileContexts: rawFileContexts, profileContext } = req.body;
  // Normalize: support both single fileContext and array fileContexts
  const fileContexts: { filename: string; mimeType: string; extractedData?: unknown }[] =
    rawFileContexts ?? (fileContext ? [fileContext] : []);

  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (!chatId || typeof chatId !== 'string') {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  if (message.length > 4000) {
    res.status(400).json({ error: 'message exceeds 4000 character limit' });
    return;
  }

  const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';

  // Check per-user message limit (resolves plugin_limits > plugin_plan > plan)
  const user = userRepo.findById(req.user.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  // Limits are resolved from the POOL owner (inviter for invited users).
  const billingUser = getBillingUser(user);
  const billingUserId = billingUser.id;
  const effectivePlan = getEffectivePlan(billingUser);
  const limits = getUserLimits(billingUser);
  const used = getMessageCount(billingUserId, limits.messages.period);

  if (used + 1 > limits.messages.limit) {
    const periodLabel = limits.messages.period === 'day' ? 'daily' : 'monthly';
    res.status(429).json({
      error: `You've reached your ${periodLabel} message limit (${limits.messages.limit} messages). Upgrade your plan for more.`,
      upgrade: true,
    });
    return;
  }

  // Check per-message attachment ceiling (separate from monthly attachment quota)
  const attachLimit = ATTACHMENTS_PER_MESSAGE[effectivePlan] ?? 1;
  if (fileContexts.length > attachLimit) {
    res.status(400).json({ error: `Your plan allows ${attachLimit} attachment(s) per message. Upgrade for more.`, upgrade: true });
    return;
  }

  // Verify chat belongs to user
  const chat = chatRepo.findById(chatId);
  if (!chat || chat.user_id !== req.user.id) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }

  // Persist user message (store first attachment for backward compat)
  const firstFile = fileContexts[0];
  messageRepo.create(chatId, 'user', message.trim(), firstFile?.filename, firstFile?.mimeType);

  // Load history from DB — convert 'model' role to 'assistant' for OpenAI format
  const dbMessages = messageRepo.findByChatId(chatId);
  const history: ChatCompletionMessageParam[] = dbMessages.slice(0, -1)
    .slice(-MAX_HISTORY_MESSAGES)
    .map(m => ({
      role: (m.role === 'model' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    }));

  // Ensure conversation starts with user message
  if (history.length > 0 && history[0].role !== 'user') {
    history.shift();
  }

  let userContent = message.trim();
  if (fileContexts.length > 0) {
    const contextBlocks: string[] = [];
    for (const fc of fileContexts) {
      const data: any = fc.extractedData ?? {};
      if (!data || typeof data !== 'object') continue;

      const parts: string[] = [`[Attached Document: ${fc.filename}]`];
      if (data.documentType) parts.push(`Type: ${data.documentType}`);
      if (data.summary) parts.push(`Summary: ${data.summary}`);

      // Tax-specific structured fields (only if present)
      const taxFields: string[] = [];
      if (data.financialYear) taxFields.push(`FY: ${data.financialYear}`);
      if (data.employerName) taxFields.push(`Employer: ${data.employerName}`);
      if (data.employeeName) taxFields.push(`Employee: ${data.employeeName}`);
      if (data.pan) taxFields.push(`PAN: ${data.pan}`);
      if (data.grossSalary) taxFields.push(`Gross Salary: ₹${data.grossSalary}`);
      if (data.tdsDeducted) taxFields.push(`TDS: ₹${data.tdsDeducted}`);
      if (data.deductions80C) taxFields.push(`80C: ₹${data.deductions80C}`);
      if (data.deductions80D) taxFields.push(`80D: ₹${data.deductions80D}`);
      if (taxFields.length > 0) parts.push(`Tax Data: ${taxFields.join(' | ')}`);

      // Key points
      if (Array.isArray(data.keyPoints) && data.keyPoints.length > 0) {
        parts.push('Key Points:\n' + data.keyPoints.map((p: string) => `  • ${p}`).join('\n'));
      }

      // Full text excerpt
      if (data.fullText) {
        parts.push(`Content Extract:\n${data.fullText}`);
      }

      contextBlocks.push(parts.join('\n'));
    }
    if (contextBlocks.length > 0) {
      userContent = `${contextBlocks.join('\n\n---\n\n')}\n\n---\n\nUser question about the attached document(s): ${userContent}`;
    }
  }

  // Profile context injection
  if (profileContext?.data) {
    userContent = `[Tax Profile: ${profileContext.name}]\nIncome: ₹${profileContext.data.gross_salary}, Other: ₹${profileContext.data.other_income}, FY: ${profileContext.data.fy}, Age: ${profileContext.data.age_category}\nDeductions: ${profileContext.data.deductions_data}\nHRA: ${profileContext.data.hra_data}\n\n${userContent}`;
  }

  // RAG: retrieve relevant Act sections (lightweight — 2-3 chunks for reference)
  let ragReferences: SectionReference[] = [];
  const ragResult = retrieveContextWithRefs(userContent);
  if (ragResult) {
    userContent = `[Supplementary Act reference — use alongside your knowledge, not instead of it]:\n${ragResult.context}\n\n---\n\n${userContent}`;
    ragReferences = ragResult.references;
  }

  const sse = new SseWriter(res);

  // Heartbeat keeps intermediate proxies (nginx, Cloudflare, etc.) from buffering
  // or dropping the connection while the model is still "thinking". The client
  // treats these as no-ops but uses any byte arrival to reset its idle watchdog.
  const HEARTBEAT_MS = 10_000;
  const heartbeat = setInterval(() => { sse.writeHeartbeat(); }, HEARTBEAT_MS);
  // Stop streaming cleanly if the client disconnects mid-response.
  const clientAbort = new AbortController();
  req.on('close', () => { clientAbort.abort(); });

  let fullResponse = '';

  // Retry logic: up to 3 attempts with exponential backoff
  const MAX_RETRIES = 3;

  try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        let stopReason: string | null = null;
        let inputTok = 0;
        let outputTok = 0;

        // ── Fast-mode cascade ─────────────────────────────────────────────
        // Primary  : Gemini 2.5 Flash-Lite (2.5 daily pool)
        // Fallback : Gemini 3.1 Flash-Lite (3.x monthly pool)
        // Fallback only runs if the primary emitted zero text — we don't
        // restart the stream after partial output (would produce duplicated
        // responses on the client).
        const searchEnabled = shouldEnableWebSearch(message);
        let usedModel = '';
        const historyPlain = history.map(m => ({ role: m.role as string, content: m.content as string }));
        let primaryFailedMidStream = false;

        // ── FAST: Gemini 2.5 Flash-Lite primary ──
        const activeIdx = getActiveKeyIndex();
        const fastApiKey = GEMINI_API_KEYS[activeIdx] ?? '';
        if (fastApiKey) {
          usedModel = GEMINI_CHAT_MODEL_T2;
          try {
            for await (const chunk of streamGeminiChat(GEMINI_CHAT_MODEL_T2, SYSTEM_INSTRUCTION, historyPlain, userContent, fastApiKey, MAX_TOKENS, searchEnabled, true)) {
              if (chunk.text) { fullResponse += chunk.text; sse.writeText(chunk.text); }
              if (chunk.done) {
                inputTok = chunk.inputTokens ?? 0;
                outputTok = chunk.outputTokens ?? 0;
                stopReason = chunk.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn';
              }
            }
            confirmUsed('gemini-2.5', activeIdx, searchEnabled);
          } catch (err) {
            // If we already started streaming text, don't run the fallback —
            // that would concatenate a second response into the same bubble.
            // Instead, surface a truncation signal and persist what we have.
            if (fullResponse) {
              primaryFailedMidStream = true;
              stopReason = 'network_error';
              console.warn('[chat] Fast primary failed after partial output; keeping partial response:', (err as Error).message?.slice(0, 120));
            } else {
              console.warn('[chat] Fast: Gemini 2.5 Flash-Lite failed, falling back to 3.1 Flash-Lite:', (err as Error).message?.slice(0, 120));
              usedModel = '';
            }
          }
        }

        // Gemini 3.1 Flash-Lite fallback for fast (only when primary returned nothing)
        if (!fullResponse && !primaryFailedMidStream) {
          const selection = selectTier(searchEnabled);
          const fbApiKey = selection.keyIndex >= 0 ? GEMINI_API_KEYS[selection.keyIndex] ?? '' : '';
          if (fbApiKey) {
            usedModel = GEMINI_CHAT_MODEL_T1;
            try {
              for await (const chunk of streamGeminiChat(GEMINI_CHAT_MODEL_T1, SYSTEM_INSTRUCTION, historyPlain, userContent, fbApiKey, MAX_TOKENS, searchEnabled, true)) {
                if (chunk.text) { fullResponse += chunk.text; sse.writeText(chunk.text); }
                if (chunk.done) {
                  inputTok = chunk.inputTokens ?? 0;
                  outputTok = chunk.outputTokens ?? 0;
                  stopReason = chunk.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn';
                }
              }
              confirmUsed('gemini-3', selection.keyIndex, searchEnabled);
            } catch (err) {
              console.warn('[chat] Fast fallback also failed:', (err as Error).message?.slice(0, 120));
              if (!fullResponse) { usedModel = ''; }
            }
          }
        }

        // Neither model produced output — treat this attempt as a failure so
        // the outer retry loop can try again (rather than silently returning
        // a blank reply).
        if (!fullResponse) {
          throw new Error('No response produced by any model');
        }

        // Persist model response
        messageRepo.create(chatId, 'model', fullResponse);

        // Auto-title
        if (chat.title === 'New Chat' && message.trim().length > 0) {
          const title = message.trim().slice(0, 60) + (message.trim().length > 60 ? '...' : '');
          chatRepo.updateTitle(chatId, title);
        }
        chatRepo.touchTimestamp(chatId);

        // Log usage — cost depends on which model was actually used.
        if ((inputTok > 0 || outputTok > 0) && fullResponse.length > 0) {
          const costMap: Record<string, [number, number]> = {
            [GEMINI_CHAT_MODEL_T1]: [GEMINI_T1_INPUT_COST, GEMINI_T1_OUTPUT_COST],
            [GEMINI_CHAT_MODEL_T2]: [GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST],
          };
          const [inputCost, outputCost] = costMap[usedModel] ?? [GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST];
          const cost = (inputTok * inputCost) + (outputTok * outputCost);
          usageRepo.logWithBilling(clientIp, req.user.id, billingUserId, inputTok, outputTok, cost, false, usedModel || undefined, searchEnabled, 'chat');
        } else {
          console.warn('[chat] skipping usage log — no tokens reported (likely partial/truncated stream)');
        }

        sse.writeDone({ stop_reason: stopReason });
        return;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const status = (err as any)?.status ?? 0;
        const isRetryable = [429, 500, 502, 503].includes(status) || errMsg.includes('rate_limit') || errMsg.includes('No response produced');
        console.warn(`[chat] Attempt ${attempt + 1}/${MAX_RETRIES} failed: ${errMsg.slice(0, 120)}`);

        // Don't retry if the client already hung up.
        if (clientAbort.signal.aborted) return;

        if (!isRetryable || attempt === MAX_RETRIES - 1) {
          const isRateLimit = status === 429 || errMsg.toLowerCase().includes('rate');
          const clientMessage = isRateLimit
            ? 'Too many requests. Please wait a moment and try again.'
            : "I'm having trouble connecting. Please try again in a moment.";
          sse.writeError(clientMessage);
          return;
        }

        // Exponential backoff: 2s, 4s, 6s
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  } finally {
    clearInterval(heartbeat);
    sse.end();
  }
});

export default router;
