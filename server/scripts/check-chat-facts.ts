/**
 * Drift check: verifies that every numeric fact pinned in
 * `server/data/taxFacts.ts` (the values the chat model is told are
 * authoritative) matches the corresponding value in the calculator engines
 * (`src/data/taxRules/*.ts` and `src/lib/tdsEngine.ts`).
 *
 * Run it:   npm run check:chat-facts
 *
 * Exits 0 on match, 1 on drift (prints the specific field that diverged).
 * Hook it into CI to make "chat prompt lies about a tax rate" structurally
 * impossible — a mismatch fails the build.
 *
 * Note: only covers facts that have an engine counterpart. Hand-maintained
 * facts (angel tax repeal date, NPS 14%, VDA 30%, etc.) are not checked
 * here because the engines don't store them yet; they're asserted in the
 * chat-eval smoke test instead.
 */

import { FY_2025_26 } from '../../src/data/taxRules/fy2025-26.js';
import { FY_2024_25 } from '../../src/data/taxRules/fy2024-25.js';
import {
  NEW_REGIME_FY_2025_26,
  NEW_REGIME_FY_2024_25,
  OLD_REGIME,
  SURCHARGE,
  CAPITAL_GAINS_POST_23_JUL_2024,
  GST,
} from '../data/taxFacts.js';

interface Mismatch { field: string; fact: unknown; engine: unknown; }

const mismatches: Mismatch[] = [];

function check(field: string, fact: unknown, engine: unknown) {
  if (JSON.stringify(fact) !== JSON.stringify(engine)) {
    mismatches.push({ field, fact, engine });
  }
}

// ── New regime FY 2025-26 ────────────────────────────────────────────────
check('newRegime.fy2025-26.standardDeduction',
  NEW_REGIME_FY_2025_26.standardDeduction,
  FY_2025_26.newRegime.standardDeduction);
check('newRegime.fy2025-26.rebateMax',
  NEW_REGIME_FY_2025_26.rebateMax,
  FY_2025_26.newRegime.rebate87A.maxRebate);
check('newRegime.fy2025-26.rebateThreshold',
  NEW_REGIME_FY_2025_26.rebateThreshold,
  FY_2025_26.newRegime.rebate87A.incomeThreshold);
check('newRegime.fy2025-26.slabs',
  NEW_REGIME_FY_2025_26.slabs.map(s => ({
    upTo: s.upTo === Infinity ? null : s.upTo,
    rate: s.rate,
  })),
  FY_2025_26.newRegime.slabs.map(s => ({
    upTo: s.upTo === Infinity ? null : s.upTo,
    rate: s.rate,
  })));

// ── New regime FY 2024-25 ────────────────────────────────────────────────
check('newRegime.fy2024-25.rebateMax',
  NEW_REGIME_FY_2024_25.rebateMax,
  FY_2024_25.newRegime.rebate87A.maxRebate);
check('newRegime.fy2024-25.rebateThreshold',
  NEW_REGIME_FY_2024_25.rebateThreshold,
  FY_2024_25.newRegime.rebate87A.incomeThreshold);

// ── Old regime (FY 2025-26 engine row; old regime hasn't changed in years)
check('oldRegime.standardDeduction',
  OLD_REGIME.standardDeduction,
  FY_2025_26.oldRegime.standardDeduction);
check('oldRegime.rebateMax',
  OLD_REGIME.rebateMax,
  FY_2025_26.oldRegime.rebate87A.maxRebate);
check('oldRegime.rebateThreshold',
  OLD_REGIME.rebateThreshold,
  FY_2025_26.oldRegime.rebate87A.incomeThreshold);

// ── Surcharge caps (highest-band rate in each regime) ────────────────────
const engineNewSurchargeMax = Math.max(...FY_2025_26.surcharge.new.map(b => b.rate));
const engineOldSurchargeMax = Math.max(...FY_2025_26.surcharge.old.map(b => b.rate));
check('surcharge.newRegimeMaxRate', SURCHARGE.newRegimeMaxRate, engineNewSurchargeMax);
check('surcharge.oldRegimeMaxRate', SURCHARGE.oldRegimeMaxRate, engineOldSurchargeMax);
check('surcharge.healthAndEducationCess', SURCHARGE.healthAndEducationCess, FY_2025_26.cess);

// ── Capital gains ────────────────────────────────────────────────────────
check('capitalGains.equity.ltcgRate',
  CAPITAL_GAINS_POST_23_JUL_2024.equity.ltcgRate,
  FY_2025_26.capitalGains.equity.ltcg.rate);
check('capitalGains.equity.ltcgExemption',
  CAPITAL_GAINS_POST_23_JUL_2024.equity.ltcgExemptionPerYear,
  FY_2025_26.capitalGains.equity.ltcg.exemption);
check('capitalGains.equity.ltcgHoldingMonths',
  CAPITAL_GAINS_POST_23_JUL_2024.equity.ltcgHoldingMonths,
  FY_2025_26.capitalGains.equity.ltcg.holdingMonths);
check('capitalGains.equity.stcgRate',
  CAPITAL_GAINS_POST_23_JUL_2024.equity.stcgRate,
  FY_2025_26.capitalGains.equity.stcg.rate);
check('capitalGains.realEstate.ltcgRate',
  CAPITAL_GAINS_POST_23_JUL_2024.realEstate.ltcgRateWithoutIndexation,
  FY_2025_26.capitalGains.realEstate.ltcg.rate);
check('capitalGains.other.ltcgRate',
  CAPITAL_GAINS_POST_23_JUL_2024.other.ltcgRateWithoutIndexation,
  FY_2025_26.capitalGains.other.ltcg.rate);

// ── GST ──────────────────────────────────────────────────────────────────
check('gst.rates',
  [...GST.rates],
  [...FY_2025_26.gst.ratesAvailable]);
check('gst.specialRates',
  [...GST.specialRates],
  [...FY_2025_26.gst.specialRates]);

// ── Verdict ──────────────────────────────────────────────────────────────
if (mismatches.length === 0) {
  console.log(`[check-chat-facts] ✓ All ${17} facts match their engine counterparts.`);
  process.exit(0);
}

console.error(`[check-chat-facts] ✗ ${mismatches.length} mismatch(es) between server/data/taxFacts.ts and the calculator engines:\n`);
for (const m of mismatches) {
  console.error(`  • ${m.field}`);
  console.error(`      taxFacts.ts:     ${JSON.stringify(m.fact)}`);
  console.error(`      engine value:    ${JSON.stringify(m.engine)}`);
}
console.error(`\nFix: update whichever file is wrong, then re-run \`npm run check:chat-facts\`.`);
process.exit(1);
