import OpenAI from 'openai';

// ── Gemini chat models ─────────────────────────────────────────────
// Three-model line-up across every route:
//   Primary:  gemini-3.6-flash        (Flex tier — frontier, fast)
//   T1:       gemini-3.5-flash-lite   (Flex tier — cheap fallback)
//   T2:       gemini-2.5-flash-lite   (Standard — last-resort anchor)
//
// gemini-2.5-flash and gemini-3-flash-preview were removed: their
// "thinking" overhead routinely consumed the entire output budget on
// vision and TSV runs, and the cost per token blew up worst-case
// Pro/Enterprise unit economics with no proportional reliability
// improvement on the structured-output workloads we actually run.
export const GEMINI_CHAT_MODEL_T2 = 'gemini-2.5-flash-lite';   // Last-resort fallback (anchor)
export const GEMINI_CHAT_MODEL_T1 = 'gemini-3.5-flash-lite';   // Fallback (Gemini 3.5, Flex tier)

// Chat PRIMARY (2026-07): Gemini 3.6 Flash — frontier reasoning + superior
// Search grounding + configurable thinking. Runs on the Flex service tier
// by default (~50% price, GEMINI_FLEX); falls back to T1 → T2 if it's
// unavailable / over capacity, so chat never breaks. Standard pricing
// $1.50 in / $7.50 out per 1M (Flex bills 50%).
export const GEMINI_CHAT_MODEL_PRIMARY = 'gemini-3.6-flash';
export const GEMINI_PRIMARY_INPUT_COST  = 1.50 / 1_000_000;
export const GEMINI_PRIMARY_OUTPUT_COST = 7.50 / 1_000_000;

/** Flex service tier: ~50% price for relaxed/variable latency. ON by
 *  default; disable with GEMINI_FLEX=0. Passed as `serviceTier` on the
 *  request and applied to the primary + T1 rungs of the chat ladder. If
 *  the endpoint rejects/over-capacity the Flex call, the primary retries
 *  on Standard and T1 drops to T2, so a Flex hiccup never breaks chat. */
export const GEMINI_FLEX = process.env.GEMINI_FLEX !== '0';
export const GEMINI_FLEX_SERVICE_TIER = 'flex';

// Pricing (USD per 1M tokens, Standard tier). Anchor for the weighted-
// token quota (see modelWeights.ts), T2 input ($0.10/M) = 1× anchor:
//   T2 input  $0.10 — w_in  = 1.0×    T2 output $0.40 — w_out = 4.0×
//   T1 input  $0.30 — w_in  = 3.0×    T1 output $2.50 — w_out = 25.0×
//   Primary   $1.50 — w_in  = 15.0×   Primary out $7.50 — w_out = 75.0×
// Flex tier bills 50% of these (handled in costForModel via the -flex
// model suffix); keep these lockstep with modelWeights.ts.
export const GEMINI_T2_INPUT_COST  = 0.10 / 1_000_000;
export const GEMINI_T2_OUTPUT_COST = 0.40 / 1_000_000;
export const GEMINI_T1_INPUT_COST  = 0.30 / 1_000_000;
export const GEMINI_T1_OUTPUT_COST = 2.50 / 1_000_000;

// Legacy pricing for historic api_usage rows logged before a model
// line-up change. costForModel still recognises these strings so cost
// reports across a migration date stay accurate; nothing in the runtime
// code path emits them any more.
const GEMINI_LEGACY_THINK_INPUT_COST     = 0.30 / 1_000_000;
const GEMINI_LEGACY_THINK_OUTPUT_COST    = 2.50 / 1_000_000;
const GEMINI_LEGACY_THINK_FB_INPUT_COST  = 0.50 / 1_000_000;
const GEMINI_LEGACY_THINK_FB_OUTPUT_COST = 3.00 / 1_000_000;
// Retired 2026-07 chat models — pinned historic Standard pricing so
// pre-swap rows (gemini-3-flash-preview, gemini-3.1-flash-lite-preview)
// still cost correctly after the 3.6/3.5 constants above changed.
const GEMINI_OLD_PRIMARY_INPUT_COST  = 0.50 / 1_000_000;
const GEMINI_OLD_PRIMARY_OUTPUT_COST = 3.00 / 1_000_000;
const GEMINI_OLD_T1_INPUT_COST       = 0.25 / 1_000_000;
const GEMINI_OLD_T1_OUTPUT_COST      = 1.50 / 1_000_000;

