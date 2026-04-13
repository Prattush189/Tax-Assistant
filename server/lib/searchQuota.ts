/**
 * Search quota tracker for the 3-tier model cascade with dual API key rotation.
 *
 * API Key 1 (GEMINI_API_KEY):
 *   Tier 1: Gemini 3.1 Flash-Lite Preview — 5,000 free searches/month
 *   Tier 2: Gemini 2.5 Flash-Lite          — 500 free searches/day
 *
 * API Key 2 (GEMINI_API_KEY_2) — when Key 1 exhausted:
 *   Tier 1b: Gemini 3.1 Flash-Lite Preview — 5,000 free searches/month (separate account)
 *   Tier 2b: Gemini 2.5 Flash-Lite          — 500 free searches/day (separate account)
 *
 * Tier 3: Grok 4.1 Fast — paid search ($5/1K calls, cheapest paid)
 *
 * Counters only increment on SUCCESS (not on attempt).
 */

export type ModelTier = 'gemini-3' | 'gemini-2.5' | 'grok';

// Conservative buffers
const T1_LIMIT = 5000;   // 5,000/month per key (Gemini 3 family)
const T2_LIMIT = 500;    // 500/day per key (Gemini 2.5 family)

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
 * Pick the best available tier + API key for the next chat request.
 * Does NOT increment counters — call `confirmUsed()` after successful API call.
 */
export function selectTier(searchEnabled: boolean): TierSelection {
  // Non-search messages always use Tier 1 key 1 — no quota consumed
  if (!searchEnabled) {
    return { tier: 'gemini-3', keyIndex: 0, keyLabel: keys[0].label };
  }

  // Try each key's Tier 1 (Gemini 3.1 monthly), then Tier 2 (Gemini 2.5 daily)
  for (let ki = 0; ki < keys.length; ki++) {
    const k = keys[ki];
    checkResets(k);

    if (k.t1Count < T1_LIMIT) {
      return { tier: 'gemini-3', keyIndex: ki, keyLabel: k.label };
    }
    if (k.t2Count < T2_LIMIT) {
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
    keys: keys.map((k, i) => ({
      index: i,
      label: k.label,
      active: i === 0 ? (k.t1Count < T1_LIMIT || k.t2Count < T2_LIMIT) : true,
      tier1: { model: 'Gemini 3.1 Flash-Lite Preview', used: k.t1Count, limit: T1_LIMIT, remaining: T1_LIMIT - k.t1Count, period: 'monthly' },
      tier2: { model: 'Gemini 2.5 Flash-Lite', used: k.t2Count, limit: T2_LIMIT, remaining: T2_LIMIT - k.t2Count, period: 'daily' },
    })),
    totalFreeSearchCapacity: {
      monthly: T1_LIMIT * keys.length,
      daily: T2_LIMIT * keys.length,
      description: `${keys.length} API keys × ${T1_LIMIT}/month + ${T2_LIMIT}/day each`,
    },
  };
}
