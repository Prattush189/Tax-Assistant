/**
 * Audit: AI models ↔ weights ↔ token billing.
 *
 * Read-only. Cross-checks three things that must stay in lockstep or users
 * get mis-billed:
 *   1. Every distinct `model` string in api_usage resolves to an explicit
 *      MODEL_WEIGHTS entry (not the 1×/4× FALLBACK — which silently
 *      UNDER-weights an unrecognised model against the quota).
 *   2. The stored weighted_tokens matches a fresh computeWeightedTokens()
 *      for that row's model + raw tokens (catches drift / a missed backfill).
 *   3. The stored cost matches costForModel() within a small tolerance.
 *
 * Also prints the per-model weight ↔ list-price ratio so you can eyeball
 * that wIn/wOut still track pricing (anchor = 2.5-flash-lite input $0.10 = 1×).
 *
 *   DB_PATH=/var/lib/tax-assistant/tax-assistant.db \
 *     npx tsx server/scripts/audit-model-billing.ts
 */
import db from '../db/index.js';
import { getWeightFor, computeWeightedTokens } from '../lib/modelWeights.js';
import { costForModel } from '../lib/gemini.js';

const FALLBACK = { wIn: 1.0, wOut: 4.0 }; // must match modelWeights FALLBACK_WEIGHT

const rows = db.prepare(`
  SELECT model,
         COUNT(*)                AS n,
         COALESCE(SUM(input_tokens),0)    AS inTok,
         COALESCE(SUM(output_tokens),0)   AS outTok,
         COALESCE(SUM(weighted_tokens),0) AS wt,
         COALESCE(SUM(cost),0)            AS cost
    FROM api_usage
   GROUP BY model
   ORDER BY wt DESC
`).all() as Array<{ model: string | null; n: number; inTok: number; outTok: number; wt: number; cost: number }>;

console.log('=== Models seen in api_usage ===');
console.log('model'.padEnd(34), 'rows'.padStart(6), 'wIn/wOut'.padStart(10), 'weight-source'.padStart(14));
const unweighted: string[] = [];
for (const r of rows) {
  const model = r.model ?? '(null)';
  const w = getWeightFor(r.model);
  const isFallback = w.wIn === FALLBACK.wIn && w.wOut === FALLBACK.wOut && !['gemini-2.5-flash-lite'].includes(model);
  // A real-token model on the fallback weight = a coverage gap.
  const hasRealTokens = r.inTok > 0 || r.outTok > 0;
  const flag = isFallback && hasRealTokens ? '  ⚠ FALLBACK' : '';
  if (isFallback && hasRealTokens) unweighted.push(model);
  console.log(model.padEnd(34), String(r.n).padStart(6), `${w.wIn}/${w.wOut}`.padStart(10), (isFallback ? 'fallback' : 'explicit').padStart(14), flag);
}

console.log('\n=== Row-level drift (weighted_tokens & cost) ===');
const detail = db.prepare(`
  SELECT id, model, input_tokens AS i, output_tokens AS o, weighted_tokens AS wt, cost
    FROM api_usage
   WHERE (input_tokens > 0 OR output_tokens > 0)
`).all() as Array<{ id: number; model: string | null; i: number; o: number; wt: number; cost: number }>;
let wtDrift = 0, costDrift = 0;
for (const r of detail) {
  const expectWt = computeWeightedTokens(r.model, r.i, r.o);
  if (r.wt > 0 && r.wt !== expectWt) wtDrift++;
  if (r.model) {
    const expectCost = costForModel(r.model, r.i, r.o);
    if (Math.abs(expectCost - r.cost) > Math.max(1e-6, expectCost * 0.05)) costDrift++;
  }
}
console.log(`Rows with token data           : ${detail.length}`);
console.log(`weighted_tokens mismatches     : ${wtDrift}  (stored ≠ recompute — stale backfill / weight change)`);
console.log(`cost mismatches (>5%)          : ${costDrift}  (stored ≠ costForModel — pricing drift; Flex rows expected if logged Standard)`);

console.log('\n=== Coverage verdict ===');
if (unweighted.length === 0) {
  console.log('OK — every real-token model resolves to an explicit weight.');
} else {
  console.log(`⚠ ${unweighted.length} real-token model(s) on the FALLBACK weight (under-billed): ${[...new Set(unweighted)].join(', ')}`);
  console.log('  → add them to MODEL_WEIGHTS + costForModel.');
}
