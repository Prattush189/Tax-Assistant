/**
 * Gemini vision extractor — sends a PDF / image inline as base64 to
 * Gemini's native generateContent API and returns parsed JSON.
 *
 * Default model: GEMINI_CHAT_MODEL_T2 (2.5 Flash-Lite — cheap primary).
 * Caller can override via opts.model.
 *
 * Hard request-size limit: Gemini accepts up to 20 MB per inline-data
 * request. The route-layer multer 10 MB cap keeps payloads well under.
 */

import { GEMINI_API_KEYS, GEMINI_CHAT_MODEL_T2 } from './gemini.js';
import { safeParseJson, type GeminiJsonOptions, type GeminiJsonResult } from './geminiJson.js';
import { withBreaker } from './circuitBreaker.js';
import { getOrCreateCachedContent, invalidateCache } from './geminiCache.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiVisionOptions {
  /** Output token cap. Defaults to 8192. */
  maxTokens?: number;
  /** Override the Gemini model. Defaults to T2 (2.5 Flash-Lite — cheap primary). */
  model?: string;
  /** Pass-through usage logging callback. */
  recordAttempt?: GeminiJsonOptions['recordAttempt'];
  /** Send these image parts INSTEAD of the single `buffer`/`mimeType`
   *  positional arg. Used by the downsampled vision path: each part is
   *  one pre-shrunk page JPEG, so Gemini tiles far fewer 768px tiles
   *  (258 tokens each) than the full-resolution source would. When
   *  present and non-empty, `buffer` is not sent. */
  imageParts?: Array<{ mimeType: string; data: Buffer }>;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

export async function extractGeminiVision<T = unknown>(
  buffer: Buffer,
  mimeType: string,
  prompt: string,
  opts: GeminiVisionOptions = {},
): Promise<GeminiJsonResult<T>> {
  const model = opts.model ?? GEMINI_CHAT_MODEL_T2;
  const maxTokens = opts.maxTokens ?? 8192;
  const recordAttempt = opts.recordAttempt;
  const apiKey = GEMINI_API_KEYS[0] ?? '';
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  // Build the image part(s) sent to Gemini. Default: one inline_data
  // from the positional buffer. Downsampled path: one inline_data per
  // pre-shrunk page JPEG (opts.imageParts) — the positional buffer is
  // then NOT encoded/sent, so we don't pay to base64 the raw upload.
  const imageDataParts =
    opts.imageParts && opts.imageParts.length > 0
      ? opts.imageParts.map((p) => ({ mime_type: p.mimeType, data: p.data.toString('base64') }))
      : [{ mime_type: mimeType, data: buffer.toString('base64') }];

  // Try to get a cached content handle for the static prompt. When this
  // returns a name, the request omits the prompt text and references the
  // cache instead — input tokens drop to ~25% of full cost on a hit. The
  // file bytes (inline_data) are NOT cached (per-upload by definition);
  // only the ~1.4K static prompt + the conditions block (which is stable
  // per-user) lives in the cache. Failure to obtain a cache is silently
  // ignored — we just send the full prompt that call.
  const cachedName = await getOrCreateCachedContent(model, prompt, apiKey);

  const baseGenerationConfig = {
    maxOutputTokens: maxTokens,
    responseMimeType: 'application/json',
    // 3.x Flash-Lite Preview burns most of max_tokens on internal
    // reasoning tokens by default — explicitly zero the thinking
    // budget so the entire output budget goes to the JSON we want.
    thinkingConfig: { thinkingBudget: 0 },
  };

  const imageParts = imageDataParts.map((inline_data) => ({ inline_data }));
  const buildBody = (useCache: boolean) =>
    useCache && cachedName
      ? {
          cachedContent: cachedName,
          contents: [{ role: 'user', parts: [...imageParts] }],
          generationConfig: baseGenerationConfig,
        }
      : {
          contents: [{
            role: 'user',
            parts: [
              ...imageParts,
              { text: prompt },
            ],
          }],
          generationConfig: baseGenerationConfig,
        };

  return withBreaker('gemini', async () => {
    let lastErr: unknown;
    let useCache = !!cachedName;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let succeeded = false;
      let inputTokens = 0;
      let outputTokens = 0;
      try {
        const url = `${BASE_URL}/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildBody(useCache)),
        });
        if (!res.ok) {
          const text = await res.text();
          const status = res.status;
          // Cached-content reference is stale (TTL expired or the cache
          // got rotated under us). Invalidate our local entry, drop back
          // to the uncached path for the rest of this call's retries,
          // and immediately retry this attempt without burning the
          // backoff budget — the next iteration sends the full prompt.
          if (useCache && (status === 404 || /cached.?content/i.test(text))) {
            console.warn(`[geminiVision] ${model} cache reference stale (HTTP ${status}); recreating uncached`);
            invalidateCache(model, prompt, apiKey);
            useCache = false;
            continue;
          }
          // User-facing message — must NOT include "Gemini" or the
          // model name. Internal log keeps the model for debugging.
          console.warn(`[geminiVision] ${model} HTTP ${status}: ${text.slice(0, 300)}`);
          const err = new Error(`AI vision service error ${status}: ${text.slice(0, 300)}`);
          (err as { status?: number }).status = status;
          throw err;
        }
        const json = await res.json() as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
            finishReason?: string;
          }>;
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        inputTokens = json.usageMetadata?.promptTokenCount ?? 0;
        outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0;
        const finishReason = json.candidates?.[0]?.finishReason;

        const raw = (json.candidates?.[0]?.content?.parts ?? [])
          .map(p => p.text ?? '')
          .join('');
        if (!raw) throw new Error('AI service returned empty response');
        // Output-cap truncation — the JSON gets cut mid-array. Surface
        // it so callers can either retry with a higher cap or chunk
        // the input. safeParseJson would otherwise silently recover a
        // partial array and the caller would never know data was lost.
        if (finishReason === 'MAX_TOKENS') {
          // User-facing message must NOT name the AI provider —
          // surface the symptom (output truncated, file too dense)
          // and the action (split / smaller export). Model name is
          // kept in console.warn for debugging only.
          console.warn(`[geminiVision] ${model} MAX_TOKENS hit (${outputTokens}/${maxTokens})`);
          const err = new Error(`Output limit hit (${outputTokens}/${maxTokens} tokens) — the file is too dense for a single pass. Split the year into halves and re-upload.`);
          (err as { truncated?: boolean }).truncated = true;
          throw err;
        }
        const parsed = safeParseJson<T>(raw);
        if (parsed === null) throw new Error('Failed to parse AI response');
        succeeded = true;
        return { data: parsed, inputTokens, outputTokens, modelUsed: model };
      } catch (err) {
        lastErr = err;
        recordAttempt?.({ failed: !succeeded, inputTokens, outputTokens, model });
        const status = (err as { status?: number })?.status ?? 0;
        if (!RETRYABLE_STATUSES.has(status)) break;
        if (attempt < MAX_ATTEMPTS - 1) {
          console.warn(`[geminiVision] ${model} retry ${attempt + 1}/${MAX_ATTEMPTS} after status ${status}`);
          await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt)));
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  });
}
