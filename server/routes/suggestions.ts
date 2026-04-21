import { Router, Response } from 'express';
import { gemini, GEMINI_MODEL, GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST } from '../lib/gemini.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { getBillingUser } from '../lib/billing.js';
import { AuthRequest } from '../types.js';

const router = Router();

// Monthly AI suggestion limits per plan
const MONTHLY_LIMITS: Record<string, number> = {
  free: 50,
  pro: 200,
  enterprise: 1000,
};

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

  // Get plan + monthly limit from the BILLING (pool) user
  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : undefined;
  const billingUserId = billingUser?.id ?? req.user.id;
  const plan = billingUser?.plan ?? actor?.plan ?? 'free';
  const monthlyLimit = MONTHLY_LIMITS[plan] ?? 50;

  // Enforce monthly cap against the shared pool
  const usedThisMonth = featureUsageRepo.countThisMonthByBillingUser(billingUserId, 'ai_suggestions');
  if (usedThisMonth >= monthlyLimit) {
    res.status(429).json({
      error: `You've reached your monthly AI suggestions limit (${monthlyLimit}). Upgrade your plan for more, or wait until the 1st.`,
      upgrade: plan !== 'enterprise',
    });
    return;
  }

  const { grossIncome, taxableIncome, regime, ageCategory, deductions, fy } = req.body;

  if (!grossIncome || !fy) {
    res.status(400).json({ error: 'Income and FY details are required' });
    return;
  }

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';

  try {
    const userPrompt = `Income Profile:
- Gross Annual Income: ₹${grossIncome.toLocaleString('en-IN')}
- Taxable Income: ₹${(taxableIncome ?? grossIncome).toLocaleString('en-IN')}
- Current Regime: ${regime ?? 'new'}
- Age Category: ${ageCategory ?? 'below60'}
- Financial Year: ${fy}
- Current Deductions: ${deductions ? JSON.stringify(deductions) : 'None claimed'}

Suggest 5 personalized tax-saving strategies.`;

    const response = await gemini.chat.completions.create({
      model: GEMINI_MODEL, // gemini-2.5-flash-lite
      messages: [
        { role: 'system', content: SUGGESTION_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1024,
    });

    const raw = response.choices[0]?.message?.content ?? '[]';
    const cleaned = raw.replace(/^```json\n?/m, '').replace(/\n?```$/m, '').trim();
    const suggestions = JSON.parse(cleaned);

    // Log successful usage toward monthly cap (actor + billing owner)
    featureUsageRepo.logWithBilling(req.user.id, billingUserId, 'ai_suggestions');

    // Log to api_usage for admin dashboard visibility
    const inputTok = response.usage?.prompt_tokens ?? 0;
    const outputTok = response.usage?.completion_tokens ?? 0;
    const cost = inputTok * GEMINI_T2_INPUT_COST + outputTok * GEMINI_T2_OUTPUT_COST;
    usageRepo.logWithBilling(clientIp, req.user.id, billingUserId, inputTok, outputTok, cost, false, GEMINI_MODEL, false, 'suggestion');

    res.json({
      suggestions,
      usage: { used: usedThisMonth + 1, limit: monthlyLimit },
    });
  } catch (err) {
    console.error('[suggestions] Error:', err);
    res.status(500).json({ error: 'Failed to generate suggestions. Please try again.' });
  }
});

export default router;
