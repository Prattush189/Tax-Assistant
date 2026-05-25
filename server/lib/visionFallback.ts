/**
 * Two-tier vision extractor.
 *
 *   Primary  : Gemini 2.5 Flash-Lite — cheapest in the line-up
 *              ($0.10 in / $0.40 out per 1M). Handles most Indian
 *              bank/ledger PDFs cleanly.
 *   Fallback : Gemini 3.1 Flash-Lite Preview — different family
 *              ($0.25 in / $1.50 out, 2.5×/3.75× pricier). Rescues
 *              what 2.5 can't parse (dense / image-only / 20+ page
 *              ICICI-style PDFs).
 *
 * Order flipped 2026-05 (was T1 → T2). Vision was the only path in
 * the codebase that called T1 first, costing ~3× per upload across
 * every statement even though T2 succeeds on the vast majority. The
 * `looksValid` callback (empty-array detector at the caller) plus the
 * MAX_TOKENS / parse-error fallback below catch the dense-PDF cases
 * that originally motivated T1-first and route them to T1 transparently.
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
  // Tier 1: Gemini 2.5 Flash-Lite (cheap primary).
  try {
    const result = await extractGeminiVision<T>(buffer, mimeType, prompt, {
      maxTokens: opts.maxTokens,
      recordAttempt: opts.recordAttempt,
      model: GEMINI_CHAT_MODEL_T2,
    });
    if (opts.looksValid && !opts.looksValid(result.data)) {
      // Internal — caller catches this and falls through to tier 2.
      throw new Error('Primary vision parse passed schema but looksValid returned false');
    }
    return result;
  } catch (err) {
    console.warn('[visionFallback] 2.5 Flash-Lite failed, falling back to 3.1:', (err as Error).message?.slice(0, 200));
    try { opts.onFallback?.({ from: GEMINI_CHAT_MODEL_T2, to: GEMINI_CHAT_MODEL_T1 }); }
    catch (e) { console.warn('[visionFallback] onFallback hook threw:', (e as Error).message); }
  }

  // Tier 2: Gemini 3.1 Flash-Lite Preview (pricier rescue tier).
  return extractGeminiVision<T>(buffer, mimeType, prompt, {
    maxTokens: opts.maxTokens,
    recordAttempt: opts.recordAttempt,
    model: GEMINI_CHAT_MODEL_T1,
  });
}
