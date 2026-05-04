/**
 * Search quota tracker for the two-model Gemini cascade with dual API
 * key rotation. The line-up tracked by this module is:
 *
 *   Tier 'gemini-2.5' — gemini-2.5-flash-lite        (primary)
 *                       1,500 free searches/day per key
 *   Tier 'gemini-3'   — gemini-3.1-flash-lite-preview (fallback)
 *                       5,000 free searches/month per key
 *
 * Tier names ('gemini-3' / 'gemini-2.5') refer to the model FAMILY
 * the search quota is shared under at Google's end, not the order in
 * which we route — selectTier() prefers the monthly Gemini 3.x bucket
 * first because it's the cheaper free quota to burn.
 *
 * Each API key gets its own set of counters.
 * Counters only increment on SUCCESS (not on attempt).
 *
 * Counters are PERSISTED to the `search_quota` SQLite table on every
 * increment / reset so state survives server restarts. The monthly reset
 * uses `year*12 + month` (year-safe) rather than just `getMonth()`.
 *
 * Admin-adjustable runtime state (in-memory, not persisted):
 *   - t1Limit / t2Limit: can be LOWERED below the free-tier defaults, never raised above.
 *   - activeKeyIndex:    which API key is preferred as the primary for chat routing.
 */

import { GEMINI_API_KEYS } from './gemini.js';
import db from '../db/index.js';

export type ModelTier = 'gemini-3' | 'gemini-2.5';

// Free tier search grounding limits (per API key) — immutable ceiling.
const DEFAULT_T1_LIMIT = 5000;   // 5,000/month per key (Gemini 3 family — shared across 3.x models)
const DEFAULT_T2_LIMIT = 1500;   // 1,500/day per key (Gemini 2.5 family — shared across 2.5 models)

// ── Runtime config persistence ───────────────────────────────────────────
// `t1Limit`, `t2Limit`, and `activeKeyIndex` are admin-adjustable at runtime.
// Without persistence they snap back to defaults on every PM2 restart, so
// any limit-lowering or key-switch from the admin UI silently undoes itself
// on the next deploy. Backed by a tiny key-value table.
db.exec(`
  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
  );
`);

