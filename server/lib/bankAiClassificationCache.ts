/**
 * In-memory cache of AI bank-statement classifications.
 *
 * After a row goes through the deterministic anchors + learned rules and
 * still lands at the AI fallback, we cache the AI's decision keyed by
 * (billing_user, fingerprint, direction). The next statement uploaded by
 * the same firm with the same fingerprint skips the AI call entirely.
 *
 * Why per-process LRU instead of a DB table:
 *   - AI decisions are heuristic, not ground truth. Persisting them
 *     across server restarts risks propagating a wrong decision
 *     forever; the learned_classifications table is reserved for
 *     user-confirmed rules (provenance matters).
 *   - The hot path is "user uploads 5-20 statements in one session"
 *     — a per-process LRU with 24h TTL catches that without any DB
 *     write cost.
 *   - Restart loss is fine; worst case the firm pays the AI bill
 *     again on next upload.
 *
 * Safety rules baked in:
 *   - Don't cache low-confidence floors (category='Other' + null
 *     subcategory). That's the "AI couldn't decide" state and
 *     caching it would suppress retries that might succeed later.
 *   - Don't cache when fingerprint is empty (pure-noise narration).
 *   - 24h TTL — short enough that a corrected rule (via the learned-
 *     classifications table) overrides within a day, long enough to
 *     amortise across a typical multi-statement upload session.
 */

const MAX_ENTRIES = 50_000;
const TTL_MS = 24 * 60 * 60 * 1000;

interface CachedDecision {
  category: string;
  subcategory: string | null;
  expiresAt: number;
}

/** Insertion-ordered Map gives us cheap LRU: delete-on-access + reinsert,
 *  evict the oldest entry on overflow. */
const cache = new Map<string, CachedDecision>();

function makeKey(billingUserId: string, fingerprint: string, direction: 'credit' | 'debit'): string {
  return `${billingUserId}|${direction}|${fingerprint}`;
}

export interface AiCachedClassification {
  category: string;
  subcategory: string | null;
}

export function lookupAiClassification(
  billingUserId: string,
  fingerprint: string,
  direction: 'credit' | 'debit',
): AiCachedClassification | null {
  if (!fingerprint) return null;
  const key = makeKey(billingUserId, fingerprint, direction);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  // LRU touch — reinsert to mark as recently used.
  cache.delete(key);
  cache.set(key, entry);
  return { category: entry.category, subcategory: entry.subcategory };
}

export function recordAiClassification(
  billingUserId: string,
  fingerprint: string,
  direction: 'credit' | 'debit',
  category: string,
  subcategory: string | null,
): void {
  if (!fingerprint) return;
  // Low-confidence floor — see header comment. Re-running AI later may
  // produce a better decision once we have more anchors / learned rules.
  if (category === 'Other' && subcategory === null) return;
  const key = makeKey(billingUserId, fingerprint, direction);
  cache.delete(key);
  cache.set(key, { category, subcategory, expiresAt: Date.now() + TTL_MS });
  if (cache.size > MAX_ENTRIES) {
    // Evict oldest (first inserted) entry. Map iteration order is
    // insertion order in JS, so the first key is the LRU victim.
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
}

/** Test helper. */
export function _clearAiClassificationCache(): void {
  cache.clear();
}

/** Admin dashboard / smoke-test snapshot. */
export function getAiClassificationCacheStats(): { size: number; maxEntries: number } {
  return { size: cache.size, maxEntries: MAX_ENTRIES };
}
