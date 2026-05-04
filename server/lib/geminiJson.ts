/**
 * Shared Gemini JSON-extraction helpers used by every route that asks Gemini
 * for a structured JSON response (suggestions, style profile, doc upload,
 * Form 16 import, bank statements). Centralizes the retry-with-fallback-model
 * loop and the defensive JSON parser so each call site stays a 3-line wrapper.
 */
import { gemini, GEMINI_MODEL, GEMINI_FALLBACK_MODEL } from './gemini.js';
import { withBreaker, BreakerOpenError } from './circuitBreaker.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface GeminiJsonOptions {
  /** Gemini max_tokens cap. Defaults to 4096. */
  maxTokens?: number;
  /** Override the primary model. */
  primaryModel?: string;
  /** Override the fallback model. Ignored if `fallbackModels` is set. */
  fallbackModel?: string;
  /**
   * Ordered chain of fallback models tried after the primary exhausts.
   * Each tier gets its own retry loop with exponential backoff on
   * 5xx/429. With the current two-model line-up (T2 → T1) most callers
   * just leave this unset and use the default; kept extensible for
   * cases where a route wants additional escalation tiers.
   */
  fallbackModels?: string[];
  /** Pass through to OpenAI SDK — defaults to `{ type: 'json_object' }`. Set to `null` to omit. */
  responseFormat?: { type: 'json_object' } | null;
  /**
   * Fires once per Gemini API call with the token usage and a `failed`
   * flag. Lets the caller log wasted spend (parse failures / truncations
   * / retries that exhausted) under a `_failed` category in usageRepo
   * without each route having to wrap callGeminiJson in its own try/catch.
   * Successful attempts also fire — the route can choose whether to
   * aggregate under the productive category or ignore.
   */
  recordAttempt?: (input: { failed: boolean; inputTokens: number; outputTokens: number; model: string }) => void;
  /** Retry when the model returns malformed/truncated JSON. */
  retryParseFailures?: boolean;
}

/** Parse JSON safely — strips markdown fences and attempts recovery on truncated strings. */
export function safeParseJson<T = unknown>(raw: string): T | null {
  let cleaned = raw
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // fall through to recovery
  }

  try {
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      else if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth--;
    }

    if (inString) cleaned += '"';
    while (bracketDepth > 0) { cleaned += ']'; bracketDepth--; }
    while (braceDepth > 0) { cleaned += '}'; braceDepth--; }

    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

/** Result of a Gemini JSON call — the parsed value plus the usage metadata the
 *  caller needs for cost logging. */
export interface GeminiJsonResult<T = unknown> {
  data: T;
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
}

