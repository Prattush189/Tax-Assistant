/**
 * Smoke tests for the CMA computation libs:
 *   - projectionEngine (growth + WC + term-loan flow)
 *   - mpbf (Tandon I, Tandon II, Nayak)
 *   - ratios (DSCR, current, quick, TOL/TNW)
 *   - stressTest (sales miss flows through ratios)
 *
 * Run with:
 *   npx tsx scripts/smoke-test-cma.ts
 */

import { runProjection } from '../src/components/cma/lib/projectionEngine';
import { computeMpbf } from '../src/components/cma/lib/mpbf';
import { computeRatios, gradeRatio } from '../src/components/cma/lib/ratios';
import { applyStressTest } from '../src/components/cma/lib/stressTest';
import { suggestCanonicalKey } from '../src/components/cma/lib/canonicalAccounts';
import type { CmaDraft } from '../src/components/cma/lib/uiModel';
import type { AccountSeries } from '../src/components/cma/lib/projectionEngine';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function approxEq(actual: number, expected: number, label: string, tol = 1) {
  if (Math.abs(actual - expected) <= tol) {
    pass++;
  } else {
    fail++;
    failures.push(`${label}: expected ~${expected}, got ${actual}`);
  }
}

function expect<T>(label: string, actual: T, expected: T) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++;
  } else {
    fail++;
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function expectTrue(label: string, cond: boolean) {
  if (cond) pass++;
  else { fail++; failures.push(label); }
}

// ─── suggestCanonicalKey ─────────────────────────────────────
expect('suggest sundry debtors', suggestCanonicalKey('Sundry Debtors'), 'bs_receivables');
expect('suggest sales', suggestCanonicalKey('Sales / Turnover'), 'pl_revenue');
expect('suggest cash credit', suggestCanonicalKey('Cash Credit Account'), 'bs_bank_borrowing_short');
expect('suggest interest paid', suggestCanonicalKey('Interest Paid on Loan'), 'pl_finance_cost');
expect('suggest paid up capital', suggestCanonicalKey('Paid Up Capital'), 'bs_paid_up_capital');
expect('suggest gross block', suggestCanonicalKey('Gross Block of Fixed Assets'), 'bs_gross_fixed_assets');
expect('suggest unrelated', suggestCanonicalKey('XYZ Account Item'), null);

// ─── runProjection — simple growth case ──────────────────────
{
  const historical: AccountSeries = {
    pl_revenue: [1_000_000, 1_200_000],
    pl_cogs: [600_000, 700_000],
    pl_operating_expense: [200_000, 240_000],
    pl_depreciation: [50_000, 55_000],
    pl_finance_cost: [30_000, 32_000],
    pl_tax: [40_000, 50_000],
    bs_inventory: [150_000, 180_000],
    bs_receivables: [200_000, 240_000],
    bs_cash_bank: [50_000, 70_000],
    bs_other_current_assets: [10_000, 12_000],
    bs_gross_fixed_assets: [500_000, 550_000],
    bs_accumulated_depreciation: [100_000, 150_000],
    bs_creditors: [120_000, 150_000],
    bs_bank_borrowing_short: [100_000, 120_000],
    bs_statutory_dues: [20_000, 25_000],
    bs_other_current_liabilities: [10_000, 15_000],
    bs_term_loan: [200_000, 180_000],
    bs_paid_up_capital: [100_000, 100_000],
    bs_reserves_surplus: [400_000, 510_000],
  };
  const draft: CmaDraft = {
    name: 'test',
    projectionHorizon: 3,
    mpbfMethod: 'tandon_ii',
    assumptions: [
      { canonicalKey: 'pl_revenue', growthPctByYear: [20, 15, 10] },
      { canonicalKey: 'pl_cogs', growthPctByYear: [18, 15, 10] },
      { canonicalKey: 'pl_operating_expense', growthPctByYear: [12, 10, 8] },
    ],
  };
  const result = runProjection(draft, historical, ['FY23-24', 'FY24-25']);
  expect('5 columns total (2 hist + 3 proj)', result.yearLabels.length, 5);
  expect('firstProjectedIndex', result.firstProjectedIndex, 2);
  // Revenue Y+1 = 1.2M × 1.20 = 1.44M
  approxEq(result.series.pl_revenue![2], 1_440_000, 'revenue year +1');
  approxEq(result.series.pl_revenue![3], 1_656_000, 'revenue year +2');
  approxEq(result.series.pl_revenue![4], 1_821_600, 'revenue year +3');
  // COGS Y+1 = 0.7M × 1.18 = 826K
  approxEq(result.series.pl_cogs![2], 826_000, 'cogs year +1');
  // Gross profit Y+1 = 1.44M - 826K = 614K
  approxEq(result.derived.grossProfit[2], 614_000, 'gross profit year +1');
  // Reserves rolled forward = prior reserves + projected PAT.
  // Year +1 PAT = revenue - cogs - opex - dep - interest - tax
  //              with assumptions flat-lining last-historical for
  //              dep/interest/tax (no growth lever set): 55K, 32K, 50K
  //              Opex Y+1 = 240K × 1.12 = 268.8K
  // = 1,440,000 - 826,000 - 268,800 - 55,000 - 32,000 - 50,000
  // = 208,200
  approxEq(result.derived.profitAfterTax[2], 208_200, 'PAT year +1');
  // Reserves Y+1 = 510K (hist) + 208.2K (PAT) = 718.2K
  approxEq(result.series.bs_reserves_surplus![2], 718_200, 'reserves year +1');
}

// ─── runProjection — working-capital cycle days ──────────────
{
  const historical: AccountSeries = {
    pl_revenue: [1_000_000, 1_200_000],
    pl_cogs: [600_000, 700_000],
  };
  const draft: CmaDraft = {
    name: 'wc-test',
    projectionHorizon: 1,
    mpbfMethod: 'tandon_ii',
    assumptions: [
      { canonicalKey: 'pl_revenue', growthPctByYear: [25] },  // 1.5M
      { canonicalKey: 'pl_cogs', growthPctByYear: [25] },     // 875K
    ],
    workingCapital: {
      model: 'cycle_days',
      inventoryDays: 60,
      debtorDays: 45,
      creditorDays: 30,
    },
  };
  const result = runProjection(draft, historical, ['Y1', 'Y2']);
  // Inventory Y+1 = COGS × 60 / 365 = 875,000 × 60 / 365 ≈ 143,836
  approxEq(result.series.bs_inventory![2], 143_835, 'inventory days projection', 5);
  // Receivables Y+1 = Revenue × 45 / 365 = 1.5M × 45/365 ≈ 184,931
  approxEq(result.series.bs_receivables![2], 184_931, 'receivables days projection', 5);
  // Creditors Y+1 = COGS × 30 / 365 = 875,000 × 30/365 ≈ 71,917
  approxEq(result.series.bs_creditors![2], 71_917, 'creditors days projection', 5);
}

// ─── MPBF — all three methods ────────────────────────────────
{
  const inputs = {
    projectedTurnover: [1_000_000],
    totalCurrentAssets: [400_000],
    inventory: [150_000],
    currentLiabExcludingBank: [150_000],
  };
  // Tandon II: 0.75 × (CA − OCL) = 0.75 × 250K = 187.5K
  const t2 = computeMpbf('tandon_ii', inputs);
  approxEq(t2.mpbfByYear[0], 187_500, 'Tandon II MPBF', 1);
  approxEq(t2.promoterMargin[0], 62_500, 'Tandon II promoter margin', 1);

  // Tandon I: 0.75 × 250K − 0.25 × 150K = 187.5K − 37.5K = 150K
  const t1 = computeMpbf('tandon_i', inputs);
  approxEq(t1.mpbfByYear[0], 150_000, 'Tandon I MPBF', 1);

  // Nayak: 20% of turnover = 200K
  const nk = computeMpbf('nayak', inputs);
  approxEq(nk.mpbfByYear[0], 200_000, 'Nayak MPBF', 1);
  approxEq(nk.promoterMargin[0], 50_000, 'Nayak promoter margin (5% of turnover)', 1);
}

// ─── Ratios ───────────────────────────────────────────────────
{
  const historical: AccountSeries = {
    pl_revenue: [1_000_000, 1_200_000],
    pl_cogs: [600_000, 700_000],
    pl_operating_expense: [200_000, 240_000],
    pl_depreciation: [50_000, 55_000],
    pl_finance_cost: [30_000, 32_000],
    pl_tax: [40_000, 50_000],
    bs_inventory: [150_000, 180_000],
    bs_receivables: [200_000, 240_000],
    bs_cash_bank: [50_000, 70_000],
    bs_other_current_assets: [10_000, 12_000],
    bs_creditors: [120_000, 150_000],
    bs_bank_borrowing_short: [100_000, 120_000],
    bs_statutory_dues: [20_000, 25_000],
    bs_other_current_liabilities: [10_000, 15_000],
    bs_term_loan: [200_000, 180_000],
    bs_paid_up_capital: [100_000, 100_000],
    bs_reserves_surplus: [400_000, 510_000],
  };
  const draft: CmaDraft = {
    name: 'ratio-test',
    projectionHorizon: 1,
    mpbfMethod: 'tandon_ii',
    assumptions: [],
    termLoans: [
      { status: 'existing', principal: 500_000, interestRatePct: 10, tenureMonths: 60, moratoriumMonths: 0 },
    ],
  };
  const result = runProjection(draft, historical, ['Y1', 'Y2']);
  const ratios = computeRatios(result);
  // Current ratio Y2 = (180K+240K+70K+12K) / (150K+120K+25K+15K) = 502/310 ≈ 1.619
  approxEq(ratios.currentRatio[1], 1.619, 'current ratio Y2 hist', 0.01);
  // Quick ratio Y2 = (502K - 180K) / 310K = 322/310 ≈ 1.039
  approxEq(ratios.quickRatio[1], 1.039, 'quick ratio Y2 hist', 0.01);
  // Grading
  expect('current ratio Y2 graded ok', gradeRatio('currentRatio', ratios.currentRatio[1]), 'ok');
}

// ─── Stress test ─────────────────────────────────────────────
{
  const historical: AccountSeries = {
    pl_revenue: [1_000_000, 1_200_000],
    pl_cogs: [600_000, 700_000],
    pl_operating_expense: [200_000, 240_000],
    pl_depreciation: [50_000, 55_000],
    pl_finance_cost: [30_000, 32_000],
    pl_tax: [40_000, 50_000],
    bs_paid_up_capital: [100_000, 100_000],
    bs_reserves_surplus: [400_000, 510_000],
  };
  const draft: CmaDraft = {
    name: 'stress',
    projectionHorizon: 1,
    mpbfMethod: 'tandon_ii',
    assumptions: [
      { canonicalKey: 'pl_revenue', growthPctByYear: [20] },
      { canonicalKey: 'pl_cogs', growthPctByYear: [18] },
    ],
  };
  const base = runProjection(draft, historical, ['Y1', 'Y2']);
  const stressed = applyStressTest(base, 10);  // 10% sales miss
  const baseRev = base.series.pl_revenue![2];
  const stressedRev = stressed.projection.series.pl_revenue![2];
  approxEq(stressedRev, baseRev * 0.9, 'stressed revenue', 1);
  // Stressed COGS: 80% variable scales with 0.9, 20% fixed stays
  const baseCogs = base.series.pl_cogs![2];
  const expectedStressedCogs = baseCogs * 0.8 * 0.9 + baseCogs * 0.2;
  approxEq(stressed.projection.series.pl_cogs![2], expectedStressedCogs, 'stressed COGS', 1);
  // Stressed PAT should be lower than base
  expectTrue('stressed PAT < base PAT', stressed.projection.derived.profitAfterTax[2] < base.derived.profitAfterTax[2]);
  // Historical years untouched
  approxEq(stressed.projection.series.pl_revenue![1], 1_200_000, 'historical revenue untouched by stress');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
