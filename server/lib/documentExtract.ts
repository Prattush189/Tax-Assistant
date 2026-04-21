// server/lib/documentExtract.ts
//
// Vision-document extraction wrapper. Builds the OpenAI-style messages array
// for a PDF/image data URL and delegates to `callGeminiJson` for the actual
// retry-with-fallback loop. Used by /api/upload, /api/form-16-import, and
// /api/bank-statements.
import { callGeminiJson } from './geminiJson.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export { safeParseJson } from './geminiJson.js'; // re-export for backward compat

export interface ExtractOptions {
  /** Gemini max_tokens cap. Defaults to 4096. Bank statements bump this to 8192. */
  maxTokens?: number;
  /** Override the primary model (e.g. use flash directly for complex tasks). */
  primaryModel?: string;
  /** Override the fallback model. */
  fallbackModel?: string;
}

/**
 * Extract structured data from a PDF/image data URL by calling Gemini with the
 * provided prompt. Retries the primary model up to 3 times on transient
 * errors, then falls back to the larger model once before giving up.
 *
 * Generic over the expected JSON shape so callers can declare what they expect
 * without casting:  `await extractWithRetry<MyDoc>(dataUrl, prompt)`.
 */
export async function extractWithRetry<T = Record<string, unknown>>(
  dataUrl: string,
  prompt: string,
  opts: ExtractOptions = {},
): Promise<T> {
  const messages: ChatCompletionMessageParam[] = [{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: dataUrl } },
      { type: 'text', text: prompt },
    ],
  }];
  const result = await callGeminiJson<T>(messages, opts);
  return result.data;
}
