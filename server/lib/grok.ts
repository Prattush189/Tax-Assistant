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

// Pricing per token (Grok 4.1 Fast)
export const INPUT_COST_PER_TOKEN = 0.20 / 1_000_000;
export const OUTPUT_COST_PER_TOKEN = 0.50 / 1_000_000;
export const WEB_SEARCH_COST = 0.005; // $5 per 1000 calls

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
