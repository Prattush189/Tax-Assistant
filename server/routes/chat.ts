// server/routes/chat.ts
import { Router, Response } from 'express';
import { grok, GROK_MODEL, INPUT_COST_PER_TOKEN, OUTPUT_COST_PER_TOKEN, WEB_SEARCH_COST } from '../lib/grok.js';
import { chatRepo } from '../db/repositories/chatRepo.js';
import { messageRepo } from '../db/repositories/messageRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { retrieveContextWithRefs, SectionReference } from '../rag/index.js';
import { AuthRequest } from '../types.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const router = Router();

const MAX_TOKENS = 8192;

// ── Selective web search — only for queries about recent/latest info ──
const WEB_SEARCH_PATTERNS = [
  /\b(latest|recent|new|updated?|current)\s+(change|circular|notification|amendment|rule|budget|reform)/i,
  /\b(budget\s+20\d{2}|union\s+budget)\b/i,
  /\b(circular|notification|press\s+release|CBDT|CBIC)\b/i,
  /\b(announced?|introduced)\s+in\s+20\d{2}/i,
  /\bchanges?\s+in\s+20(2[5-9]|[3-9]\d)\b/i,
];

function shouldEnableWebSearch(query: string): boolean {
  return WEB_SEARCH_PATTERNS.some(p => p.test(query));
}

// ── Plan-based message limits ──
interface PlanConfig {
  limit: number;
  period: 'day' | 'month';
}

const PLAN_LIMITS: Record<string, PlanConfig> = {
  free: { limit: 10, period: 'day' },
  pro: { limit: 1000, period: 'month' },
  enterprise: { limit: 10000, period: 'month' },
};

function getMessageCount(userId: string, period: 'day' | 'month'): number {
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
  return usageRepo.countByUser(userId, since);
}

