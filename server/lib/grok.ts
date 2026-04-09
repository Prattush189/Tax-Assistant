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
