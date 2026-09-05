/**
 * Per-model token weights for the cross-feature quota.
 *
 * Each token a model consumes is multiplied by its weight before being
 * counted against the user's monthlyTokenBudget. Anchored at the
 * cheapest active model — gemini-2.5-flash-lite input ($0.10/M) — as
 * 1× so the plan budgets (Free 250K, Pro 20M, Enterprise 60M) represent
 * T2-input-equivalent units.
 *
 * The point is fairness: a 1M-token Gemini 3.1 Preview call costs us
 * ~2.5× more than a flash-lite-input call (per Google list pricing),
 * so it counts 2.5×. Without weighting, a Pro user could exhaust an
 * $X/month plan running the more expensive model for "free" while a
 * flash-lite-only user pays the same $X for a fraction of the
 * compute.
 *
 * Weights are derived directly from list pricing ratios. If pricing
 * changes, update both the cost constants in lib/gemini.ts and the
 * weight values below in lockstep.
 *
 * Weights apply ONLY to the cross-feature quota gate. The cost
 * column on api_usage stays in actual USD, computed per-model in
 * costForModel(); that's an independent display.
 */

export interface ModelWeight {
  /** Per-input-token weight (multiplier into weighted_tokens). */
  wIn: number;
  /** Per-output-token weight. */
  wOut: number;
  /** Weight for the CACHED portion of the prompt. Gemini's
   *  promptTokenCount INCLUDES tokens served from context cache, which
   *  bill at the caching rate (~10% of input on 3.x, 25% on 2.5), not
   *  the full input rate. Without this every chat call charged the
   *  entire cached system prompt at full weight. */
  wCached: number;
}

/**
 * Active + retired model weights. Retired models are kept so historic
 * api_usage rows logged before a model was dropped continue to weight
 * correctly when the gate sums across the period.
 */
const MODEL_WEIGHTS: Record<string, ModelWeight> = {
  // Active (2026-07): anchored on T2 input ($0.10/M = 1×). Flex variants
  // weigh 50% (a "-flex" model string is logged when the call ran Flex).
  // 3.8 and 3.7 are priced identically ($0.75 / $3.75 promo), so they
  // share weights. !! Both DOUBLE on 2027-01-01 — when that lands these
  // become wIn 15.0 / wOut 75.0, in lockstep with lib/gemini.ts.
  'gemini-3.8-flash':              { wIn: 7.5,  wOut: 37.5,  wCached: 0.75 },  // $0.75 / $3.75 — chat primary
  'gemini-3.8-flash-flex':         { wIn: 3.75, wOut: 18.75, wCached: 0.375 }, // ~50% on the Flex tier
  'gemini-3.7-flash':              { wIn: 7.5,  wOut: 37.5,  wCached: 0.75 },  // $0.75 / $3.75 — T1 fallback
  'gemini-3.7-flash-flex':         { wIn: 3.75, wOut: 18.75, wCached: 0.375 }, // ~50% on the Flex tier
  'gemini-2.5-flash-lite':         { wIn: 1.0,  wOut: 4.0,   wCached: 0.25 },   // $0.10 / $0.40 — anchor / last resort

  // Retired. Kept for historic rows.
  'gemini-3.6-flash':              { wIn: 15.0, wOut: 75.0,  wCached: 1.5 },  // $1.50 / $7.50 — chat primary to 2026-09
  'gemini-3.6-flash-flex':         { wIn: 7.5,  wOut: 37.5,  wCached: 0.75 },  // ~50% on the Flex tier
  'gemini-3.5-flash-lite':         { wIn: 3.0,  wOut: 25.0,  wCached: 0.3 },  // $0.30 / $2.50 — T1 to 2026-09
  'gemini-3.5-flash-lite-flex':    { wIn: 1.5,  wOut: 12.5,  wCached: 0.15 },  // ~50% on the Flex tier
  'gemini-3-flash-preview':        { wIn: 5.0, wOut: 30.0,   wCached: 1.25 },   // $0.50 / $3.00 — old chat primary
  'gemini-3-flash-preview-flex':   { wIn: 2.5, wOut: 15.0,   wCached: 0.625 },   // ~50% on the Flex tier
  'gemini-3.1-flash-lite-preview': { wIn: 2.5, wOut: 15.0,   wCached: 0.625 },   // $0.25 / $1.50 — old T1
  'gemini-2.5-flash':              { wIn: 3.0, wOut: 25.0,   wCached: 0.75 },   // $0.30 / $2.50

  // Retired (2026-05 Anthropic-removal). The vision pipeline used
  // Sonnet 4.5 briefly between the original Gemini-only path and the
  // current Gemini-only path. Weights kept here so any api_usage row
  // logged against these model strings during that window still sums
  // correctly into the cross-feature quota. No code path currently
  // emits these model strings.
  'claude-sonnet-4-5':             { wIn: 30.0, wOut: 150.0, wCached: 3.0 },
  'claude-sonnet-4-5-20250929':    { wIn: 30.0, wOut: 150.0, wCached: 3.0 },
  'claude-haiku-4-5':              { wIn: 8.0, wOut: 40.0,   wCached: 0.8 },   // approximate
};

const FALLBACK_WEIGHT: ModelWeight = { wIn: 1.0, wOut: 4.0, wCached: 0.25 };

/** Look up the weight pair for a model. Falls back to T2 weights on
 *  unknown models — under-attributing slightly is better than failing
 *  open and letting an unrecognised model slip through unweighted. */
export function getWeightFor(model: string | null | undefined): ModelWeight {
  if (!model) return FALLBACK_WEIGHT;
  return MODEL_WEIGHTS[model] ?? FALLBACK_WEIGHT;
}

/** Compute weighted_tokens for a single api_usage row.
 *
 *  `outputTokens` must be the BILLABLE output — visible answer PLUS
 *  thinking tokens (Gemini reports those separately as
 *  thoughtsTokenCount and bills them as output). Callers get that from
 *  billableGeminiUsage(); passing candidatesTokenCount alone was the
 *  bug that made Deep calls look ~half their real size.
 *
 *  `cachedInputTokens` is the portion of `inputTokens` served from
 *  context cache; it is weighted at the cache rate instead of full
 *  input. Clamped to inputTokens so a bad counter can never go
 *  negative. */
export function computeWeightedTokens(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): number {
  const w = getWeightFor(model);
  const cached = Math.max(0, Math.min(cachedInputTokens, inputTokens));
  const fresh = inputTokens - cached;
  // Round up — the column is INTEGER and rounding up is the
  // conservative direction for a quota.
  return Math.ceil(fresh * w.wIn + cached * w.wCached + outputTokens * w.wOut);
}
