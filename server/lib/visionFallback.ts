/**
 * Two-tier vision extractor.
 *
 *   Primary  : Gemini 3.x Flash-Lite Preview (cheap, handles most
 *              Tally / Busy ledger and bank-statement layouts).
 *   Fallback : Claude Sonnet 4.5 via extractClaudeVision (more
 *              accurate on edge cases, ~30x more expensive per token
 *              under our weighted-quota system).
 *
 * Returns the same GeminiJsonResult shape both branches produce, so
 * call sites stay identical to the legacy extractClaudeVision usage.
 *
 * Falls back on:
 *   - any thrown error from the Gemini path (network, parse, status),
 *   - or an empty `accounts` / empty `transactions` result that
 *     suggests Gemini misread the doc — only when the caller passes
 *     `looksValid` to opt in to the result-quality check.
 */

import { extractGeminiVision } from './geminiVision.js';
import { extractClaudeVision, ClaudePageLimitError } from './claudeVision.js';
import type { GeminiJsonResult, GeminiJsonOptions } from './geminiJson.js';

export interface VisionFallbackOptions {
  maxTokens?: number;
  recordAttempt?: GeminiJsonOptions['recordAttempt'];
  /** Fires once when the call drops from Gemini to Claude. */
  onFallback?: (input: { from: string; to: string }) => void;
  /** Optional sanity check on the Gemini parse — if this returns
   *  false, treat the call as failed and try Sonnet. Useful when
   *  Gemini returns syntactically-valid JSON with empty arrays. */
  looksValid?: (data: unknown) => boolean;
}

export async function extractVisionWithFallback<T = unknown>(
  buffer: Buffer,
  mimeType: string,
  prompt: string,
  opts: VisionFallbackOptions = {},
): Promise<GeminiJsonResult<T>> {
  // Try Gemini first.
  try {
    const result = await extractGeminiVision<T>(buffer, mimeType, prompt, {
      maxTokens: opts.maxTokens,
      recordAttempt: opts.recordAttempt,
    });
    if (opts.looksValid && !opts.looksValid(result.data)) {
      throw new Error('Gemini parse passed schema but looksValid returned false');
    }
    return result;
  } catch (err) {
    if (err instanceof ClaudePageLimitError) throw err; // Sonnet won't help — same limit.
    console.warn('[visionFallback] Gemini failed, falling back to Sonnet:', (err as Error).message?.slice(0, 200));
    try { opts.onFallback?.({ from: 'gemini-vision', to: 'sonnet' }); }
    catch (e) { console.warn('[visionFallback] onFallback hook threw:', (e as Error).message); }
    return extractClaudeVision<T>(buffer, mimeType, prompt, {
      maxTokens: opts.maxTokens,
      recordAttempt: opts.recordAttempt,
    });
  }
}

export { ClaudePageLimitError };
