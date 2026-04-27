import OpenAI from 'openai';

// ── Gemini chat models ─────────────────────────────────────────────
// Fast mode:  Gemini 2.5 Flash-Lite → Gemini 3.1 Flash-Lite fallback
// Think mode: Gemini 2.5 Flash      → Gemini 3 Flash fallback
// Search grounding: 2.5 family = 1,500 RPD shared, 3.x family = 5,000/month shared
export const GEMINI_CHAT_MODEL_T1 = 'gemini-3.1-flash-lite-preview';  // Fast fallback + Gemini 3 family
export const GEMINI_CHAT_MODEL_T2 = 'gemini-2.5-flash-lite';          // Fast primary
export const GEMINI_CHAT_MODEL_THINK = 'gemini-2.5-flash';            // Think primary  (Gemini 2.5 family)
export const GEMINI_CHAT_MODEL_THINK_FB = 'gemini-3-flash-preview';   // Think fallback (Gemini 3 family)

// Gemini 3.1 Flash-Lite Preview pricing
export const GEMINI_T1_INPUT_COST = 0.25 / 1_000_000;    // $0.25/M tokens
export const GEMINI_T1_OUTPUT_COST = 1.50 / 1_000_000;   // $1.50/M tokens
// Gemini 2.5 Flash-Lite pricing
export const GEMINI_T2_INPUT_COST = 0.10 / 1_000_000;    // $0.10/M tokens
export const GEMINI_T2_OUTPUT_COST = 0.40 / 1_000_000;   // $0.40/M tokens
// Gemini 2.5 Flash pricing (Think primary)
export const GEMINI_THINK_INPUT_COST = 0.30 / 1_000_000;   // $0.30/M tokens
export const GEMINI_THINK_OUTPUT_COST = 2.50 / 1_000_000;  // $2.50/M tokens
// Gemini 3 Flash Preview pricing (Think fallback)
export const GEMINI_THINK_FB_INPUT_COST = 0.50 / 1_000_000;  // $0.50/M tokens
export const GEMINI_THINK_FB_OUTPUT_COST = 3.00 / 1_000_000; // $3.00/M tokens
export const GEMINI_API_KEYS: string[] = [
  process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? '',
  process.env.GEMINI_API_KEY_2 ?? '',
].filter(k => k.length > 0);
// Backward compat
export const GEMINI_API_KEY_RAW = GEMINI_API_KEYS[0] ?? '';

// ── Gemini (via OpenAI-compatible endpoint) — used for document extraction ──
// Native PDF + image support, cheaper than Grok for vision tasks.
// Accepts either GEMINI_API_KEY (standard) or GOOGLE_AI_API_KEY (legacy)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? '';
if (!GEMINI_API_KEY) {
  console.warn('[gemini] GEMINI_API_KEY is not set. Document extraction (PDF/image) will fail until you add it to .env.');
}
export const gemini = new OpenAI({
  apiKey: GEMINI_API_KEY || 'missing-gemini-key-placeholder',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  // 90s covers the longest expected call: a bank-statement chunk that
  // escalates to gemini-2.5-flash with 16K output tokens. Typical chat /
  // extract calls finish in well under 15s — this is the ceiling, not the
  // target. Too-tight a ceiling was making long chunks abort mid-stream,
  // turning a recoverable slowness into a hard failure.
  timeout: 90_000,
});
export const geminiConfigured = !!GEMINI_API_KEY;

// Primary model: flash-lite is cheaper and faster. Fallback to full flash if it fails.
export const GEMINI_MODEL = 'gemini-2.5-flash-lite';
export const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash';

/**
 * Per-model cost calculator. Routes used to flat-rate every chunk at
 * GEMINI_T2 (Flash-Lite) regardless of which model actually ran, which
 * under-attributed ledger and bank-statement TSV runs by 3-6x because
 * those chunks routinely escalate to gemini-2.5-flash or
 * gemini-3-flash-preview. Now every cost log resolves the rate from the
 * model name returned by Gemini, so the admin dashboard reflects what
 * the key was actually charged.
 */
export function costForModel(model: string, inputTokens: number, outputTokens: number): number {
  if (model === GEMINI_CHAT_MODEL_THINK_FB || model === 'gemini-3-flash-preview') {
    return inputTokens * GEMINI_THINK_FB_INPUT_COST + outputTokens * GEMINI_THINK_FB_OUTPUT_COST;
  }
  if (model === 'gemini-2.5-flash' || model === GEMINI_FALLBACK_MODEL) {
    return inputTokens * GEMINI_THINK_INPUT_COST + outputTokens * GEMINI_THINK_OUTPUT_COST;
  }
  if (model === GEMINI_CHAT_MODEL_T1 || model === 'gemini-3.1-flash-lite-preview') {
    return inputTokens * GEMINI_T1_INPUT_COST + outputTokens * GEMINI_T1_OUTPUT_COST;
  }
  // Default: Flash-Lite pricing. Used for unknown models so we
  // under-attribute slightly rather than fabricate higher pricing.
  return inputTokens * GEMINI_T2_INPUT_COST + outputTokens * GEMINI_T2_OUTPUT_COST;
}
