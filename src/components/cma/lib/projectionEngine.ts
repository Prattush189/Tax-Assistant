/**
 * CMA projection engine. Takes historical financials (2 years, mapped
 * to canonical accounts) + per-line growth assumptions + working-
 * capital assumptions + term-loan schedules, produces projected P&L
 * and BS for 3 or 5 forward years.
 *
 * All math is deterministic — same inputs produce same outputs, byte
 * for byte. No randomness, no AI, no rounding except final display.
 *
 * Sign convention: every canonical value is a magnitude (≥ 0). The
 * derived totals know how to add/subtract — e.g. EBITDA subtracts
 * COGS and operating expenses, even though they're stored positive.
 */

import type { CanonicalSection } from './canonicalAccounts';
import type { CmaDraft, LineAssumption, TermLoan, WorkingCapitalAssumption } from './uiModel';

/** Per-account historical + projected magnitudes, indexed by year.
 *  Year index 0..H-1 = historical (latest H years uploaded);
 *  index H..H+P-1 = projected (next P years).
 *
 *  Historical values are read directly from the user's mapping.
 *  Projected values flow from growth assumptions applied to the
 *  latest historical (or to the previous projected year). */
export type AccountSeries = Partial<Record<CanonicalSection, number[]>>;

export interface ProjectionResult {
  /** Year labels for the columns ["FY23-24", "FY24-25", "FY25-26 (P)", …] */
  yearLabels: string[];
  /** First projected year's column index (everything before is historical). */
  firstProjectedIndex: number;
  /** Per-account values across all years (historical + projected). */
  series: AccountSeries;
  /** Convenience derived metrics, one number per year. */
  derived: {
    grossProfit: number[];           // revenue - cogs
    ebitda: number[];                // grossProfit - operatingExpense + otherIncome
    ebit: number[];                  // ebitda - depreciation
    profitBeforeTax: number[];       // ebit - financeCost
    profitAfterTax: number[];        // pbt - tax
    totalCurrentAssets: number[];    // inventory + receivables + cash + other_ca
    totalFixedAssets: number[];      // gross_fa - accumulated_dep
    totalAssets: number[];           // CA + FA + other_non_current
    totalCurrentLiabilities: number[]; // creditors + bank_borrowing_short + statutory + other_cl
    totalNonCurrentLiab: number[];   // term_loan + other_non_current_liab
    totalEquity: number[];           // paid_up + reserves
    totalLiabAndEquity: number[];    // CL + NCL + Equity
    workingCapitalGap: number[];     // CA - (CL excluding bank borrowing)
    /** Closing balance of operative term loans across years. Used by
     *  DSCR computation. Derived from the supplied schedules. */
    termLoanClosingBalance: number[];
    /** Annual interest on the operative term loans (existing +
     *  proposed). Computed from the loan schedules. */
    termLoanInterest: number[];
    /** Annual principal repayment on the operative term loans. */
    termLoanPrincipal: number[];
  };
}

/** Latest historical = the most recent year in the uploaded BS/P&L.
 *  Used as the base for every projection year's growth multiplier. */
const ZERO_FALLBACK = 0;

/**
 * Run the projection. Returns AccountSeries plus derived totals.
 * Handles missing assumptions gracefully — any account without a
 * growth lever flatlines from its latest historical value.
 *
 * Throws nothing; bad inputs yield zeros rather than NaN. CMA users
 * routinely upload partial data while still building the draft, and
 * we'd rather show "₹0" in a projected cell than crash the wizard.
 */
