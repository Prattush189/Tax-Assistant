/**
 * Gemini native context-caching shim.
 *
 * Used by `streamGeminiChat` for the chat route, where the SYSTEM_INSTRUCTION
 * is ~2k tokens of constant rules (regimes, GST slabs, formatting). Caching
 * trims that input cost to ~25% on cache hits and saves 50-150ms of latency
 * per chat turn.
 *
 * Cache entries are keyed by (model, apiKey, sysPromptHash) and stored in
 * memory only — they're reconstructed on the next call after a server
 * restart. Google manages TTL server-side (default 1 hour); we react to
 * NOT_FOUND responses by clearing our entry and recreating.
 *
 * Failure mode: if cache creation fails for ANY reason (model unsupported,
 * prompt too short, API error), we silently fall back to the uncached path
 * and the caller proceeds normally. Caching is a perf optimization, not a
 * correctness requirement.
 */

import { createHash } from 'crypto';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** Minimum prompt length to bother caching. Gemini rejects caches below the
 *  per-model minimum (varies 1024–4096 tokens); we use a conservative byte
 *  threshold that tracks roughly the worst case. */
const MIN_CACHE_BYTES = 6000;

/** Default cache TTL — 1 hour. Long enough to catch a busy chat session,
 *  short enough that prompt edits propagate within an hour. */
const CACHE_TTL_SECONDS = 3600;

interface CacheEntry {
  name: string;          // e.g. "cachedContents/abc123"
  createdAt: number;     // ms epoch
}

const cacheMap = new Map<string, CacheEntry>();
/** In-flight cache creations — multiple concurrent chat requests collapse to one. */
const inFlight = new Map<string, Promise<string | null>>();

function cacheKey(model: string, apiKey: string, systemPrompt: string): string {
  // Hash the api key (so the cache key is opaque in logs) and the prompt.
  const keyHash = createHash('sha256').update(apiKey).digest('hex').slice(0, 8);
  const promptHash = createHash('sha256').update(systemPrompt).digest('hex').slice(0, 12);
  return `${model}|${keyHash}|${promptHash}`;
}

/**
 * Get an existing cache name or create a new one. Returns null if caching is
 * not viable for this prompt (too short, model unsupported, API error). The
 * caller should treat null as "send the full system prompt this time".
 */
export async function getOrCreateCachedContent(
  model: string,
  systemPrompt: string,
  apiKey: string,
): Promise<string | null> {
  if (!apiKey || systemPrompt.length < MIN_CACHE_BYTES) return null;

  const key = cacheKey(model, apiKey, systemPrompt);
  const existing = cacheMap.get(key);
  if (existing) return existing.name;

  // Coalesce concurrent creates so the first chat after server boot only
  // makes one cache-create request even under burst load.
  const pending = inFlight.get(key);
  if (pending) return pending;

  const creation = createCache(model, systemPrompt, apiKey).then(name => {
    if (name) cacheMap.set(key, { name, createdAt: Date.now() });
    inFlight.delete(key);
    return name;
  });
  inFlight.set(key, creation);
  return creation;
}

async function createCache(model: string, systemPrompt: string, apiKey: string): Promise<string | null> {
  try {
    const url = `${BASE_URL}/cachedContents?key=${apiKey}`;
    const body = {
      model: `models/${model}`,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      ttl: `${CACHE_TTL_SECONDS}s`,
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[geminiCache] create failed (${res.status}) for ${model}: ${errText.slice(0, 200)}`);
      return null;
    }
    const data = await res.json() as { name?: string };
    if (!data.name) return null;
    console.log(`[geminiCache] created ${data.name} for ${model}`);
    return data.name;
  } catch (err) {
    console.warn(`[geminiCache] create error for ${model}: ${(err as Error).message?.slice(0, 200)}`);
    return null;
  }
}

/** Drop the cache entry for this prompt — call when Gemini rejects the
 *  cachedContent reference (TTL expired, cache+tools combo not allowed, etc).
 *  The next call will recreate. */
export function invalidateCache(model: string, systemPrompt: string, apiKey: string): void {
  const key = cacheKey(model, apiKey, systemPrompt);
  if (cacheMap.delete(key)) {
    console.log(`[geminiCache] invalidated ${key}`);
  }
}
