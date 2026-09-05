import OpenAI from 'openai';

// ── Gemini chat models ─────────────────────────────────────────────
// Three-model line-up across every route:
//   Primary:  gemini-3.8-flash        (Flex tier — frontier, fast)
//   T1:       gemini-3.7-flash        (Flex tier — availability fallback)
//   T2:       gemini-2.5-flash-lite   (Standard — last-resort anchor)
//
// 2026-09 swap: 3.6-flash → 3.8-flash and 3.5-flash-lite → 3.7-flash.
// 3.8/3.7 are on promotional pricing ($0.75 in / $3.75 out) which is
// HALF what 3.6-flash cost, so the primary rung got ~2x cheaper.
//
// !! PROMO EXPIRY — 3.8 and 3.7 both DOUBLE to $1.50 in / $7.50 out on
// 2027-01-01. When that lands, update the cost constants below AND the
// weights in modelWeights.ts together, or the quota gate silently
// under-charges every 3.x call by 50%.
//
// NOTE: 3.8 and 3.7 are priced IDENTICALLY, so the T1 rung no longer
// saves money — it is now purely an availability/capacity fallback.
// T2 remains the genuinely cheap anchor.
export const GEMINI_CHAT_MODEL_T2 = 'gemini-2.5-flash-lite';   // Last-resort fallback (anchor)
export const GEMINI_CHAT_MODEL_T1 = 'gemini-3.7-flash';        // Fallback (Gemini 3.7, Flex tier)

// Chat PRIMARY (2026-07): Gemini 3.6 Flash — frontier reasoning + superior
// Search grounding + configurable thinking. Runs on the Flex service tier
// by default (~50% price, GEMINI_FLEX); falls back to T1 → T2 if it's
// unavailable / over capacity, so chat never breaks. Standard pricing
// $1.50 in / $7.50 out per 1M (Flex bills 50%).
// ── Vision / document-extraction models ────────────────────────────
// Deliberately SEPARATE constants from the chat ladder above, and
// pinned as literals rather than aliased to it.
//
// Vision extraction (notices, Form 16, bank statements, ledger
// scrutiny) used to read GEMINI_CHAT_MODEL_T1 directly, so a pure
// CHAT model swap silently repointed every document-extraction path —
// 49519e4 was a chat change that, as a side effect, changed which
// model reads an uploaded notice. Extraction and chat have different
// failure modes and different regression suites; changing one must
// not move the other. Change these only alongside an extraction run.
export const GEMINI_VISION_MODEL_T1 = 'gemini-3.7-flash';
export const GEMINI_VISION_MODEL_T2 = 'gemini-2.5-flash-lite';

export const GEMINI_CHAT_MODEL_PRIMARY = 'gemini-3.8-flash';
export const GEMINI_PRIMARY_INPUT_COST  = 0.75 / 1_000_000;   // promo → 1.50 on 2027-01-01
export const GEMINI_PRIMARY_OUTPUT_COST = 3.75 / 1_000_000;   // promo → 7.50 on 2027-01-01

/** Flex service tier: ~50% price for relaxed/variable latency. ON by
 *  default; disable with GEMINI_FLEX=0. Passed as `serviceTier` on the
 *  request and applied to the primary + T1 rungs of the chat ladder. If
 *  the endpoint rejects/over-capacity the Flex call, the primary retries
 *  on Standard and T1 drops to T2, so a Flex hiccup never breaks chat. */
export const GEMINI_FLEX = process.env.GEMINI_FLEX !== '0';
export const GEMINI_FLEX_SERVICE_TIER = 'flex';

/** Flex for INTERACTIVE chat specifically. Google defines Flex as
 *  "relaxed, variable latency" for 50% off — and production bears it
 *  out: Deep chat averaged 18-29 s on Flex vs 7 s for Fast, with a human
 *  watching a spinner the whole time. Chat volume is tiny (~90 calls /
 *  30 days, ~1K output tokens each), so the discount is negligible in
 *  rupees while the latency is the most visible thing in the product.
 *  OFF by default → chat runs Standard. Set GEMINI_FLEX_CHAT=1 to restore.
 *  Notices, deeds, ledger scrutiny and batch jobs keep GEMINI_FLEX —
 *  notices showed NO measurable Flex penalty (52 s vs 64 s), so the 50%
 *  is free there. */
export const GEMINI_FLEX_CHAT = process.env.GEMINI_FLEX_CHAT === '1';

