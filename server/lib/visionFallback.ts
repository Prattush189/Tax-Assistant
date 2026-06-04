/**
 * Single-tier vision extractor — Gemini 3.1 Flash-Lite Preview only.
 *
 * 2026-06: removed the 2.5 Flash-Lite primary tier. Production
 * telemetry across June showed 2.5 was failing on virtually every
 * dense Indian bank statement (parse errors, missed rows, MAX_TOKENS
 * truncation), and every failure burned the 2.5 call BEFORE the 3.1
 * fallback ran. Net token cost ended up HIGHER than calling 3.1
 * directly, while extraction quality regressed (each new run dropped
 * more rows than the last on the user's ICICI statement: 450 → 363 →
 * 268 across versions). User direction: "simplest solution, least
 * tokens, 2.5 keeps failing."
 *
 * 3.1 Flash-Lite Preview at $0.25 in / $1.50 out per 1M is pricier
 * per-token than 2.5 but reliably succeeds in one shot — no wasted
 * primary call, no fallback overhead, no chunk-stitching drift. The
 * function name and signature stay so callers don't change.
 *
 * The `looksValid` and `onFallback` options are preserved for source
 * compatibility but `onFallback` is now never invoked.
 */

import { extractGeminiVision } from './geminiVision.js';
import { GEMINI_CHAT_MODEL_T1 } from './gemini.js';
import type { GeminiJsonResult, GeminiJsonOptions } from './geminiJson.js';

export interface VisionFallbackOptions {
  maxTokens?: number;
  recordAttempt?: GeminiJsonOptions['recordAttempt'];
  /** Preserved for source compat with old call-sites. Never fires now
   *  that there's no tier-1 → tier-2 fallback (only one tier). */
  onFallback?: (input: { from: string; to: string }) => void;
  /** Optional sanity check on the parse. With a single tier, a false
   *  return now bubbles up as an error to the caller — there is no
   *  fallback to try. */
  looksValid?: (data: unknown) => boolean;
}

export async function extractVisionWithFallback<T = unknown>(
  buffer: Buffer,
  mimeType: string,
  prompt: string,
  opts: VisionFallbackOptions = {},
): Promise<GeminiJsonResult<T>> {
  const result = await extractGeminiVision<T>(buffer, mimeType, prompt, {
    maxTokens: opts.maxTokens,
    recordAttempt: opts.recordAttempt,
    model: GEMINI_CHAT_MODEL_T1,
  });
  if (opts.looksValid && !opts.looksValid(result.data)) {
    throw new Error('Vision parse passed schema but looksValid returned false');
  }
  return result;
}
