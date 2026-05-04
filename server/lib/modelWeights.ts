/**
 * Per-model token weights for the cross-feature quota.
 *
 * Each token a model consumes is multiplied by its weight before being
 * counted against the user's monthlyTokenBudget. Anchored at the
 * cheapest active model — gemini-2.5-flash-lite input ($0.10/M) — as
 * 1× so the existing plan budgets (Free 250K, Pro 20M, Enterprise 60M)
 * keep their headline numbers but represent T2-input-equivalent units.
 *
 * The point is fairness: a 1M-token Sonnet call costs us ~30× what a
 * 1M-token flash-lite-input call costs (per Anthropic / Google list
 * pricing), so we count it 30×. Without this, a Pro user could
 * exhaust their entire $X/month plan running Sonnet for "free" while
 * a flash-lite user pays the same $X for 30× less compute.
 *
 * Weights are derived directly from list pricing ratios. If pricing
 * changes, update both the cost constants in lib/gemini.ts (or the
 * Sonnet pricing here) and the weight values below in lockstep.
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
}

/**
 * Active + retired model weights. Retired models are kept so historic
 * api_usage rows logged before a model was dropped continue to weight
 * correctly when the gate sums across the period.
 */
const MODEL_WEIGHTS: Record<string, ModelWeight> = {
  // Active: anchored on T2 input
  'gemini-2.5-flash-lite':         { wIn: 1.0, wOut: 4.0 },    // $0.10 / $0.40
  'gemini-3.1-flash-lite-preview': { wIn: 2.5, wOut: 15.0 },   // $0.25 / $1.50

  // Active vision (added in the Sonnet swap commit). Sonnet 4.5
  // pricing: $3 in / $15 out. Anchored against flash-lite-input
  // ($0.10) → 30× input, 150× output.
  'claude-sonnet-4-5':             { wIn: 30.0, wOut: 150.0 },
  'claude-sonnet-4-5-20250929':    { wIn: 30.0, wOut: 150.0 },

  // Retired (Stage: drop-think-tier). Kept for historic rows.
  'gemini-2.5-flash':              { wIn: 3.0, wOut: 25.0 },   // $0.30 / $2.50
  'gemini-3-flash-preview':        { wIn: 5.0, wOut: 30.0 },   // $0.50 / $3.00
  'claude-haiku-4-5':              { wIn: 8.0, wOut: 40.0 },   // approximate
};

const FALLBACK_WEIGHT: ModelWeight = { wIn: 1.0, wOut: 4.0 };

/** Look up the weight pair for a model. Falls back to T2 weights on
 *  unknown models — under-attributing slightly is better than failing
 *  open and letting an unrecognised model slip through unweighted. */
export function getWeightFor(model: string | null | undefined): ModelWeight {
  if (!model) return FALLBACK_WEIGHT;
  return MODEL_WEIGHTS[model] ?? FALLBACK_WEIGHT;
}

/** Convenience: compute weighted_tokens for a single api_usage row. */
export function computeWeightedTokens(model: string | null | undefined, inputTokens: number, outputTokens: number): number {
  const w = getWeightFor(model);
  // Round to integer — column is INTEGER. Token weights below 1×
  // could in theory produce fractional weighted counts; round-up
  // to be slightly conservative against quota.
  return Math.ceil(inputTokens * w.wIn + outputTokens * w.wOut);
}
