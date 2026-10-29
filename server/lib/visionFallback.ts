/**
 * Two-tier vision extractor: T1 (Gemini 3.1 Flash-Lite) with a T2
 * (Gemini 3.7 Flash) rescue -- see GEMINI_VISION_MODEL_* in lib/gemini.ts.
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
import { GEMINI_VISION_MODEL_T1, GEMINI_VISION_MODEL_T2, costForModel } from './gemini.js';
import { safeParseJson, type GeminiJsonResult, type GeminiJsonOptions } from './geminiJson.js';
import { claudeComplete, isClaudeActive, CLAUDE_MODEL, CLAUDE_MODEL_FAST, type ClaudeCompletion } from './claude.js';

/** Claude rejects requests over 32 MB; base64 inflates by 4/3. */
const CLAUDE_MAX_UPLOAD_BYTES = 22 * 1024 * 1024;
const CLAUDE_MIME = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/;

/** A billed Claude attempt that produced nothing usable before Gemini
 *  answered. Callers log these as `<category>_failed` rows. */
export type ClaudeWastedAttempt = { model: string; inputTokens: number; outputTokens: number; cachedInputTokens: number; costUsd: number };

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
  /** Claude reads the document first while the admin switch is on:
   *  'fast' (Haiku, the default) for notices, Form 16 and attachments;
   *  'smart' (Sonnet) for dense tables like scanned ledgers; false to
   *  skip (bank statements, where Claude already ran earlier). Gemini
   *  T1 → T2 below stays as the rescue. 2026-10-29 test, judged blind
   *  against the documents: notices + attachments accuracy/completeness
   *  Gemini 8.6/5.3, Haiku 9.6/8.4, Sonnet 9.2/8.7; scanned ledgers
   *  Sonnet 576/576 rows, Gemini failed 2 of 3. */
  claude?: 'fast' | 'smart' | false;
}

export async function extractVisionWithFallback<T = unknown>(
  buffer: Buffer,
  mimeType: string,
  prompt: string,
  opts: VisionFallbackOptions = {},
): Promise<GeminiJsonResult<T> & { claudeWasted?: ClaudeWastedAttempt[] }> {
  const claudeWasted: ClaudeWastedAttempt[] = [];
  const tier = opts.claude ?? 'fast';
  if (tier && isClaudeActive() && CLAUDE_MIME.test(mimeType) && buffer.length <= CLAUDE_MAX_UPLOAD_BYTES) {
    const model = tier === 'smart' ? CLAUDE_MODEL : CLAUDE_MODEL_FAST;
    const part = mimeType === 'application/pdf'
      ? { type: 'file', file: { file_data: `data:application/pdf;base64,${buffer.toString('base64')}`, filename: 'document.pdf' } }
      : { type: 'image_url', image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` } };
    const wasted = (u: Pick<ClaudeCompletion, 'model' | 'inputTokens' | 'outputTokens' | 'cachedInputTokens'>) => {
      claudeWasted.push({ model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cachedInputTokens: u.cachedInputTokens, costUsd: costForModel(u.model, u.inputTokens, u.outputTokens, u.cachedInputTokens) });
      opts.recordAttempt?.({ failed: true, inputTokens: u.inputTokens, outputTokens: u.outputTokens, model: u.model });
    };
    try {
      const r = await claudeComplete([{ role: 'user', content: [part, { type: 'text', text: prompt }] as never }],
        { model, maxTokens: opts.maxTokens ?? 8192, effort: 'medium', timeoutMs: 600_000 });
      const data = safeParseJson<T>(r.text);
      if (data !== null && r.finishReason !== 'length' && (!opts.looksValid || opts.looksValid(data))) {
        opts.recordAttempt?.({ failed: false, inputTokens: r.inputTokens, outputTokens: r.outputTokens, model: r.model });
        return { data, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cachedInputTokens: r.cachedInputTokens, modelUsed: r.model };
      }
      wasted(r);
      console.warn(`[visionFallback] ${model} output unusable (${data === null ? 'unparseable' : r.finishReason === 'length' ? 'output cap hit' : 'looksValid false'}); falling back to Gemini`);
    } catch (err) {
      const u = (err as { claudeUsage?: ClaudeCompletion }).claudeUsage;
      if (u) wasted(u);
      console.warn(`[visionFallback] ${model} failed (${(err as Error)?.message?.slice(0, 200)}); falling back to Gemini`);
    }
    opts.onFallback?.({ from: model, to: GEMINI_VISION_MODEL_T1 });
  }
  const withWasted = <R extends GeminiJsonResult<T>>(r: R) => (claudeWasted.length ? Object.assign(r, { claudeWasted }) : r);

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
    return withWasted(await attempt(GEMINI_VISION_MODEL_T1));
  } catch (err) {
    // Density failure — T2 cannot do better. Surface it unchanged.
    if ((err as { truncated?: boolean })?.truncated) throw err;
    console.warn(
      `[visionFallback] ${GEMINI_VISION_MODEL_T1} failed (${(err as Error)?.message?.slice(0, 200)}); retrying on ${GEMINI_VISION_MODEL_T2}`,
    );
    opts.onFallback?.({ from: GEMINI_VISION_MODEL_T1, to: GEMINI_VISION_MODEL_T2 });
    return withWasted(await attempt(GEMINI_VISION_MODEL_T2));
  }
}
