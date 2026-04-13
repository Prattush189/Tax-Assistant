// server/routes/chat.ts
import { Router, Response } from 'express';
import { grok, GROK_MODEL, INPUT_COST_PER_TOKEN, OUTPUT_COST_PER_TOKEN, WEB_SEARCH_COST, GEMINI_T1_INPUT_COST, GEMINI_T1_OUTPUT_COST, GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST, GEMINI_THINK_INPUT_COST, GEMINI_THINK_OUTPUT_COST, GEMINI_THINK_FB_INPUT_COST, GEMINI_THINK_FB_OUTPUT_COST, GEMINI_CHAT_MODEL_T1, GEMINI_CHAT_MODEL_T2, GEMINI_CHAT_MODEL_THINK, GEMINI_CHAT_MODEL_THINK_FB, GEMINI_API_KEYS } from '../lib/grok.js';
import { selectTier, confirmUsed, type ModelTier } from '../lib/searchQuota.js';
import { streamGeminiChat } from '../lib/geminiChat.js';
import { chatRepo } from '../db/repositories/chatRepo.js';
import { messageRepo } from '../db/repositories/messageRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { getUserLimits, getEffectivePlan } from '../lib/planLimits.js';
import { getBillingUserId, getBillingUser } from '../lib/billing.js';
import { retrieveContextWithRefs, SectionReference } from '../rag/index.js';
import { AuthRequest } from '../types.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const router = Router();

const MAX_TOKENS = 4096;

// ── Selective web search ──────────────────────────────────────────────────
// When any of these patterns match the user's query, Grok is given the web
// search tool so it can fetch live CBDT/CBIC notifications, Budget updates,
// and case-law mentions. The local RAG reference is still injected into the
// same request as supporting context — so web search is the primary source
// for time-sensitive / comparative queries, and RAG acts as a fallback.
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

