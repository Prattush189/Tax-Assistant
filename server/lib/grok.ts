import OpenAI from 'openai';

export const grok = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: 'https://api.x.ai/v1',
});

export const GROK_MODEL = 'grok-4-1-fast-reasoning';

// Pricing per token (Grok 4.1 Fast)
export const INPUT_COST_PER_TOKEN = 0.20 / 1_000_000;
export const OUTPUT_COST_PER_TOKEN = 0.50 / 1_000_000;
export const WEB_SEARCH_COST = 0.005; // $5 per 1000 calls

// ── Gemini (via OpenAI-compatible endpoint) — used for document extraction ──
// Native PDF + image support, cheaper than Grok for vision tasks.
// Accepts either GEMINI_API_KEY (standard) or GOOGLE_AI_API_KEY (legacy)
export const gemini = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

// Primary model: flash-lite is cheaper and faster. Fallback to full flash if it fails.
export const GEMINI_MODEL = 'gemini-2.5-flash-lite';
export const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash';
