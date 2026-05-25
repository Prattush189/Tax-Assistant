/**
 * Bank-statement CSV-enrichment client.
 *
 * Why a dedicated helper instead of callGeminiJson:
 * - The CSV path fires 5–15 batches per statement, each with the SAME
 *   ~2 KB static prefix (instructions + conditions block) followed by
 *   a small dynamic tail (the row batch). The OpenAI-compatible
 *   endpoint that callGeminiJson uses does NOT expose Gemini's
 *   `cachedContents` API, so every batch re-pays the full static
 *   prefix as fresh input tokens.
 * - Switching this one call site to the native Gemini API lets us
 *   cache the static prefix once per statement (and reuse across
 *   multi-statement sessions within the cache TTL). Cache hits drop
 *   the cached portion to ~25% of normal input cost — and on a
 *   typical 8-batch upload the static prefix is ~60% of input, so
 *   the math is ~45% input-token reduction per statement.
 *
 * Behaviour parity with callGeminiJson:
 * - T2 primary, T1 fallback (matches GEMINI_MODEL / GEMINI_FALLBACK_MODEL).
 * - 3 attempts per tier with exponential backoff on 429/5xx.
 * - Breaker-wrapped under the shared 'gemini' upstream.
 * - recordAttempt + onFallback hooks for usage logging.
 * - Cached-content rejection (TTL expired / rotated) invalidates the
 *   local cache entry and retries uncached on the same tier.
 *
 * Output JSON shape is opaque to this module — caller passes any
 * type parameter; we just parse and return.
 */

import { GEMINI_API_KEYS, GEMINI_MODEL, GEMINI_FALLBACK_MODEL } from './gemini.js';
import { safeParseJson, type GeminiJsonOptions, type GeminiJsonResult } from './geminiJson.js';
import { withBreaker } from './circuitBreaker.js';
import { getOrCreateCachedContent, invalidateCache } from './geminiCache.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_PRIMARY_ATTEMPTS = 3;
const MAX_FALLBACK_ATTEMPTS = 3;

export interface BankEnrichmentOptions {
  /** Output token cap. Defaults to 16,384 (current CSV path uses this). */
  maxTokens?: number;
  /** Override the primary model. */
  primaryModel?: string;
  /** Override the fallback model. */
  fallbackModel?: string;
  recordAttempt?: GeminiJsonOptions['recordAttempt'];
  onFallback?: GeminiJsonOptions['onFallback'];
}

interface NativeResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/**
 * Call Gemini natively with an optional cached static prefix.
 *
 * `staticPrefix` is the cacheable portion (instructions + conditions
 * block). Below the cache size threshold it gets inlined into the
 * dynamic tail and no cache is created.
 *
 * `dynamicTail` is the per-call portion (the batch rows).
 */
export async function callBankEnrichment<T>(
  staticPrefix: string,
  dynamicTail: string,
  opts: BankEnrichmentOptions = {},
): Promise<GeminiJsonResult<T>> {
  const apiKey = GEMINI_API_KEYS[0] ?? '';
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const maxTokens = opts.maxTokens ?? 16_384;
  const primary = opts.primaryModel ?? GEMINI_MODEL;
  const fallback = opts.fallbackModel ?? GEMINI_FALLBACK_MODEL;
  const recordAttempt = opts.recordAttempt;
  const onFallback = opts.onFallback;
  let fallbackFired = false;

  const baseGenerationConfig = {
    maxOutputTokens: maxTokens,
    responseMimeType: 'application/json',
    // 3.x Flash-Lite Preview reasoning tokens would eat the output
    // budget; explicit zero matches the vision-path config.
    thinkingConfig: { thinkingBudget: 0 },
  };

  // Try once to create / fetch a cache entry for the static prefix.
  // Cached separately per model — Gemini scopes caches by model id.
  const tryCache = async (model: string) => getOrCreateCachedContent(model, staticPrefix, apiKey);

  const buildBody = (useCache: boolean, cachedName: string | null) =>
    useCache && cachedName
      ? {
          cachedContent: cachedName,
          contents: [{ role: 'user', parts: [{ text: dynamicTail }] }],
          generationConfig: baseGenerationConfig,
        }
      : {
          contents: [{
            role: 'user',
            parts: [{ text: `${staticPrefix}${dynamicTail}` }],
          }],
          generationConfig: baseGenerationConfig,
        };

  const callOnce = async (model: string, useCache: boolean, cachedName: string | null) => {
    const url = `${BASE_URL}/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(useCache, cachedName)),
    });
    return res;
  };

  return withBreaker('gemini', async () => {
    let lastErr: unknown;
    const tiers: Array<{ model: string; maxAttempts: number; backoffMs: number }> = [
      { model: primary, maxAttempts: MAX_PRIMARY_ATTEMPTS, backoffMs: 1500 },
      { model: fallback, maxAttempts: MAX_FALLBACK_ATTEMPTS, backoffMs: 2000 },
    ];

    for (let tierIdx = 0; tierIdx < tiers.length; tierIdx++) {
      const { model, maxAttempts, backoffMs } = tiers[tierIdx];
      if (tierIdx > 0) {
        console.warn(`[bankEnrichment] ${tiers[tierIdx - 1].model} exhausted, falling back to ${model}`);
        if (!fallbackFired) {
          fallbackFired = true;
          try { onFallback?.({ from: tiers[tierIdx - 1].model, to: model }); }
          catch (e) { console.warn('[bankEnrichment] onFallback hook threw:', (e as Error).message); }
        }
      }

      // One cache lookup per tier — the cache name is model-scoped.
      let cachedName = await tryCache(model);
      let useCache = !!cachedName;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let succeeded = false;
        let inputTokens = 0;
        let outputTokens = 0;
        try {
          const res = await callOnce(model, useCache, cachedName);
          if (!res.ok) {
            const text = await res.text();
            const status = res.status;
            // Cached-content went stale. Invalidate, drop to uncached
            // for the rest of this tier, retry immediately without
            // burning the backoff budget.
            if (useCache && (status === 404 || /cached.?content/i.test(text))) {
              console.warn(`[bankEnrichment] ${model} cache reference stale (HTTP ${status}); switching to uncached for this tier`);
              invalidateCache(model, staticPrefix, apiKey);
              cachedName = null;
              useCache = false;
              continue;
            }
            console.warn(`[bankEnrichment] ${model} HTTP ${status}: ${text.slice(0, 300)}`);
            const err = new Error(`AI service error ${status}: ${text.slice(0, 300)}`);
            (err as { status?: number }).status = status;
            throw err;
          }
          const json = await res.json() as NativeResponse;
          inputTokens = json.usageMetadata?.promptTokenCount ?? 0;
          outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0;
          const finishReason = json.candidates?.[0]?.finishReason;
          const raw = (json.candidates?.[0]?.content?.parts ?? [])
            .map(p => p.text ?? '')
            .join('');
          if (!raw) throw new Error('AI service returned empty response');
          if (finishReason === 'MAX_TOKENS') {
            // Surface as fatal so categorizeWithSplit's bisect path
            // can split the batch — same contract as the prior
            // OpenAI-compat call, which threw a similar error.
            const err = new Error(`finish_reason=length — output truncated (${outputTokens}/${maxTokens} tokens)`);
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
          if (attempt < maxAttempts - 1) {
            console.warn(`[bankEnrichment] ${model} retry ${attempt + 1}/${maxAttempts} after status ${status}`);
            await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt)));
          }
        }
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  });
}