export const GEMINI_API_KEYS: string[] = [
  process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? '',
  process.env.GEMINI_API_KEY_2 ?? '',
].filter(k => k.length > 0);
export const GEMINI_API_KEY_RAW = GEMINI_API_KEYS[0] ?? '';

// ── Gemini (via OpenAI-compatible endpoint) — used for document extraction ──
// Native PDF + image support, cheaper than Grok for vision tasks.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? '';
if (!GEMINI_API_KEY) {
  console.warn('[gemini] GEMINI_API_KEY is not set. Document extraction (PDF/image) will fail until you add it to .env.');
}
export const gemini = new OpenAI({
  apiKey: GEMINI_API_KEY || 'missing-gemini-key-placeholder',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  // 90s covers the longest expected call. Typical chat / extract
  // calls finish in well under 15s — this is the ceiling, not the
  // target.
  timeout: 90_000,
});
export const geminiConfigured = !!GEMINI_API_KEY;

// Primary + fallback used by every JSON / vision / chat route.
export const GEMINI_MODEL = GEMINI_CHAT_MODEL_T2;
export const GEMINI_FALLBACK_MODEL = GEMINI_CHAT_MODEL_T1;

/**
 * Per-model cost calculator. Resolves the rate from the model name
 * returned by Gemini so the admin dashboard reflects what the key
 * was actually charged. Recognises the two retired models too —
 * historic api_usage rows still carry those strings, and we want
 * cost reports to span the migration cleanly.
 */
export function costForModel(model: string, inputTokens: number, outputTokens: number): number {
  const cost = (inCost: number, outCost: number) => inputTokens * inCost + outputTokens * outCost;

  // ── Active models ── (a "-flex" suffix on the model string means the
  //  call ran on the Flex service tier → bill 50% of Standard.)
  if (model === GEMINI_CHAT_MODEL_T2 || model === 'gemini-2.5-flash-lite') {
    return cost(GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST);
  }
  if (model === `${GEMINI_CHAT_MODEL_T1}-flex`) {
    return cost(GEMINI_T1_INPUT_COST, GEMINI_T1_OUTPUT_COST) * 0.5;
  }
  if (model === GEMINI_CHAT_MODEL_T1) {
    return cost(GEMINI_T1_INPUT_COST, GEMINI_T1_OUTPUT_COST);
  }
  if (model === `${GEMINI_CHAT_MODEL_PRIMARY}-flex`) {
    return cost(GEMINI_PRIMARY_INPUT_COST, GEMINI_PRIMARY_OUTPUT_COST) * 0.5;
  }
  if (model === GEMINI_CHAT_MODEL_PRIMARY) {
    return cost(GEMINI_PRIMARY_INPUT_COST, GEMINI_PRIMARY_OUTPUT_COST);
  }

  // ── Retired / legacy models — historic api_usage rows only ──
  if (model === 'gemini-2.5-flash') {
    return cost(GEMINI_LEGACY_THINK_INPUT_COST, GEMINI_LEGACY_THINK_OUTPUT_COST);
  }
  if (model === 'gemini-3-flash-preview-flex') {
    return cost(GEMINI_OLD_PRIMARY_INPUT_COST, GEMINI_OLD_PRIMARY_OUTPUT_COST) * 0.5;
  }
  if (model === 'gemini-3-flash-preview') {
    return cost(GEMINI_OLD_PRIMARY_INPUT_COST, GEMINI_OLD_PRIMARY_OUTPUT_COST);
  }
  if (model === 'gemini-3.1-flash-lite-preview') {
    return cost(GEMINI_OLD_T1_INPUT_COST, GEMINI_OLD_T1_OUTPUT_COST);
  }

  // Default: Flash-Lite pricing for unknown models — under-attribute
  // slightly rather than fabricate higher pricing.
  return cost(GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST);
}
