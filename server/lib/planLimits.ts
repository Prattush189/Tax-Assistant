/**
 * Centralized plan-limit resolution.
 *
 * Single hard quota gate now: `monthlyTokenBudget`. Every per-feature
 * limit (notices/3, deeds/15, statements/50, etc.) was removed in
 * favour of one cross-feature token budget — those numbers were
 * confusing users (a "Limit reached" UI badge fired even when they
 * had 80% of their tokens left) and the routes enforced them
 * inconsistently (some hard-rejected, some only displayed). The token
 * budget already captures the real cost ceiling we care about.
 *
 * Two sources of truth, checked in order:
 *   1. `plugin_limits` JSON column on the user row — token-budget
 *      override pushed by a parent/consultant app via the plugin SSO
 *      handshake.
 *   2. `plugin_plan` column — an override plan id whose defaults apply
 *      if plugin_limits doesn't specify a token budget.
 *   3. `plan` column — the user's standalone Smartbiz AI plan.
 *
 * `profiles` is kept on UserLimits because it's a multi-tenant
 * structure cap (max # client profiles per consultant), not an AI
 * cost gate — it doesn't make sense to fold into the token budget.
 */

import type { UserRow } from '../db/repositories/userRepo.js';

export type PlanId = 'free' | 'pro' | 'enterprise';

/** Number of days a free-plan trial lasts before the account is locked. */
export const TRIAL_DAYS = 30;

export interface UserLimits {
  /** Max number of client profiles the user can create. Multi-tenant
   *  structural cap — not an AI cost gate. */
  profiles: number;
  /** Cross-feature token budget — the ONLY hard quota gate.
   *
   *  Period semantics (see getUsagePeriodStart):
   *    - Paid: yearly window, resets on Razorpay renewal.
   *    - Free trial: account lifetime (no reset; trial wall at 30 days). */
  monthlyTokenBudget: number;
}

/** Baseline defaults for each plan tier.
 *
 *  Token-budget sizing — yearly totals for paid plans:
 *    Free       250 K  ≈ 30 notices  /  1.5 K bank txns  /  500 chats
 *    Pro         20 M  ≈ yearly budget across all features
 *    Enterprise  60 M  ≈ yearly budget across all features (3× Pro) */
export const PLAN_DEFAULTS: Record<PlanId, UserLimits> = {
  free: {
    profiles: 1,
    monthlyTokenBudget: 250_000,
  },
  pro: {
    profiles: 5,
    monthlyTokenBudget: 20_000_000,
  },
  enterprise: {
    profiles: 25,
    monthlyTokenBudget: 60_000_000,
  },
};

/** Bare-minimum shape for callers who only have a user id + plan fields. */
export type LimitUserInput = Pick<UserRow, 'plan' | 'plugin_plan' | 'plugin_limits'>;

/** Returns the effective plan id (plugin_plan takes precedence over plan). */
export function getEffectivePlan(user: LimitUserInput): PlanId {
  const override = user.plugin_plan;
  if (override && override in PLAN_DEFAULTS) {
    return override as PlanId;
  }
  if (user.plan && user.plan in PLAN_DEFAULTS) {
    return user.plan as PlanId;
  }
  return 'free';
}

/**
 * Resolve effective limits for a user. Precedence per field:
 * plugin_limits > PLAN_DEFAULTS[effective plan].
 */
export function getUserLimits(user: LimitUserInput): UserLimits {
  const plan = getEffectivePlan(user);
  const base = PLAN_DEFAULTS[plan];

  if (!user.plugin_limits) return base;

  let overrides: Partial<UserLimits>;
  try {
    overrides = JSON.parse(user.plugin_limits) as Partial<UserLimits>;
  } catch {
    return base;
  }

  return {
    profiles: overrides.profiles ?? base.profiles,
    // Token budget falls back to plan default unless the override
    // explicitly sets a positive value. Zero means "no override"
    // because sanitizePluginLimits stores 0 when the parent app
    // doesn't supply this field, and we don't want to reject every
    // request for those users.
    monthlyTokenBudget: (overrides.monthlyTokenBudget && overrides.monthlyTokenBudget > 0)
      ? overrides.monthlyTokenBudget
      : base.monthlyTokenBudget,
  };
}

/**
 * Validate a limits payload from a parent app before persisting it.
 * Returns sanitized limits or null if the input is malformed / empty.
 */
export function sanitizePluginLimits(raw: unknown): UserLimits | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const numeric = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;

  const profiles = numeric(r.profiles);
  const monthlyTokenBudget = numeric(r.monthlyTokenBudget);

  if (profiles === undefined && monthlyTokenBudget === undefined) {
    return null;
  }

  return {
    profiles: profiles ?? 0,
    monthlyTokenBudget: monthlyTokenBudget ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Trial helpers (free-plan 30-day trial)
// ---------------------------------------------------------------------------

/**
 * Compute the ISO timestamp when a free-plan user's trial expires.
 * Always based on the user's `created_at` — no DB column needed.
 */
export function getTrialEndsAt(createdAt: string): string {
  const d = new Date(createdAt);
  d.setDate(d.getDate() + TRIAL_DAYS);
  return d.toISOString();
}

/**
 * Returns true if the free-plan trial has expired.
 * Always returns false for paid plans (caller should gate on plan === 'free').
 */
export function isTrialExpired(createdAt: string): boolean {
  return new Date() > new Date(getTrialEndsAt(createdAt));
}

// ---------------------------------------------------------------------------
// Usage-period helpers
// ---------------------------------------------------------------------------

/**
 * Returns the ISO timestamp marking the start of the user's current usage
 * period — the cutoff for "tokens used so far".
 *
 *   - Paid (plan_expires_at set): start = plan_expires_at − 1 year. Razorpay
 *     extends plan_expires_at on every successful charge, so the period
 *     auto-rolls forward when the yearly subscription renews.
 *   - Free / no paid sub: start = created_at. Free plan is a one-off 30-day
 *     trial — usage NEVER resets; once the 30 days pass the user hits the
 *     trial-expired wall instead of getting fresh tokens next month.
 *
 * Returned as a SQLite-friendly local-IST string ('YYYY-MM-DD HH:MM:SS.sss')
 * matching how api_usage.created_at is stored.
 */
export function getUsagePeriodStart(user: {
  created_at: string;
  plan_expires_at: string | null;
  plan: string;
}): string {
  if (user.plan && user.plan !== 'free' && user.plan_expires_at) {
    const expires = new Date(user.plan_expires_at);
    if (!Number.isNaN(expires.getTime())) {
      const start = new Date(expires);
      start.setFullYear(start.getFullYear() - 1);
      return toSqlIst(start);
    }
  }
  // Free / no paid sub — usage period is the user's lifetime.
  return toSqlIst(new Date(user.created_at));
}

/** Convert a JS Date to the same IST-local string format api_usage rows
 *  use (no trailing 'Z'). The DB stores `datetime('now', '+5h30m')`. */
function toSqlIst(d: Date): string {
  // Strip the 'Z' so SQLite string comparisons line up with stored values.
  return d.toISOString().replace('Z', '');
}