const cfgGetStmt = db.prepare('SELECT value FROM app_config WHERE key = ?');
const cfgSetStmt = db.prepare(`
  INSERT INTO app_config (key, value, updated_at)
  VALUES (?, ?, datetime('now', '+5 hours', '+30 minutes'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

function readConfigInt(key: string): number | null {
  try {
    const row = cfgGetStmt.get(key) as { value: string } | undefined;
    if (!row) return null;
    const n = parseInt(row.value, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeConfigInt(key: string, value: number): void {
  try {
    cfgSetStmt.run(key, String(value));
  } catch (e) {
    console.warn(`[searchQuota] persist app_config[${key}] failed:`, (e as Error).message);
  }
}

// Mutable runtime limits (admin can lower these). Hydrated from app_config
// on module load; clamped to the free-tier ceiling.
let t1Limit = (() => {
  const stored = readConfigInt('gemini_t1_limit');
  if (stored === null) return DEFAULT_T1_LIMIT;
  return Math.max(0, Math.min(DEFAULT_T1_LIMIT, stored));
})();
let t2Limit = (() => {
  const stored = readConfigInt('gemini_t2_limit');
  if (stored === null) return DEFAULT_T2_LIMIT;
  return Math.max(0, Math.min(DEFAULT_T2_LIMIT, stored));
})();

// Which API key is preferred as primary. Iteration in selectTier() still rotates
// through all keys, but starts here. Hydrated from app_config; bounds-validated
// once `keys[]` is populated below.
let activeKeyIndex = (() => {
  const stored = readConfigInt('gemini_active_key_index');
  return stored === null ? 0 : stored;
})();

interface KeyQuota {
  label: string;
  t1Count: number;     // Gemini 3.x monthly
  t1ResetYm: number;   // year*12 + month — year-safe monthly rollover
  t2Count: number;     // Gemini 2.5 daily
  t2ResetDate: string; // new Date().toDateString()
}

function currentYm(now: Date = new Date()): number {
  return now.getFullYear() * 12 + now.getMonth();
}

function makeDefault(label: string): KeyQuota {
  return { label, t1Count: 0, t1ResetYm: currentYm(), t2Count: 0, t2ResetDate: new Date().toDateString() };
}

const KEY_LABELS = ['Key 1 (Primary)', 'Key 2 (Secondary)'];
const keys: KeyQuota[] = KEY_LABELS.map(makeDefault);

// activeKeyIndex was hydrated from app_config above; clamp it now that we
// know the actual key count, so a stale config row from a future schema
// (e.g. 3-key setup) can't poison the rotation pointer.
if (!Number.isInteger(activeKeyIndex) || activeKeyIndex < 0 || activeKeyIndex >= keys.length) {
  activeKeyIndex = 0;
}

// ── Persistence ────────────────────────────────────────────────────────────
// Counters must survive server restarts. Each key's row is upserted on every
// increment and on every reset-rollover.
const persistStmt = db.prepare(`
  INSERT INTO search_quota (key_index, label, t1_count, t1_reset_ym, t2_count, t2_reset_date, updated_at)
  VALUES (@key_index, @label, @t1_count, @t1_reset_ym, @t2_count, @t2_reset_date, datetime('now', '+5 hours', '+30 minutes'))
  ON CONFLICT(key_index) DO UPDATE SET
    label = excluded.label,
    t1_count = excluded.t1_count,
    t1_reset_ym = excluded.t1_reset_ym,
    t2_count = excluded.t2_count,
    t2_reset_date = excluded.t2_reset_date,
    updated_at = excluded.updated_at
`);

function persist(ki: number): void {
  const k = keys[ki];
  try {
    persistStmt.run({
      key_index: ki,
      label: k.label,
      t1_count: k.t1Count,
      t1_reset_ym: k.t1ResetYm,
      t2_count: k.t2Count,
      t2_reset_date: k.t2ResetDate,
    });
  } catch (e) {
    console.warn('[searchQuota] persist failed:', (e as Error).message);
  }
}

// Load from DB on module init; any missing rows are inserted with current defaults.
(function hydrate() {
  try {
    const rows = db.prepare('SELECT key_index, label, t1_count, t1_reset_ym, t2_count, t2_reset_date FROM search_quota').all() as Array<{
      key_index: number; label: string; t1_count: number; t1_reset_ym: number; t2_count: number; t2_reset_date: string;
    }>;
    for (const r of rows) {
      if (r.key_index < 0 || r.key_index >= keys.length) continue;
      keys[r.key_index] = {
        label: KEY_LABELS[r.key_index] ?? r.label,
        t1Count: r.t1_count,
        t1ResetYm: r.t1_reset_ym,
        t2Count: r.t2_count,
        t2ResetDate: r.t2_reset_date,
      };
    }
    // Apply any expired resets and persist any missing rows.
    for (let i = 0; i < keys.length; i++) {
      checkResets(keys[i]);
      persist(i);
    }
  } catch (e) {
    console.warn('[searchQuota] hydrate failed, starting fresh:', (e as Error).message);
  }
})();

function checkResets(k: KeyQuota): boolean {
  const now = new Date();
  const ym = currentYm(now);
  const today = now.toDateString();
  let changed = false;
  if (ym !== k.t1ResetYm) { k.t1Count = 0; k.t1ResetYm = ym; changed = true; }
  if (today !== k.t2ResetDate) { k.t2Count = 0; k.t2ResetDate = today; changed = true; }
  return changed;
}

export interface TierSelection {
  tier: ModelTier;
  keyIndex: number;     // 0 = key 1, 1 = key 2
  keyLabel: string;
}

/**
 * Current active key index — used by chat routes to pick the primary Gemini key.
 */
export function getActiveKeyIndex(): number {
  return activeKeyIndex;
}

/**
 * Pick the best available tier + API key for the next chat request.
 * Does NOT increment counters — call `confirmUsed()` after successful API call.
 */
export function selectTier(searchEnabled: boolean): TierSelection {
  // Non-search messages always use Tier 1 active key — no quota consumed
  if (!searchEnabled) {
    const k = keys[activeKeyIndex];
    return { tier: 'gemini-3', keyIndex: activeKeyIndex, keyLabel: k.label };
  }

  // Try each key in rotation order starting at activeKeyIndex:
  // Tier 1 (Gemini 3.x monthly), then Tier 2 (Gemini 2.5 daily).
  for (let i = 0; i < keys.length; i++) {
    const ki = (activeKeyIndex + i) % keys.length;
    const k = keys[ki];
    if (checkResets(k)) persist(ki);

    if (k.t1Count < t1Limit) {
      return { tier: 'gemini-3', keyIndex: ki, keyLabel: k.label };
    }
    if (k.t2Count < t2Limit) {
      return { tier: 'gemini-2.5', keyIndex: ki, keyLabel: k.label };
    }
  }

  // All free quotas exhausted — best-effort: use active key with Gemini 3 (over-quota will fail gracefully)
  console.warn('[searchQuota] All free search quotas exhausted — routing to active key over-quota');
  return { tier: 'gemini-3', keyIndex: activeKeyIndex, keyLabel: keys[activeKeyIndex]?.label ?? 'Key 1 (Primary)' };
}

/**
 * Call AFTER a successful Gemini API call to increment the counter.
 * Only counts search-enabled requests.
 */
export function confirmUsed(tier: ModelTier, keyIndex: number, searchEnabled: boolean): void {
  if (!searchEnabled || keyIndex < 0 || keyIndex >= keys.length) return;

  const k = keys[keyIndex];
  checkResets(k);

  if (tier === 'gemini-3') k.t1Count++;
  else if (tier === 'gemini-2.5') k.t2Count++;
  else return;
  persist(keyIndex);
}

/**
 * Current quota status — exposed to the admin API cost dashboard.
 */
export function getQuotaStatus() {
  for (let i = 0; i < keys.length; i++) {
    if (checkResets(keys[i])) persist(i);
  }
  return {
    activeKeyIndex,
    t1Limit,
    t2Limit,
    defaults: { t1: DEFAULT_T1_LIMIT, t2: DEFAULT_T2_LIMIT },
    keys: keys.map((k, i) => ({
      index: i,
      label: k.label,
      active: i === activeKeyIndex,
      tier1: { model: 'Gemini 3.1 Flash-Lite Preview', used: k.t1Count, limit: t1Limit, remaining: Math.max(0, t1Limit - k.t1Count), period: 'monthly' },
      tier2: { model: 'Gemini 2.5 Flash-Lite', used: k.t2Count, limit: t2Limit, remaining: Math.max(0, t2Limit - k.t2Count), period: 'daily' },
    })),
    totalFreeSearchCapacity: {
      monthly: t1Limit * keys.length,
      daily: t2Limit * keys.length,
      description: `${keys.length} API keys × ${t1Limit}/month + ${t2Limit}/day each`,
    },
  };
}

/**
 * Admin-facing config (mutable limits + active key + per-key availability).
 * `hasKey` reflects whether the env var for that slot is actually populated —
 * imported lazily here to avoid a circular dep with gemini.ts at module load.
 */
export function getGeminiConfig() {
  return {
    activeKeyIndex,
    t1Limit,
    t2Limit,
    defaults: { t1: DEFAULT_T1_LIMIT, t2: DEFAULT_T2_LIMIT },
    keys: keys.map((k, i) => ({
      index: i,
      label: k.label,
      hasKey: !!GEMINI_API_KEYS[i] && GEMINI_API_KEYS[i].length > 0,
    })),
  };
}

/**
 * Lower (or restore to default) the Gemini free-tier limits.
 * Values are CLAMPED to `[0, DEFAULT_*_LIMIT]` — admin cannot raise above free tier.
 */
export function setGeminiLimits(input: { t1Limit?: number; t2Limit?: number }): { t1Limit: number; t2Limit: number } {
  if (typeof input.t1Limit === 'number' && Number.isFinite(input.t1Limit)) {
    t1Limit = Math.max(0, Math.min(DEFAULT_T1_LIMIT, Math.floor(input.t1Limit)));
    writeConfigInt('gemini_t1_limit', t1Limit);
  }
  if (typeof input.t2Limit === 'number' && Number.isFinite(input.t2Limit)) {
    t2Limit = Math.max(0, Math.min(DEFAULT_T2_LIMIT, Math.floor(input.t2Limit)));
    writeConfigInt('gemini_t2_limit', t2Limit);
  }
  return { t1Limit, t2Limit };
}

/**
 * Set which key is the active/primary key. Validates bounds.
 * Returns true on success, false on invalid index.
 */
export function setActiveKey(index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= keys.length) return false;
  activeKeyIndex = index;
  writeConfigInt('gemini_active_key_index', activeKeyIndex);
  return true;
}

export function getKeyCount(): number {
  return keys.length;
}
