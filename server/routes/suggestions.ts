import { Router, Response } from 'express';
import { grok, GROK_MODEL } from '../lib/grok.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { AuthRequest } from '../types.js';

const router = Router();

const SUGGESTION_PROMPT = `You are an expert Indian tax advisor. Given the user's income and deduction details, provide exactly 5 personalized tax-saving suggestions.

For each suggestion, return a JSON array with objects containing:
- "title": Short title (e.g., "Maximize ELSS under 80C")
- "section": Applicable section (e.g., "Section 80C")
- "action": Specific action to take (1-2 sentences)
- "estimatedSaving": Estimated annual tax saving in INR (number)
- "priority": 1-5 (1 = most impactful)

Return ONLY the JSON array, no markdown, no explanation.
Consider: current regime, income level, existing deductions, age category.
Suggest actionable, realistic strategies — not generic advice.`;

router.post('/optimize', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Plan gate: Pro+ only
  const user = userRepo.findById(req.user.id);
  const plan = user?.plan ?? 'free';
  if (plan === 'free') {
    res.status(403).json({ error: 'AI suggestions require a Pro or Enterprise plan.', upgrade: true });
    return;
  }

  const { grossIncome, taxableIncome, regime, ageCategory, deductions, fy } = req.body;

  if (!grossIncome || !fy) {
    res.status(400).json({ error: 'Income and FY details are required' });
    return;
  }

  try {
    const userPrompt = `Income Profile:
- Gross Annual Income: ₹${grossIncome.toLocaleString('en-IN')}
- Taxable Income: ₹${(taxableIncome ?? grossIncome).toLocaleString('en-IN')}
- Current Regime: ${regime ?? 'new'}
- Age Category: ${ageCategory ?? 'below60'}
- Financial Year: ${fy}
- Current Deductions: ${deductions ? JSON.stringify(deductions) : 'None claimed'}

Suggest 5 personalized tax-saving strategies.`;

    const response = await grok.chat.completions.create({
      model: GROK_MODEL,
      messages: [
        { role: 'system', content: SUGGESTION_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1024,
    });

    const raw = response.choices[0]?.message?.content ?? '[]';
    const cleaned = raw.replace(/^```json\n?/m, '').replace(/\n?```$/m, '').trim();
    const suggestions = JSON.parse(cleaned);

    res.json({ suggestions });
  } catch (err) {
    console.error('[suggestions] Error:', err);
    res.status(500).json({ error: 'Failed to generate suggestions. Please try again.' });
  }
});

export default router;
