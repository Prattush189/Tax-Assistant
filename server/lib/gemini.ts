import OpenAI from 'openai';

// ── Gemini chat models ─────────────────────────────────────────────
// Two-model line-up across every route:
//   Primary:  gemini-2.5-flash-lite          (T2 — fast, cheap)
//   Fallback: gemini-3.1-flash-lite-preview  (T1 — different family,
//                                              independent capacity)
//
// gemini-2.5-flash and gemini-3-flash-preview were removed: their
// "thinking" overhead routinely consumed the entire output budget on
// vision and TSV runs, and the cost per token (5-7× flash-lite) blew
// up worst-case Pro/Enterprise unit economics with no proportional
// reliability improvement on the structured-output workloads we
// actually run.
export const GEMINI_CHAT_MODEL_T2 = 'gemini-2.5-flash-lite';          // Fast primary
export const GEMINI_CHAT_MODEL_T1 = 'gemini-3.1-flash-lite-preview';  // Fast fallback (Gemini 3.x family)

// Pricing (USD per 1M tokens). Anchor for the planned weighted-token
// quota (see WEIGHTED_TOKENS docs):
//   T2 input  $0.10 — w_in  = 1.0× anchor
//   T2 output $0.40 — w_out = 4.0× anchor
//   T1 input  $0.25 — w_in  = 2.5× anchor
//   T1 output $1.50 — w_out = 15.0× anchor
export const GEMINI_T2_INPUT_COST  = 0.10 / 1_000_000;
export const GEMINI_T2_OUTPUT_COST = 0.40 / 1_000_000;
export const GEMINI_T1_INPUT_COST  = 0.25 / 1_000_000;
export const GEMINI_T1_OUTPUT_COST = 1.50 / 1_000_000;

// Legacy pricing for historic api_usage rows logged before the model
// line-up was trimmed. costForModel still recognises them so cost
// reports across the migration date stay accurate; nothing in the
// runtime code path emits these model strings any more.
const GEMINI_LEGACY_THINK_INPUT_COST     = 0.30 / 1_000_000;
const GEMINI_LEGACY_THINK_OUTPUT_COST    = 2.50 / 1_000_000;
const GEMINI_LEGACY_THINK_FB_INPUT_COST  = 0.50 / 1_000_000;
const GEMINI_LEGACY_THINK_FB_OUTPUT_COST = 3.00 / 1_000_000;

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
  // Active models
  if (model === GEMINI_CHAT_MODEL_T2 || model === 'gemini-2.5-flash-lite') {
    return inputTokens * GEMINI_T2_INPUT_COST + outputTokens * GEMINI_T2_OUTPUT_COST;
  }
  if (model === GEMINI_CHAT_MODEL_T1 || model === 'gemini-3.1-flash-lite-preview') {
    return inputTokens * GEMINI_T1_INPUT_COST + outputTokens * GEMINI_T1_OUTPUT_COST;
  }
  // Legacy / retired models — kept for historic rows only
  if (model === 'gemini-2.5-flash') {
    return inputTokens * GEMINI_LEGACY_THINK_INPUT_COST + outputTokens * GEMINI_LEGACY_THINK_OUTPUT_COST;
  }
  if (model === 'gemini-3-flash-preview') {
    return inputTokens * GEMINI_LEGACY_THINK_FB_INPUT_COST + outputTokens * GEMINI_LEGACY_THINK_FB_OUTPUT_COST;
  }
  // Default: Flash-Lite pricing for unknown models — under-attribute
  // slightly rather than fabricate higher pricing.
  return inputTokens * GEMINI_T2_INPUT_COST + outputTokens * GEMINI_T2_OUTPUT_COST;
}