const SYSTEM_INSTRUCTION = `You are "Smart AI" — an expert on Indian Income Tax, GST, and financial planning. You give thorough, professional, well-structured answers.

SCOPE: Only answer questions about Indian tax, GST, deductions, capital gains, and financial planning. Politely decline other topics.

RESPONSE QUALITY:
- Give DETAILED, comprehensive answers. Do NOT give one-line or two-line answers. Each response should be thorough and educational.
- Always use Markdown formatting: headings (##, ###), bold, bullet points, numbered lists.
- ALWAYS include a Markdown table when presenting rates, limits, thresholds, comparisons, or mappings. Tables make data scannable.
- For old vs new Act comparisons, ALWAYS show a mapping table with Old Section | New Section | Nature columns.
- For tax computations, show step-by-step breakdown in a table.
- TABLE CELL RULE: Keep each table cell SHORT — max 10-15 words. If a cell needs more detail, split into multiple rows or use a bullet list OUTSIDE the table. NEVER put paragraphs or long explanations inside a table cell. Use brief values like "₹2.5L (General)" not full sentences.
- Include a json-chart block ONLY when there is meaningful numerical data to visualize (tax amounts, slab comparisons, cost breakdowns).
  - For SINGLE series: \`\`\`json-chart {"type":"bar","title":"...","data":[{"name":"Label","value":12345}]} \`\`\`
  - For COMPARISON (old vs new, regime A vs B): \`\`\`json-chart {"type":"stacked-bar","title":"...","keys":["Old Regime","New Regime"],"data":[{"name":"5L","Old Regime":0,"New Regime":0},{"name":"10L","Old Regime":50000,"New Regime":37500}]} \`\`\`
  - Use numeric values in chart data (e.g., 296400 not "2.96L"). The chart renders raw numbers.
- Do NOT include charts for non-numerical comparisons (form mappings, section name changes, feature lists). Use tables instead for those.

CALCULATION FORMATTING:
- When showing tax computations, make them READABLE. Use one line per slab, not compressed into a single line.
- Always express final amounts in Lakhs (e.g., ₹2.96L not ₹296.4K or 296400). Use K only for amounts under ₹1L.
- Use Indian number formatting with commas: ₹1,50,000 not ₹150000 or 150K.
- End with a brief practical tip or recommendation where relevant.
- Mention consulting a CA for official filing.

ACCURACY & HONESTY:
- Default to FY 2025-26 (AY 2026-27) unless user specifies otherwise.
- Cite specific section numbers when referencing the Act (both old and new Act numbers if applicable).
- The Income Tax Act 2025 (effective 1 April 2026) replaced the 1961 Act. Use "Tax Year" not "Assessment Year" for the new Act.
- NEVER fabricate or invent section numbers, rates, thresholds, dates, or policy changes. If you are not certain about a specific fact, say so clearly.
- If no changes exist for what the user asks about, say so directly and confidently. Do NOT invent changes to fill the response.
- It is BETTER to give a short, accurate answer than a long, hallucinated one.
- CONSISTENCY: NEVER show a rate table that contradicts your own changes section.

CURRENT GST RATE STRUCTURE (Post 56th GST Council, effective 22 Sep 2025):
Use ONLY these rates when showing current GST slabs. The old 12% and 28% slabs have been largely removed.
  Rate  | Category
  0%    | Essentials: fresh fruits, vegetables, milk, bread, eggs, education, healthcare, life & health insurance
  5%    | Daily needs: packaged food, medicines, footwear, bicycles, EVs, restaurants (non-AC), hotels ≤₹7,500/day, gyms/salons, renewable energy devices, tractors, farm equipment
  18%   | Standard: most goods & services, IT services, electronics, ACs, TVs, fridges, cement, vehicles, financial services, auto parts, small cars, two-wheelers ≤350cc
  40%   | Demerit/sin/luxury: tobacco, pan masala, aerated beverages, high-end cars, yachts, private aircraft, premium bikes >350cc
  3%    | Special: gold, silver, platinum
  0.25% | Special: rough diamonds
Do NOT show 12% or 28% as current general slabs. They have been merged into 5% and 18% respectively.

INCOME TAX SLABS — NEW REGIME (Default, IT Act 2025, FY 2025-26):
Use ONLY these slabs for new regime calculations. This is the default regime under IT Act 2025.
  Slab               | Rate
  ₹0 – ₹4,00,000    | Nil
  ₹4,00,001 – ₹8,00,000   | 5%
  ₹8,00,001 – ₹12,00,000  | 10%
  ₹12,00,001 – ₹16,00,000 | 15%
  ₹16,00,001 – ₹20,00,000 | 20%
  ₹20,00,001 – ₹24,00,000 | 25%
  Above ₹24,00,000         | 30%
  Standard Deduction: ₹75,000
  Rebate u/s 87A: Full tax rebate if taxable income ≤ ₹12,00,000 (max rebate ₹60,000)
  Cess: 4% Health & Education Cess on total tax
  Surcharge: 10% (₹50L-₹1Cr), 15% (₹1Cr-₹2Cr), 25% (₹2Cr-₹5Cr)

USING REFERENCE CONTEXT:
- Official Act text may be included in the message for reference verification. Use it silently to verify section numbers and rates.
- If the reference contradicts your knowledge, prefer the reference (it reflects the latest Act amendments).
- CRITICAL: NEVER acknowledge, thank, mention, or reference the Act texts provided in the message. The user does NOT see them — they are injected by the system. Treat them as invisible background knowledge. Phrases like "Thank you for sharing the reference", "the reference texts align with", "based on the Act text provided" are STRICTLY FORBIDDEN. Just answer the question directly as if you knew the information yourself.

BANNED PHRASES — NEVER use these in any response:
- "provided context", "the context", "based on the context", "reference context"
- "reference Act texts", "the texts you shared", "thank you for sharing"
- "the Act text provided", "as per the reference", "aligns with the reference"
- "potential future trends", "might focus on", "could involve" (no speculation)
- Do NOT list basic/obvious sections as filler
- Do NOT pad answers with compliance deadlines, generic return filing dates, or section lists

RESPONSE APPROACH:
- Lead with the ACTUAL answer. If changes exist, list them directly. If no changes exist, say so immediately.
- If you know the answer, give it confidently. Do not hedge with "based on general knowledge".
- Focus on the LATEST known changes (Budget 2025, Finance Act 2025, IT Act 2025, GST Council decisions).
- NEVER invent tables of rate changes, slab restructurings, or policy announcements that you are not certain actually happened.
- STAY FOCUSED: Only discuss sections/provisions that ACTUALLY APPLY to the user's question. If a section is not relevant, do not analyze it — skip it entirely. A concise answer covering what applies is better than an exhaustive analysis of everything that doesn't.
- If the RAG context includes sections that are irrelevant to the question, IGNORE them. Do not explain why they don't apply.

FOCUS ON THE QUESTION:
- Read the user's ACTUAL question carefully. Do not repeat the same answer for different questions.
- If the user asks about a specific form, explain THAT form in detail.
- If the user asks for a comparison, give a FULL comparison table covering ALL relevant items.
- If the user corrects themselves, answer the corrected question specifically.`;

