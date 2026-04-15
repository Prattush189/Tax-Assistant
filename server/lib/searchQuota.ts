/**
 * Search quota tracker for dual-mode Gemini cascade with dual API key rotation.
 *
 * Gemini 3.x family: 5,000 free searches/month (shared across all 3.x models)
 *   - gemini-3-flash-preview       (Think primary)
 *   - gemini-3.1-flash-lite-preview (Fast fallback)
 *
 * Gemini 2.5 family: 1,500 free searches/day (shared across all 2.5 models)
 *   - gemini-2.5-flash-lite  (Fast primary)
 *   - gemini-2.5-flash       (Think fallback)
 *
 * Each API key gets its own set of counters.
 * Counters only increment on SUCCESS (not on attempt).
 *
 * Admin-adjustable state (in-memory, resets on server restart):
 *   - t1Limit / t2Limit: can be LOWERED below the free-tier defaults, never raised above.
 *   - activeKeyIndex:    which API key is preferred as the primary for chat routing.
 */

import { GEMINI_API_KEYS } from './grok.js';

export type ModelTier = 'gemini-3' | 'gemini-2.5' | 'grok';

// Free tier search grounding limits (per API key) — immutable ceiling.
const DEFAULT_T1_LIMIT = 5000;   // 5,000/month per key (Gemini 3 family — shared across 3.x models)
const DEFAULT_T2_LIMIT = 1500;   // 1,500/day per key (Gemini 2.5 family — shared across 2.5 models)

// Mutable runtime limits (admin can lower these).
let t1Limit = DEFAULT_T1_LIMIT;
let t2Limit = DEFAULT_T2_LIMIT;

// Which API key is preferred as primary. Iteration in selectTier() still rotates
// through all keys, but starts here.
let activeKeyIndex = 0;

interface KeyQuota {
  label: string;
  t1Count: number;     // Gemini 3.1 monthly
  t1ResetMonth: number;
  t2Count: number;     // Gemini 2.5 daily
  t2ResetDate: string;
}

const keys: KeyQuota[] = [
  { label: 'Key 1 (Primary)', t1Count: 0, t1ResetMonth: new Date().getMonth(), t2Count: 0, t2ResetDate: new Date().toDateString() },
  { label: 'Key 2 (Secondary)', t1Count: 0, t1ResetMonth: new Date().getMonth(), t2Count: 0, t2ResetDate: new Date().toDateString() },
];

function checkResets(k: KeyQuota): void {
  const now = new Date();
  if (now.getMonth() !== k.t1ResetMonth) { k.t1Count = 0; k.t1ResetMonth = now.getMonth(); }
  if (now.toDateString() !== k.t2ResetDate) { k.t2Count = 0; k.t2ResetDate = now.toDateString(); }
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
    checkResets(k);

    if (k.t1Count < t1Limit) {
      return { tier: 'gemini-3', keyIndex: ki, keyLabel: k.label };
    }
    if (k.t2Count < t2Limit) {
      return { tier: 'gemini-2.5', keyIndex: ki, keyLabel: k.label };
    }
  }

  // All free quotas exhausted — fall to paid Grok
  return { tier: 'grok', keyIndex: -1, keyLabel: 'N/A (Grok)' };
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
}

/**
 * Current quota status — exposed to the admin API cost dashboard.
 */
export function getQuotaStatus() {
  keys.forEach(checkResets);
  return {
    activeKeyIndex,
    t1Limit,
    t2Limit,
    defaults: { t1: DEFAULT_T1_LIMIT, t2: DEFAULT_T2_LIMIT },
    keys: keys.map((k, i) => ({
      index: i,
      label: k.label,
      active: i === activeKeyIndex,
      tier1: { model: 'Gemini 3.x family (3 Flash + 3.1 Flash-Lite)', used: k.t1Count, limit: t1Limit, remaining: Math.max(0, t1Limit - k.t1Count), period: 'monthly' },
      tier2: { model: 'Gemini 2.5 family (Flash + Flash-Lite)', used: k.t2Count, limit: t2Limit, remaining: Math.max(0, t2Limit - k.t2Count), period: 'daily' },
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
 * imported lazily here to avoid a circular dep with grok.ts at module load.
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
  }
  if (typeof input.t2Limit === 'number' && Number.isFinite(input.t2Limit)) {
    t2Limit = Math.max(0, Math.min(DEFAULT_T2_LIMIT, Math.floor(input.t2Limit)));
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
  return true;
}

export function getKeyCount(): number {
  return keys.length;
}