// Pricing (USD per 1M tokens, Standard tier). Anchor for the weighted-
// token quota (see modelWeights.ts), T2 input ($0.10/M) = 1× anchor:
//   T2 input  $0.10 — w_in  = 1.0×    T2 output $0.40 — w_out = 4.0×
//   T1 input  $0.75 — w_in  = 7.5×    T1 output $3.75 — w_out = 37.5×
//   Primary   $0.75 — w_in  = 7.5×    Primary out $3.75 — w_out = 37.5×
// Flex tier bills 50% of these (handled in costForModel via the -flex
// model suffix); keep these lockstep with modelWeights.ts.
// Context-caching rates (Standard tier, per 1M cached input tokens).
// Cached prompt tokens are part of promptTokenCount but bill at these
// rates, not the input rate. 3.x = $0.075 (doubles 2027-01-01 with the
// rest of the promo); 2.5 Flash-Lite = $0.025.
export const GEMINI_PRIMARY_CACHE_COST = 0.075 / 1_000_000;
export const GEMINI_T1_CACHE_COST      = 0.075 / 1_000_000;
export const GEMINI_T2_CACHE_COST      = 0.025 / 1_000_000;
export const GEMINI_T2_INPUT_COST  = 0.10 / 1_000_000;
export const GEMINI_T2_OUTPUT_COST = 0.40 / 1_000_000;
export const GEMINI_T1_INPUT_COST  = 0.75 / 1_000_000;   // promo → 1.50 on 2027-01-01
export const GEMINI_T1_OUTPUT_COST = 3.75 / 1_000_000;   // promo → 7.50 on 2027-01-01

// Legacy pricing for historic api_usage rows logged before a model
// line-up change. costForModel still recognises these strings so cost
// reports across a migration date stay accurate; nothing in the runtime
// code path emits them any more.
const GEMINI_LEGACY_THINK_INPUT_COST     = 0.30 / 1_000_000;
const GEMINI_LEGACY_THINK_OUTPUT_COST    = 2.50 / 1_000_000;
const GEMINI_LEGACY_THINK_FB_INPUT_COST  = 0.50 / 1_000_000;
const GEMINI_LEGACY_THINK_FB_OUTPUT_COST = 3.00 / 1_000_000;
// Retired 2026-09 chat models — 3.6-flash (primary) and
// 3.5-flash-lite (T1) were swapped out for 3.8/3.7. Historic
// api_usage rows still carry these strings.
const GEMINI_RET_36_INPUT_COST      = 1.50 / 1_000_000;
const GEMINI_RET_36_OUTPUT_COST     = 7.50 / 1_000_000;
const GEMINI_RET_35LITE_INPUT_COST  = 0.30 / 1_000_000;
const GEMINI_RET_35LITE_OUTPUT_COST = 2.50 / 1_000_000;
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
export function costForModel(
  model: string,
  inputTokens: number,
  outputTokens: number,
  /** Portion of inputTokens served from context cache — billed at the
   *  caching rate. Omit for models/paths that don't cache. */
  cachedInputTokens = 0,
): number {
  const cached = Math.max(0, Math.min(cachedInputTokens, inputTokens));
  const fresh = inputTokens - cached;
  // cacheCost defaults to 25% of input for models without a published
  // caching rate (legacy rows) — close enough for historic reporting.
  const cost = (inCost: number, outCost: number, cacheCost = inCost * 0.25) =>
    fresh * inCost + cached * cacheCost + outputTokens * outCost;

  // ── Active models ── (a "-flex" suffix on the model string means the
  //  call ran on the Flex service tier → bill 50% of Standard.)
  if (model === GEMINI_CHAT_MODEL_T2 || model === 'gemini-2.5-flash-lite') {
    return cost(GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST, GEMINI_T2_CACHE_COST);
  }
  if (model === `${GEMINI_CHAT_MODEL_T1}-flex`) {
    return cost(GEMINI_T1_INPUT_COST, GEMINI_T1_OUTPUT_COST, GEMINI_T1_CACHE_COST) * 0.5;
  }
  if (model === GEMINI_CHAT_MODEL_T1) {
    return cost(GEMINI_T1_INPUT_COST, GEMINI_T1_OUTPUT_COST, GEMINI_T1_CACHE_COST);
  }
  if (model === `${GEMINI_CHAT_MODEL_PRIMARY}-flex`) {
    return cost(GEMINI_PRIMARY_INPUT_COST, GEMINI_PRIMARY_OUTPUT_COST, GEMINI_PRIMARY_CACHE_COST) * 0.5;
  }
  if (model === GEMINI_CHAT_MODEL_PRIMARY) {
    return cost(GEMINI_PRIMARY_INPUT_COST, GEMINI_PRIMARY_OUTPUT_COST, GEMINI_PRIMARY_CACHE_COST);
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
  if (model === 'gemini-3.6-flash-flex') {
    return cost(GEMINI_RET_36_INPUT_COST, GEMINI_RET_36_OUTPUT_COST) * 0.5;
  }
  if (model === 'gemini-3.6-flash') {
    return cost(GEMINI_RET_36_INPUT_COST, GEMINI_RET_36_OUTPUT_COST);
  }
  if (model === 'gemini-3.5-flash-lite-flex') {
    return cost(GEMINI_RET_35LITE_INPUT_COST, GEMINI_RET_35LITE_OUTPUT_COST) * 0.5;
  }
  if (model === 'gemini-3.5-flash-lite') {
    return cost(GEMINI_RET_35LITE_INPUT_COST, GEMINI_RET_35LITE_OUTPUT_COST);
  }

  // Default: Flash-Lite pricing for unknown models — under-attribute
  // slightly rather than fabricate higher pricing.
  return cost(GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST, GEMINI_T2_CACHE_COST);
}
