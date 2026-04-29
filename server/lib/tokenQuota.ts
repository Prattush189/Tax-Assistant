/**
 * Cross-feature token-budget gate.
 *
 * Replaces the per-feature credit gates (`enforceQuota` in
 * bankStatements / ledgerScrutiny / etc.) with a single number that
 * caps total Gemini token spend per user per month, regardless of
 * which features they ran.
 *
 *   Free       250 K tokens
 *   Pro          2 M
 *   Enterprise 7.5 M
 *
 * Counts toward the budget: any call that completed (success) or
 * was cancelled mid-flight (cancelled). Both consumed real tokens;
 * the bill comes either way.
 *
 * Excluded from the budget: failed calls (timeouts, content-filter
 * rejections, network errors). Those are typically retried
 * successfully and shouldn't double-bill the user. They're still
 * logged with status='failed' for the admin dashboard's wasted-
 * spend visibility.
 *
 * The check is best-effort up-front: it doesn't try to predict the
 * cost of THIS request, only that the user is within budget when
 * they start. A single oversized call can land them slightly over
 * budget; the next call after that hard-fails with 429.
 */

import type { Response } from 'express';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { getUserLimits, getEffectivePlan } from './planLimits.js';
import { getBillingUser } from './billing.js';
import type { AuthRequest } from '../types.js';

export interface TokenQuotaOk {
  ok: true;
  billingUserId: string;
  plan: string;
  budget: number;
  used: number;
  remaining: number;
}

export interface TokenQuotaDenied {
  ok: false;
}

export type TokenQuotaResult = TokenQuotaOk | TokenQuotaDenied;

/** Resolve and check the user's token budget. Sends a 429 response
 *  when the budget is exhausted (or when a passed-in estimate would
 *  push the user over budget) and returns ok=false so the caller can
 *  early-return without burning any Gemini calls.
 *
 *  estimatedTokens: optional rough-cost estimate for THIS run.
 *  Bank/ledger uploads pass `rowCount × tokens-per-row` so a 5,000-
 *  row PDF that would clearly exceed remaining budget hard-fails up
 *  front with a clear "use a smaller file" message rather than
 *  burning the first chunk's worth of tokens before hitting the
 *  cap. Defaults to 0 (just check current usage). */
export function enforceTokenQuota(
  req: AuthRequest,
  res: Response,
  estimatedTokens: number = 0,
): TokenQuotaResult {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return { ok: false };
  }
  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : undefined;
  const billingUserId = billingUser?.id ?? req.user.id;
  const plan = billingUser ? getEffectivePlan(billingUser) : (actor ? getEffectivePlan(actor) : 'free');
  const limitSource = billingUser ?? actor;
  const budget = limitSource ? getUserLimits(limitSource).monthlyTokenBudget : 0;

  let used = 0;
  try {
    used = usageRepo.sumTokensThisMonthByBillingUser(billingUserId);
  } catch (err) {
    console.error('[tokenQuota] Failed to read usage:', err);
  }

  const remaining = Math.max(0, budget - used);
  if (budget > 0 && used >= budget) {
    const pct = Math.round((used / budget) * 100);
    res.status(429).json({
      error: `You've used ${pct}% of your monthly token budget (${used.toLocaleString('en-IN')} / ${budget.toLocaleString('en-IN')} tokens). Upgrade your plan or wait until next month.`,
      tokensUsed: used,
      tokenBudget: budget,
      upgrade: plan !== 'enterprise',
    });
    return { ok: false };
  }
  // Pre-flight estimate check: if the caller knows roughly how many
  // tokens this run will need and the user doesn't have that headroom,
  // surface a tailored "use a smaller file" message instead of failing
  // half-way through a chunked run.
  if (estimatedTokens > 0 && estimatedTokens > remaining) {
    res.status(429).json({
      error: `This file would consume about ${estimatedTokens.toLocaleString('en-IN')} tokens, but you only have ${remaining.toLocaleString('en-IN')} left this month (${used.toLocaleString('en-IN')} of ${budget.toLocaleString('en-IN')} already used). Try a smaller file or split it, or upgrade your plan.`,
      tokensUsed: used,
      tokenBudget: budget,
      tokensEstimated: estimatedTokens,
      tokensRemaining: remaining,
      upgrade: plan !== 'enterprise',
    });
    return { ok: false };
  }
  return { ok: true, billingUserId, plan, budget, used, remaining };
}

/** Estimate-only soft warning. Caller can use this to add a small
 *  buffer ("you have 5K tokens left, this run will likely cost
 *  20K — proceed?") without blocking. Optional. */
export function tokensRemainingForUser(req: AuthRequest): { used: number; budget: number; remaining: number } {
  if (!req.user) return { used: 0, budget: 0, remaining: 0 };
  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : undefined;
  const billingUserId = billingUser?.id ?? req.user.id;
  const limitSource = billingUser ?? actor;
  const budget = limitSource ? getUserLimits(limitSource).monthlyTokenBudget : 0;
  let used = 0;
  try {
    used = usageRepo.sumTokensThisMonthByBillingUser(billingUserId);
  } catch {
    // best-effort
  }
  return { used, budget, remaining: Math.max(0, budget - used) };
}
