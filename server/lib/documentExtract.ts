// server/lib/documentExtract.ts
//
// Vision-document extraction wrapper. Builds the OpenAI-style messages array
// for a PDF/image data URL and delegates to `callGeminiJson` for the actual
// retry-with-fallback loop. Used by /api/upload, /api/form-16-import, and
// /api/bank-statements.
import { callGeminiJson, type GeminiJsonResult, type GeminiJsonOptions } from './geminiJson.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export { safeParseJson } from './geminiJson.js'; // re-export for backward compat

export interface ExtractOptions {
  /** Gemini max_tokens cap. Defaults to 4096. Bank statements bump this to 8192. */
  maxTokens?: number;
  /** Override the primary model (e.g. use flash directly for complex tasks). */
  primaryModel?: string;
  /** Override the fallback model. */
  fallbackModel?: string;
  /** Pass-through to callGeminiJson for failed-attempt cost logging. */
  recordAttempt?: GeminiJsonOptions['recordAttempt'];
}

/**
 * Extract structured data from a PDF/image data URL. Returns both the parsed
 * value AND the token-usage envelope so the caller can log cost to
 * usageRepo. Retries the primary model up to 3 times on transient errors,
 * then falls back to the larger model once before giving up.
 *
 * Generic over the expected JSON shape:
 *   `const { data, inputTokens, outputTokens } = await extractWithRetry<MyDoc>(url, prompt)`
 */
export async function extractWithRetry<T = Record<string, unknown>>(
  dataUrl: string,
  prompt: string,
  opts: ExtractOptions = {},
): Promise<GeminiJsonResult<T>> {
  const messages: ChatCompletionMessageParam[] = [{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: dataUrl } },
      { type: 'text', text: prompt },
    ],
  }];
  return callGeminiJson<T>(messages, opts);
}
