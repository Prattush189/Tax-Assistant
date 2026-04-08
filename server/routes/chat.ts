// server/routes/chat.ts
import { Router, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { chatRepo } from '../db/repositories/chatRepo.js';
import { messageRepo } from '../db/repositories/messageRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { retrieveContext } from '../rag/index.js';
import { AuthRequest } from '../types.js';

const router = Router();
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });

const PRIMARY_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODEL = 'gemini-2.0-flash';
const MAX_TOKENS = 8192;

// Gemini Flash pricing (conservative — uses 2.5 rates)
const INPUT_COST_PER_TOKEN = 0.15 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 0.60 / 1_000_000;

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
  const result = usageRepo.countByUser(userId, since);
  return result;
}

const SYSTEM_INSTRUCTION = `You are "Smart AI" — an expert on Indian Income Tax, GST, and financial planning. You give thorough, professional, well-structured answers.

SCOPE: Only answer questions about Indian tax, GST, deductions, capital gains, and financial planning. Politely decline other topics.

RESPONSE QUALITY:
- Give DETAILED, comprehensive answers. Do NOT give one-line or two-line answers. Each response should be thorough and educational.
- Always use Markdown formatting: headings (##, ###), bold, bullet points, numbered lists.
- ALWAYS include a Markdown table when presenting rates, limits, thresholds, comparisons, or mappings. Tables make data scannable.
- For old vs new Act comparisons, ALWAYS show a mapping table with Old Section | New Section | Nature columns.
- For tax computations, show step-by-step breakdown in a table.
- For comparisons (old vs new regime, FY comparisons), include a json-chart block: \`\`\`json-chart {"type":"bar"|"pie"|"line","title":"...","data":[{"name":"...","value":0}]} \`\`\`
- End with a brief practical tip or recommendation where relevant.
- Mention consulting a CA for official filing.

ACCURACY:
- Default to FY 2025-26 (AY 2026-27) unless user specifies otherwise.
- Cite specific section numbers when referencing the Act (both old and new Act numbers if applicable).
- The Income Tax Act 2025 (effective 1 April 2026) replaced the 1961 Act. Use "Tax Year" not "Assessment Year" for the new Act.
- When reference context is provided in the message, use it to answer accurately but DO NOT mention the reference. Just answer directly.
- If the reference does not cover the topic, answer from your own knowledge. NEVER say "I cannot find this" or ask the user to provide data.

USING REFERENCE CONTEXT:
- Reference context from the Income Tax Acts may be provided with the question. Use it ONLY to validate facts, verify section numbers, and fill gaps in your knowledge.
- Do NOT blindly summarize or parrot the reference. Use your own expertise to craft the answer, and cross-check specific numbers (rates, thresholds, section numbers) against the reference.
- If the reference contains information that contradicts your knowledge, prefer the reference (it reflects the latest Act amendments).
- If the reference is not relevant to the question asked, IGNORE it completely. Answer from your own knowledge.
- NEVER fabricate section numbers, rates, or thresholds. If unsure, say so and recommend consulting a CA.

FOCUS ON THE QUESTION:
- Read the user's ACTUAL question carefully. Do not repeat the same answer for different questions.
- If the user asks about a specific form, explain THAT form in detail (purpose, who files it, when, where, new form number).
- If the user asks for a comparison, give a FULL comparison table covering ALL relevant items, not just one.
- If the user corrects themselves ("I meant 15CA"), answer about 15CA specifically — do not repeat your previous answer.`;

const MAX_HISTORY_MESSAGES = 10;

router.post('/chat', async (req: AuthRequest, res: Response) => {
  const { chatId, message, fileContext } = req.body;

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

  // Verify chat belongs to user
  const chat = chatRepo.findById(chatId);
  if (!chat || chat.user_id !== req.user.id) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }

  // Persist user message
  messageRepo.create(chatId, 'user', message.trim(), fileContext?.filename, fileContext?.mimeType);

  // Load history from DB — Gemini uses 'user'/'model' roles
  const dbMessages = messageRepo.findByChatId(chatId);
  const history = dbMessages.slice(0, -1)
    .slice(-MAX_HISTORY_MESSAGES)
    .map(m => ({
      role: m.role as 'user' | 'model',
      parts: [{ text: m.content }],
    }));

  if (history.length > 0 && history[0].role !== 'user') {
    history.shift();
  }

  let userContent = message.trim();
  if (fileContext?.extractedData) {
    userContent = `[Attached document context: ${JSON.stringify(fileContext.extractedData)}]\n\n${userContent}`;
  }

  // RAG: retrieve relevant Act sections
  const ragContext = retrieveContext(userContent);
  if (ragContext) {
    userContent = `[Relevant sections from the Income Tax Acts]:\n\n${ragContext}\n\n---\n\n${userContent}`;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let fullResponse = '';

  try {
    const requestBody = {
      contents: [
        ...history,
        { role: 'user' as const, parts: [{ text: userContent }] },
      ],
      config: {
        maxOutputTokens: MAX_TOKENS,
        systemInstruction: SYSTEM_INSTRUCTION,
      },
    };

    let stream;
    try {
      stream = await ai.models.generateContentStream({ model: PRIMARY_MODEL, ...requestBody });
    } catch (primaryErr) {
      const msg = primaryErr instanceof Error ? primaryErr.message : '';
      if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('overloaded')) {
        console.warn(`[chat] ${PRIMARY_MODEL} unavailable, falling back to ${FALLBACK_MODEL}`);
        stream = await ai.models.generateContentStream({ model: FALLBACK_MODEL, ...requestBody });
      } else {
        throw primaryErr;
      }
    }

    let stopReason: string | null = null;
    let inputTok = 0;
    let outputTok = 0;

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }

      // Capture usage from the last chunk
      if (chunk.usageMetadata) {
        inputTok = chunk.usageMetadata.promptTokenCount ?? 0;
        outputTok = chunk.usageMetadata.candidatesTokenCount ?? 0;
      }

      // Capture stop reason from candidates
      if (chunk.candidates?.[0]?.finishReason) {
        const reason = chunk.candidates[0].finishReason;
        stopReason = reason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn';
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

    // Log usage
    const cost = (inputTok * INPUT_COST_PER_TOKEN) + (outputTok * OUTPUT_COST_PER_TOKEN);
    usageRepo.log(clientIp, req.user.id, inputTok, outputTok, cost, false);

    res.write(`data: ${JSON.stringify({ done: true, stop_reason: stopReason })}\n\n`);
  } catch (err) {
    console.error('[chat] Gemini API error:', err);
    const errMsg = err instanceof Error ? err.message : String(err);
    const isRateLimit = errMsg.includes('429') || errMsg.toLowerCase().includes('rate');
    const clientMessage = isRateLimit
      ? 'Too many requests. Please wait a moment and try again.'
      : "I'm having trouble connecting. Please try again in a moment.";
    res.write(`data: ${JSON.stringify({ error: true, message: clientMessage })}\n\n`);
  } finally {
    res.end();
  }
});

export default router;