const MAX_HISTORY_MESSAGES = 10;

// Attachment limits per plan
const ATTACHMENT_LIMITS: Record<string, number> = { free: 1, pro: 3, enterprise: 5 };

router.post('/chat', async (req: AuthRequest, res: Response) => {
  const { chatId, message, fileContext, fileContexts: rawFileContexts } = req.body;
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

  // Check plan-based message limit
  const user = userRepo.findById(req.user.id);
  const plan = user?.plan ?? 'free';
  const planConfig = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const used = getMessageCount(req.user.id, planConfig.period);

  if (used >= planConfig.limit) {
    const periodLabel = planConfig.period === 'day' ? 'daily' : 'monthly';
    res.status(429).json({
      error: `You've reached your ${periodLabel} message limit (${planConfig.limit} messages). Upgrade your plan for more.`,
      upgrade: true,
    });
    return;
  }

  // Check attachment limit
  const attachLimit = ATTACHMENT_LIMITS[plan] ?? 1;
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
    const contextStr = fileContexts
      .filter(fc => fc.extractedData)
      .map(fc => `[Attached: ${fc.filename}]\n${JSON.stringify(fc.extractedData)}`)
      .join('\n\n');
    if (contextStr) {
      userContent = `${contextStr}\n\n${userContent}`;
    }
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
      const useWebSearch = shouldEnableWebSearch(message);
      const stream = await grok.chat.completions.create({
        model: GROK_MODEL,
        messages,
        max_tokens: MAX_TOKENS,
        stream: true,
        stream_options: { include_usage: true },
        ...(useWebSearch ? { tools: [{ type: 'web_search' }] as any } : {}),
      });

      let stopReason: string | null = null;
      let inputTok = 0;
      let outputTok = 0;
      let usedWebSearch = false;

      for await (const chunk of stream) {
        // Skip tool call deltas (web search internals — don't send to client)
        if (chunk.choices?.[0]?.delta?.tool_calls) {
          usedWebSearch = true;
          continue;
        }

        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          fullResponse += delta;
          res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
        }

        // Capture finish reason
        const finishReason = chunk.choices?.[0]?.finish_reason;
        if (finishReason) {
          stopReason = finishReason === 'length' ? 'max_tokens' : 'end_turn';
        }

        // Capture token usage (arrives in the final chunk)
        if (chunk.usage) {
          inputTok = chunk.usage.prompt_tokens ?? 0;
          outputTok = chunk.usage.completion_tokens ?? 0;
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

      // Log usage (include web search cost if used)
      const cost = (inputTok * INPUT_COST_PER_TOKEN) + (outputTok * OUTPUT_COST_PER_TOKEN) + (usedWebSearch ? WEB_SEARCH_COST : 0);
      usageRepo.log(clientIp, req.user.id, inputTok, outputTok, cost, false);

      res.write(`data: ${JSON.stringify({ done: true, stop_reason: stopReason, references: ragReferences })}\n\n`);
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
