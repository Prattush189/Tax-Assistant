/**
 * Two-tier vision extractor.
 *
 *   Primary  : Gemini 3.1 Flash-Lite Preview — cheap, fast, decent on
 *              dense Indian bank/ledger PDFs.
 *   Fallback : Gemini 2.5 Flash-Lite — different family, often handles
 *              what 3.1 trips on (and vice versa).
 *
 * Sonnet 4.5 is intentionally NOT in this chain right now — operator
 * will re-introduce when a key is provisioned. To add it, drop the
 * extractClaudeVision call into the catch below behind a third tier.
 *
 * Returns the standard GeminiJsonResult shape so call sites stay
 * identical to the legacy extractClaudeVision usage. ClaudePageLimitError
 * is re-exported for callers that want to short-circuit on >100 page
 * PDFs (Anthropic limit; Gemini doesn't have one but we keep the cap
 * so a future Sonnet tier doesn't suddenly fail on the same file).
 */

import { extractGeminiVision } from './geminiVision.js';
import { ClaudePageLimitError } from './claudeVision.js';
import { GEMINI_CHAT_MODEL_T1, GEMINI_CHAT_MODEL_T2 } from './gemini.js';
import type { GeminiJsonResult, GeminiJsonOptions } from './geminiJson.js';

export interface VisionFallbackOptions {
  maxTokens?: number;
  recordAttempt?: GeminiJsonOptions['recordAttempt'];
  /** Fires once when the call drops from primary to fallback. */
  onFallback?: (input: { from: string; to: string }) => void;
  /** Optional sanity check on the parse — if returns false, treat as
   *  failed and try fallback. Useful when a model returns syntactically-
   *  valid JSON with empty arrays. */
  looksValid?: (data: unknown) => boolean;
}

export async function extractVisionWithFallback<T = unknown>(
  buffer: Buffer,
  mimeType: string,
  prompt: string,
  opts: VisionFallbackOptions = {},
): Promise<GeminiJsonResult<T>> {
  // Tier 1: Gemini 3.1 Flash-Lite Preview.
  try {
    const result = await extractGeminiVision<T>(buffer, mimeType, prompt, {
      maxTokens: opts.maxTokens,
      recordAttempt: opts.recordAttempt,
      model: GEMINI_CHAT_MODEL_T1,
    });
    if (opts.looksValid && !opts.looksValid(result.data)) {
      throw new Error('Gemini 3.1 parse passed schema but looksValid returned false');
    }
    return result;
  } catch (err) {
    console.warn('[visionFallback] Gemini 3.1 failed, falling back to 2.5:', (err as Error).message?.slice(0, 200));
    try { opts.onFallback?.({ from: GEMINI_CHAT_MODEL_T1, to: GEMINI_CHAT_MODEL_T2 }); }
    catch (e) { console.warn('[visionFallback] onFallback hook threw:', (e as Error).message); }
  }

  // Tier 2: Gemini 2.5 Flash-Lite.
  return extractGeminiVision<T>(buffer, mimeType, prompt, {
    maxTokens: opts.maxTokens,
    recordAttempt: opts.recordAttempt,
    model: GEMINI_CHAT_MODEL_T2,
  });
}

export { ClaudePageLimitError };
