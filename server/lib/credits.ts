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
 * Typical cost of one action, in credits, at the FULL rate (a launch
 * offer's discount is applied by the client on top). Refresh when a
 * feature's model or prompt changes. Chat runs on Gemini; everything
 * else on Claude Sonnet 5.5 with web search since 2026-11-13 (weights
 * 20x in / 100x out; every call also carries the search tool, ~2.8K
 * input tokens, 5.9K for notices' dynamic tool):
 *
 *   chat_fast       3.1 Flash-Lite on Flex: ~4.2K in x 1.25 + ~0.4K out x 7.5  ~= 8K    -> 1
 *   chat_deep       3.8 Flash Standard:     ~4.2K in x 7.5  + ~1.2K out x 37.5 ~= 76K   -> 8
 *   notice_draft    Sonnet + search: ~30K in (prompt, tool, search results) x 20 + ~3K out x 100 ~= 900K -> 90
 *   notice_pdf_read Sonnet vision: ~9.5K in x 20 + ~0.6K out x 100          ~= 250K  -> 25
 *   bank_statement  Sonnet classifier: ~9K in (2 batches + tool) x 20 + ~0.7K out x 100 ~= 250K -> 25
 *   ledger_scrutiny Sonnet: ~80K in (66K + tool per chunk) x 20 + ~2K out x 100 ~= 1.8M -> 180
 *
 * Token counts: production averages (api_usage, Oct-Nov 2026) and the
 * 2026-11-12 VPS runs. These are shown to users as "about N credits" --
 * never as a promise. Keep src/lib/creditEstimates.ts in step (the
 * client's fallback until the server's numbers load).
 */
export const CREDIT_ESTIMATES: Readonly<Record<string, number>> = {
  chat_fast: 1,
  chat_deep: 8,
  notice_draft: 90,
  notice_pdf_read: 25,
  bank_statement: 25,
  ledger_scrutiny: 180,
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
