/**
 * Two-tier vision extractor.
 *
 *   Primary  : Gemini 3.1 Flash-Lite Preview — cheap, fast, decent on
 *              dense Indian bank/ledger PDFs.
 *   Fallback : Gemini 2.5 Flash-Lite — different family, often handles
 *              what 3.1 trips on (and vice versa).
 *
 * Previously this module also re-exported a `ClaudePageLimitError`
 * type used as a backstop when Sonnet vision was in the chain. The
 * Anthropic provider was removed from the codebase entirely (the
 * 2026-05 prod key went inactive and the project standardised on
 * Gemini for vision). Gemini has no documented 100-page hard limit,
 * so the page-count backstop went away with the Claude removal —
 * routes that used to `instanceof ClaudePageLimitError` now just
 * propagate any error. The upstream page-count check (in the
 * frontend's `pdfTooLarge` dialog) is still in place for UX.
 */

import { extractGeminiVision } from './geminiVision.js';
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
      // Internal — caller catches this and falls through to tier 2.
      throw new Error('Tier-1 vision parse passed schema but looksValid returned false');
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
