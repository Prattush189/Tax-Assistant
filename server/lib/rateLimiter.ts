/**
 * Generic per-bucket rate limiter for upstream provider rate limits.
 *
 * Today this owns the Anthropic side: a per-minute requests bucket so we can
 * detect we're about to hit Anthropic Tier 1's ~50 RPM cap and back off
 * before the 429 lands. The existing `searchQuota.ts` continues to own
 * Gemini's Google-Search grounding quota — folding it in here would mean
 * migrating its SQLite table, which carries real risk for marginal gain.
 *
 * Counters persist to the `rate_limit_buckets` SQLite table so they survive
 * server restarts. Buckets are registered at module load and accessed by
 * `(provider, dimension, label)` triples.
 */

import db from '../db/index.js';

export type Period = 'minute' | 'day' | 'month';

export interface BucketDef {
  provider: string;   // 'anthropic', 'gemini', etc.
  dimension: string;  // 'rpm', 'input_tokens', 'search-grounding', ...
  label: string;      // 'global' for shared, or a per-key label
  limit: number;
  period: Period;
}

interface BucketState {
  def: BucketDef;
  count: number;
  resetAt: number;    // ms epoch when count resets to 0
}

// ── Persistence ────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    bucket_key TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    dimension TEXT NOT NULL,
    label TEXT NOT NULL,
    period TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    reset_at INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
  );
`);

const persistStmt = db.prepare(`
  INSERT INTO rate_limit_buckets (bucket_key, provider, dimension, label, period, count, reset_at, updated_at)
  VALUES (@bucket_key, @provider, @dimension, @label, @period, @count, @reset_at, datetime('now', '+5 hours', '+30 minutes'))
  ON CONFLICT(bucket_key) DO UPDATE SET
    count = excluded.count,
    reset_at = excluded.reset_at,
    updated_at = excluded.updated_at
`);

const loadStmt = db.prepare(`SELECT bucket_key, count, reset_at FROM rate_limit_buckets`);

// ── Limiter ────────────────────────────────────────────────────────────────

const buckets = new Map<string, BucketState>();

function bucketKey(provider: string, dimension: string, label: string): string {
  return `${provider}|${dimension}|${label}`;
}

function nextReset(period: Period, from: Date = new Date()): number {
  const d = new Date(from);
  if (period === 'minute') {
    d.setSeconds(60, 0);
    return d.getTime();
  }
  if (period === 'day') {
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }
  // month — first of next month at 00:00 IST. We approximate with UTC since
  // bucket rollover precision at second-level isn't meaningful for monthly.
  d.setMonth(d.getMonth() + 1, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function rolloverIfNeeded(state: BucketState): boolean {
  if (Date.now() >= state.resetAt) {
    state.count = 0;
    state.resetAt = nextReset(state.def.period);
    return true;
  }
  return false;
}

function persist(state: BucketState): void {
  try {
    persistStmt.run({
      bucket_key: bucketKey(state.def.provider, state.def.dimension, state.def.label),
      provider: state.def.provider,
      dimension: state.def.dimension,
      label: state.def.label,
      period: state.def.period,
      count: state.count,
      reset_at: state.resetAt,
    });
  } catch (e) {
    console.warn('[rateLimiter] persist failed:', (e as Error).message);
  }
}

/** Register a bucket. Idempotent — re-registering with the same key is a no-op. */
export function registerBucket(def: BucketDef): void {
  const key = bucketKey(def.provider, def.dimension, def.label);
  if (buckets.has(key)) return;
  buckets.set(key, { def, count: 0, resetAt: nextReset(def.period) });

  // Hydrate from DB if a row exists.
  try {
    const rows = loadStmt.all() as Array<{ bucket_key: string; count: number; reset_at: number }>;
    const row = rows.find(r => r.bucket_key === key);
    if (row) {
      const state = buckets.get(key)!;
      state.count = row.count;
      state.resetAt = row.reset_at;
      rolloverIfNeeded(state);
    }
    persist(buckets.get(key)!);
  } catch (e) {
    console.warn('[rateLimiter] hydrate failed for', key, (e as Error).message);
  }
}

/**
 * Try to acquire `amount` units against the bucket. Returns true if allowed
 * (and increments the counter), false if the bucket is exhausted.
 */
export function tryAcquire(provider: string, dimension: string, label: string, amount: number = 1): boolean {
  const state = buckets.get(bucketKey(provider, dimension, label));
  if (!state) return true; // Unregistered buckets are unlimited (fail-open).
  rolloverIfNeeded(state);
  if (state.count + amount > state.def.limit) return false;
  state.count += amount;
  persist(state);
  return true;
}

/** Snapshot for the admin dashboard. */
export function getRateLimiterStatus(): Array<BucketState & { remaining: number; resetInSeconds: number }> {
  const out: Array<BucketState & { remaining: number; resetInSeconds: number }> = [];
  for (const state of buckets.values()) {
    rolloverIfNeeded(state);
    out.push({
      ...state,
      remaining: Math.max(0, state.def.limit - state.count),
      resetInSeconds: Math.max(0, Math.ceil((state.resetAt - Date.now()) / 1000)),
    });
  }
  return out;
}
