/**
 * In-memory search quota tracker for the 3-tier model cascade.
 *
 * Tier 1: Gemini 3.1 Flash-Lite Preview — 5,000 free searches/month (better quality)
 * Tier 2: Gemini 2.5 Flash-Lite        — 500 free searches/day (separate pool, cheapest tokens)
 * Tier 3: Grok 4.1 Fast                — paid search ($5/1K calls)
 *
 * Counters reset automatically: Tier 1 monthly, Tier 2 daily.
 * Resets on server restart (acceptable — limits also reset server-side at Google).
 */

export type ModelTier = 'gemini-3' | 'gemini-2.5' | 'grok';

// Conservative buffers to avoid hitting the hard limit
const TIER1_LIMIT = 4800;  // actual: 5,000/month (Gemini 3)
const TIER2_LIMIT = 480;   // actual: 500/day (Gemini 2.5)

let tier1Count = 0;   // Gemini 3 — monthly
let tier1ResetMonth = new Date().getMonth();

let tier2Count = 0;   // Gemini 2.5 — daily
let tier2ResetDate = new Date().toDateString();

function checkResets(): void {
  const now = new Date();
  // Monthly reset for Tier 1 (Gemini 3)
  if (now.getMonth() !== tier1ResetMonth) {
    tier1Count = 0;
    tier1ResetMonth = now.getMonth();
  }
  // Daily reset for Tier 2 (Gemini 2.5)
  if (now.toDateString() !== tier2ResetDate) {
    tier2Count = 0;
    tier2ResetDate = now.toDateString();
  }
}

/**
 * Pick the best available tier for the next chat request.
 * Tier 1 (Gemini 3) first for better quality, then Tier 2 (2.5) for cheapest tokens.
 */
export function getTier(): ModelTier {
  checkResets();

  if (tier1Count < TIER1_LIMIT) {
    tier1Count++;
    return 'gemini-3';
  }
  if (tier2Count < TIER2_LIMIT) {
    tier2Count++;
    return 'gemini-2.5';
  }
  return 'grok';
}

/**
 * Roll back the counter when Gemini fails (so failed requests don't eat quota).
 */
export function rollbackTier(tier: ModelTier): void {
  if (tier === 'gemini-3' && tier1Count > 0) tier1Count--;
  if (tier === 'gemini-2.5' && tier2Count > 0) tier2Count--;
}

/**
 * Current quota status — exposed to the admin API cost dashboard.
 */
export function getQuotaStatus() {
  checkResets();
  return {
    tier1: { model: 'Gemini 3.1 Flash-Lite Preview', used: tier1Count, limit: TIER1_LIMIT, remaining: TIER1_LIMIT - tier1Count, period: 'monthly' },
    tier2: { model: 'Gemini 2.5 Flash-Lite', used: tier2Count, limit: TIER2_LIMIT, remaining: TIER2_LIMIT - tier2Count, period: 'daily' },
  };
}
