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
import { getUserLimits, getEffectivePlan, getUsagePeriodStart } from './planLimits.js';
import { getBillingUser } from './billing.js';
import { reservedTokensFor, reserve } from './quotaReservations.js';
import type { AuthRequest } from '../types.js';

export interface TokenQuotaOk {
  ok: true;
  billingUserId: string;
  plan: string;
  budget: number;
  used: number;
  remaining: number;
  /** Pre-flight estimate the gate accepted for this request. Routes
   *  pass this to `usageRepo.logWithBilling(..., estimatedTokens)` on
   *  the summary row so the admin dashboard can audit estimate
   *  vs. actual. Zero when the caller didn't provide an estimate. */
  estimatedTokens: number;
  /** Release the pre-flight reservation taken by this gate call. Always
   *  call from a `finally` once the Gemini work for this request has
   *  finished (success, failure, or cancel). Idempotent. */
  release: () => void;
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

  // Period start = yearly billing window for paid users (resets on
  // Razorpay renewal), or account lifetime for free-trial users (no
  // reset; lockout at 30 days via the trial wall).
  const periodStart = limitSource ? getUsagePeriodStart(limitSource) : new Date(0).toISOString().replace('Z', '');
  let realUsed = 0;
  try {
    realUsed = usageRepo.sumTokensSinceForBillingUser(billingUserId, periodStart);
  } catch (err) {
    console.error('[tokenQuota] Failed to read usage:', err);
  }
  // Effective usage = what's already logged to api_usage PLUS what's
  // currently in-flight (reservations from concurrent requests we've
  // gated but whose api_usage rows don't exist yet). Without this,
  // two requests that each fit in the remaining budget on their own
  // can both pass and collectively overshoot.
  const reserved = reservedTokensFor(billingUserId);
  const used = realUsed + reserved;
  const remaining = Math.max(0, budget - used);

  if (budget > 0 && used >= budget) {
    const pct = Math.round((used / budget) * 100);
    res.status(429).json({
      error: `You've used ${pct}% of your token budget (${used.toLocaleString('en-IN')} / ${budget.toLocaleString('en-IN')} tokens). ${plan === 'free' ? 'Upgrade to Pro or Enterprise to continue.' : 'Your budget resets on your next yearly renewal — renew now or upgrade your plan if you need more headroom.'}`,
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
      error: `This run would use about ${estimatedTokens.toLocaleString('en-IN')} tokens, but you only have ${remaining.toLocaleString('en-IN')} left in your current period (${used.toLocaleString('en-IN')} of ${budget.toLocaleString('en-IN')} already used${reserved > 0 ? `, including ${reserved.toLocaleString('en-IN')} in other runs currently in progress` : ''}). ${plan === 'free' ? 'Try a smaller file or upgrade to Pro for a 2M-token monthly budget.' : 'Try a smaller file, wait for in-flight runs to finish, or renew now to start a fresh quota.'}`,
      tokensUsed: used,
      tokenBudget: budget,
      tokensEstimated: estimatedTokens,
      tokensRemaining: remaining,
      upgrade: plan !== 'enterprise',
    });
    return { ok: false };
  }
  // Hold the estimate as a reservation for the duration of the request.
  // The caller releases this in a `finally` after their Gemini work
  // (and the corresponding api_usage row write) has completed. Once
  // the api_usage row exists, the next `realUsed` query will pick it
  // up — releasing the reservation simultaneously prevents the user's
  // effective usage from briefly double-counting.
  const release = reserve(billingUserId, estimatedTokens);
  return { ok: true, billingUserId, plan, budget, used, remaining, estimatedTokens, release };
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
  const periodStart = limitSource ? getUsagePeriodStart(limitSource) : new Date(0).toISOString().replace('Z', '');
  let used = 0;
  try {
    used = usageRepo.sumTokensSinceForBillingUser(billingUserId, periodStart);
  } catch {
    // best-effort
  }
  used += reservedTokensFor(billingUserId);
  return { used, budget, remaining: Math.max(0, budget - used) };
}
