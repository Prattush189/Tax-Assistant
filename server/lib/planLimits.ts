/**
 * Centralized plan-limit resolution.
 *
 * Two sources of truth, checked in order:
 *   1. `plugin_limits` JSON column on the user row — per-feature overrides
 *      pushed by a parent/consultant app via the plugin SSO handshake.
 *   2. `plugin_plan` column — an override plan id (e.g. 'enterprise-shared')
 *      whose defaults apply if plugin_limits doesn't specify a given field.
 *   3. `plan` column — the user's standalone Smart AI plan.
 *
 * All route-level enforcement (chat, notices, upload, suggestions, profiles,
 * usage) should call `getUserLimits()` instead of defining its own constants.
 */

import type { UserRow } from '../db/repositories/userRepo.js';

export type PlanId = 'free' | 'pro' | 'enterprise' | 'enterprise-shared';

export interface MessageLimit {
  limit: number;
  period: 'day' | 'month';
}

export interface UserLimits {
  messages: MessageLimit;
  attachments: number;   // monthly
  suggestions: number;   // monthly
  notices: number;       // monthly
  profiles: number;      // total
}

/** Baseline defaults for each plan tier. */
export const PLAN_DEFAULTS: Record<PlanId, UserLimits> = {
  free: {
    messages: { limit: 10, period: 'day' },
    attachments: 10,
    suggestions: 50,
    notices: 3,
    profiles: 1,
  },
  pro: {
    messages: { limit: 1000, period: 'month' },
    attachments: 100,
    suggestions: 200,
    notices: 30,
    profiles: 10,
  },
  enterprise: {
    messages: { limit: 10000, period: 'month' },
    attachments: 500,
    suggestions: 1000,
    notices: 100,
    profiles: 50,
  },
  /**
   * enterprise-shared defaults are intentionally generous — the consultant's
   * parent app is expected to allocate per-staff/per-client caps via
   * `plugin_limits` on every SSO handshake. If the parent forgets to pass
   * limits, the user silently falls back to these ceilings.
   */
  'enterprise-shared': {
    messages: { limit: 10000, period: 'month' },
    attachments: 500,
    suggestions: 1000,
    notices: 100,
    profiles: 50,
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

  // Require at least one field to be set
  if (
    !messages &&
    attachments === undefined &&
    suggestions === undefined &&
    notices === undefined &&
    profiles === undefined
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
  };
}
