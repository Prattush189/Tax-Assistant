import OpenAI from 'openai';

// ── Grok (xAI) — chat + notices ──
// The OpenAI SDK constructor throws synchronously when no key is available,
// which would crash the entire Express process at import time and break even
// non-AI endpoints (auth, calculators, usage). Fall back to a dummy key so
// the server stays up — actual API calls will then fail cleanly at request
// time with a normal error response.
const XAI_API_KEY = process.env.XAI_API_KEY ?? '';
if (!XAI_API_KEY) {
  console.warn('[grok] XAI_API_KEY is not set. Chat and notice drafting will fail until you add it to .env.');
}
export const grok = new OpenAI({
  apiKey: XAI_API_KEY || 'missing-xai-key-placeholder',
  baseURL: 'https://api.x.ai/v1',
});
export const grokConfigured = !!XAI_API_KEY;

export const GROK_MODEL = 'grok-4-1-fast-reasoning';

// Pricing per token (Grok 4.1 Fast — Tier 3 fallback)
export const INPUT_COST_PER_TOKEN = 0.20 / 1_000_000;
export const OUTPUT_COST_PER_TOKEN = 0.50 / 1_000_000;
export const WEB_SEARCH_COST = 0.005; // $5 per 1000 calls

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
});
export const geminiConfigured = !!GEMINI_API_KEY;

// Primary model: flash-lite is cheaper and faster. Fallback to full flash if it fails.
export const GEMINI_MODEL = 'gemini-2.5-flash-lite';
export const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash';
