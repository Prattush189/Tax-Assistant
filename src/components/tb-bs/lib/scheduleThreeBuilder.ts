/**
 * Build the Schedule III BS + P&L data structure from a TB upload
 * plus the user's mapping. Pure aggregation — no projections, no
 * derived ratios. Output is ready for the Excel exporter and the
 * Review-step preview.
 */

import type { TbBsDraft } from './uiModel';
import {
  SCHEDULE_THREE_BY_KEY,
  type ScheduleThreeSection,
  type ScheduleThreeAccount,
} from './scheduleThreeAccounts';

function readNumber(raw: string): number {
  if (!raw) return 0;
  let s = String(raw).trim();
  if (!s || s === '-' || s === '—') return 0;
  const negative = /^\(.+\)$/.test(s);
  if (negative) s = s.slice(1, -1);
  s = s.replace(/[₹$,]/g, '').replace(/\s+/g, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

/**
 * Normalise an account name for cross-year matching.
 *
 * Tally / Busy / Marg occasionally append "A/c" suffixes, vary
 * casing, or insert extra spaces between years — same account
 * still, different surface text. We lowercase, drop "a/c"-style
 * suffixes, strip punctuation, collapse whitespace.
 *
 *   "Sundry Debtors"      → "sundry debtors"
 *   "Sundry Debtors A/c"  → "sundry debtors"
 *   "  SUNDRY  DEBTORS "  → "sundry debtors"
 *   "Plant & Machinery"   → "plant machinery"
 */
function normaliseAccountName(raw: string | undefined): string {
  if (!raw) return '';
  return String(raw)
    .toLowerCase()
    .replace(/\ba\/?c\b\.?/g, '')          // strip "A/c" suffix
    .replace(/\baccount\b/g, '')           // strip standalone "account"
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')      // strip punctuation, keep letters+digits
    .replace(/\s+/g, ' ')
    .trim();
}

/** Two-period balance for each Schedule III line. */
export type ScheduleThreeAggregate = Partial<Record<ScheduleThreeSection, {
  current: number;
  previous: number;
}>>;

export interface ScheduleThreeReport {
  /** Year labels for the two columns. previousLabel may be empty
   *  when only the current-year TB was uploaded — the exporter will
   *  emit a single-column BS / P&L in that case. */
  currentLabel: string;
  previousLabel: string;
  hasPreviousYear: boolean;
  aggregate: ScheduleThreeAggregate;
  /** Derived totals. Each is a tuple [current, previous]. */
  totals: {
    // BS — Equity & Liabilities
    shareholderFunds: [number, number];
    nonCurrentLiab: [number, number];
    currentLiab: [number, number];
    totalEquityAndLiab: [number, number];
    // BS — Assets
    nonCurrentAssets: [number, number];
    currentAssets: [number, number];
    totalAssets: [number, number];
    // P&L
    totalRevenue: [number, number];
    totalExpenses: [number, number];
    profitBeforeExceptional: [number, number];
    profitBeforeTax: [number, number];
    totalTax: [number, number];
    profitForPeriod: [number, number];
  };
  /** Balance check — totalAssets − totalEquityAndLiab. ≠ 0 means
   *  the TB doesn't tie or the mapping is incomplete. */
  balanceCheck: [number, number];
  /** Split of `bs_long_term_borrowings` into secured vs unsecured,
   *  driven by the `isUnsecured` flag on each TbMappingEntry. The
   *  sum (secured + unsecured) equals aggregate.bs_long_term_borrowings.
   *  Used by the Tally Sources/Application exporter; Schedule III
   *  and ICAI exporters ignore the split. */
  loanFundsSplit: {
    secured: [number, number];
    unsecured: [number, number];
  };
}

/**
 * Aggregate the mapped TB into Schedule III shape. Sums multiple
 * TB rows pointing at the same canonical key.
 *
 * Sign convention:
 *   - For debit-side accounts (assets, expenses), value = debit − credit
 *     (rare case where TB shows the contra-side, e.g. closing-stock-
 *     in-COGS adjustment)
 *   - For credit-side accounts (liabilities, income, equity), value =
 *     credit − debit
 *   - Store as a non-negative magnitude in the aggregate
 */
export function buildScheduleThreeReport(draft: TbBsDraft): ScheduleThreeReport {
  const aggregate: ScheduleThreeAggregate = {};
  const currentLabel = draft.currentTb?.yearLabel ?? 'Current Year';
  const previousLabel = draft.previousTb?.yearLabel ?? '';
  const hasPreviousYear = !!draft.previousTb?.rows?.length;

  // Walk the mapping. For each entry, look up the row in the
  // appropriate year's TB and add its signed amount to the
  // aggregate.
  const mapping = draft.mapping ?? [];
  const currentRows = draft.currentTb?.rows ?? [];
  const previousRows = draft.previousTb?.rows ?? [];

  const accountCol = draft.currentTb?.accountColumn ?? 0;
  const debitCol = draft.currentTb?.debitColumn ?? null;
  const creditCol = draft.currentTb?.creditColumn ?? null;
  const prevAccountCol = draft.previousTb?.accountColumn ?? accountCol;
  const prevDebitCol = draft.previousTb?.debitColumn ?? debitCol;
  const prevCreditCol = draft.previousTb?.creditColumn ?? creditCol;

  const sideForKey = (key: ScheduleThreeSection): 'debit' | 'credit' =>
    SCHEDULE_THREE_BY_KEY[key].side;

  // Signed value for a TB row: take side-appropriate balance.
  const signedFor = (row: string[] | undefined, side: 'debit' | 'credit', dCol: number | null, cCol: number | null): number => {
    if (!row) return 0;
    const dr = dCol !== null && dCol !== undefined ? readNumber(row[dCol] ?? '') : 0;
    const cr = cCol !== null && cCol !== undefined ? readNumber(row[cCol] ?? '') : 0;
    // If only one column present, that's the signed balance.
    if (dCol !== null && cCol === null) return side === 'debit' ? dr : -dr;
    if (cCol !== null && dCol === null) return side === 'credit' ? cr : -cr;
    // Both columns: net them on the side we want.
    return side === 'debit' ? (dr - cr) : (cr - dr);
  };

  // Build a name → index lookup for the previous-year TB so we can
  // align each current-year mapped row to its same-named counterpart
  // last year, regardless of row position. Index-based lookup is the
  // fallback when no name match is found (covers the case where the
  // user uploaded the same file as both years, or when account names
  // genuinely differ across years).
  const prevByName = new Map<string, number>();
  if (hasPreviousYear) {
    for (let i = 0; i < previousRows.length; i++) {
      const name = normaliseAccountName(previousRows[i]?.[prevAccountCol]);
      if (name && !prevByName.has(name)) {
        // First occurrence wins — if the previous-year TB has
        // duplicate account names (sub-ledger split across rows),
        // the user should consolidate before upload. Logging this
        // would be too chatty; the tie-out check catches the
        // resulting imbalance downstream.
        prevByName.set(name, i);
      }
    }
  }

  // Secured / Unsecured tracking for bs_long_term_borrowings. Used
  // by the Tally Sources/Application exporter, which surfaces the
  // two as separate lines. The aggregate.bs_long_term_borrowings
  // total stays unchanged (Schedule III and ICAI use the combined
  // figure).
  const securedLoans: [number, number] = [0, 0];
  const unsecuredLoans: [number, number] = [0, 0];

  for (const entry of mapping) {
    if (entry.yearKey !== 'current') continue; // mapping is single-year in v1
    const key = entry.canonicalKey as ScheduleThreeSection;
    const side = sideForKey(key);
    const curVal = signedFor(currentRows[entry.sourceRowIndex], side, debitCol, creditCol);

    // Previous-year lookup: by name first, fallback to index.
    let prevVal = 0;
    if (hasPreviousYear) {
      const curName = normaliseAccountName(currentRows[entry.sourceRowIndex]?.[accountCol]);
      const prevIdx = curName ? prevByName.get(curName) : undefined;
      const effectivePrevRow = prevIdx !== undefined
        ? previousRows[prevIdx]
        : previousRows[entry.sourceRowIndex];
      prevVal = signedFor(effectivePrevRow, side, prevDebitCol, prevCreditCol);
    }

    if (!aggregate[key]) aggregate[key] = { current: 0, previous: 0 };
    aggregate[key]!.current += Math.abs(curVal);
    aggregate[key]!.previous += Math.abs(prevVal);

    // Track secured/unsecured split for long-term borrowings only.
    if (key === 'bs_long_term_borrowings') {
      const target = entry.isUnsecured ? unsecuredLoans : securedLoans;
      target[0] += Math.abs(curVal);
      target[1] += Math.abs(prevVal);
    }
  }

  // ── Derived totals ───────────────────────────────────────────
  const get = (k: ScheduleThreeSection): [number, number] => {
    const a = aggregate[k];
    return [a?.current ?? 0, a?.previous ?? 0];
  };
  const sumKeys = (keys: ScheduleThreeSection[]): [number, number] => {
    let c = 0, p = 0;
    for (const k of keys) {
      const [cv, pv] = get(k);
      c += cv; p += pv;
    }
    return [c, p];
  };

  const shareholderFunds = sumKeys([
    'bs_share_capital', 'bs_reserves_surplus', 'bs_money_received_share_warrants', 'bs_share_application_pending',
  ]);
  const nonCurrentLiab = sumKeys([
    'bs_long_term_borrowings', 'bs_deferred_tax_liab', 'bs_other_long_term_liab', 'bs_long_term_provisions',
  ]);
  const currentLiab = sumKeys([
    'bs_short_term_borrowings', 'bs_trade_payables', 'bs_other_current_liab', 'bs_short_term_provisions',
  ]);
  const totalEquityAndLiab: [number, number] = [
    shareholderFunds[0] + nonCurrentLiab[0] + currentLiab[0],
    shareholderFunds[1] + nonCurrentLiab[1] + currentLiab[1],
  ];

  const nonCurrentAssets = sumKeys([
    'bs_tangible_assets', 'bs_intangible_assets', 'bs_capital_wip', 'bs_intangible_under_dev',
    'bs_non_current_investments', 'bs_deferred_tax_asset', 'bs_long_term_loans_advances', 'bs_other_non_current_assets',
  ]);
  const currentAssets = sumKeys([
    'bs_current_investments', 'bs_inventories', 'bs_trade_receivables', 'bs_cash_equivalents',
    'bs_short_term_loans_advances', 'bs_other_current_assets',
  ]);
  const totalAssets: [number, number] = [
    nonCurrentAssets[0] + currentAssets[0],
    nonCurrentAssets[1] + currentAssets[1],
  ];

  const totalRevenue = sumKeys(['pl_revenue_operations', 'pl_other_income']);
  const expensesExclTaxAndExceptional = sumKeys([
    'pl_cost_of_materials', 'pl_purchases_stock', 'pl_change_inventory',
    'pl_employee_benefits', 'pl_finance_costs', 'pl_depreciation_amort', 'pl_other_expenses',
  ]);
  const profitBeforeExceptional: [number, number] = [
    totalRevenue[0] - expensesExclTaxAndExceptional[0],
    totalRevenue[1] - expensesExclTaxAndExceptional[1],
  ];
  const exceptional = get('pl_exceptional_items');
  const profitBeforeTax: [number, number] = [
    profitBeforeExceptional[0] - exceptional[0],
    profitBeforeExceptional[1] - exceptional[1],
  ];
  const totalTax = sumKeys(['pl_tax_current', 'pl_tax_deferred']);
  const profitForPeriod: [number, number] = [
    profitBeforeTax[0] - totalTax[0],
    profitBeforeTax[1] - totalTax[1],
  ];
  // P&L's total expenses includes tax + exceptional for the
  // Schedule III layout's "Total Expenses" line under expenses.
  // We keep it separate above for clarity, but the export expects
  // a combined number for the line "V. Total Expenses".
  const totalExpenses: [number, number] = [
    expensesExclTaxAndExceptional[0] + exceptional[0] + totalTax[0],
    expensesExclTaxAndExceptional[1] + exceptional[1] + totalTax[1],
  ];

  return {
    currentLabel,
    previousLabel,
    hasPreviousYear,
    aggregate,
    totals: {
      shareholderFunds, nonCurrentLiab, currentLiab, totalEquityAndLiab,
      nonCurrentAssets, currentAssets, totalAssets,
      totalRevenue, totalExpenses,
      profitBeforeExceptional, profitBeforeTax, totalTax, profitForPeriod,
    },
    balanceCheck: [
      totalAssets[0] - totalEquityAndLiab[0],
      totalAssets[1] - totalEquityAndLiab[1],
    ],
    loanFundsSplit: {
      secured: securedLoans,
      unsecured: unsecuredLoans,
    },
  };
}

/** Convenience: which Schedule III keys actually have non-zero
 *  values in either year. Useful for the Excel layout to suppress
 *  empty rows. */
export function nonEmptyKeys(report: ScheduleThreeReport): ScheduleThreeSection[] {
  const out: ScheduleThreeSection[] = [];
  for (const [k, v] of Object.entries(report.aggregate)) {
    if (!v) continue;
    if (Math.abs(v.current) > 0.01 || Math.abs(v.previous) > 0.01) {
      out.push(k as ScheduleThreeSection);
    }
  }
  return out;
}