export function runProjection(
  draft: CmaDraft,
  historicalValues: AccountSeries,
  historicalYearLabels: string[],
): ProjectionResult {
  const horizon = draft.projectionHorizon ?? 3;
  const historicalCount = historicalYearLabels.length;
  const totalYears = historicalCount + horizon;
  const firstProjectedIndex = historicalCount;

  // Compose year labels. Projected ones get "(P)" suffix so the
  // banker can tell forecast from actual at a glance.
  const yearLabels: string[] = [...historicalYearLabels];
  // Pull the start year from the last historical label if it looks
  // like "FY 24-25" or "FY24-25"; otherwise default to current year.
  const lastHistorical = historicalYearLabels[historicalCount - 1] ?? '';
  const fyMatch = /(\d{2})\s*[-/]\s*(\d{2})/.exec(lastHistorical);
  let startYy = fyMatch ? parseInt(fyMatch[2], 10) : new Date().getFullYear() % 100;
  for (let p = 0; p < horizon; p++) {
    startYy = (startYy + 1) % 100;
    const next = (startYy + 1) % 100;
    yearLabels.push(`FY ${String(startYy).padStart(2, '0')}-${String(next).padStart(2, '0')} (P)`);
  }

  // Build a quick lookup for growth assumptions per canonical key.
  // Each LineAssumption.growthPctByYear is indexed 0..horizon-1.
  const assumptionByKey = new Map<CanonicalSection, LineAssumption>();
  for (const a of draft.assumptions ?? []) {
    assumptionByKey.set(a.canonicalKey as CanonicalSection, a);
  }

  // Project each P&L line forward. BS lines that aren't WC-driven
  // (fixed assets, capital, reserves) get the same growth treatment.
  const series: AccountSeries = {};
  const allKeys = Object.keys(historicalValues) as CanonicalSection[];
  for (const key of allKeys) {
    const hist = historicalValues[key] ?? [];
    const padded: number[] = new Array(totalYears).fill(ZERO_FALLBACK);
    for (let i = 0; i < historicalCount; i++) padded[i] = hist[i] ?? ZERO_FALLBACK;

    const assumption = assumptionByKey.get(key);
    let base = padded[historicalCount - 1] ?? ZERO_FALLBACK;
    for (let p = 0; p < horizon; p++) {
      const growthPct = assumption?.growthPctByYear?.[p];
      const next = growthPct === undefined || growthPct === null
        ? base                              // no assumption = flatline
        : base * (1 + growthPct / 100);
      padded[historicalCount + p] = next;
      base = next;
    }
    series[key] = padded;
  }

  // Working-capital re-derivation for projected years (overrides any
  // direct growth lever for inventory / receivables / creditors).
  // The CMA convention: project sales from the user's growth lever,
  // then derive WC components from days-of-sales (or % of sales) so
  // they scale with the projected sales line.
  applyWorkingCapitalAssumptions(series, draft.workingCapital, historicalCount, horizon);

  // Term-loan schedule produces interest + principal + closing
  // balance per year. Folds back into BS (bs_term_loan column gets
  // overwritten by the schedule's closing balance — overrides any
  // growth-lever flatlining).
  const loanProjection = projectTermLoans(draft.termLoans ?? [], totalYears, historicalCount);
  series.bs_term_loan = loanProjection.closingBalance;

  // ── Derived totals ────────────────────────────────────────────
  const get = (k: CanonicalSection): number[] =>
    series[k] ?? new Array(totalYears).fill(ZERO_FALLBACK);

  const revenue = get('pl_revenue');
  const otherIncome = get('pl_other_income');
  const cogs = get('pl_cogs');
  const opex = get('pl_operating_expense');
  const depreciation = get('pl_depreciation');
  const financeCost = get('pl_finance_cost');
  // Project finance cost overlay: when projected, prefer the term-
  // loan schedule's interest plus a flat assumption on other interest.
  // We don't over-mix here for v1 — finance cost is what the user
  // projected via assumptions OR derived from the loan schedule,
  // whichever is non-zero. The Excel output explains the lineage.
  const projectedInterest = loanProjection.interest;
  const effectiveFinanceCost = financeCost.map((c, i) =>
    i >= historicalCount && projectedInterest[i] > 0 ? projectedInterest[i] : c,
  );
  series.pl_finance_cost = effectiveFinanceCost;

  const tax = get('pl_tax');

  const grossProfit = revenue.map((r, i) => r - cogs[i]);
  const ebitda = grossProfit.map((gp, i) => gp - opex[i] + otherIncome[i]);
  const ebit = ebitda.map((e, i) => e - depreciation[i]);
  const profitBeforeTax = ebit.map((e, i) => e - effectiveFinanceCost[i]);
  const profitAfterTax = profitBeforeTax.map((pbt, i) => pbt - tax[i]);

  const totalCurrentAssets = sumKeys(series, [
    'bs_inventory', 'bs_receivables', 'bs_cash_bank', 'bs_other_current_assets',
  ], totalYears);
  const totalFixedAssets = get('bs_gross_fixed_assets').map(
    (g, i) => g - (series.bs_accumulated_depreciation?.[i] ?? 0),
  );
  const totalAssets = totalCurrentAssets.map(
    (ca, i) => ca + totalFixedAssets[i] + (series.bs_other_non_current_assets?.[i] ?? 0),
  );
  const totalCurrentLiabilities = sumKeys(series, [
    'bs_creditors', 'bs_bank_borrowing_short', 'bs_statutory_dues', 'bs_other_current_liabilities',
  ], totalYears);
  const totalNonCurrentLiab = sumKeys(series, [
    'bs_term_loan', 'bs_other_non_current_liab',
  ], totalYears);
  const totalEquity = sumKeys(series, [
    'bs_paid_up_capital', 'bs_reserves_surplus',
  ], totalYears);
  const totalLiabAndEquity = totalCurrentLiabilities.map(
    (cl, i) => cl + totalNonCurrentLiab[i] + totalEquity[i],
  );
  // Working-capital GAP = current assets MINUS current liabilities OTHER
  // than bank borrowings. This is the Tandon II base — the gap the
  // bank funds 75% of (with 25% promoter margin).
  const workingCapitalGap = totalCurrentAssets.map((ca, i) => {
    const clOther = (series.bs_creditors?.[i] ?? 0)
      + (series.bs_statutory_dues?.[i] ?? 0)
      + (series.bs_other_current_liabilities?.[i] ?? 0);
    return ca - clOther;
  });

  // Roll reserves forward by adding projected PAT to the prior
  // year's reserves. This is what's expected in a CMA — without it,
  // the BS doesn't balance after Year 1. Existing reserves
  // assumptions are overridden for projected years only.
  const reserves = series.bs_reserves_surplus ?? new Array(totalYears).fill(ZERO_FALLBACK);
  for (let i = historicalCount; i < totalYears; i++) {
    reserves[i] = (reserves[i - 1] ?? 0) + (profitAfterTax[i] ?? 0);
  }
  series.bs_reserves_surplus = reserves;

  return {
    yearLabels,
    firstProjectedIndex,
    series,
    derived: {
      grossProfit, ebitda, ebit, profitBeforeTax, profitAfterTax,
      totalCurrentAssets, totalFixedAssets, totalAssets,
      totalCurrentLiabilities, totalNonCurrentLiab, totalEquity, totalLiabAndEquity,
      workingCapitalGap,
      termLoanClosingBalance: loanProjection.closingBalance,
      termLoanInterest: loanProjection.interest,
      termLoanPrincipal: loanProjection.principal,
    },
  };
}

