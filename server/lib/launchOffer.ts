/**
 * Launch offer: every AI call counts 25% of its weighted tokens against
 * users' credit budgets for one month. Users are told "all features 75%
 * off" — whichever model answers (Claude, or Gemini as primary or
 * fallback), so the promise holds for every feature.
 *
 * Only the quota changes (api_usage.weighted_tokens, via
 * computeWeightedTokens). api_usage.cost stays the real USD spend, so
 * the admin dashboard keeps showing what the calls actually cost.
 *
 * The window is judged by when a call was logged, not by when the
 * weights are computed: a recompute after the offer ends keeps the
 * discount on rows from inside it and never grants it to rows outside.
 * Nothing needs deploying to end it: from 13 Dec 00:00 IST new rows
 * weigh full and the offers route reports it as off.
 *
 * Dependency-free so modelWeights.ts (and the offers route) can import
 * it without pulling in the DB or an AI client.
 */

export const LAUNCH_OFFER = {
  /** user_notices_seen.notice_id for the one-time pop-up. */
  id: 'launch-75-off-2026-11',
  discountPct: 75,
  /** Inclusive start (IST midnight, 12 Nov 2026). */
  startsAt: '2026-11-12T00:00:00+05:30',
  /** Exclusive end (IST midnight, 13 Dec 2026) — "until 12 December". */
  endsAt: '2026-12-13T00:00:00+05:30',
} as const;

const START_MS = Date.parse(LAUNCH_OFFER.startsAt);
const END_MS = Date.parse(LAUNCH_OFFER.endsAt);

/** api_usage.created_at is IST wall-clock text ("YYYY-MM-DD HH:MM:SS",
 *  datetime('now', '+5 hours', '+30 minutes')), so a string with no zone
 *  is read as +05:30. */
function toMs(at: Date | string | undefined): number {
  if (at === undefined) return Date.now();
  if (at instanceof Date) return at.getTime();
  const s = at.trim();
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  return Date.parse(hasZone ? s : `${s.replace(' ', 'T')}+05:30`);
}

/** True when a call made at `at` (default: now) falls inside the offer. */
export function launchOfferActive(at?: Date | string): boolean {
  const t = toMs(at);
  return t >= START_MS && t < END_MS;
}

/** Factor on any AI call's weighted tokens: 0.25 inside the offer, 1
 *  outside it. */
export function launchOfferMultiplier(at?: Date | string): number {
  return launchOfferActive(at) ? 1 - LAUNCH_OFFER.discountPct / 100 : 1;
}