async function callOnce<T>(
  messages: ChatCompletionMessageParam[],
  model: string,
  maxTokens: number,
  responseFormat: GeminiJsonOptions['responseFormat'],
  recordAttempt?: GeminiJsonOptions['recordAttempt'],
): Promise<GeminiJsonResult<T>> {
  // Pass `stream: false` explicitly so TypeScript narrows the return type
  // to ChatCompletion (the SDK overloads on the `stream` literal).
  const response = await gemini.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages,
    stream: false,
    ...(responseFormat === null ? {} : { response_format: responseFormat ?? { type: 'json_object' } }),
  });
  const raw = response.choices[0]?.message?.content ?? '{}';
  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;
  // Capture usage before parse so a `Failed to parse AI response`
  // throw still reports the wasted Gemini spend through recordAttempt.
  let succeeded = false;
  try {
    const parsed = safeParseJson<T>(raw);
    if (parsed === null) throw new Error('Failed to parse AI response');
    succeeded = true;
    return {
      data: parsed,
      inputTokens,
      outputTokens,
      modelUsed: model,
    };
  } finally {
    recordAttempt?.({ failed: !succeeded, inputTokens, outputTokens, model });
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const isParseFailure = (err: unknown) =>
  err instanceof Error && /Failed to parse AI response/i.test(err.message);
const MAX_PRIMARY_ATTEMPTS = 3;
// Fallback also gets multiple attempts now. Production logs showed
// brief Gemini regional outages (503 bursts lasting 30-90s) where the
// primary exhausted its 3 retries and then the fallback's single
// attempt also caught a 503, surfacing as a hard "503 (no body)"
// failure to the user even though waiting another 5-10s would have
// recovered. 3 fallback attempts with longer backoff covers the
// outage window.
const MAX_FALLBACK_ATTEMPTS = 3;
// Parse failures get at most 1 retry per model: same model + same prompt
// rarely reparses (the model isn't going to materially restructure its
// own output on a re-call), so burning 3 attempts here just delays
// advancing to the next model in the fallback chain. Production logs
// showed gemini-3-flash-preview eating its full 3-attempt budget on
// parse failures and then surfacing the failure to the user when a
// different model would have answered cleanly.
const MAX_PARSE_FAILURE_ATTEMPTS = 2;

/**
 * Call Gemini, ask for JSON, parse it, and return both the value and the
 * usage so the caller can log cost. Retries the primary model up to 3 times
 * on transient errors with exponential backoff (1s, 2s, 4s), then falls back
 * to the larger model once before giving up.
 */
export async function callGeminiJson<T = unknown>(
  messages: ChatCompletionMessageParam[],
  opts: GeminiJsonOptions = {},
): Promise<GeminiJsonResult<T>> {
  const maxTokens = opts.maxTokens ?? 4096;
  const primary = opts.primaryModel ?? GEMINI_MODEL;
  const fallbacks = opts.fallbackModels && opts.fallbackModels.length > 0
    ? opts.fallbackModels
    : [opts.fallbackModel ?? GEMINI_FALLBACK_MODEL];
  const responseFormat = opts.responseFormat;
  const recordAttempt = opts.recordAttempt;
  const retryParseFailures = opts.retryParseFailures === true;

  // Circuit-breaker wraps the WHOLE retry-and-fallback ladder for this provider.
  // If Gemini is genuinely down, the breaker opens after a handful of failures
  // and the next 60s of requests get a fast `BreakerOpenError` instead of each
  // burning 6+ seconds of backoff time.
  return withBreaker('gemini', async () => {
    let lastErr: unknown;
    const tiers: Array<{ model: string; maxAttempts: number; backoffMs: number }> = [
      { model: primary, maxAttempts: MAX_PRIMARY_ATTEMPTS, backoffMs: 1500 },
      ...fallbacks.map(model => ({ model, maxAttempts: MAX_FALLBACK_ATTEMPTS, backoffMs: 2000 })),
    ];

    for (let tierIdx = 0; tierIdx < tiers.length; tierIdx++) {
      const { model, maxAttempts, backoffMs } = tiers[tierIdx];
      if (tierIdx > 0) {
        console.warn(`[geminiJson] ${tiers[tierIdx - 1].model} exhausted, falling back to ${model}`);
      }

      // Parse failures don't benefit from many retries on the same model
      // (same prompt → same output shape), so cap them low and let the
      // next tier take over. Status retries follow the per-tier budget.
      const parseCap = Math.min(maxAttempts, MAX_PARSE_FAILURE_ATTEMPTS);
      let parseAttempts = 0;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          return await callOnce<T>(messages, model, maxTokens, responseFormat, recordAttempt);
        } catch (err) {
          lastErr = err;
          const status = (err as { status?: number })?.status ?? 0;
          const parseFail = retryParseFailures && isParseFailure(err);
          if (!RETRYABLE_STATUSES.has(status) && !parseFail) break;
          if (parseFail) {
            parseAttempts++;
            if (parseAttempts >= parseCap) break; // advance to next tier
          }
          if (attempt < maxAttempts - 1) {
            console.warn(`[geminiJson] ${model} retry ${attempt + 1}/${maxAttempts} after ${status ? `status ${status}` : 'JSON parse failure'}`);
            await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt)));
          }
        }
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  });
}

export { BreakerOpenError };
