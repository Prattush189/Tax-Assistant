// server/routes/chat.ts
import { Router, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { chatRepo } from '../db/repositories/chatRepo.js';
import { messageRepo } from '../db/repositories/messageRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { AuthRequest } from '../types.js';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 4096;

// ── Token-based cost tracking per IP ──
// Haiku 4.5: $1/MTok input, $5/MTok output
const INPUT_COST_PER_TOKEN = 1 / 1_000_000;   // $0.000001
const OUTPUT_COST_PER_TOKEN = 5 / 1_000_000;   // $0.000005

// Monthly budgets (configurable via env)
const MONTHLY_BUDGET_APP = parseFloat(process.env.MONTHLY_BUDGET_APP ?? '5');       // $5/month for main app
const MONTHLY_BUDGET_PLUGIN = parseFloat(process.env.MONTHLY_BUDGET_PLUGIN ?? '1'); // $1/month for plugin

interface CostRecord {
  cost: number;
  resetAt: number;
}
const ipCosts = new Map<string, CostRecord>();

function getMonthResetTimestamp(): number {
  const now = new Date();
  // Reset on 1st of next month at midnight IST (18:30 UTC previous day)
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 18, 30, 0));
  if (reset.getTime() <= now.getTime()) {
    reset.setUTCMonth(reset.getUTCMonth() + 1);
  }
  return reset.getTime();
}

function checkBudget(ip: string, isPlugin: boolean): { allowed: boolean; spent: number; budget: number } {
  const now = Date.now();
  const record = ipCosts.get(ip);
  const budget = isPlugin ? MONTHLY_BUDGET_PLUGIN : MONTHLY_BUDGET_APP;

  if (!record || now > record.resetAt) {
    ipCosts.set(ip, { cost: 0, resetAt: getMonthResetTimestamp() });
    return { allowed: true, spent: 0, budget };
  }

  return { allowed: record.cost < budget, spent: record.cost, budget };
}

function addCost(ip: string, inputTokens: number, outputTokens: number): void {
  const cost = (inputTokens * INPUT_COST_PER_TOKEN) + (outputTokens * OUTPUT_COST_PER_TOKEN);
  const record = ipCosts.get(ip);
  if (record) {
    record.cost += cost;
  }
}

// Cleanup stale entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipCosts) {
    if (now > record.resetAt) ipCosts.delete(ip);
  }
}, 60 * 60 * 1000);

// System prompt
const SYSTEM_INSTRUCTION = `You are "Tax Assistant" — an expert on Indian Income Tax, GST, and financial planning.

SCOPE: Only answer questions about Indian tax, GST, deductions, capital gains, and financial planning. Politely decline other topics.

RULES:
- Specify FY/AY for all calculations
- Show tax breakdowns in compact Markdown tables (GFM syntax, blank lines before/after tables)
- Be concise: answer in the fewest words possible while staying accurate
- Mention consulting a CA for official filing
- For comparisons, include a json-chart block: \`\`\`json-chart {"type":"bar"|"pie"|"line","title":"...","data":[{"name":"...","value":0}]} \`\`\`

DEDUCTION LIMITS (FY 2024-25):
80C: ₹1.5L | 80D: ₹25K/₹50K(senior) | 80CCD(1B): ₹50K | HRA: metro 50%, non-metro 40%
New regime std deduction: ₹75K | Old regime std deduction: ₹50K
New regime rebate 87A: ₹25K (income ≤₹7L) | Old regime rebate 87A: ₹12.5K (income ≤₹5L)`;

const MAX_HISTORY_MESSAGES = 10;

router.post('/chat', async (req: AuthRequest, res: Response) => {
  const { chatId, message, history: clientHistory, fileContext } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  if (message.length > 4000) {
    res.status(400).json({ error: 'message exceeds 4000 character limit' });
    return;
  }

  const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const isPlugin = !!req.headers['x-plugin-key'];

  // Check IP block
  const blocked = usageRepo.isBlocked(clientIp);
  if (blocked) {
    res.status(403).json({
      error: `This IP is blocked${blocked.blocked_until ? ' until ' + blocked.blocked_until + ' IST' : ''}. ${blocked.reason || ''}`.trim(),
    });
    return;
  }

  // Check monthly token budget
  const budget = checkBudget(clientIp, isPlugin);
  if (!budget.allowed) {
    res.status(429).json({
      error: 'Monthly usage limit reached. Your limit resets on the 1st of next month.',
    });
    return;
  }

  const isAuthenticated = !!req.user;
  let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let chat: { title: string } | null = null;

  if (isAuthenticated && chatId) {
    const dbChat = chatRepo.findById(chatId);
    if (!dbChat || dbChat.user_id !== req.user!.id) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }
    chat = dbChat;

    messageRepo.create(chatId, 'user', message.trim(), fileContext?.filename, fileContext?.mimeType);

    const dbMessages = messageRepo.findByChatId(chatId);
    history = dbMessages.slice(0, -1)
      .slice(-MAX_HISTORY_MESSAGES)
      .map(m => ({
        role: (m.role === 'model' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content,
      }));
  } else {
    const raw = Array.isArray(clientHistory) ? clientHistory : [];
    history = raw.slice(-MAX_HISTORY_MESSAGES).map((m: { role: string; parts?: Array<{ text: string }>; content?: string }) => ({
      role: (m.role === 'model' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.parts?.[0]?.text ?? m.content ?? '',
    }));
  }

  if (history.length > 0 && history[0].role !== 'user') {
    history = history.slice(1);
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

    // Track token costs
    const inputTok = finalMsg.usage.input_tokens;
    const outputTok = finalMsg.usage.output_tokens;
    addCost(clientIp, inputTok, outputTok);

    // Persist usage to DB
    const cost = (inputTok * INPUT_COST_PER_TOKEN) + (outputTok * OUTPUT_COST_PER_TOKEN);
    usageRepo.log(clientIp, req.user?.id ?? null, inputTok, outputTok, cost, isPlugin);

    // Persist model response (authenticated only)
    if (isAuthenticated && chatId && fullResponse) {
      messageRepo.create(chatId, 'model', fullResponse);

      if (chat?.title === 'New Chat' && message.trim().length > 0) {
        const title = message.trim().slice(0, 60) + (message.trim().length > 60 ? '...' : '');
        chatRepo.updateTitle(chatId, title);
      }
      chatRepo.touchTimestamp(chatId);
    }

    // Send done with stop_reason so frontend knows if response was truncated
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
