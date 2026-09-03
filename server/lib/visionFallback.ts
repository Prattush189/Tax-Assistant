/**
 * Two-tier vision extractor: T1 (Gemini 3.5 Flash-Lite) with a T2
 * (Gemini 2.5 Flash-Lite) rescue.
 *
 * HISTORY — read before changing the tier order.
 *
 * 2026-06: the ORIGINAL ladder ran T2 FIRST and fell back to T1. That
 * was removed for good reason: 2.5 failed on virtually every dense
 * Indian bank statement (parse errors, missed rows, MAX_TOKENS), and
 * every failure burned a full 2.5 call BEFORE the better model ran —
 * higher net cost AND worse extraction. User direction at the time:
 * "simplest solution, least tokens, 2.5 keeps failing."
 *
 * That change removed the SECOND TIER ENTIRELY, which went too far.
 * Every call site was written against a two-tier contract and still
 * documents it — bankStatements.ts passes `looksValid` with the
 * comment "forces the fallback to Gemini 2.5 Flash-Lite", and
 * notices.ts passes one saying "so tier 2 fires". No tier 2 existed,
 * so those `looksValid` guards inverted their own purpose: instead of
 * triggering a rescue they became a hard failure, and a single
 * empty-but-well-formed response from T1 surfaced to the user as
 * "Could not read the uploaded notice".
 *
 * The order below keeps the 2026-06 lesson intact while honouring the
 * contract: T1 stays PRIMARY, so the happy path is still one call at
 * the good model and costs exactly what it did before. T2 runs ONLY
 * when T1 genuinely failed — a rare path that previously produced a
 * dead end.
 *
 * EXCEPTION: MAX_TOKENS truncation is NOT retried. That is a density
 * problem, not a model problem; T2 has no more output headroom, so a
 * retry only burns tokens before failing again. It propagates so the
 * caller can surface the actionable "split the file" message.
 */

import { extractGeminiVision } from './geminiVision.js';
import { GEMINI_VISION_MODEL_T1, GEMINI_VISION_MODEL_T2 } from './gemini.js';
import type { GeminiJsonResult, GeminiJsonOptions } from './geminiJson.js';

export interface VisionFallbackOptions {
  maxTokens?: number;
  recordAttempt?: GeminiJsonOptions['recordAttempt'];
  /** Pre-downsampled page images to send instead of the raw `buffer`.
   *  See GeminiVisionOptions.imageParts — caps per-page vision tokens. */
  imageParts?: Array<{ mimeType: string; data: Buffer }>;
  /** Fires when T1 failed and T2 is about to be tried. */
  onFallback?: (input: { from: string; to: string }) => void;
  /** Sanity check on the parse. Returning false means "this response
   *  is structurally valid but useless" (empty summary, zero rows) and
   *  triggers the T2 rescue — which is what every caller intends. If
   *  T2 also fails the check, the error propagates. */
  looksValid?: (data: unknown) => boolean;
}

export async function extractVisionWithFallback<T = unknown>(
  buffer: Buffer,
  mimeType: string,
  prompt: string,
  opts: VisionFallbackOptions = {},
): Promise<GeminiJsonResult<T>> {
  const attempt = async (model: string): Promise<GeminiJsonResult<T>> => {
    const result = await extractGeminiVision<T>(buffer, mimeType, prompt, {
      maxTokens: opts.maxTokens,
      recordAttempt: opts.recordAttempt,
      model,
      imageParts: opts.imageParts,
    });
    if (opts.looksValid && !opts.looksValid(result.data)) {
      const err = new Error('Vision parse passed schema but looksValid returned false');
      (err as { looksValidFailed?: boolean }).looksValidFailed = true;
      throw err;
    }
    return result;
  };

  try {
    return await attempt(GEMINI_VISION_MODEL_T1);
  } catch (err) {
    // Density failure — T2 cannot do better. Surface it unchanged.
    if ((err as { truncated?: boolean })?.truncated) throw err;
    console.warn(
      `[visionFallback] ${GEMINI_VISION_MODEL_T1} failed (${(err as Error)?.message?.slice(0, 200)}); retrying on ${GEMINI_VISION_MODEL_T2}`,
    );
    opts.onFallback?.({ from: GEMINI_VISION_MODEL_T1, to: GEMINI_VISION_MODEL_T2 });
    return await attempt(GEMINI_VISION_MODEL_T2);
  }
}
