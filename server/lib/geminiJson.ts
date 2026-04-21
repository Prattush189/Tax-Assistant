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
  /** Override the fallback model. */
  fallbackModel?: string;
  /** Pass through to OpenAI SDK — defaults to `{ type: 'json_object' }`. Set to `null` to omit. */
  responseFormat?: { type: 'json_object' } | null;
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
  const parsed = safeParseJson<T>(raw);
  if (parsed === null) throw new Error('Failed to parse Gemini JSON response');
  return {
    data: parsed,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    modelUsed: model,
  };
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_PRIMARY_ATTEMPTS = 3;

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
  const fallback = opts.fallbackModel ?? GEMINI_FALLBACK_MODEL;
  const responseFormat = opts.responseFormat;

  // Circuit-breaker wraps the WHOLE retry-and-fallback ladder for this provider.
  // If Gemini is genuinely down, the breaker opens after a handful of failures
  // and the next 60s of requests get a fast `BreakerOpenError` instead of each
  // burning 6+ seconds of backoff time.
  return withBreaker('gemini', async () => {
    let lastErr: unknown;

    for (let attempt = 0; attempt < MAX_PRIMARY_ATTEMPTS; attempt++) {
      try {
        return await callOnce<T>(messages, primary, maxTokens, responseFormat);
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number })?.status ?? 0;
        if (!RETRYABLE_STATUSES.has(status)) break;
        if (attempt < MAX_PRIMARY_ATTEMPTS - 1) {
          console.warn(`[geminiJson] ${primary} retry ${attempt + 1}/${MAX_PRIMARY_ATTEMPTS} after status ${status}`);
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    console.warn(`[geminiJson] ${primary} exhausted, falling back to ${fallback}`);
    try {
      return await callOnce<T>(messages, fallback, maxTokens, responseFormat);
    } catch (err) {
      lastErr = err;
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  });
}

export { BreakerOpenError };