function sumKeys(
  series: AccountSeries,
  keys: CanonicalSection[],
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

function applyWorkingCapitalAssumptions(
  series: AccountSeries,
  wc: WorkingCapitalAssumption | undefined,
  historicalCount: number,
  horizon: number,
) {
  if (!wc) return;
  const totalYears = historicalCount + horizon;
  const revenue = series.pl_revenue ?? new Array(totalYears).fill(0);
  const cogs = series.pl_cogs ?? new Array(totalYears).fill(0);

  if (wc.model === 'cycle_days') {
    if (typeof wc.inventoryDays === 'number') {
      const inv = series.bs_inventory ?? new Array(totalYears).fill(0);
      for (let i = historicalCount; i < totalYears; i++) {
        inv[i] = (cogs[i] * wc.inventoryDays) / 365;
      }
      series.bs_inventory = inv;
    }
    if (typeof wc.debtorDays === 'number') {
      const rec = series.bs_receivables ?? new Array(totalYears).fill(0);
      for (let i = historicalCount; i < totalYears; i++) {
        rec[i] = (revenue[i] * wc.debtorDays) / 365;
      }
      series.bs_receivables = rec;
    }
    if (typeof wc.creditorDays === 'number') {
      const cr = series.bs_creditors ?? new Array(totalYears).fill(0);
      for (let i = historicalCount; i < totalYears; i++) {
        cr[i] = (cogs[i] * wc.creditorDays) / 365;
      }
      series.bs_creditors = cr;
    }
  } else if (wc.model === 'percent_of_sales') {
    if (typeof wc.wcAsPctOfSales === 'number') {
      // % of sales → distribute across inventory + receivables (50/50
      // split) and zero out the creditor projection so the user's
      // sales-driven WC dominates. Simple, works for service biz.
      const pct = wc.wcAsPctOfSales / 100;
      const inv = series.bs_inventory ?? new Array(totalYears).fill(0);
      const rec = series.bs_receivables ?? new Array(totalYears).fill(0);
      for (let i = historicalCount; i < totalYears; i++) {
        const wcTotal = revenue[i] * pct;
        inv[i] = wcTotal * 0.4;
        rec[i] = wcTotal * 0.6;
      }
      series.bs_inventory = inv;
      series.bs_receivables = rec;
    }
  }
}

/**
 * Project the term-loan schedule across the timeline. Returns
 * arrays of closing balance, interest paid, and principal repaid
 * per year — sized [historicalCount + horizon] so consumers can
 * index them directly against the year columns.
 *
 * Each loan contributes from its `drawnAt` onward. Existing loans
 * (status = 'existing') are assumed already partly repaid by the
 * latest historical year — for v1 we treat the full principal as
 * outstanding at the start of year 0 and amortize forward. This
 * is approximate (banks expect proper opening balances) but
 * good enough for the projection — the user can override the
 * BS bs_term_loan opening balance via mapping if needed.
 *
 * Proposed loans (status = 'proposed') start at year (historical
 * year + 1) — i.e. the first projected year.
 */
function projectTermLoans(
  loans: TermLoan[],
  totalYears: number,
  historicalCount: number,
): { closingBalance: number[]; interest: number[]; principal: number[] } {
  const closingBalance = new Array(totalYears).fill(0);
  const interest = new Array(totalYears).fill(0);
  const principal = new Array(totalYears).fill(0);

  for (const loan of loans) {
    if (!loan.principal || loan.principal <= 0) continue;
    if (!loan.interestRatePct || loan.interestRatePct < 0) continue;
    if (!loan.tenureMonths || loan.tenureMonths <= 0) continue;

    const startYearIdx = loan.status === 'proposed' ? historicalCount : 0;
    const moratoriumYears = Math.floor((loan.moratoriumMonths ?? 0) / 12);
    const tenureYears = Math.ceil(loan.tenureMonths / 12);
    const ratePerYear = loan.interestRatePct / 100;

    let balance = loan.principal;
    for (let yearOffset = 0; yearOffset < tenureYears && (startYearIdx + yearOffset) < totalYears; yearOffset++) {
      const idx = startYearIdx + yearOffset;
      if (balance <= 0) break;
      const yearInterest = balance * ratePerYear;
      // Repayment: in moratorium years, only interest is paid.
      // Otherwise principal flat-out — repaymentType differentiation
      // is a v1.1 feature; for v1 we approximate as equal-principal.
      let yearPrincipal = 0;
      if (yearOffset >= moratoriumYears) {
        const remainingYears = tenureYears - moratoriumYears;
        yearPrincipal = loan.principal / Math.max(1, remainingYears);
        if (yearPrincipal > balance) yearPrincipal = balance;
      }
      interest[idx] += yearInterest;
      principal[idx] += yearPrincipal;
      balance -= yearPrincipal;
      closingBalance[idx] += Math.max(0, balance);
    }
  }
  return { closingBalance, interest, principal };
}
