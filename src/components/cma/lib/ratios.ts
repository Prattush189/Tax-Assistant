/**
 * Standard CMA financial ratios. Each ratio is one number per year
 * (historical + projected), so the bank's officer can see the trend.
 *
 * DSCR, Current Ratio, TOL/TNW, Quick Ratio cover the four ratios
 * every CMA template prints. Additional ratios (gross margin,
 * EBITDA margin, interest coverage) come along for free since
 * they're simple arithmetic on the projection result.
 */

import type { ProjectionResult } from './projectionEngine';

export interface RatiosResult {
  /** Debt Service Coverage Ratio = (PAT + Depreciation + Interest)
   *  ÷ (Principal repayment + Interest). Banks need DSCR ≥ 1.5x to
   *  approve a term loan comfortably; 1.2x is the regulatory floor. */
  dscr: number[];
  /** Current Ratio = Current Assets ÷ Current Liabilities. Banks
   *  prefer ≥ 1.33x for working-capital-limit approval. */
  currentRatio: number[];
  /** Quick Ratio = (Current Assets − Inventory) ÷ Current Liabilities.
   *  Tighter than current ratio; banks like ≥ 1.0x. */
  quickRatio: number[];
  /** Total Outside Liabilities ÷ Tangible Net Worth. Lower is
   *  better; banks prefer ≤ 3.0x. */
  tolTnw: number[];
  /** Gross Margin % = (Revenue − COGS) ÷ Revenue × 100. */
  grossMargin: number[];
  /** EBITDA Margin % */
  ebitdaMargin: number[];
  /** Interest Coverage = EBIT ÷ Interest. Higher is better;
   *  banks expect ≥ 2.0x. */
  interestCoverage: number[];
}

export function computeRatios(p: ProjectionResult): RatiosResult {
  const n = p.yearLabels.length;
  const safeDivide = (num: number, den: number): number => {
    if (!Number.isFinite(num) || !Number.isFinite(den) || Math.abs(den) < 0.01) return 0;
    return num / den;
  };

  const get = (arr: number[] | undefined): number[] => arr ?? new Array(n).fill(0);
  const revenue = get(p.series.pl_revenue);
  const cogs = get(p.series.pl_cogs);
  const inventory = get(p.series.bs_inventory);
  const financeCost = get(p.series.pl_finance_cost);
  const depreciation = get(p.series.pl_depreciation);

  // DSCR — only meaningful when there's principal + interest to
  // service. For years with no term-loan activity, this returns 0
  // (UI prints "—") rather than a misleading infinity.
  const dscr = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const cashAccrual = (p.derived.profitAfterTax[i] ?? 0)
      + (depreciation[i] ?? 0)
      + (financeCost[i] ?? 0);
    const debtService = (p.derived.termLoanPrincipal[i] ?? 0)
      + (p.derived.termLoanInterest[i] ?? 0);
    dscr[i] = safeDivide(cashAccrual, debtService);
  }

  // Current ratio (and its quick-asset cousin).
  const currentRatio = p.derived.totalCurrentAssets.map(
    (ca, i) => safeDivide(ca, p.derived.totalCurrentLiabilities[i]),
  );
  const quickRatio = p.derived.totalCurrentAssets.map(
    (ca, i) => safeDivide(ca - inventory[i], p.derived.totalCurrentLiabilities[i]),
  );

  // TOL/TNW. Tangible Net Worth = equity less intangibles. For v1
  // we treat TNW = totalEquity (no goodwill column to subtract).
  // TOL = current liabilities + non-current liabilities.
  const tolTnw = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const tol = (p.derived.totalCurrentLiabilities[i] ?? 0)
      + (p.derived.totalNonCurrentLiab[i] ?? 0);
    const tnw = p.derived.totalEquity[i] ?? 0;
    tolTnw[i] = safeDivide(tol, tnw);
  }

  // Margin ratios.
  const grossMargin = revenue.map((r, i) => safeDivide((r - cogs[i]) * 100, r));
  const ebitdaMargin = revenue.map((r, i) => safeDivide(p.derived.ebitda[i] * 100, r));

  // Interest coverage = EBIT ÷ Interest. Years with zero interest
  // surface as 0 (UI prints "—") rather than infinity.
  const interestCoverage = financeCost.map(
    (fc, i) => safeDivide(p.derived.ebit[i], fc),
  );

  return {
    dscr, currentRatio, quickRatio, tolTnw,
    grossMargin, ebitdaMargin, interestCoverage,
  };
}

/**
 * Sanity check: does the bank typically approve at these ratios?
 * Returns a per-ratio status that the UI surfaces as green/amber.
 * Thresholds match standard CMA acceptance norms across PSU banks.
 */
export type RatioStatus = 'ok' | 'borderline' | 'weak';

export function gradeRatio(name: keyof RatiosResult, value: number): RatioStatus {
  if (!Number.isFinite(value) || value === 0) return 'weak';
  switch (name) {
    case 'dscr':
      if (value >= 1.5) return 'ok';
      if (value >= 1.2) return 'borderline';
      return 'weak';
    case 'currentRatio':
      if (value >= 1.33) return 'ok';
      if (value >= 1.0) return 'borderline';
      return 'weak';
    case 'quickRatio':
      if (value >= 1.0) return 'ok';
      if (value >= 0.75) return 'borderline';
      return 'weak';
    case 'tolTnw':
      // Lower is better.
      if (value <= 3.0) return 'ok';
      if (value <= 4.5) return 'borderline';
      return 'weak';
    case 'interestCoverage':
      if (value >= 2.0) return 'ok';
      if (value >= 1.25) return 'borderline';
      return 'weak';
    case 'grossMargin':
    case 'ebitdaMargin':
      // No universal grade — depends on industry. Default ok.
      return 'ok';
  }
}
