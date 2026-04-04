// server/routes/chat.ts
import { Router, Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { validateChatRequest } from '../middleware/validation.js';

const router = Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// SYSTEM_INSTRUCTION moved from App.tsx — authoritative copy lives here on the server
const SYSTEM_INSTRUCTION = `You are "Tax Assistant", a highly specialized AI assistant for Indian Tax and Financial matters.
Your expertise includes:
1. Income Tax Act, 1961: Detailed knowledge of Old vs New Tax Regimes (FY 2024-25, FY 2025-26), deductions (80C, 80D, etc.), HRA, LTA, and capital gains.
2. GST (Goods and Services Tax): Rates, filing requirements, ITC, and compliance for businesses and freelancers.
3. Professional Queries: Tax implications for Salaried employees, Freelancers (44ADA), and Small Businesses (44AD).
4. Math & Calculations: Accurate calculation of tax liability, cess, and surcharges.
5. Financial Planning: Suggesting tax-saving investments like PPF, ELSS, NPS, etc.

CHART GENERATION:
When providing statistical data or tax comparisons, you MUST also provide a JSON block for visualization.
Format: \`\`\`json-chart { "type": "bar" | "pie", "data": [...], "title": "..." } \`\`\`
- For "bar": data should be [{ "name": "...", "value": 123 }, ...]
- For "pie": data should be [{ "name": "...", "value": 123 }, ...]

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

router.post('/chat', async (req: Request, res: Response) => {
  // Validate request body
  const validationError = validateChatRequest(req.body);
  if (validationError) {
    res.status(validationError.status).json({ error: validationError.message });
    return;
  }

  const { message, history = [] } = req.body;

  // SSE headers
  // X-Accel-Buffering: no disables Apache/Nginx buffering — critical for streaming to work in production
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const chat = ai.chats.create({
      model: 'gemini-2.0-flash',
      config: { systemInstruction: SYSTEM_INSTRUCTION },
      history: history,
    });

    const stream = await chat.sendMessageStream({ message });

    for await (const chunk of stream) {
      if (chunk.text) {
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }

    // [DONE] sentinel tells the client the stream is complete
    res.write('data: [DONE]\n\n');
  } catch (err) {
    console.error('[chat] Gemini API error:', err);
    // Friendly error per CONTEXT.md — no technical details exposed to client
    res.write(`data: ${JSON.stringify({ error: true, message: "I'm having trouble connecting. Please try again in a moment." })}\n\n`);
  } finally {
    res.end();
  }
});

export default router;
