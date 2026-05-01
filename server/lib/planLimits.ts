/**
 * Centralized plan-limit resolution.
 *
 * Two sources of truth, checked in order:
 *   1. `plugin_limits` JSON column on the user row — per-feature overrides
 *      pushed by a parent/consultant app via the plugin SSO handshake.
 *   2. `plugin_plan` column — an override plan id whose defaults apply if
 *      plugin_limits doesn't specify a given field.
 *   3. `plan` column — the user's standalone Smartbiz AI plan.
 *
 * All route-level enforcement (chat, notices, upload, suggestions, profiles,
 * usage) should call `getUserLimits()` instead of defining its own constants.
 */

import type { UserRow } from '../db/repositories/userRepo.js';

export type PlanId = 'free' | 'pro' | 'enterprise';

/** Number of days a free-plan trial lasts before the account is locked. */
export const TRIAL_DAYS = 30;

export interface MessageLimit {
  limit: number;
  period: 'day' | 'month';
}

export interface UserLimits {
  messages: MessageLimit;
  attachments: number;        // monthly
  suggestions: number;        // monthly
  notices: number;            // monthly
  profiles: number;           // total
  boardResolutions: number;   // monthly
  partnershipDeeds: number;   // monthly
  bankStatements: number;     // monthly
  ledgerScrutiny: number;     // monthly
  /** Cross-feature monthly token budget — the only HARD quota gate.
   *  Per-feature limits above stay as soft analytics counters: we
   *  still log them so the dashboard can show "you've used 22 notices
   *  this month", but they no longer block. The only thing that can
   *  reject a request is the user being out of tokens. */
  monthlyTokenBudget: number;
}

/** Baseline defaults for each plan tier.
 *
 *  Token-budget sizing (the only hard gate now) — yearly totals for paid plans:
 *    Free       250 K  ≈ 30 notices  /  1.5 K bank txns  /  500 chats
 *    Pro         20 M  ≈ yearly budget across all features
 *    Enterprise  60 M  ≈ yearly budget across all features   (3× Pro)
 *
 *  Per-feature counts (notices: 3/15/50, etc.) are kept as SOFT
 *  display in the UI and analytics — useful for "you've drafted
 *  22 notices this month" surfacing — but the routes no longer
 *  enforce them. Only monthlyTokenBudget can reject a request. */
export const PLAN_DEFAULTS: Record<PlanId, UserLimits> = {
  free: {
    messages: { limit: 50, period: 'month' },
    attachments: 5,
    suggestions: 20,
    notices: 3,
    profiles: 1,
    boardResolutions: 3,
    partnershipDeeds: 3,
    bankStatements: 3,
    ledgerScrutiny: 3,
    monthlyTokenBudget: 250_000,
  },
  pro: {
    messages: { limit: 1500, period: 'month' },
    attachments: 30,
    suggestions: 100,
    notices: 15,
    profiles: 5,
    boardResolutions: 15,
    partnershipDeeds: 15,
    bankStatements: 15,
    ledgerScrutiny: 50,
    monthlyTokenBudget: 20_000_000,
  },
  enterprise: {
    messages: { limit: 3000, period: 'month' },
    attachments: 200,
    suggestions: 500,
    notices: 50,
    profiles: 25,
    boardResolutions: 50,
    partnershipDeeds: 50,
    bankStatements: 50,
    ledgerScrutiny: 250,
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
 * Resolve effective per-feature limits for a user.
 * Precedence (per field): plugin_limits > PLAN_DEFAULTS[effective plan].
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
    messages: overrides.messages
      ? {
          limit: overrides.messages.limit ?? base.messages.limit,
          period: overrides.messages.period ?? base.messages.period,
        }
      : base.messages,
    attachments: overrides.attachments ?? base.attachments,
    suggestions: overrides.suggestions ?? base.suggestions,
    notices: overrides.notices ?? base.notices,
    profiles: overrides.profiles ?? base.profiles,
    boardResolutions: overrides.boardResolutions ?? base.boardResolutions,
    partnershipDeeds: overrides.partnershipDeeds ?? base.partnershipDeeds,
    bankStatements: overrides.bankStatements ?? base.bankStatements,
    ledgerScrutiny: overrides.ledgerScrutiny ?? base.ledgerScrutiny,
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

  let messages: MessageLimit | undefined;
  if (r.messages && typeof r.messages === 'object') {
    const m = r.messages as Record<string, unknown>;
    const limit = numeric(m.limit);
    const period = m.period === 'day' || m.period === 'month' ? m.period : 'month';
    if (limit !== undefined) messages = { limit, period };
  }

  const attachments = numeric(r.attachments);
  const suggestions = numeric(r.suggestions);
  const notices = numeric(r.notices);
  const profiles = numeric(r.profiles);
  const boardResolutions = numeric(r.boardResolutions);
  const partnershipDeeds = numeric(r.partnershipDeeds);
  const bankStatements = numeric(r.bankStatements);
  const ledgerScrutiny = numeric(r.ledgerScrutiny);

  // Require at least one field to be set
  if (
    !messages &&
    attachments === undefined &&
    suggestions === undefined &&
    notices === undefined &&
    profiles === undefined &&
    boardResolutions === undefined &&
    partnershipDeeds === undefined &&
    bankStatements === undefined &&
    ledgerScrutiny === undefined
  ) {
    return null;
  }

  // Fill missing fields with sensible zeros — but those are overridable per feature
  return {
    messages: messages ?? { limit: 0, period: 'month' },
    attachments: attachments ?? 0,
    suggestions: suggestions ?? 0,
    notices: notices ?? 0,
    profiles: profiles ?? 0,
    boardResolutions: boardResolutions ?? 0,
    partnershipDeeds: partnershipDeeds ?? 0,
    bankStatements: bankStatements ?? 0,
    ledgerScrutiny: ledgerScrutiny ?? 0,
    monthlyTokenBudget: 0, // plugin overrides don't set token budget — use plan default
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
