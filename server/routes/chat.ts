// server/routes/chat.ts
import { Router, Response } from 'express';
import { GoogleGenAI, createPartFromUri, Part } from '@google/genai';
import { chatRepo } from '../db/repositories/chatRepo.js';
import { messageRepo } from '../db/repositories/messageRepo.js';
import { AuthRequest } from '../types.js';

const router = Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// SYSTEM_INSTRUCTION — authoritative copy lives here on the server
const SYSTEM_INSTRUCTION = `You are "Tax Assistant", a highly specialized AI assistant for Indian Tax and Financial matters.
Your expertise includes:
1. Income Tax Act, 1961: Detailed knowledge of Old vs New Tax Regimes (FY 2024-25, FY 2025-26), deductions (80C, 80D, etc.), HRA, LTA, and capital gains.
2. GST (Goods and Services Tax): Rates, filing requirements, ITC, and compliance for businesses and freelancers.
3. Professional Queries: Tax implications for Salaried employees, Freelancers (44ADA), and Small Businesses (44AD).
4. Math & Calculations: Accurate calculation of tax liability, cess, and surcharges.
5. Financial Planning: Suggesting tax-saving investments like PPF, ELSS, NPS, etc.

CHART GENERATION:
When providing statistical data or tax comparisons, you MUST also provide a JSON block for visualization.
Format: \`\`\`json-chart { ... } \`\`\`

Supported chart types:

"bar" — single-series bar chart
{ "type": "bar", "title": "...", "data": [{ "name": "...", "value": 123 }, ...] }

"pie" — donut/pie chart
{ "type": "pie", "title": "...", "data": [{ "name": "...", "value": 123 }, ...] }

"line" — line chart (use for trends over income/time)
{ "type": "line", "title": "...", "data": [{ "name": "5L", "rate": 0 }, ...], "lines": ["rate"] }
"lines" is required — list the data keys to plot as lines.

"stacked-bar" — stacked bar chart (use for showing composition/breakdown)
{ "type": "stacked-bar", "title": "...", "data": [{ "name": "80C", "used": 150000, "remaining": 50000 }], "keys": ["used", "remaining"] }
"keys" is required — list the data keys to stack.

"composed" — combined bar + line chart (use for overlaying two different scales)
{ "type": "composed", "title": "...", "data": [{ "name": "FY24", "income": 1200000, "tax": 97500 }], "bars": ["income"], "lines": ["tax"] }
"bars" and "lines" are required — list keys for bar series and line series respectively.

Use "line" for: effective tax rate progression, year-over-year comparison.
Use "stacked-bar" for: deduction breakdown (used vs. remaining), income composition.
Use "composed" for: income vs. tax overlay, gross vs. net comparison.

TABLE FORMATTING (CRITICAL):
- Use standard GFM (GitHub Flavored Markdown) table syntax.
- Ensure there is a blank line before and after every table.
- Ensure each row is on a NEW line.
- Use the standard header separator: | Header | Header | \n | --- | --- | \n | Row | Row |
- DO NOT use double pipes (||) for rows. Use single pipes (|) at the start and end of each row.

Guidelines:
- Always specify which Assessment Year (AY) or Financial Year (FY) you are referring to.
- For calculations, show the step-by-step breakdown in a Markdown table.
- Use clear, professional, yet accessible language.
- Include a disclaimer that you are an AI assistant and users should consult a Chartered Accountant (CA) for official filing.
- Use Markdown (tables, bold text, lists) to make complex information readable.
- If a query is not related to Indian tax or finance, politely redirect the user.`;

router.post('/chat', async (req: AuthRequest, res: Response) => {
  const { chatId, message, fileContext } = req.body;

  // Validate
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

  // Verify chat belongs to user
  const chat = chatRepo.findById(chatId);
  if (!chat || chat.user_id !== req.user!.id) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }

  // Persist user message
  messageRepo.create(
    chatId,
    'user',
    message.trim(),
    fileContext?.filename,
    fileContext?.mimeType
  );

  // Load history from DB
  const dbMessages = messageRepo.findByChatId(chatId);
  // Convert to Gemini history format (exclude the last user message — we send it separately)
  const history = dbMessages.slice(0, -1).map(m => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let fullResponse = '';

  try {
    const geminiChat = ai.chats.create({
      model: 'gemini-2.0-flash',
      config: { systemInstruction: SYSTEM_INSTRUCTION },
      history,
    });

    // Build message parts
    const messageParts: Part[] = [];
    if (fileContext?.uri && fileContext?.mimeType) {
      messageParts.push(createPartFromUri(fileContext.uri, fileContext.mimeType));
    }
    messageParts.push({ text: message });

    const stream = await geminiChat.sendMessageStream({ message: messageParts });

    for await (const chunk of stream) {
      if (chunk.text) {
        fullResponse += chunk.text;
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }

    // Persist model response
    if (fullResponse) {
      messageRepo.create(chatId, 'model', fullResponse);
    }

    // Auto-title: if this is the first user message, set chat title
    if (chat.title === 'New Chat' && message.trim().length > 0) {
      const title = message.trim().slice(0, 60) + (message.trim().length > 60 ? '...' : '');
      chatRepo.updateTitle(chatId, title);
    }

    // Touch timestamp
    chatRepo.touchTimestamp(chatId);

    res.write('data: [DONE]\n\n');
  } catch (err) {
    console.error('[chat] Gemini API error:', err);
    const errMsg = err instanceof Error ? err.message : String(err);
    const isExpiredFile = errMsg.includes('404') || errMsg.toLowerCase().includes('file not found');
    const clientMessage = isExpiredFile
      ? 'The uploaded document has expired. Please upload it again to continue document Q&A.'
      : "I'm having trouble connecting. Please try again in a moment.";
    res.write(`data: ${JSON.stringify({ error: true, message: clientMessage })}\n\n`);
  } finally {
    res.end();
  }
});

export default router;
