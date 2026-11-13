/**
 * Launch offer (12 Nov – 12 Dec 2026): 50% off every feature except tax
 * chat. The owner's terms (2026-11-13): "match sonnet prices to 50% off
 * on Gemini prices, so nothing changes just the model behind for 1
 * month", Gemini fallbacks also 50% off, chat (Gemini only) full price,
 * and if the Claude credits run out, everything goes back to how it was
 * and the 50% switches off.
 *
 * So, for a call inside the offer that is not tax chat:
 *  - Claude answered → its tokens are priced as Gemini 3.1 Flash-Lite
 *    Flex (CLAUDE_PRICED_AS), then halved. Sonnet uses ~2-3x the tokens
 *    Gemini Flash-Lite did for the same action (the web-search tool
 *    definition, longer drafts), so at Flex rates (half of Standard) a
 *    typical action costs about what it did on Gemini; the offer halves
 *    that. 2026-11-13 bake-off: notice reply ~2.2 credits (Gemini ~2.4),
 *    document read ~0.8, ledger scrutiny ~7 (Gemini ~19).
 *  - Gemini answered (fallback) → its own weights, halved.
 * Tax chat ('chat' rows) is charged normally throughout.
 *
 * Claude runs ONLY while the offer is live (claude.ts isClaudeActive):
 * from 13 Dec 00:00 IST, or from the moment Anthropic reports the credit
 * balance used up (setLaunchOfferEarlyEnd), every feature is back on
 * Gemini at normal prices with no deploy.
 *
 * Only the quota changes (api_usage.weighted_tokens, via
 * computeWeightedTokens). api_usage.cost stays the real USD spend.
 * The window is judged by when a call was logged, so a recompute keeps
 * the discount on rows from inside it and never grants it outside.
 *
 * Dependency-free (no DB, no AI client) so modelWeights.ts and the
 * offers route can import it; claude.ts restores an early end at boot.
 */

export const LAUNCH_OFFER = {
  /** user_notices_seen.notice_id for the one-time pop-up. */
  id: 'launch-50-off-2026-11',
  discountPct: 50,
  /** api_usage categories the discount does not apply to. */
  excludes: ['chat'] as readonly string[],
  /** Inclusive start (IST midnight, 12 Nov 2026). */
  startsAt: '2026-11-12T00:00:00+05:30',
  /** Exclusive end (IST midnight, 13 Dec 2026) — "until 12 December". */
  endsAt: '2026-12-13T00:00:00+05:30',
} as const;

/** The Gemini model whose weights price a Claude call inside the offer. */
export const CLAUDE_PRICED_AS = 'gemini-3.1-flash-lite-flex';

const START_MS = Date.parse(LAUNCH_OFFER.startsAt);
const END_MS = Date.parse(LAUNCH_OFFER.endsAt);
/** Set when the Claude credits ran out before END_MS. */
let earlyEndMs: number | null = null;

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

/** End the offer early (the Claude credits ran out). Pass null to clear.
 *  Only moves the end earlier, never later than 13 Dec. */
export function setLaunchOfferEarlyEnd(at: Date | string | null): void {
  earlyEndMs = at === null ? null : Math.min(toMs(at), END_MS);
}

/** When the offer ends (or ended): the early end if any, else 13 Dec. */
export function launchOfferEndsAt(): string {
  return new Date(earlyEndMs ?? END_MS).toISOString();
}

/** True when a call made at `at` (default: now) falls inside the offer. */
export function launchOfferActive(at?: Date | string): boolean {
  const t = toMs(at);
  return t >= START_MS && t < (earlyEndMs ?? END_MS);
}

/** Does the discount apply to a call of this category at `at`? */
export function launchOfferApplies(category: string | null | undefined, at?: Date | string): boolean {
  return launchOfferActive(at) && !LAUNCH_OFFER.excludes.includes(category ?? '');
}

/** Factor on a discounted call's weighted tokens: 0.5. */
export const LAUNCH_OFFER_FACTOR = 1 - LAUNCH_OFFER.discountPct / 100;
