/**
 * Smoke tests for the TB → BS computation libs:
 *   - suggestScheduleThreeKey (canonical chart auto-suggest)
 *   - buildScheduleThreeReport (aggregation + balance tie-out)
 *   - mapScheduleThreeToCma (TB → CMA handoff key mapping)
 *
 * Run with:
 *   npx tsx scripts/smoke-test-tb-bs.ts
 */

import {
  suggestScheduleThreeKey,
  mapScheduleThreeToCma,
} from '../src/components/tb-bs/lib/scheduleThreeAccounts';
import {
  buildScheduleThreeReport,
  nonEmptyKeys,
} from '../src/components/tb-bs/lib/scheduleThreeBuilder';
import { buildScheduleThreeWorkbook } from '../src/components/tb-bs/lib/scheduleThreeExport';
import { buildIcaiNonCorporateWorkbook } from '../src/components/tb-bs/lib/icaiNonCorporateExport';
import { buildTallyVerticalWorkbook } from '../src/components/tb-bs/lib/tallyVerticalExport';
import type { TbBsDraft } from '../src/components/tb-bs/lib/uiModel';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function expect<T>(label: string, actual: T, expected: T) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else { fail++; failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

function approxEq(actual: number, expected: number, label: string, tol = 1) {
  if (Math.abs(actual - expected) <= tol) pass++;
  else { fail++; failures.push(`${label}: expected ~${expected}, got ${actual}`); }
}

// ─── suggestScheduleThreeKey ────────────────────────────────
expect('suggest sundry debtors', suggestScheduleThreeKey('Sundry Debtors'), 'bs_trade_receivables');
expect('suggest trade payables', suggestScheduleThreeKey('Trade Payables'), 'bs_trade_payables');
expect('suggest cash credit', suggestScheduleThreeKey('Cash Credit Account'), 'bs_short_term_borrowings');
expect('suggest sales', suggestScheduleThreeKey('Sales Account'), 'pl_revenue_operations');
expect('suggest depreciation', suggestScheduleThreeKey('Depreciation on Plant'), 'pl_depreciation_amort');
expect('suggest finance cost', suggestScheduleThreeKey('Interest paid on loan'), 'pl_finance_costs');
expect('suggest tangible', suggestScheduleThreeKey('Plant and Machinery'), 'bs_tangible_assets');
expect('suggest intangible', suggestScheduleThreeKey('Goodwill on consolidation'), 'bs_intangible_assets');
expect('suggest inventory', suggestScheduleThreeKey('Closing Stock'), 'bs_inventories');
expect('suggest reserves', suggestScheduleThreeKey('General Reserve'), 'bs_reserves_surplus');
expect('suggest current investment', suggestScheduleThreeKey('Mutual Fund Investments'), 'bs_current_investments');
expect('suggest deferred tax', suggestScheduleThreeKey('Deferred Tax Asset'), 'bs_deferred_tax_asset');
expect('suggest unknown', suggestScheduleThreeKey('Random Account XYZ'), null);

// ─── mapScheduleThreeToCma ──────────────────────────────────
expect('CMA: sales maps', mapScheduleThreeToCma('pl_revenue_operations'), 'pl_revenue');
expect('CMA: cost of materials maps to cogs', mapScheduleThreeToCma('pl_cost_of_materials'), 'pl_cogs');
expect('CMA: tangible + intangible + cwip all map to gross FA', mapScheduleThreeToCma('bs_tangible_assets'), 'bs_gross_fixed_assets');
expect('CMA: tangible same as intangible', mapScheduleThreeToCma('bs_intangible_assets'), 'bs_gross_fixed_assets');
expect('CMA: tangible same as cwip', mapScheduleThreeToCma('bs_capital_wip'), 'bs_gross_fixed_assets');
expect('CMA: long-term borrowings → term loan', mapScheduleThreeToCma('bs_long_term_borrowings'), 'bs_term_loan');
expect('CMA: short-term borrowings → bank borrowing short', mapScheduleThreeToCma('bs_short_term_borrowings'), 'bs_bank_borrowing_short');
expect('CMA: share capital → paid-up capital', mapScheduleThreeToCma('bs_share_capital'), 'bs_paid_up_capital');
expect('CMA: cash equivalents → cash bank', mapScheduleThreeToCma('bs_cash_equivalents'), 'bs_cash_bank');

// ─── buildScheduleThreeReport — basic aggregation ───────────
// Construct a minimal TB: 4 mapped rows, debit/credit split, no
// previous year.
{
  const draft: TbBsDraft = {
    name: 'test',
    currentTb: {
      filename: 'test.csv',
      sheetName: 'CSV',
      yearLabel: 'FY 24-25',
      accountColumn: 0,
      debitColumn: 1,
      creditColumn: 2,
      rows: [
        // Header row at index 0 (typically skipped by user; for the
        // test we include unrelated rows to confirm mapping works
        // by source index).
        ['Account', 'Debit', 'Credit'],
        ['Sales', '0', '1000000'],                  // pl_revenue_operations
        ['Cost of Materials', '600000', '0'],       // pl_cost_of_materials
        ['Sundry Debtors', '300000', '0'],          // bs_trade_receivables
        ['Trade Payables', '0', '150000'],          // bs_trade_payables
        ['Cash at Bank', '50000', '0'],             // bs_cash_equivalents
        ['Share Capital', '0', '100000'],           // bs_share_capital
        ['Reserves', '0', '100000'],                // bs_reserves_surplus
      ],
    },
    mapping: [
      { sourceRowIndex: 1, yearKey: 'current', canonicalKey: 'pl_revenue_operations' },
      { sourceRowIndex: 2, yearKey: 'current', canonicalKey: 'pl_cost_of_materials' },
      { sourceRowIndex: 3, yearKey: 'current', canonicalKey: 'bs_trade_receivables' },
      { sourceRowIndex: 4, yearKey: 'current', canonicalKey: 'bs_trade_payables' },
      { sourceRowIndex: 5, yearKey: 'current', canonicalKey: 'bs_cash_equivalents' },
      { sourceRowIndex: 6, yearKey: 'current', canonicalKey: 'bs_share_capital' },
      { sourceRowIndex: 7, yearKey: 'current', canonicalKey: 'bs_reserves_surplus' },
    ],
  };
  const report = buildScheduleThreeReport(draft);
  approxEq(report.aggregate.pl_revenue_operations?.current ?? 0, 1_000_000, 'revenue aggregated');
  approxEq(report.aggregate.pl_cost_of_materials?.current ?? 0, 600_000, 'cost of materials aggregated');
  approxEq(report.aggregate.bs_trade_receivables?.current ?? 0, 300_000, 'receivables aggregated');
  approxEq(report.aggregate.bs_trade_payables?.current ?? 0, 150_000, 'payables aggregated');
  approxEq(report.aggregate.bs_cash_equivalents?.current ?? 0, 50_000, 'cash aggregated');
  // Totals
  approxEq(report.totals.totalRevenue[0], 1_000_000, 'total revenue');
  approxEq(report.totals.shareholderFunds[0], 200_000, 'shareholders funds = capital + reserves');
  approxEq(report.totals.currentLiab[0], 150_000, 'current liab');
  approxEq(report.totals.totalEquityAndLiab[0], 350_000, 'total equity + liab');
  approxEq(report.totals.currentAssets[0], 350_000, 'current assets = receivables + cash');
  approxEq(report.totals.totalAssets[0], 350_000, 'total assets');
  approxEq(report.balanceCheck[0], 0, 'balance check ties out');
}

// ─── buildScheduleThreeReport — P&L flow ─────────────────────
{
  const draft: TbBsDraft = {
    name: 'pl-test',
    currentTb: {
      filename: 't.csv',
      sheetName: 'CSV',
      yearLabel: 'FY 24-25',
      accountColumn: 0,
      debitColumn: 1,
      creditColumn: 2,
      rows: [
        ['Account', 'Debit', 'Credit'],
        ['Sales', '0', '5000000'],
        ['Cost of Materials', '2500000', '0'],
        ['Employee Salary', '800000', '0'],
        ['Interest paid', '200000', '0'],
        ['Depreciation', '150000', '0'],
        ['Office Rent', '300000', '0'],
        ['Current Tax', '100000', '0'],
      ],
    },
    mapping: [
      { sourceRowIndex: 1, yearKey: 'current', canonicalKey: 'pl_revenue_operations' },
      { sourceRowIndex: 2, yearKey: 'current', canonicalKey: 'pl_cost_of_materials' },
      { sourceRowIndex: 3, yearKey: 'current', canonicalKey: 'pl_employee_benefits' },
      { sourceRowIndex: 4, yearKey: 'current', canonicalKey: 'pl_finance_costs' },
      { sourceRowIndex: 5, yearKey: 'current', canonicalKey: 'pl_depreciation_amort' },
      { sourceRowIndex: 6, yearKey: 'current', canonicalKey: 'pl_other_expenses' },
      { sourceRowIndex: 7, yearKey: 'current', canonicalKey: 'pl_tax_current' },
    ],
  };
  const r = buildScheduleThreeReport(draft);
  // Revenue 5M, expenses (excl tax+exceptional) = 2.5 + 0.8 + 0.2 + 0.15 + 0.3 = 3.95M
  approxEq(r.totals.profitBeforeExceptional[0], 1_050_000, 'PBT before exceptional = 5M − 3.95M');
  approxEq(r.totals.profitBeforeTax[0], 1_050_000, 'PBT (no exceptional)');
  approxEq(r.totals.totalTax[0], 100_000, 'total tax');
  approxEq(r.totals.profitForPeriod[0], 950_000, 'profit for period = PBT − tax');
}

// ─── nonEmptyKeys ───────────────────────────────────────────
{
  const draft: TbBsDraft = {
    name: 'nz-test',
    currentTb: {
      filename: 't.csv',
      sheetName: 'CSV',
      yearLabel: 'Y',
      accountColumn: 0,
      debitColumn: 1,
      creditColumn: null,
      rows: [
        ['Account', 'Debit'],
        ['Cash', '1000'],
      ],
    },
    mapping: [
      { sourceRowIndex: 1, yearKey: 'current', canonicalKey: 'bs_cash_equivalents' },
    ],
  };
  const r = buildScheduleThreeReport(draft);
  const nz = nonEmptyKeys(r);
  expect('only cash is non-empty', nz, ['bs_cash_equivalents']);
}

// ─── Previous-year alignment BY NAME (not by row index) ────
// Two TBs with the SAME accounts in DIFFERENT row order. The
// builder must look up the previous-year value by account-name
// match, not by row index. Pre-fix: this test would report
// previous-year values shifted/zero.
{
  const draft: TbBsDraft = {
    name: 'name-align-test',
    currentTb: {
      filename: 'c.csv',
      sheetName: 'CSV',
      yearLabel: 'FY 24-25',
      accountColumn: 0,
      debitColumn: 1,
      creditColumn: 2,
      rows: [
        ['Account', 'Debit', 'Credit'],
        ['Cash at Bank', '50000', '0'],
        ['Sundry Debtors', '300000', '0'],
        ['Trade Payables', '0', '150000'],
      ],
    },
    previousTb: {
      filename: 'p.csv',
      sheetName: 'CSV',
      yearLabel: 'FY 23-24',
      accountColumn: 0,
      debitColumn: 1,
      creditColumn: 2,
      // SAME accounts as current, but in REVERSED order. Index-based
      // alignment would pair Cash with Trade Payables. Name-based
      // pairs them correctly.
      rows: [
        ['Account', 'Debit', 'Credit'],
        ['Trade Payables', '0', '120000'],
        ['Sundry Debtors', '270000', '0'],
        ['Cash at Bank', '40000', '0'],
      ],
    },
    mapping: [
      { sourceRowIndex: 1, yearKey: 'current', canonicalKey: 'bs_cash_equivalents' },
      { sourceRowIndex: 2, yearKey: 'current', canonicalKey: 'bs_trade_receivables' },
      { sourceRowIndex: 3, yearKey: 'current', canonicalKey: 'bs_trade_payables' },
    ],
  };
  const r = buildScheduleThreeReport(draft);
  // Despite reversed order, name match should pull the right
  // previous-year value for each account.
  approxEq(r.aggregate.bs_cash_equivalents?.previous ?? 0, 40000, 'previous-year Cash by name');
  approxEq(r.aggregate.bs_trade_receivables?.previous ?? 0, 270000, 'previous-year Debtors by name');
  approxEq(r.aggregate.bs_trade_payables?.previous ?? 0, 120000, 'previous-year Payables by name');
}

// Name-match handles "A/c" suffix + case + extra spaces.
{
  const draft: TbBsDraft = {
    name: 'name-normalise-test',
    currentTb: {
      filename: 'c.csv',
      sheetName: 'CSV',
      yearLabel: 'FY 24-25',
      accountColumn: 0,
      debitColumn: 1,
      creditColumn: null,
      rows: [
        ['Account', 'Debit'],
        ['Plant & Machinery', '500000'],
      ],
    },
    previousTb: {
      filename: 'p.csv',
      sheetName: 'CSV',
      yearLabel: 'FY 23-24',
      accountColumn: 0,
      debitColumn: 1,
      creditColumn: null,
      // Same account, different surface text:
      //  - "PLANT & MACHINERY A/C" — caps + A/c suffix + ampersand
      rows: [
        ['Account', 'Debit'],
        ['PLANT & MACHINERY A/c', '450000'],
      ],
    },
    mapping: [
      { sourceRowIndex: 1, yearKey: 'current', canonicalKey: 'bs_tangible_assets' },
    ],
  };
  const r = buildScheduleThreeReport(draft);
  approxEq(r.aggregate.bs_tangible_assets?.previous ?? 0, 450000, 'normaliser strips A/c + collapses case');
}

// ─── Secured / Unsecured loan split ─────────────────────────
// Two long-term-borrowing rows, one flagged unsecured. The report
// must split them in loanFundsSplit while keeping the combined
// total in aggregate.bs_long_term_borrowings.
{
  const draft: TbBsDraft = {
    name: 'loan-split-test',
    currentTb: {
      filename: 't.csv',
      sheetName: 'CSV',
      yearLabel: 'Y',
      accountColumn: 0,
      debitColumn: 1,
      creditColumn: 2,
      rows: [
        ['Account', 'Debit', 'Credit'],
        ['Bank Term Loan', '0', '1000000'],
        ['Partner Loan', '0', '300000'],
      ],
    },
    mapping: [
      { sourceRowIndex: 1, yearKey: 'current', canonicalKey: 'bs_long_term_borrowings' },
      { sourceRowIndex: 2, yearKey: 'current', canonicalKey: 'bs_long_term_borrowings', isUnsecured: true },
    ],
  };
  const r = buildScheduleThreeReport(draft);
  approxEq(r.aggregate.bs_long_term_borrowings?.current ?? 0, 1300000, 'combined LT borrowings');
  approxEq(r.loanFundsSplit.secured[0], 1000000, 'secured LT borrowings');
  approxEq(r.loanFundsSplit.unsecured[0], 300000, 'unsecured LT borrowings');
  expect(
    'secured + unsecured = combined',
    Math.abs((r.loanFundsSplit.secured[0] + r.loanFundsSplit.unsecured[0]) - (r.aggregate.bs_long_term_borrowings?.current ?? 0)) < 1,
    true,
  );
}

// Default (no flag) → all secured, zero unsecured.
{
  const draft: TbBsDraft = {
    name: 'loan-default-test',
    currentTb: {
      filename: 't.csv',
      sheetName: 'CSV',
      yearLabel: 'Y',
      accountColumn: 0,
      debitColumn: 1,
      creditColumn: 2,
      rows: [
        ['Account', 'Debit', 'Credit'],
        ['Bank Term Loan', '0', '500000'],
      ],
    },
    mapping: [
      { sourceRowIndex: 1, yearKey: 'current', canonicalKey: 'bs_long_term_borrowings' },
    ],
  };
  const r = buildScheduleThreeReport(draft);
  approxEq(r.loanFundsSplit.secured[0], 500000, 'default = all secured');
  approxEq(r.loanFundsSplit.unsecured[0], 0, 'default = zero unsecured');
}

// ─── Excel exporters — builds without throwing ──────────────
// We can't introspect xlsx contents in a smoke test without
// pulling in ExcelJS read-back, but we CAN assert that each builder
// produces a non-empty Blob given a valid report. Catches any
// formula syntax errors, missing imports, or cell-reference bugs.
{
  const draft: TbBsDraft = {
    name: 'export-smoke',
    firm: { firmName: 'Acme Industries Pvt Ltd' },
    currentTb: {
      filename: 't.csv',
      sheetName: 'CSV',
      yearLabel: 'FY 24-25',
      accountColumn: 0,
      debitColumn: 1,
      creditColumn: 2,
      rows: [
        ['Account', 'Debit', 'Credit'],
        ['Sales', '0', '5000000'],
        ['Cost of Materials', '2500000', '0'],
        ['Employee Salary', '800000', '0'],
        ['Interest paid', '200000', '0'],
        ['Depreciation', '150000', '0'],
        ['Office Rent', '300000', '0'],
        ['Current Tax', '100000', '0'],
        ['Sundry Debtors', '600000', '0'],
        ['Trade Payables', '0', '350000'],
        ['Cash at Bank', '120000', '0'],
        ['Share Capital', '0', '500000'],
        ['Reserves', '0', '770000'],
        ['Plant and Machinery', '900000', '0'],
        ['Long Term Borrowings', '0', '500000'],
      ],
    },
    mapping: [
      { sourceRowIndex: 1, yearKey: 'current', canonicalKey: 'pl_revenue_operations' },
      { sourceRowIndex: 2, yearKey: 'current', canonicalKey: 'pl_cost_of_materials' },
      { sourceRowIndex: 3, yearKey: 'current', canonicalKey: 'pl_employee_benefits' },
      { sourceRowIndex: 4, yearKey: 'current', canonicalKey: 'pl_finance_costs' },
      { sourceRowIndex: 5, yearKey: 'current', canonicalKey: 'pl_depreciation_amort' },
      { sourceRowIndex: 6, yearKey: 'current', canonicalKey: 'pl_other_expenses' },
      { sourceRowIndex: 7, yearKey: 'current', canonicalKey: 'pl_tax_current' },
      { sourceRowIndex: 8, yearKey: 'current', canonicalKey: 'bs_trade_receivables' },
      { sourceRowIndex: 9, yearKey: 'current', canonicalKey: 'bs_trade_payables' },
      { sourceRowIndex: 10, yearKey: 'current', canonicalKey: 'bs_cash_equivalents' },
      { sourceRowIndex: 11, yearKey: 'current', canonicalKey: 'bs_share_capital' },
      { sourceRowIndex: 12, yearKey: 'current', canonicalKey: 'bs_reserves_surplus' },
      { sourceRowIndex: 13, yearKey: 'current', canonicalKey: 'bs_tangible_assets' },
      { sourceRowIndex: 14, yearKey: 'current', canonicalKey: 'bs_long_term_borrowings' },
    ],
  };
  const report = buildScheduleThreeReport(draft);

  for (const [label, builder] of ([
    ['Schedule III', buildScheduleThreeWorkbook],
    ['ICAI Non-Corporate', buildIcaiNonCorporateWorkbook],
    ['Tally vertical', buildTallyVerticalWorkbook],
  ] as const)) {
    try {
      const blob = await builder({ draft, report });
      expect(`${label} builder produces a non-empty Blob`, blob.size > 1000, true);
    } catch (err) {
      fail++;
      failures.push(`${label} builder threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
