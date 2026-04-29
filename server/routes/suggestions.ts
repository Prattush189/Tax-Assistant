import { Router, Response } from 'express';
import { GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST } from '../lib/gemini.js';
import { callGeminiJson } from '../lib/geminiJson.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { getBillingUser } from '../lib/billing.js';
import { enforceTokenQuota } from '../lib/tokenQuota.js';
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

  // Token-budget gate — the only HARD quota check now. Per-feature
  // count below stays for analytics display.
  const tokenQuota = enforceTokenQuota(req, res);
  if (!tokenQuota.ok) return;
  const usedThisMonth = featureUsageRepo.countThisMonthByBillingUser(billingUserId, 'ai_suggestions');

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

    // Suggestions JSON is wrapped in an object so JSON mode is happy: the
    // schema asks for `{ "suggestions": [...] }` and we unwrap on the client.
    // (Gemini's OpenAI-compat layer rejects bare JSON arrays from json_object.)
    const result = await callGeminiJson<{ suggestions?: unknown[] } | unknown[]>(
      [
        { role: 'system', content: SUGGESTION_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      { maxTokens: 1024 },
    );
    const suggestions = Array.isArray(result.data)
      ? result.data
      : (result.data as { suggestions?: unknown[] }).suggestions ?? [];

    // Log successful usage toward monthly cap (actor + billing owner)
    featureUsageRepo.logWithBilling(req.user.id, billingUserId, 'ai_suggestions');

    // Log to api_usage for admin dashboard visibility
    const cost = result.inputTokens * GEMINI_T2_INPUT_COST + result.outputTokens * GEMINI_T2_OUTPUT_COST;
    usageRepo.logWithBilling(clientIp, req.user.id, billingUserId, result.inputTokens, result.outputTokens, cost, false, result.modelUsed, false, 'suggestion');

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
