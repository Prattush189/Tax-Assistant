/**
 * AI credits — the user-facing unit for the token budget.
 *
 * Nobody outside this codebase understands "weighted tokens", and the
 * raw numbers (750,000 / 20,000,000) read as noise. Underneath nothing
 * changes: api_usage.weighted_tokens is still the ledger and the quota
 * gate still sums it. This module is a DISPLAY layer:
 *
 *   1 credit = 10,000 weighted tokens
 *   Free 750K -> 75 credits   Pro 20M -> 2,000   Enterprise 60M -> 6,000
 *
 * Keeping the accounting in weighted tokens means models can be
 * re-priced (lib/modelWeights.ts) without ever touching what the user
 * sees; only the per-action ESTIMATES below need a refresh when a
 * feature's model or prompt changes materially.
 */

export const CREDIT_UNIT = 10_000;

/** Weighted tokens -> credits. Rounds to the nearest whole credit for
 *  display; callers that need to be conservative (quota headroom) use
 *  creditsCeil. */
export function toCredits(weightedTokens: number): number {
  return Math.round(weightedTokens / CREDIT_UNIT);
}
export function creditsCeil(weightedTokens: number): number {
  return Math.ceil(weightedTokens / CREDIT_UNIT);
}
export function creditsToWeighted(credits: number): number {
  return credits * CREDIT_UNIT;
}

/**
 * Typical cost of one action, in credits. Derived from production
 * averages (api_usage, Sept 2026) priced on the rung each feature runs
 * on TODAY. Refresh when a feature's model or prompt changes:
 *
 *   chat_fast       3.1 Flash-Lite on Flex: ~4.2K in x 1.25 + ~0.4K out x 7.5  ~= 8K   -> 1
 *   chat_deep       3.8 Flash Standard:     ~4.2K in x 7.5  + ~1.2K out x 37.5 ~= 76K  -> 8
 *   notice_draft    3.1 Flash-Lite (economy): ~6.5K x 2.5 + ~1.7K x 15         ~= 42K  -> 4
 *   notice_pdf_read vision on 3.1 Flash-Lite: ~4K x 2.5 + ~0.85K x 15         ~= 23K  -> 2
 *   bank_statement  3.1 Flash-Lite:         ~5.4K x 2.5 + ~1.1K x 15           ~= 30K  -> 3
 *   ledger_scrutiny 3.1 Flash-Lite:         ~91K x 2.5 + ~2.5K x 15            ~= 265K -> 27
 *
 * These are shown to users as "about N credits" -- never as a promise.
 */
export const CREDIT_ESTIMATES: Readonly<Record<string, number>> = {
  chat_fast: 1,
  chat_deep: 8,
  notice_draft: 4,
  notice_pdf_read: 2,
  bank_statement: 3,
  ledger_scrutiny: 27,
};

export interface CreditsSummary {
  unit: number;
  used: number;
  budget: number;
  remaining: number;
  estimates: Record<string, number>;
}

export function summarizeCredits(tokens: { used: number; budget: number; remaining: number }): CreditsSummary {
  return {
    unit: CREDIT_UNIT,
    used: toCredits(tokens.used),
    budget: toCredits(tokens.budget),
    remaining: toCredits(tokens.remaining),
    estimates: { ...CREDIT_ESTIMATES },
  };
}
