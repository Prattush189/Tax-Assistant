// server/routes/chat.ts
import { Router, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chatRepo } from '../db/repositories/chatRepo.js';
import { messageRepo } from '../db/repositories/messageRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { AuthRequest } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 4096;

// Haiku 4.5 pricing
const INPUT_COST_PER_TOKEN = 1 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 5 / 1_000_000;

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

// Load tax reference data at startup
const TAX_REFERENCE = readFileSync(join(__dirname, '..', 'data', 'tax-reference.md'), 'utf-8');

const SYSTEM_INSTRUCTION = `You are "Smart AI" — an expert on Indian Income Tax, GST, and financial planning.

SCOPE: Only answer questions about Indian tax, GST, deductions, capital gains, and financial planning. Politely decline other topics.

RULES:
- Default to FY 2025-26 (AY 2026-27) unless user specifies otherwise
- Specify FY/AY for all calculations
- Show tax breakdowns in compact Markdown tables (GFM syntax, blank lines before/after tables)
- Be concise: answer in the fewest words possible while staying accurate
- Mention consulting a CA for official filing
- For comparisons, include a json-chart block: \`\`\`json-chart {"type":"bar"|"pie"|"line","title":"...","data":[{"name":"...","value":0}]} \`\`\`
- ALWAYS use the tax reference data below for rates, slabs, and limits — never guess or use outdated figures

<tax-reference>
${TAX_REFERENCE}
</tax-reference>`;

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

  // Check IP block
  const blocked = usageRepo.isBlocked(clientIp);
  if (blocked) {
    res.status(403).json({
      error: `This IP is blocked${blocked.blocked_until ? ' until ' + blocked.blocked_until + ' IST' : ''}. ${blocked.reason || ''}`.trim(),
    });
    return;
  }

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

  // Load history from DB
  const dbMessages = messageRepo.findByChatId(chatId);
  const history = dbMessages.slice(0, -1)
    .slice(-MAX_HISTORY_MESSAGES)
    .map(m => ({
      role: (m.role === 'model' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    }));

  if (history.length > 0 && history[0].role !== 'user') {
    history.shift();
  }

  let userContent = message.trim();
  if (fileContext?.extractedData) {
    userContent = `[Attached document context: ${JSON.stringify(fileContext.extractedData)}]\n\n${userContent}`;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let fullResponse = '';

  try {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_INSTRUCTION,
      messages: [
        ...history,
        { role: 'user', content: userContent },
      ],
    });

    let stopReason: string | null = null;

    stream.on('text', (text) => {
      fullResponse += text;
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });

    const finalMsg = await stream.finalMessage();
    stopReason = finalMsg.stop_reason;

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
    const inputTok = finalMsg.usage.input_tokens;
    const outputTok = finalMsg.usage.output_tokens;
    const cost = (inputTok * INPUT_COST_PER_TOKEN) + (outputTok * OUTPUT_COST_PER_TOKEN);
    usageRepo.log(clientIp, req.user.id, inputTok, outputTok, cost, false);

    res.write(`data: ${JSON.stringify({ done: true, stop_reason: stopReason })}\n\n`);
  } catch (err) {
    console.error('[chat] Anthropic API error:', err);
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