// ── Web search via xAI Responses API ──
async function* streamWithWebSearch(
  systemPrompt: string,
  history: { role: string; content: string }[],
  userContent: string,
  maxOutputTokens: number = MAX_TOKENS,
): AsyncGenerator<{ type: 'text'; text: string } | { type: 'usage'; input: number; output: number } | { type: 'done'; reason: string }> {
  const input = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userContent },
  ];

  const response = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      input,
      tools: [{ type: 'web_search' }],
      max_output_tokens: maxOutputTokens,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${response.status} ${errText.slice(0, 200)}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        const event = JSON.parse(line.slice(6));
        // Response API streams different event types
        if (event.type === 'response.output_text.delta' && event.delta) {
          yield { type: 'text', text: event.delta };
        } else if (event.type === 'response.completed' && event.response?.usage) {
          const u = event.response.usage;
          yield { type: 'usage', input: u.input_tokens ?? 0, output: u.output_tokens ?? 0 };
          yield { type: 'done', reason: 'end_turn' };
        }
      } catch { /* skip unparseable lines */ }
    }
  }
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
- If reference text is injected, use it silently — NEVER mention "the reference" or "provided context".
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
  const { chatId, message, fileContext, fileContexts: rawFileContexts, profileContext, chatMode } = req.body;
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

  const isThinking = chatMode === 'thinking';
  const creditCost = isThinking ? 2 : 1;
  const modeMaxTokens = isThinking ? 8000 : MAX_TOKENS;

  if (used + creditCost > limits.messages.limit) {
    const periodLabel = limits.messages.period === 'day' ? 'daily' : 'monthly';
    const remaining = limits.messages.limit - used;
    const insufficientMsg = isThinking && remaining > 0
      ? `Thinking mode requires ${creditCost} credits but you only have ${remaining} left. Switch to Fast mode or upgrade your plan.`
      : `You've reached your ${periodLabel} message limit (${limits.messages.limit} messages). Upgrade your plan for more.`;
    res.status(429).json({
      error: insufficientMsg,
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
    userContent = `[Official Act text for reference verification]:\n${ragResult.context}\n\n---\n\n${userContent}`;
    ragReferences = ragResult.references;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let fullResponse = '';

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    ...history,
    { role: 'user', content: userContent },
  ];

  // Retry logic: up to 3 attempts with exponential backoff
  const MAX_RETRIES = 3;
  let success = false;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      let stopReason: string | null = null;
      let inputTok = 0;
      let outputTok = 0;

      // ── Dual-mode cascade (all Gemini, free tier) ─────────────────────
      // FAST     (1 credit): Gemini 2.5 Flash-Lite → Gemini 3.1 Flash-Lite fallback
      // THINKING (2 credits): Gemini 3 Flash → Gemini 2.5 Flash fallback, always search, 8000 tokens
      // Search grounding: 2.5 family = 1,500 RPD shared | 3.x family = 5,000/month shared
      const searchEnabled = isThinking ? true : shouldEnableWebSearch(message);
      let usedModel = '';
      const historyPlain = history.map(m => ({ role: m.role as string, content: m.content as string }));

      if (isThinking) {
        // ── THINKING: Gemini 3 Flash primary (always search) ──
        const selection = selectTier(true);  // picks best available Gemini 3 key
        const thinkApiKey = selection.keyIndex >= 0 ? GEMINI_API_KEYS[selection.keyIndex] ?? '' : '';
        if (thinkApiKey) {
          usedModel = GEMINI_CHAT_MODEL_THINK;
          try {
            for await (const chunk of streamGeminiChat(GEMINI_CHAT_MODEL_THINK, SYSTEM_INSTRUCTION, historyPlain, userContent, thinkApiKey, modeMaxTokens, true)) {
              if (chunk.text) { fullResponse += chunk.text; res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`); }
              if (chunk.done) { inputTok = chunk.inputTokens ?? 0; outputTok = chunk.outputTokens ?? 0; stopReason = 'end_turn'; }
            }
            confirmUsed('gemini-3', selection.keyIndex, true);
          } catch (err) {
            console.warn('[chat] Think: Gemini 3 Flash failed, falling back to 2.5 Flash:', (err as Error).message?.slice(0, 120));
            fullResponse = ''; usedModel = '';
          }
        }

        // Gemini 2.5 Flash fallback for thinking
        if (!fullResponse) {
          const fbApiKey = GEMINI_API_KEYS[0] ?? '';
          if (fbApiKey) {
            usedModel = GEMINI_CHAT_MODEL_THINK_FB;
            try {
              for await (const chunk of streamGeminiChat(GEMINI_CHAT_MODEL_THINK_FB, SYSTEM_INSTRUCTION, historyPlain, userContent, fbApiKey, modeMaxTokens, true)) {
                if (chunk.text) { fullResponse += chunk.text; res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`); }
                if (chunk.done) { inputTok = chunk.inputTokens ?? 0; outputTok = chunk.outputTokens ?? 0; stopReason = 'end_turn'; }
              }
              confirmUsed('gemini-2.5', 0, true);
            } catch (err) {
              console.warn('[chat] Think fallback: Gemini 2.5 Flash also failed:', (err as Error).message?.slice(0, 120));
              fullResponse = ''; usedModel = '';
            }
          }
        }
      } else {
        // ── FAST: Gemini 2.5 Flash-Lite primary ──
        const fastApiKey = GEMINI_API_KEYS[0] ?? '';
        if (fastApiKey) {
          usedModel = GEMINI_CHAT_MODEL_T2;
          try {
            for await (const chunk of streamGeminiChat(GEMINI_CHAT_MODEL_T2, SYSTEM_INSTRUCTION, historyPlain, userContent, fastApiKey, modeMaxTokens, searchEnabled)) {
              if (chunk.text) { fullResponse += chunk.text; res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`); }
              if (chunk.done) { inputTok = chunk.inputTokens ?? 0; outputTok = chunk.outputTokens ?? 0; stopReason = 'end_turn'; }
            }
            confirmUsed('gemini-2.5', 0, searchEnabled);
          } catch (err) {
            console.warn('[chat] Fast: Gemini 2.5 Flash-Lite failed, falling back to 3.1 Flash-Lite:', (err as Error).message?.slice(0, 120));
            fullResponse = ''; usedModel = '';
          }
        }

        // Gemini 3.1 Flash-Lite fallback for fast
        if (!fullResponse) {
          const selection = selectTier(searchEnabled);
          const fbApiKey = selection.keyIndex >= 0 ? GEMINI_API_KEYS[selection.keyIndex] ?? '' : '';
          if (fbApiKey) {
            usedModel = GEMINI_CHAT_MODEL_T1;
            try {
              for await (const chunk of streamGeminiChat(GEMINI_CHAT_MODEL_T1, SYSTEM_INSTRUCTION, historyPlain, userContent, fbApiKey, modeMaxTokens, searchEnabled)) {
                if (chunk.text) { fullResponse += chunk.text; res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`); }
                if (chunk.done) { inputTok = chunk.inputTokens ?? 0; outputTok = chunk.outputTokens ?? 0; stopReason = 'end_turn'; }
              }
              confirmUsed('gemini-3', selection.keyIndex, searchEnabled);
            } catch {
              fullResponse = ''; usedModel = '';
            }
          }
        }
      }

      // Persist model response
      if (fullResponse) {
        messageRepo.create(chatId, 'model', fullResponse);
      }

      // Auto-title
      if (chat.title === 'New Chat' && message.trim().length > 0) {
        const title = message.trim().slice(0, 60) + (message.trim().length > 60 ? '...' : '');
        chatRepo.updateTitle(chatId, title);
      }
      chatRepo.touchTimestamp(chatId);

      // Log usage — cost depends on which model was actually used
      const costMap: Record<string, [number, number]> = {
        [GEMINI_CHAT_MODEL_T1]: [GEMINI_T1_INPUT_COST, GEMINI_T1_OUTPUT_COST],
        [GEMINI_CHAT_MODEL_T2]: [GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST],
        [GEMINI_CHAT_MODEL_THINK]: [GEMINI_THINK_INPUT_COST, GEMINI_THINK_OUTPUT_COST],
        [GEMINI_CHAT_MODEL_THINK_FB]: [GEMINI_THINK_FB_INPUT_COST, GEMINI_THINK_FB_OUTPUT_COST],
      };
      const [inputCost, outputCost] = costMap[usedModel] ?? [INPUT_COST_PER_TOKEN, OUTPUT_COST_PER_TOKEN];
      const searchCost = usedModel in costMap ? 0 : (searchEnabled ? WEB_SEARCH_COST : 0);
      const actualSearchUsed = searchEnabled;
      const cost = (inputTok * inputCost) + (outputTok * outputCost) + searchCost;
      usageRepo.logWithBilling(clientIp, req.user.id, billingUserId, inputTok, outputTok, cost, false, usedModel || undefined, actualSearchUsed);
      // Thinking mode costs 4 credits — log 3 extra zero-cost rows to consume them
      if (isThinking) {
        for (let c = 1; c < creditCost; c++) {
          usageRepo.logWithBilling(clientIp, req.user.id, billingUserId, 0, 0, 0, false, usedModel || undefined, false);
        }
      }

      res.write(`data: ${JSON.stringify({ done: true, stop_reason: stopReason })}\n\n`);
      success = true;
      break;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const status = (err as any)?.status ?? 0;
      const isRetryable = [429, 500, 502, 503].includes(status) || errMsg.includes('rate_limit');
      console.warn(`[chat] Attempt ${attempt + 1}/${MAX_RETRIES} failed: ${errMsg.slice(0, 120)}`);

      if (!isRetryable || attempt === MAX_RETRIES - 1) {
        const isRateLimit = status === 429 || errMsg.toLowerCase().includes('rate');
        const clientMessage = isRateLimit
          ? 'Too many requests. Please wait a moment and try again.'
          : "I'm having trouble connecting. Please try again in a moment.";
        res.write(`data: ${JSON.stringify({ error: true, message: clientMessage })}\n\n`);
        break;
      }

      // Exponential backoff: 2s, 4s, 6s
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }

  res.end();
});

export default router;
