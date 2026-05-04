/**
 * Native-API Gemini vision helper for multi-page PDFs.
 *
 * Why this exists: the OpenAI-compatible shim
 * (`generativelanguage.googleapis.com/v1beta/openai/`) only understands
 * `image_url` content parts, which it treats as a single image. When
 * we feed it a multi-page PDF data URL the shim silently keeps page 1
 * and drops the rest — observed in production as "AI vision only
 * analyzed page 1 of 17" on a scanned bank statement.
 *
 * The native `generateContent` endpoint accepts `inlineData` with
 * `mimeType: 'application/pdf'` and processes every page as documented
 * Gemini behaviour. This module wraps that endpoint with the same
 * retry-with-fallback-chain semantics as `geminiJson.ts`, so the bank-
 * statement / ledger / form-16 vision flows can swap their vision call
 * without re-implementing breaker / retry / parse-failure handling.
 *
 * Usage shape mirrors `extractWithRetry` from documentExtract.ts so the
 * call sites stay symmetric.
 */
import { GEMINI_MODEL, GEMINI_FALLBACK_MODEL } from './gemini.js';
import { withBreaker, BreakerOpenError } from './circuitBreaker.js';
import { safeParseJson, type GeminiJsonResult, type GeminiJsonOptions } from './geminiJson.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? '';
const NATIVE_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 120_000; // longer than the OpenAI client (90s) — multi-page PDF OCR is genuinely slow on dense scans

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_PRIMARY_ATTEMPTS = 3;
const MAX_FALLBACK_ATTEMPTS = 3;
const MAX_PARSE_FAILURE_ATTEMPTS = 2;

const isParseFailure = (err: unknown): boolean =>
  err instanceof Error && /Failed to parse Gemini JSON response/i.test(err.message);

class GeminiNativeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GeminiNativeError';
  }
}

interface NativeUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface NativeResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: NativeUsage;
  error?: { message?: string; status?: string };
}

async function callOnce<T>(
  base64Data: string,
  mimeType: string,
  prompt: string,
  model: string,
  maxTokens: number,
  recordAttempt: GeminiJsonOptions['recordAttempt'],
): Promise<GeminiJsonResult<T>> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');
  const url = `${NATIVE_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  // Thinking budget is always 0 — both active models (T2, T1) accept
  // it and we don't want internal "thinking" tokens eating the output
  // budget on deterministic OCR-style extraction. Earlier versions
  // had a per-model branch for gemini-3-flash-preview which couldn't
  // fully disable thinking; that model is no longer in the line-up.
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: base64Data } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: maxTokens,
      temperature: 0,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Attach status so the retry layer can decide whether to retry.
    let detail = '';
    try { detail = (await res.text()).slice(0, 280); } catch { /* swallow */ }
    throw new GeminiNativeError(`Gemini ${model} returned ${res.status}${detail ? ` — ${detail}` : ''}`, res.status);
  }

  const json = await res.json() as NativeResponse;
  if (json.error) {
    throw new GeminiNativeError(`Gemini ${model} error: ${json.error.message ?? 'unknown'}`, 500);
  }
  const raw = json.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '{}';
  const finishReason = json.candidates?.[0]?.finishReason ?? '';
  const inputTokens = json.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0;

  // Surface MAX_TOKENS truncation as a distinct, actionable signal:
  // safeParseJson tries to repair brace-imbalance but a truncated array
  // of transactions almost always loses its tail row mid-string, and
  // even a successful repair quietly loses data. Flag it so the retry
  // layer escalates (a higher-output model has a real chance) and the
  // server logs make the cause obvious instead of "Failed to parse".
  const truncated = finishReason === 'MAX_TOKENS';

  let succeeded = false;
  try {
    const parsed = safeParseJson<T>(raw);
    if (parsed === null) throw new Error(truncated
      ? `Failed to parse Gemini JSON response (truncated at MAX_TOKENS=${outputTokens}; PDF likely needs higher output budget or page chunking)`
      : 'Failed to parse Gemini JSON response');
    if (truncated) {
      // Even if repair "succeeded", the data lost its tail. Refuse
      // the result so the retry / fallback chain gets a chance with
      // a stronger model rather than persisting a silently-incomplete
      // extraction.
      throw new Error(`Failed to parse Gemini JSON response (truncated at MAX_TOKENS=${outputTokens})`);
    }
    succeeded = true;
    return { data: parsed, inputTokens, outputTokens, modelUsed: model };
  } finally {
    recordAttempt?.({ failed: !succeeded, inputTokens, outputTokens, model });
  }
}

export interface VisionPdfOptions {
  /** Output token cap. Defaults to 8192. */
  maxTokens?: number;
  primaryModel?: string;
  fallbackModel?: string;
  fallbackModels?: string[];
  recordAttempt?: GeminiJsonOptions['recordAttempt'];
  /** Retry malformed/truncated JSON responses (one extra attempt per tier). */
  retryParseFailures?: boolean;
}

/**
 * Run a Gemini vision extraction on a PDF (or image) buffer using the
 * native generateContent endpoint. Returns the same shape as
 * `extractWithRetry` so call sites can swap with a one-liner.
 *
 * Use this for multi-page PDFs. Single-image inputs work too but the
 * OpenAI compat path (extractWithRetry) is fine for those.
 */
export async function extractVisionPdf<T = unknown>(
  buffer: Buffer,
  mimeType: string,
  prompt: string,
  opts: VisionPdfOptions = {},
): Promise<GeminiJsonResult<T>> {
  const base64 = buffer.toString('base64');
  const maxTokens = opts.maxTokens ?? 8192;
  const primary = opts.primaryModel ?? GEMINI_MODEL;
  const fallbacks = opts.fallbackModels && opts.fallbackModels.length > 0
    ? opts.fallbackModels
    : [opts.fallbackModel ?? GEMINI_FALLBACK_MODEL];
  const recordAttempt = opts.recordAttempt;
  const retryParseFailures = opts.retryParseFailures === true;

  return withBreaker('gemini', async () => {
    const tiers: Array<{ model: string; maxAttempts: number; backoffMs: number }> = [
      { model: primary, maxAttempts: MAX_PRIMARY_ATTEMPTS, backoffMs: 1500 },
      ...fallbacks.map(model => ({ model, maxAttempts: MAX_FALLBACK_ATTEMPTS, backoffMs: 2000 })),
    ];

    let lastErr: unknown;
    for (let tierIdx = 0; tierIdx < tiers.length; tierIdx++) {
      const { model, maxAttempts, backoffMs } = tiers[tierIdx];
      if (tierIdx > 0) {
        console.warn(`[geminiVisionPdf] ${tiers[tierIdx - 1].model} exhausted, falling back to ${model}`);
      }
      const parseCap = Math.min(maxAttempts, MAX_PARSE_FAILURE_ATTEMPTS);
      let parseAttempts = 0;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          return await callOnce<T>(base64, mimeType, prompt, model, maxTokens, recordAttempt);
        } catch (err) {
          lastErr = err;
          const status = err instanceof GeminiNativeError ? err.status : 0;
          const parseFail = retryParseFailures && isParseFailure(err);
          if (!RETRYABLE_STATUSES.has(status) && !parseFail) break;
          if (parseFail) {
            parseAttempts++;
            if (parseAttempts >= parseCap) break;
          }
          if (attempt < maxAttempts - 1) {
            console.warn(`[geminiVisionPdf] ${model} retry ${attempt + 1}/${maxAttempts} after ${status ? `status ${status}` : 'JSON parse failure'}`);
            await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt)));
          }
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  });
}

export { BreakerOpenError };
