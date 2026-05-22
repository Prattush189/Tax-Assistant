/**
 * Stress test for CMA projections. Re-runs the whole projection with
 * sales miss by N% — banks' risk committees use this to gauge
 * resilience: "if revenue underperforms by 10%, does DSCR still
 * clear 1.2x?".
 *
 * Implementation: scales the revenue line down by the stress factor,
 * scales COGS proportionally (variable-cost assumption — fixed
 * costs DON'T scale, so EBITDA suffers more than revenue does),
 * leaves fixed costs (operating expense, depreciation, interest)
 * untouched, then re-derives everything that depends on those.
 *
 * The CA convention is that COGS in CMA is mostly variable (raw
 * materials, direct wages). For v1 we model 80% of COGS as variable
 * — a reasonable middle ground for most SMEs. Service businesses
 * with very low COGS effectively get a pure revenue-stress in this
 * model, which is also accurate.
 */

import type { ProjectionResult } from './projectionEngine';
import { computeRatios, type RatiosResult } from './ratios';

const VARIABLE_COGS_FRACTION = 0.80;

export interface StressedProjection {
  projection: ProjectionResult;
  ratios: RatiosResult;
}

/**
 * Apply the stress to a base projection. Returns a NEW projection
 * (immutable — base projection is untouched) plus re-computed
 * ratios. UI shows the base and stress side-by-side.
 */
export function applyStressTest(
  base: ProjectionResult,
  salesMissPct: number,
): StressedProjection {
  if (!Number.isFinite(salesMissPct) || salesMissPct <= 0) {
    // No-op stress: return the base projection unchanged.
    return { projection: base, ratios: computeRatios(base) };
  }
  const stressFactor = 1 - salesMissPct / 100;
  const n = base.yearLabels.length;

  // Deep-copy the series so the stressed mutation doesn't leak.
  const stressedSeries: typeof base.series = {};
  for (const key of Object.keys(base.series) as Array<keyof typeof base.series>) {
    const arr = base.series[key];
    if (arr) stressedSeries[key] = [...arr];
  }

  // Apply stress to revenue + variable COGS, ONLY for projected years.
  // Historical years stay untouched — you can't stress the past.
  const firstP = base.firstProjectedIndex;
  for (let i = firstP; i < n; i++) {
    if (stressedSeries.pl_revenue) {
      stressedSeries.pl_revenue[i] *= stressFactor;
    }
    if (stressedSeries.pl_cogs) {
      // 80% variable component scales with revenue; 20% fixed stays put.
      const cogs = stressedSeries.pl_cogs[i];
      const variableCogs = cogs * VARIABLE_COGS_FRACTION;
      const fixedCogs = cogs * (1 - VARIABLE_COGS_FRACTION);
      stressedSeries.pl_cogs[i] = (variableCogs * stressFactor) + fixedCogs;
    }
  }

  // Re-derive everything downstream. We can't just call runProjection
  // again because the user's assumptions haven't changed — only the
  // computed P&L lines. So we manually recompute the derived totals
  // and the BS WC components that depend on revenue/COGS.

  const get = (k: keyof typeof stressedSeries): number[] =>
    stressedSeries[k] ?? new Array(n).fill(0);

  const revenue = get('pl_revenue');
  const otherIncome = get('pl_other_income');
  const cogs = get('pl_cogs');
  const opex = get('pl_operating_expense');
  const depreciation = get('pl_depreciation');
  const financeCost = get('pl_finance_cost');
  const tax = get('pl_tax');

  const grossProfit = revenue.map((r, i) => r - cogs[i]);
  const ebitda = grossProfit.map((gp, i) => gp - opex[i] + otherIncome[i]);
  const ebit = ebitda.map((e, i) => e - depreciation[i]);
  const profitBeforeTax = ebit.map((e, i) => e - financeCost[i]);
  // Tax is held FLAT in the stress (a conservative choice — tax
  // departments don't refund underperformance in real time). The
  // bank's risk view assumes the tax provision sticks.
  const profitAfterTax = profitBeforeTax.map((pbt, i) => pbt - tax[i]);

  // Roll reserves forward under the stressed PAT.
  const reserves = stressedSeries.bs_reserves_surplus ?? new Array(n).fill(0);
  for (let i = firstP; i < n; i++) {
    reserves[i] = (reserves[i - 1] ?? 0) + (profitAfterTax[i] ?? 0);
  }
  stressedSeries.bs_reserves_surplus = reserves;

  // BS components driven by revenue (receivables on days-of-sales)
  // also flex with revenue — but for v1 we keep them at base levels
  // since the WC assumption model is already baked into the base
  // projection. A separate "stress on WC" lever could be a v1.1
  // addition if users ask.

  const totalCurrentAssets = sumKeys(stressedSeries, [
    'bs_inventory', 'bs_receivables', 'bs_cash_bank', 'bs_other_current_assets',
  ], n);
  const totalFixedAssets = get('bs_gross_fixed_assets').map(
    (g, i) => g - (stressedSeries.bs_accumulated_depreciation?.[i] ?? 0),
  );
  const totalAssets = totalCurrentAssets.map(
    (ca, i) => ca + totalFixedAssets[i] + (stressedSeries.bs_other_non_current_assets?.[i] ?? 0),
  );
  const totalCurrentLiabilities = sumKeys(stressedSeries, [
    'bs_creditors', 'bs_bank_borrowing_short', 'bs_statutory_dues', 'bs_other_current_liabilities',
  ], n);
  const totalNonCurrentLiab = sumKeys(stressedSeries, [
    'bs_term_loan', 'bs_other_non_current_liab',
  ], n);
  const totalEquity = sumKeys(stressedSeries, [
    'bs_paid_up_capital', 'bs_reserves_surplus',
  ], n);
  const totalLiabAndEquity = totalCurrentLiabilities.map(
    (cl, i) => cl + totalNonCurrentLiab[i] + totalEquity[i],
  );
  const workingCapitalGap = totalCurrentAssets.map((ca, i) => {
    const clOther = (stressedSeries.bs_creditors?.[i] ?? 0)
      + (stressedSeries.bs_statutory_dues?.[i] ?? 0)
      + (stressedSeries.bs_other_current_liabilities?.[i] ?? 0);
    return ca - clOther;
  });

  const stressedProjection: ProjectionResult = {
    yearLabels: base.yearLabels.map((l, i) =>
      i >= firstP ? l.replace(' (P)', ` (P, stress −${salesMissPct}%)`) : l,
    ),
    firstProjectedIndex: firstP,
    series: stressedSeries,
    derived: {
      grossProfit, ebitda, ebit, profitBeforeTax, profitAfterTax,
      totalCurrentAssets, totalFixedAssets, totalAssets,
      totalCurrentLiabilities, totalNonCurrentLiab, totalEquity, totalLiabAndEquity,
      workingCapitalGap,
      termLoanClosingBalance: [...base.derived.termLoanClosingBalance],
      termLoanInterest: [...base.derived.termLoanInterest],
      termLoanPrincipal: [...base.derived.termLoanPrincipal],
    },
  };

  return {
    projection: stressedProjection,
    ratios: computeRatios(stressedProjection),
  };
}

function sumKeys(
  series: ProjectionResult['series'],
  keys: Array<keyof ProjectionResult['series']>,
  totalYears: number,
): number[] {
  const out = new Array(totalYears).fill(0);
  for (const k of keys) {
    const s = series[k];
    if (!s) continue;
    for (let i = 0; i < totalYears; i++) out[i] += s[i] ?? 0;
  }
  return out;
}
