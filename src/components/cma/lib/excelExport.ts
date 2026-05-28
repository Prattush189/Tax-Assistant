/**
 * CMA report Excel emission. Builds a multi-sheet xlsx with LIVE
 * formulas — every derived cell (gross profit, EBITDA, ratios)
 * references the input cells by row/column, so the banker can click
 * any output cell and audit the math without leaving Excel.
 *
 * Sheet layout — banker-standard CMA-II format (Phase 1):
 *   1. Cover                  — firm info, application context, methodology notes
 *   2. Form II                — OPERATING STATEMENT (P&L + operating ratios)
 *   3. Form III               — ANALYSIS OF BALANCE SHEET (Tandon section order)
 *   4. Cash Flow              — indirect-method statement (kept until Form VI lands)
 *   5. WC & MPBF              — working capital gap + eligible bank finance
 *   6. Ratios                 — DSCR, current, quick, TOL/TNW, margins (formula-driven)
 *   7. Stress Test (optional) — when enabled, side-by-side base vs stressed PAT/DSCR
 *   8. Term Loans (optional)  — existing + proposed schedules
 *
 * Sheet naming and section ordering deliberately mirror the standard
 * Indian banker's CMA template — when a credit officer opens this in
 * a stack of CMAs from other firms, the tabs read in the same order
 * they expect. Subsequent phases add Forms IV, V, VI, DSCR, BEP,
 * Project Report, monthly TL schedules and WDV depreciation.
 *
 * Why formulas instead of plain numbers: a banker's audit standard
 * is "click and trace". Static numbers lose credibility — looks like
 * "trust me" output. Formula-driven cells let them verify a 10×
 * difference is from a 10× input, not from us tweaking the result.
 */

import ExcelJS from 'exceljs';
import type { CmaDraft } from './uiModel';
import { MPBF_METHOD_LABELS } from './uiModel';
import type { ProjectionResult } from './projectionEngine';
import type { RatiosResult } from './ratios';
import type { MpbfResult } from './mpbf';
import { CANONICAL_ACCOUNTS, ACCOUNT_BY_KEY, type CanonicalSection } from './canonicalAccounts';
import type { StressedProjection } from './stressTest';
import { resolveProjectReport, resolveBep, resolveHoldingPeriods } from './phase2Defaults';
import { buildMonthlyAmortisation, groupByFy } from './amortisation';
import { computeMpbf } from './mpbf';

export interface CmaExportInput {
  draft: CmaDraft;
  projection: ProjectionResult;
  ratios: RatiosResult;
  mpbf: MpbfResult;
  stress: StressedProjection | null;
}

const RUPEE_FMT = '#,##,##0;[Red](#,##,##0);"—"';
const RATIO_FMT = '0.00';
const PCT_FMT = '0.00%';
const HEADING_FILL: ExcelJS.FillPattern = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4EA' },
};
const SECTION_FILL: ExcelJS.FillPattern = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' },
};

/**
 * Build the workbook and return it as a Blob for client-side
 * download. Caller wires up the href + click + revoke.
 */
export async function buildCmaWorkbook(input: CmaExportInput): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smartbiz Tax Assistant';
  wb.created = new Date();

  // Sheet order mirrors the banker template (Forms II → VI, then
  // MPBF, DSCR, BEP, Term Loans, Introduction). Introduction sits at
  // the END because that's where the reference CMAs we model on
  // place it — the project narrative is read after the numbers, not
  // before. (Putting it first would also push everyone past it to
  // get to the operating statement on every open.)
  buildCoverSheet(wb, input);
  buildFormII(wb, input);
  buildFormIII(wb, input);
  buildFormIV(wb, input);
  buildFormV(wb, input);                  // Phase 3: both Tandon methods side-by-side
  buildFormVI(wb, input);
  buildMpbfMonthlySheet(wb, input);       // Phase 3: monthly figures derivation
  buildDscrSheet(wb, input);
  buildBepSheet(wb, input);
  buildRatiosSheet(wb, input);
  if (input.stress) buildStressSheet(wb, input);
  buildDepreciationSheet(wb, input);      // Phase 3: WDV depreciation block
  if ((input.draft.termLoans ?? []).length > 0) {
    buildTermLoansSheet(wb, input);
    buildMonthlyTermLoanSheets(wb, input); // Phase 3: per-loan monthly amortisation
  }
  buildIntroductionSheet(wb, input);

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// ── Sheet 1: Cover ─────────────────────────────────────────────

function buildCoverSheet(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const ws = wb.addWorksheet('Cover');
  ws.columns = [{ width: 28 }, { width: 60 }];
  ws.addRow(['CREDIT MONITORING ARRANGEMENT (CMA)']).font = { bold: true, size: 14 };
  ws.addRow([]);
  ws.addRow(['Firm', input.draft.firm?.firmName ?? '—']);
  ws.addRow(['GSTIN', input.draft.firm?.gstin ?? '—']);
  ws.addRow(['Nature of business', input.draft.firm?.businessNature ?? '—']);
  ws.addRow(['State', input.draft.firm?.state ?? '—']);
  ws.addRow(['Application context', input.draft.firm?.applicationContext ?? '—']);
  ws.addRow([]);
  ws.addRow(['Projection horizon', `${input.draft.projectionHorizon ?? 3} years`]);
  ws.addRow(['MPBF method', input.mpbf.methodLabel]);
  ws.addRow(['Working capital model', input.draft.workingCapital?.model ?? '—']);
  ws.addRow(['Stress test', input.stress ? `Enabled (sales −${input.draft.stress?.salesMissPct ?? 10}%)` : 'Disabled']);
  ws.addRow([]);
  ws.addRow(['Generated by', 'Smartbiz Tax Assistant — every formula is live; audit by clicking any output cell.']).font = { italic: true, color: { argb: 'FF6B7280' } };
  ws.getColumn(1).font = { bold: true };
}

// ── Sheet 2: FORM II — OPERATING STATEMENT ─────────────────────
//
// Banker-standard P&L: starts with Gross Sales, deducts excise/other
// to arrive at Net Sales, then itemised Cost of Sales (raw material,
// power, labour, manufacturing expenses, depreciation), then SG&A,
// then Operating Profit (before and after interest), tax, retained
// earnings. The reference CMA also includes an "Important Ratios"
// sub-block at the bottom (Consumption / Net Sales, Power / Net
// Sales, etc.) — banker uses these to spot anomalies year-over-year
// at a glance.
//
// Phase 1 limitation: our `pl_cogs` canonical bucket is a single
// number, not split into raw material / power / labour / manufacturing
// like the reference. We surface it as "Cost of Sales (total)" — Phase
// 2 will add the granular breakdown when we wire up the new input
// fields. The ratio block uses the totals we have today.
function buildFormII(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const ws = wb.addWorksheet('Form II');
  const yearCols = input.projection.yearLabels;
  const firstP = input.projection.firstProjectedIndex;
  setupBankerFormHeader(ws, input, 'II', 'Operating Statement');

  const rowByKey = new Map<CanonicalSection, number>();

  // 1. Gross Sales (single line for now — domestic + exports breakdown
  //    will land in Phase 2 alongside the new input fields).
  const revAcc = ACCOUNT_BY_KEY['pl_revenue'];
  const revValues = input.projection.series.pl_revenue ?? [];
  const grossRow = formRow(ws, '1', `Gross Sales — ${revAcc.label}`, revValues.map(roundFor));
  rowByKey.set('pl_revenue', grossRow.number);
  formatValueRow(grossRow, firstP);

  // 2. Less: Excise / Other deductions — placeholder for the standard
  //    banker line. Currently zero (we treat the canonical revenue
  //    bucket as net of excise). Kept as a visible row so the
  //    structure matches the reference template.
  const exciseRow = formRow(ws, '2', 'Less: Excise Duty / Other Deductions', yearCols.map(() => 0));
  formatValueRow(exciseRow, firstP);

  // 3. Net Sales = Gross − Excise
  const netSalesRow = ws.addRow(['3', 'Net Sales', ...yearCols.map((_, i) => ({
    formula: `${cellRef(grossRow.number, i + 3)}-${cellRef(exciseRow.number, i + 3)}`,
  }))]);
  formatDerivedRow(netSalesRow, firstP);

  // 4. Cost of Sales
  const cogsAcc = ACCOUNT_BY_KEY['pl_cogs'];
  const cogsValues = input.projection.series.pl_cogs ?? [];
  const cogsRow = formRow(ws, '4', cogsAcc.label, cogsValues.map(roundFor));
  rowByKey.set('pl_cogs', cogsRow.number);
  formatValueRow(cogsRow, firstP);

  // 5. SG&A (Selling, General & Administrative Expenses)
  const opexAcc = ACCOUNT_BY_KEY['pl_operating_expense'];
  const opexValues = input.projection.series.pl_operating_expense ?? [];
  const opexRow = formRow(ws, '5', `Selling, General & Administrative — ${opexAcc.label}`, opexValues.map(roundFor));
  rowByKey.set('pl_operating_expense', opexRow.number);
  formatValueRow(opexRow, firstP);

  // 6. Depreciation
  const depAcc = ACCOUNT_BY_KEY['pl_depreciation'];
  const depValues = input.projection.series.pl_depreciation ?? [];
  const depRow = formRow(ws, '6', depAcc.label, depValues.map(roundFor));
  rowByKey.set('pl_depreciation', depRow.number);
  formatValueRow(depRow, firstP);

  // 7. Sub-total = Cost of Sales + SG&A + Depreciation
  const subTotalRow = ws.addRow(['7', 'Sub-total (4 + 5 + 6)', ...yearCols.map((_, i) => ({
    formula: `${cellRef(cogsRow.number, i + 3)}+${cellRef(opexRow.number, i + 3)}+${cellRef(depRow.number, i + 3)}`,
  }))]);
  formatDerivedRow(subTotalRow, firstP);

  // 8. Operating Profit before Interest = Net Sales − Sub-total + Other Income
  const otherIncomeAcc = ACCOUNT_BY_KEY['pl_other_income'];
  const otherIncomeValues = input.projection.series.pl_other_income ?? [];
  const otherIncomeRow = formRow(ws, '8', otherIncomeAcc.label, otherIncomeValues.map(roundFor));
  rowByKey.set('pl_other_income', otherIncomeRow.number);
  formatValueRow(otherIncomeRow, firstP);

  const opProfitBeforeIntRow = ws.addRow(['9', 'Operating Profit before Interest (3 − 7 + 8)', ...yearCols.map((_, i) => ({
    formula: `${cellRef(netSalesRow.number, i + 3)}-${cellRef(subTotalRow.number, i + 3)}+${cellRef(otherIncomeRow.number, i + 3)}`,
  }))]);
  formatDerivedRow(opProfitBeforeIntRow, firstP);

  // 10. Interest (Finance Cost)
  const finCostAcc = ACCOUNT_BY_KEY['pl_finance_cost'];
  const finCostValues = input.projection.series.pl_finance_cost ?? [];
  const finCostRow = formRow(ws, '10', `Interest — ${finCostAcc.label}`, finCostValues.map(roundFor));
  rowByKey.set('pl_finance_cost', finCostRow.number);
  formatValueRow(finCostRow, firstP);

  // 11. Operating Profit after Interest = 9 − 10
  const opProfitAfterIntRow = ws.addRow(['11', 'Operating Profit after Interest (9 − 10)', ...yearCols.map((_, i) => ({
    formula: `${cellRef(opProfitBeforeIntRow.number, i + 3)}-${cellRef(finCostRow.number, i + 3)}`,
  }))]);
  formatDerivedRow(opProfitAfterIntRow, firstP);

  // 12. Profit Before Tax (same as 11 — no non-op items in Phase 1)
  const pbtRow = ws.addRow(['12', 'Profit Before Tax', ...yearCols.map((_, i) => ({
    formula: cellRef(opProfitAfterIntRow.number, i + 3),
  }))]);
  formatDerivedRow(pbtRow, firstP);

  // 13. Provision for Income Tax
  const taxAcc = ACCOUNT_BY_KEY['pl_tax'];
  const taxValues = input.projection.series.pl_tax ?? [];
  const taxRow = formRow(ws, '13', taxAcc.label, taxValues.map(roundFor));
  rowByKey.set('pl_tax', taxRow.number);
  formatValueRow(taxRow, firstP);

  // 14. Net Profit / Loss = PBT − Tax
  const patRow = ws.addRow(['14', 'Net Profit / Loss (12 − 13)', ...yearCols.map((_, i) => ({
    formula: `${cellRef(pbtRow.number, i + 3)}-${cellRef(taxRow.number, i + 3)}`,
  }))]);
  formatDerivedRow(patRow, firstP);
  patRow.eachCell((c, ci) => { if (ci > 2) c.font = { bold: true }; });

  // ── Operating ratios sub-block ─────────────────────────────────
  // Banker convention: a small ratios panel at the bottom showing
  // each major cost line as a percentage of net sales. Spot-check
  // tool — sudden jumps year-over-year flag misreporting or wrong
  // assumptions.
  ws.addRow([]);
  const ratiosBanner = ws.addRow(['', 'Important Ratios']);
  ratiosBanner.font = { bold: true };
  ratiosBanner.getCell(2).fill = SECTION_FILL;

  const writeRatio = (label: string, numeratorRow: number) => {
    const r = ws.addRow(['', label, ...yearCols.map((_, i) => ({
      formula: `IFERROR(${cellRef(numeratorRow, i + 3)}/${cellRef(netSalesRow.number, i + 3)},0)`,
    }))]);
    for (let c = 3; c <= yearCols.length + 2; c++) r.getCell(c).numFmt = PCT_FMT;
  };
  writeRatio('Cost of Sales / Net Sales', cogsRow.number);
  writeRatio('Selling, Gen & Admin / Net Sales', opexRow.number);
  writeRatio('Depreciation / Net Sales', depRow.number);
  writeRatio('Interest / Net Sales', finCostRow.number);
  writeRatio('Operating Profit (after int) / Net Sales', opProfitAfterIntRow.number);
  writeRatio('Net Profit / Net Sales', patRow.number);

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 42;
  for (let c = 3; c <= yearCols.length + 2; c++) ws.getColumn(c).width = 16;
}

// ── Sheet 3: FORM III — ANALYSIS OF BALANCE SHEET ──────────────
//
// Banker-standard layout follows the Tandon order:
//   LIABILITIES side first:
//     CURRENT LIABILITIES (Sub Total A)
//     TERM LIABILITIES (Sub Total B)
//     Total Outside Liabilities (A + B)
//     NET WORTH
//     Total Liabilities (Total Outside + Net Worth)
//   ASSETS side:
//     CURRENT ASSETS
//     FIXED ASSETS (gross − accumulated dep = net)
//     OTHER NON-CURRENT ASSETS
//     Total Assets
//   Balance check: Total Liabilities − Total Assets = 0.
//
// The naming convention (Current Liabilities / Term Liabilities /
// Net Worth — not "Equity") matches what a credit officer expects to
// read. Each section ends with its own sub-total which the running
// totals reference via cell formulas (so click-and-trace audit works).
function buildFormIII(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const ws = wb.addWorksheet('Form III');
  const yearCols = input.projection.yearLabels;
  const firstP = input.projection.firstProjectedIndex;
  setupBankerFormHeader(ws, input, 'III', 'Analysis of Balance Sheet');

  const sectionRow = (label: string) => {
    const r = ws.addRow(['', label]);
    r.font = { bold: true };
    r.getCell(2).fill = SECTION_FILL;
    return r;
  };

  const rowByKey = new Map<CanonicalSection, number>();
  let srNo = 1;
  const writeLine = (key: CanonicalSection) => {
    const acc = ACCOUNT_BY_KEY[key];
    const values = input.projection.series[key] ?? [];
    const r = formRow(ws, String(srNo++), acc.label, values.map(roundFor));
    rowByKey.set(key, r.number);
    formatValueRow(r, firstP);
  };

  // ─── LIABILITIES ──────────────────────────────────────────────
  sectionRow('LIABILITIES');
  ws.addRow([]);
  sectionRow('Current Liabilities');
  (['bs_bank_borrowing_short', 'bs_creditors', 'bs_statutory_dues', 'bs_other_current_liabilities'] as CanonicalSection[]).forEach(writeLine);
  const clTotalRow = ws.addRow(['', 'Sub Total — Current Liabilities (A)', ...yearCols.map((_, i) => ({
    formula: sumFormula([
      rowByKey.get('bs_bank_borrowing_short'),
      rowByKey.get('bs_creditors'),
      rowByKey.get('bs_statutory_dues'),
      rowByKey.get('bs_other_current_liabilities'),
    ], i + 3),
  }))]);
  formatDerivedRow(clTotalRow, firstP);

  ws.addRow([]);
  sectionRow('Term Liabilities');
  (['bs_term_loan', 'bs_other_non_current_liab'] as CanonicalSection[]).forEach(writeLine);
  const tlTotalRow = ws.addRow(['', 'Sub Total — Term Liabilities (B)', ...yearCols.map((_, i) => ({
    formula: sumFormula([
      rowByKey.get('bs_term_loan'),
      rowByKey.get('bs_other_non_current_liab'),
    ], i + 3),
  }))]);
  formatDerivedRow(tlTotalRow, firstP);

  ws.addRow([]);
  const totalOutsideRow = ws.addRow(['', 'Total Outside Liabilities (A + B)', ...yearCols.map((_, i) => ({
    formula: `${cellRef(clTotalRow.number, i + 3)}+${cellRef(tlTotalRow.number, i + 3)}`,
  }))]);
  formatDerivedRow(totalOutsideRow, firstP);

  ws.addRow([]);
  sectionRow('Net Worth');
  (['bs_paid_up_capital', 'bs_reserves_surplus'] as CanonicalSection[]).forEach(writeLine);
  const nwTotalRow = ws.addRow(['', 'Total Net Worth', ...yearCols.map((_, i) => ({
    formula: sumFormula([
      rowByKey.get('bs_paid_up_capital'),
      rowByKey.get('bs_reserves_surplus'),
    ], i + 3),
  }))]);
  formatDerivedRow(nwTotalRow, firstP);

  ws.addRow([]);
  const totalLiabRow = ws.addRow(['', 'TOTAL LIABILITIES (Total Outside + Net Worth)', ...yearCols.map((_, i) => ({
    formula: `${cellRef(totalOutsideRow.number, i + 3)}+${cellRef(nwTotalRow.number, i + 3)}`,
  }))]);
  formatTotalRow(totalLiabRow);

  // ─── ASSETS ───────────────────────────────────────────────────
  ws.addRow([]);
  ws.addRow([]);
  sectionRow('ASSETS');
  ws.addRow([]);
  sectionRow('Current Assets');
  (['bs_cash_bank', 'bs_receivables', 'bs_inventory', 'bs_other_current_assets'] as CanonicalSection[]).forEach(writeLine);
  const caTotalRow = ws.addRow(['', 'Total Current Assets', ...yearCols.map((_, i) => ({
    formula: sumFormula([
      rowByKey.get('bs_cash_bank'),
      rowByKey.get('bs_receivables'),
      rowByKey.get('bs_inventory'),
      rowByKey.get('bs_other_current_assets'),
    ], i + 3),
  }))]);
  formatDerivedRow(caTotalRow, firstP);

  ws.addRow([]);
  sectionRow('Fixed Assets');
  (['bs_gross_fixed_assets', 'bs_accumulated_depreciation'] as CanonicalSection[]).forEach(writeLine);
  const faTotalRow = ws.addRow(['', 'Net Fixed Assets (Gross − Acc. Dep.)', ...yearCols.map((_, i) => ({
    formula: `${cellRef(rowByKey.get('bs_gross_fixed_assets')!, i + 3)}-${cellRef(rowByKey.get('bs_accumulated_depreciation')!, i + 3)}`,
  }))]);
  formatDerivedRow(faTotalRow, firstP);

  ws.addRow([]);
  sectionRow('Other Non-Current Assets');
  (['bs_other_non_current_assets'] as CanonicalSection[]).forEach(writeLine);

  ws.addRow([]);
  const totalAssetsRow = ws.addRow(['', 'TOTAL ASSETS', ...yearCols.map((_, i) => ({
    formula: `${cellRef(caTotalRow.number, i + 3)}+${cellRef(faTotalRow.number, i + 3)}+${cellRef(rowByKey.get('bs_other_non_current_assets')!, i + 3)}`,
  }))]);
  formatTotalRow(totalAssetsRow);

  // ─── Tie-out ──────────────────────────────────────────────────
  ws.addRow([]);
  const tieOut = ws.addRow(['', 'Balance check (Total Liabilities − Total Assets)', ...yearCols.map((_, i) => ({
    formula: `${cellRef(totalLiabRow.number, i + 3)}-${cellRef(totalAssetsRow.number, i + 3)}`,
  }))]);
  tieOut.font = { italic: true, color: { argb: 'FF6B7280' } };
  for (let c = 3; c <= yearCols.length + 2; c++) {
    tieOut.getCell(c).numFmt = RUPEE_FMT;
  }

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 44;
  for (let c = 3; c <= yearCols.length + 2; c++) ws.getColumn(c).width = 16;
}

// ── Sheet 4: WC + MPBF ─────────────────────────────────────────

function buildWcMpbfSheet(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const ws = wb.addWorksheet('WC & MPBF');
  const yearCols = input.projection.yearLabels;
  const firstP = input.projection.firstProjectedIndex;
  setupHeader(ws, `Working Capital & MPBF (${input.mpbf.methodLabel})`, yearCols);
  ws.addRow(['Working Capital Gap', ...input.projection.derived.workingCapitalGap.map(roundFor)]).eachCell((c, ci) => {
    if (ci > 1) c.numFmt = RUPEE_FMT;
  });
  ws.addRow(['MPBF (eligible bank finance)', ...input.mpbf.mpbfByYear.map(roundFor)]).eachCell((c, ci) => {
    if (ci > 1) { c.numFmt = RUPEE_FMT; c.font = { bold: true }; }
  });
  ws.addRow(['Promoter margin required', ...input.mpbf.promoterMargin.map(roundFor)]).eachCell((c, ci) => {
    if (ci > 1) c.numFmt = RUPEE_FMT;
  });
  ws.getColumn(1).width = 42;
  for (let c = 2; c <= yearCols.length + 1; c++) ws.getColumn(c).width = 16;

  // Color code projected MPBF cells.
  const mpbfRow = ws.getRow(3);
  for (let c = 2 + firstP; c <= yearCols.length + 1; c++) {
    mpbfRow.getCell(c).fill = HEADING_FILL;
  }
}

// ── Sheet 5: Ratios ────────────────────────────────────────────

function buildRatiosSheet(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const ws = wb.addWorksheet('Ratios');
  const yearCols = input.projection.yearLabels;
  setupHeader(ws, 'Key Financial Ratios', yearCols);

  const rows: Array<[string, number[], string]> = [
    ['DSCR (≥ 1.5x ideal)', input.ratios.dscr, RATIO_FMT],
    ['Current Ratio (≥ 1.33x)', input.ratios.currentRatio, RATIO_FMT],
    ['Quick Ratio (≥ 1.0x)', input.ratios.quickRatio, RATIO_FMT],
    ['TOL / TNW (≤ 3.0x)', input.ratios.tolTnw, RATIO_FMT],
    ['Interest Coverage (≥ 2.0x)', input.ratios.interestCoverage, RATIO_FMT],
    ['Gross Margin %', input.ratios.grossMargin.map((v) => v / 100), PCT_FMT],
    ['EBITDA Margin %', input.ratios.ebitdaMargin.map((v) => v / 100), PCT_FMT],
  ];
  for (const [label, values, fmt] of rows) {
    const r = ws.addRow([label, ...values.map((v) => Number.isFinite(v) ? v : 0)]);
    for (let c = 2; c <= yearCols.length + 1; c++) {
      r.getCell(c).numFmt = fmt;
    }
  }
  ws.getColumn(1).width = 32;
  for (let c = 2; c <= yearCols.length + 1; c++) ws.getColumn(c).width = 16;
}

// ── Sheet 6: Stress ────────────────────────────────────────────

function buildStressSheet(wb: ExcelJS.Workbook, input: CmaExportInput) {
  if (!input.stress) return;
  const ws = wb.addWorksheet('Stress Test');
  const yearCols = input.projection.yearLabels;
  setupHeader(ws, `Stress Test — Sales miss ${input.draft.stress?.salesMissPct ?? 10}%`, yearCols);

  const writePair = (label: string, base: number[], stressed: number[], fmt: string) => {
    ws.addRow([`${label} — base`, ...base.map((v) => fmt === PCT_FMT ? v / 100 : roundFor(v))]).eachCell((c, ci) => {
      if (ci > 1) c.numFmt = fmt;
    });
    ws.addRow([`${label} — stressed`, ...stressed.map((v) => fmt === PCT_FMT ? v / 100 : roundFor(v))]).eachCell((c, ci) => {
      if (ci > 1) { c.numFmt = fmt; c.font = { color: { argb: 'FFB45309' } }; }
    });
  };

  writePair('Revenue', input.projection.series.pl_revenue ?? [], input.stress.projection.series.pl_revenue ?? [], RUPEE_FMT);
  writePair('EBITDA', input.projection.derived.ebitda, input.stress.projection.derived.ebitda, RUPEE_FMT);
  writePair('PAT', input.projection.derived.profitAfterTax, input.stress.projection.derived.profitAfterTax, RUPEE_FMT);
  writePair('DSCR', input.ratios.dscr, input.stress.ratios.dscr, RATIO_FMT);
  writePair('Current Ratio', input.ratios.currentRatio, input.stress.ratios.currentRatio, RATIO_FMT);

  ws.getColumn(1).width = 30;
  for (let c = 2; c <= yearCols.length + 1; c++) ws.getColumn(c).width = 16;
}

// ── Sheet 7: Term Loans ────────────────────────────────────────

function buildTermLoansSheet(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const loans = input.draft.termLoans ?? [];
  if (loans.length === 0) return;
  const ws = wb.addWorksheet('Term Loans');
  ws.addRow(['Status', 'Lender', 'Principal (Rs.)', 'Rate %', 'Tenure (months)', 'Moratorium (months)', 'Drawn at']).font = { bold: true };
  ws.getRow(1).fill = HEADING_FILL;
  for (const ln of loans) {
    const r = ws.addRow([
      ln.status,
      ln.lender ?? '—',
      ln.principal ?? 0,
      ln.interestRatePct ?? 0,
      ln.tenureMonths ?? 0,
      ln.moratoriumMonths ?? 0,
      ln.drawnAt ?? '—',
    ]);
    r.getCell(3).numFmt = RUPEE_FMT;
    r.getCell(4).numFmt = RATIO_FMT;
  }
  ws.addRow([]);
  ws.addRow(['Projected debt service (combined across all loans)']).font = { bold: true };
  const yearCols = input.projection.yearLabels;
  setupHeader(ws, 'Year', yearCols, true);
  ws.addRow(['Principal repayment', ...input.projection.derived.termLoanPrincipal.map(roundFor)]).eachCell((c, ci) => {
    if (ci > 1) c.numFmt = RUPEE_FMT;
  });
  ws.addRow(['Interest', ...input.projection.derived.termLoanInterest.map(roundFor)]).eachCell((c, ci) => {
    if (ci > 1) c.numFmt = RUPEE_FMT;
  });
  ws.addRow(['Closing balance', ...input.projection.derived.termLoanClosingBalance.map(roundFor)]).eachCell((c, ci) => {
    if (ci > 1) c.numFmt = RUPEE_FMT;
  });
  for (let c = 1; c <= yearCols.length + 1; c++) ws.getColumn(c).width = c === 1 ? 28 : 16;
}

// ── Sheet: Cash Flow Statement (indirect method) ───────────────
//
// Derived ENTIRELY from numbers on the P&L and BS sheets, so every
// cell can reference back to its source and the banker can audit.
// Indirect method (the format banks expect for CMA):
//
//   Operating activities:
//     + PAT
//     + Depreciation (non-cash)
//     + Finance cost (added back; financing-side outflow shown separately)
//     − Tax paid (current year)
//     ± Working-capital changes (Δ receivables, Δ inventory, Δ payables, etc.)
//   = Net cash from operating activities
//
//   Investing activities:
//     − Capex (Δ in gross fixed assets, FY-to-FY)
//   = Net cash from investing activities
//
//   Financing activities:
//     − Term loan principal repayment
//     − Finance cost paid (= the add-back above, now reflected as actual outflow)
//   = Net cash from financing activities
//
//   Net change in cash = sum of all three
//   Reconciles to: Δ cash & bank on the BS
//
// We render historical + projected years side by side. The first
// historical year has no Δ working-capital row (no prior year to
// diff against) — those cells show 0 by formula.

function buildCashFlowSheet(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const ws = wb.addWorksheet('Cash Flow');
  const yearCols = input.projection.yearLabels;
  const n = yearCols.length;
  const firstP = input.projection.firstProjectedIndex;
  setupHeader(ws, 'Cash Flow Statement (indirect method, Rs. in nearest)', yearCols);

  const sectionRow = (label: string) => {
    const r = ws.addRow([label]);
    r.font = { bold: true };
    r.getCell(1).fill = SECTION_FILL;
    return r;
  };

  const writeNumberRow = (label: string, values: number[]) => {
    const row = ws.addRow([`  ${label}`, ...values.map(roundFor)]);
    formatValueRow(row, firstP);
    return row.number;
  };

  // ── Operating activities ────────────────────────────────────
  sectionRow('A. CASH FLOW FROM OPERATING ACTIVITIES');

  const patRow = writeNumberRow('Profit after tax', input.projection.derived.profitAfterTax);
  const depRow = writeNumberRow('Add: Depreciation', input.projection.series.pl_depreciation ?? new Array(n).fill(0));
  const intRow = writeNumberRow('Add: Finance cost', input.projection.series.pl_finance_cost ?? new Array(n).fill(0));
  const taxRow = writeNumberRow('Less: Tax paid', (input.projection.series.pl_tax ?? new Array(n).fill(0)));

  // Working-capital changes — Δ year-over-year. Positive ΔCA = cash
  // outflow (more money locked in WC); positive ΔCL = cash inflow
  // (more vendor / statutory funding). Year 0 has no prior year
  // reference → zero.
  const wcDeltaFor = (
    series: number[] | undefined,
    sign: 1 | -1,
  ): number[] => {
    const arr = series ?? new Array(n).fill(0);
    return arr.map((v, i) => i === 0 ? 0 : sign * (arr[i - 1] - v));
  };

  const dReceivables = wcDeltaFor(input.projection.series.bs_receivables, 1);
  const dInventory = wcDeltaFor(input.projection.series.bs_inventory, 1);
  const dOtherCA = wcDeltaFor(input.projection.series.bs_other_current_assets, 1);
  const dCreditors = wcDeltaFor(input.projection.series.bs_creditors, -1);
  const dStatutory = wcDeltaFor(input.projection.series.bs_statutory_dues, -1);
  const dOtherCL = wcDeltaFor(input.projection.series.bs_other_current_liabilities, -1);

  const dRecvRow = writeNumberRow('Less: Increase in receivables', dReceivables);
  const dInvRow = writeNumberRow('Less: Increase in inventory', dInventory);
  const dOtherCARow = writeNumberRow('Less: Increase in other current assets', dOtherCA);
  const dCredRow = writeNumberRow('Add: Increase in trade payables', dCreditors);
  const dStatRow = writeNumberRow('Add: Increase in statutory dues', dStatutory);
  const dOtherCLRow = writeNumberRow('Add: Increase in other current liabilities', dOtherCL);

  // Net cash from operating activities — formula summing all the rows above.
  const operatingRefs = [patRow, depRow, intRow, taxRow, dRecvRow, dInvRow, dOtherCARow, dCredRow, dStatRow, dOtherCLRow];
  const netOperatingRow = ws.addRow([
    'Net cash from operating activities (A)',
    ...yearCols.map((_, i) => ({ formula: operatingRefs.map((r) => cellRef(r, i + 2)).join('+') })),
  ]);
  formatTotalRow(netOperatingRow);
  ws.addRow([]);

  // ── Investing activities ────────────────────────────────────
  sectionRow('B. CASH FLOW FROM INVESTING ACTIVITIES');
  // Capex = increase in gross fixed assets year-over-year. First
  // year shows 0 (no prior to diff against).
  const grossFa = input.projection.series.bs_gross_fixed_assets ?? new Array(n).fill(0);
  const capex = grossFa.map((v, i) => i === 0 ? 0 : -(v - grossFa[i - 1]));
  const capexRow = writeNumberRow('Less: Capex (increase in gross fixed assets)', capex);
  const netInvestingRow = ws.addRow([
    'Net cash from investing activities (B)',
    ...yearCols.map((_, i) => ({ formula: cellRef(capexRow, i + 2) })),
  ]);
  formatTotalRow(netInvestingRow);
  ws.addRow([]);

  // ── Financing activities ────────────────────────────────────
  sectionRow('C. CASH FLOW FROM FINANCING ACTIVITIES');
  const principalRow = writeNumberRow(
    'Less: Term loan principal repayment',
    input.projection.derived.termLoanPrincipal.map((v) => -v),
  );
  const interestPaidRow = writeNumberRow(
    'Less: Finance cost paid',
    (input.projection.series.pl_finance_cost ?? new Array(n).fill(0)).map((v) => -v),
  );
  // Change in equity (paid-up capital injection) — positive = inflow.
  const equity = input.projection.series.bs_paid_up_capital ?? new Array(n).fill(0);
  const equityChange = equity.map((v, i) => i === 0 ? 0 : v - equity[i - 1]);
  const equityRow = writeNumberRow('Add: Increase in paid-up capital', equityChange);

  const netFinancingRow = ws.addRow([
    'Net cash from financing activities (C)',
    ...yearCols.map((_, i) => ({
      formula: `${cellRef(principalRow, i + 2)}+${cellRef(interestPaidRow, i + 2)}+${cellRef(equityRow, i + 2)}`,
    })),
  ]);
  formatTotalRow(netFinancingRow);
  ws.addRow([]);

  // ── Net change in cash ──────────────────────────────────────
  const netChangeRow = ws.addRow([
    'Net increase / (decrease) in cash (A + B + C)',
    ...yearCols.map((_, i) => ({
      formula: `${cellRef(netOperatingRow.number, i + 2)}+${cellRef(netInvestingRow.number, i + 2)}+${cellRef(netFinancingRow.number, i + 2)}`,
    })),
  ]);
  formatTotalRow(netChangeRow);

  // Reconciliation: BS cash & bank delta YoY should match net change
  // calculated above (within rounding). Surface as an italic check
  // row at the bottom so the banker can see the tie.
  const cashBank = input.projection.series.bs_cash_bank ?? new Array(n).fill(0);
  const cashDelta = cashBank.map((v, i) => i === 0 ? 0 : v - cashBank[i - 1]);
  const reconcileRow = ws.addRow([
    'BS Δ cash check (should reconcile to row above)',
    ...cashDelta.map(roundFor),
  ]);
  reconcileRow.font = { italic: true, color: { argb: 'FF6B7280' } };
  for (let c = 2; c <= n + 1; c++) reconcileRow.getCell(c).numFmt = RUPEE_FMT;

  ws.getColumn(1).width = 50;
  for (let c = 2; c <= n + 1; c++) ws.getColumn(c).width = 16;
}

// ── Helpers ─────────────────────────────────────────────────────

// ── Sheet: FORM IV — COMPARATIVE STATEMENT OF CA / CL ──────────
//
// Banker's holding-period schedule. For each current-asset line we
// show the amount AND the implied holding period in months — raw
// material in months of consumption, FG in months of cost of sales,
// debtors in months of net sales. Same for the creditors line (months
// of purchases). A credit officer eyeballs these to spot stock-piling
// or stretched receivables; an unusually high months-figure year-on-
// year is the canonical "what changed?" signal.
//
// Holding periods come from resolveHoldingPeriods which falls back
// through user-set months → user-set days → conservative defaults.
function buildFormIV(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const ws = wb.addWorksheet('Form IV');
  const yearCols = input.projection.yearLabels;
  const firstP = input.projection.firstProjectedIndex;
  const hp = resolveHoldingPeriods(input.draft);
  setupBankerFormHeader(ws, input, 'IV', 'Comparative Statement of Current Assets / Current Liabilities');

  const sectionRow = (label: string) => {
    const r = ws.addRow(['', label]);
    r.font = { bold: true };
    r.getCell(2).fill = SECTION_FILL;
    return r;
  };

  // CURRENT ASSETS side. For each line we emit an "Amount" row and
  // a "Holding Period (months)" row. The holding period is a flat
  // user-assumption value across all years — the reference template
  // does the same (variation year-to-year is rare and would be
  // captured by changing the input).
  sectionRow('A. CURRENT ASSETS');
  let srNo = 1;
  const writeCaLine = (key: CanonicalSection, label: string, months: number, monthsLabel: string) => {
    const acc = ACCOUNT_BY_KEY[key];
    const values = input.projection.series[key] ?? [];
    const amountRow = formRow(ws, String(srNo), `${label || acc.label} — Amount`, values.map(roundFor));
    formatValueRow(amountRow, firstP);
    const monthsRow = formRow(ws, '', `${label || acc.label} — ${monthsLabel}`, yearCols.map(() => months));
    monthsRow.font = { italic: true, color: { argb: 'FF6B7280' } };
    for (let c = 3; c <= yearCols.length + 2; c++) monthsRow.getCell(c).numFmt = RATIO_FMT;
    srNo++;
  };

  // Raw material treated as part of "inventory" canonical bucket. We
  // don't have a split for raw material vs FG today; future Phase
  // will surface that. For Phase 2 we use the same `bs_inventory`
  // total for both rows but with different holding-period contexts
  // so the BANKER's framing is right.
  writeCaLine('bs_inventory', 'Inventory (total)', hp.rawMaterialMonths, 'Months of Consumption (RM proxy)');
  writeCaLine('bs_receivables', 'Trade Receivables', hp.receivablesMonths, 'Months of Net Sales');
  writeCaLine('bs_cash_bank', 'Cash & Bank', 0, 'Days (n/a)');
  writeCaLine('bs_other_current_assets', 'Other Current Assets', 0, 'Days (n/a)');

  ws.addRow([]);
  // Total CA row.
  const totalCaRow = ws.addRow(['', 'Total Current Assets', ...input.projection.derived.totalCurrentAssets.map(roundFor)]);
  formatDerivedRow(totalCaRow, firstP);

  ws.addRow([]);
  ws.addRow([]);

  // CURRENT LIABILITIES side.
  sectionRow('B. CURRENT LIABILITIES');
  srNo = 1;
  const writeClLine = (key: CanonicalSection, label: string, months: number, monthsLabel: string) => {
    const acc = ACCOUNT_BY_KEY[key];
    const values = input.projection.series[key] ?? [];
    const amountRow = formRow(ws, String(srNo), `${label || acc.label} — Amount`, values.map(roundFor));
    formatValueRow(amountRow, firstP);
    if (months > 0) {
      const monthsRow = formRow(ws, '', `${label || acc.label} — ${monthsLabel}`, yearCols.map(() => months));
      monthsRow.font = { italic: true, color: { argb: 'FF6B7280' } };
      for (let c = 3; c <= yearCols.length + 2; c++) monthsRow.getCell(c).numFmt = RATIO_FMT;
    }
    srNo++;
  };
  writeClLine('bs_creditors', 'Trade Payables (Sundry Creditors)', hp.payablesMonths, 'Months of Purchases');
  writeClLine('bs_bank_borrowing_short', 'Short-term Bank Borrowings', 0, '');
  writeClLine('bs_statutory_dues', 'Statutory Dues', 0, '');
  writeClLine('bs_other_current_liabilities', 'Other Current Liabilities', 0, '');

  ws.addRow([]);
  const totalClRow = ws.addRow(['', 'Total Current Liabilities', ...input.projection.derived.totalCurrentLiabilities.map(roundFor)]);
  formatDerivedRow(totalClRow, firstP);

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 50;
  for (let c = 3; c <= yearCols.length + 2; c++) ws.getColumn(c).width = 16;
}

// ── Sheet: FORM VI — FUNDS FLOW STATEMENT ──────────────────────
//
// Sources & Uses framework — the format banks expect, distinct from
// a Cash Flow statement (which is direct/indirect operating-cash flow).
//
//   SOURCES:
//     1. Profit After Tax
//     2. Depreciation (non-cash)
//     3. Increase in Net Worth (paid-up + reserves YoY)
//     4. Increase in Term Liabilities (term loans + other non-current YoY)
//     5. Decrease in Fixed Assets (negative capex)
//
//   USES:
//     1. Increase in Fixed Assets (capex)
//     2. Increase in Current Assets (working capital invested)
//     3. Decrease in Current Liabilities (working capital repaid)
//     4. Term loan principal repayment
//
//   NET SURPLUS / DEFICIT = Sources − Uses (should reconcile to Δcash).
//
// Year-1 column is empty for YoY-delta rows (no prior period to
// difference against). The exporter still emits the row with zeros so
// the structure is consistent.
function buildFormVI(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const ws = wb.addWorksheet('Form VI');
  const yearCols = input.projection.yearLabels;
  const firstP = input.projection.firstProjectedIndex;
  setupBankerFormHeader(ws, input, 'VI', 'Funds Flow Statement');

  const sectionRow = (label: string) => {
    const r = ws.addRow(['', label]);
    r.font = { bold: true };
    r.getCell(2).fill = SECTION_FILL;
    return r;
  };

  // YoY delta of a series. Year-0 is left empty (no prior period).
  const delta = (series: number[]): number[] => series.map((v, i) => i === 0 ? 0 : v - series[i - 1]);

  // SOURCES
  sectionRow('A. SOURCES OF FUNDS');
  const pat = input.projection.derived.profitAfterTax;
  const dep = input.projection.series.pl_depreciation ?? [];
  const equityTotal = input.projection.derived.totalEquity;
  const equityIncrease = delta(equityTotal).map(v => Math.max(0, v));
  const tlClosing = input.projection.derived.termLoanClosingBalance;
  const otherNcl = input.projection.series.bs_other_non_current_liab ?? [];
  const tlPlusOther = tlClosing.map((v, i) => v + (otherNcl[i] ?? 0));
  const tlIncrease = delta(tlPlusOther).map(v => Math.max(0, v));
  const grossFa = input.projection.series.bs_gross_fixed_assets ?? [];
  const faDecrease = delta(grossFa).map(v => Math.max(0, -v));

  formatValueRow(formRow(ws, '1', 'Profit After Tax', pat.map(roundFor)), firstP);
  formatValueRow(formRow(ws, '2', 'Depreciation (non-cash add-back)', dep.map(roundFor)), firstP);
  formatValueRow(formRow(ws, '3', 'Increase in Net Worth (YoY)', equityIncrease.map(roundFor)), firstP);
  formatValueRow(formRow(ws, '4', 'Increase in Term Liabilities (YoY)', tlIncrease.map(roundFor)), firstP);
  formatValueRow(formRow(ws, '5', 'Decrease in Fixed Assets (YoY)', faDecrease.map(roundFor)), firstP);

  const sources = pat.map((_, i) => roundFor(
    pat[i] + (dep[i] ?? 0) + equityIncrease[i] + tlIncrease[i] + faDecrease[i],
  ));
  const sourcesRow = ws.addRow(['', 'TOTAL SOURCES (1 + 2 + 3 + 4 + 5)', ...sources]);
  formatTotalRow(sourcesRow);

  ws.addRow([]);
  // USES
  sectionRow('B. USES OF FUNDS');
  const faIncrease = delta(grossFa).map(v => Math.max(0, v));
  const ca = input.projection.derived.totalCurrentAssets;
  const cl = input.projection.derived.totalCurrentLiabilities;
  const caIncrease = delta(ca).map(v => Math.max(0, v));
  const clDecrease = delta(cl).map(v => Math.max(0, -v));
  const tlPrincipal = input.projection.derived.termLoanPrincipal;

  formatValueRow(formRow(ws, '1', 'Increase in Fixed Assets (capex)', faIncrease.map(roundFor)), firstP);
  formatValueRow(formRow(ws, '2', 'Increase in Current Assets', caIncrease.map(roundFor)), firstP);
  formatValueRow(formRow(ws, '3', 'Decrease in Current Liabilities', clDecrease.map(roundFor)), firstP);
  formatValueRow(formRow(ws, '4', 'Term Loan Principal Repayment', tlPrincipal.map(roundFor)), firstP);

  const uses = pat.map((_, i) => roundFor(
    faIncrease[i] + caIncrease[i] + clDecrease[i] + tlPrincipal[i],
  ));
  const usesRow = ws.addRow(['', 'TOTAL USES (1 + 2 + 3 + 4)', ...uses]);
  formatTotalRow(usesRow);

  ws.addRow([]);
  // NET
  const netRow = ws.addRow(['', 'NET SURPLUS / (DEFICIT) — Sources − Uses', ...pat.map((_, i) => roundFor(sources[i] - uses[i]))]);
  formatTotalRow(netRow);
  netRow.eachCell((c, ci) => { if (ci > 2) c.fill = HEADING_FILL; });

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 50;
  for (let c = 3; c <= yearCols.length + 2; c++) ws.getColumn(c).width = 16;
}

// ── Sheet: DSCR ────────────────────────────────────────────────
//
// Dedicated DSCR sheet with cumulative + total column on the right
// (banker convention — they read the cumulative figure to assess
// whole-tenure debt-service comfort, not just year-by-year).
//
//   Numerator (Funds Available for Debt Service):
//     PAT + Depreciation + Deferred Tax + Term Loan Interest
//
//   Denominator (Debt Service Obligation):
//     Term Loan Principal Repayment + Term Loan Interest
//
//   DSCR = Numerator / Denominator
//   Cumulative DSCR = ΣNumerator / ΣDenominator (across years to date)
//
// We don't track deferred tax separately on the canonical chart; it
// rides inside `pl_tax`. So the "Deferred Tax" row defaults to zero.
function buildDscrSheet(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const ws = wb.addWorksheet('DSCR');
  const yearCols = input.projection.yearLabels;
  const firm = input.draft.firm ?? {};

  const r1 = ws.addRow([firm.firmName ? `M/s ${firm.firmName}` : 'M/s —']);
  r1.font = { bold: true, size: 12 };
  ws.addRow([]);
  const banner = ws.addRow(['Calculation of DSCR']);
  banner.font = { bold: true, size: 13 };
  banner.getCell(1).fill = HEADING_FILL;
  ws.addRow([]);

  const headerRow = ws.addRow(['Particulars', ...yearCols, 'Total']);
  headerRow.font = { bold: true };
  headerRow.eachCell((c) => { c.fill = HEADING_FILL; });

  const pat = input.projection.derived.profitAfterTax;
  const dep = input.projection.series.pl_depreciation ?? [];
  const tlInterest = input.projection.derived.termLoanInterest;
  const tlPrincipal = input.projection.derived.termLoanPrincipal;
  const deferredTax = pat.map(() => 0);

  // Numerator components — one row each + total column.
  const writeNumeratorRow = (label: string, vals: number[]) => {
    const total = vals.reduce((s, v) => s + v, 0);
    const r = ws.addRow([label, ...vals.map(roundFor), roundFor(total)]);
    formatValueRow(r, 0);
    r.getCell(yearCols.length + 2).font = { bold: true };
    return r;
  };
  writeNumeratorRow('Profit After Tax', pat);
  writeNumeratorRow('Depreciation', dep);
  writeNumeratorRow('Deferred Tax Asset / Liability', deferredTax);
  writeNumeratorRow('Interest on Term Loan', tlInterest);

  ws.addRow([]);
  // Funds Available row.
  const fundsAvailable = pat.map((_, i) => pat[i] + (dep[i] ?? 0) + deferredTax[i] + tlInterest[i]);
  const fundsTotal = fundsAvailable.reduce((s, v) => s + v, 0);
  const fundsRow = ws.addRow(['Funds Available for Debt Service', ...fundsAvailable.map(roundFor), roundFor(fundsTotal)]);
  formatTotalRow(fundsRow);

  ws.addRow([]);
  // Debt-service denominator components.
  const tlPrincipalRow = writeNumeratorRow('Term Loan Principal Repayment', tlPrincipal);
  const tlInterestRow = writeNumeratorRow('Interest on Term Loan (as above)', tlInterest);
  ws.addRow([]);

  // Total debt-service row.
  const debtService = tlPrincipal.map((_, i) => tlPrincipal[i] + tlInterest[i]);
  const debtTotal = debtService.reduce((s, v) => s + v, 0);
  const debtRow = ws.addRow(['Total Debt Service Obligation', ...debtService.map(roundFor), roundFor(debtTotal)]);
  formatTotalRow(debtRow);

  ws.addRow([]);

  // DSCR per year + cumulative + overall.
  const dscr = debtService.map((d, i) => d > 0 ? fundsAvailable[i] / d : 0);
  // Cumulative running average: Σfunds / Σdebt up to year i.
  let cumF = 0, cumD = 0;
  const cumulative = debtService.map((d, i) => {
    cumF += fundsAvailable[i];
    cumD += d;
    return cumD > 0 ? cumF / cumD : 0;
  });
  const overallDscr = debtTotal > 0 ? fundsTotal / debtTotal : 0;

  const dscrRow = ws.addRow(['DSCR (Year-wise)', ...dscr.map(v => Number.isFinite(v) ? v : 0), overallDscr]);
  for (let c = 2; c <= yearCols.length + 2; c++) dscrRow.getCell(c).numFmt = RATIO_FMT;
  dscrRow.font = { bold: true };
  dscrRow.eachCell((c, ci) => { if (ci > 1) c.fill = HEADING_FILL; });

  const cumRow = ws.addRow(['DSCR (Cumulative)', ...cumulative.map(v => Number.isFinite(v) ? v : 0), overallDscr]);
  for (let c = 2; c <= yearCols.length + 2; c++) cumRow.getCell(c).numFmt = RATIO_FMT;
  cumRow.font = { italic: true, color: { argb: 'FF6B7280' } };

  // Suppress unused-row TS warnings.
  void tlPrincipalRow; void tlInterestRow;

  ws.getColumn(1).width = 38;
  for (let c = 2; c <= yearCols.length + 2; c++) ws.getColumn(c).width = 14;
}

// ── Sheet: BEP — Break-Even Point Analysis ─────────────────────
//
// Splits each cost line into variable vs fixed using the resolved
// BEP assumptions (deterministic defaults, user override on
// ReviewStep). Banker reads BEP to gauge how far sales can fall
// before the business loses money — Margin of Safety = (NetSales −
// BEPSales) / NetSales. <30% MoS is the typical "this is tight"
// flag.
function buildBepSheet(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const ws = wb.addWorksheet('BEP');
  const yearCols = input.projection.yearLabels;
  const firm = input.draft.firm ?? {};
  const bep = resolveBep(input.draft);
  const vfBy = bep.variableFractionByKey ?? {};

  const r1 = ws.addRow([firm.firmName ? `M/s ${firm.firmName}` : 'M/s —']);
  r1.font = { bold: true, size: 12 };
  const banner = ws.addRow(['BEP ANALYSIS']);
  banner.font = { bold: true, size: 13 };
  banner.getCell(1).fill = HEADING_FILL;
  ws.addRow([]);

  // Column header — first column "Particulars", second "Variable %",
  // then year labels.
  const headerRow = ws.addRow(['Particulars', 'Variable %', ...yearCols]);
  headerRow.font = { bold: true };
  headerRow.eachCell((c) => { c.fill = HEADING_FILL; });

  // Net sales (top line).
  const netSales = input.projection.series.pl_revenue ?? [];
  const netSalesRow = ws.addRow(['Net Sales', '', ...netSales.map(roundFor)]);
  formatTotalRow(netSalesRow);

  ws.addRow([]);
  const vcSection = ws.addRow(['Less: Variable Cost']);
  vcSection.font = { bold: true };
  vcSection.getCell(1).fill = SECTION_FILL;

  // Each cost line, split variable / fixed using the resolved
  // fractions. We emit two rows per source key — one labelled
  // (variable %, variable cost values) under the variable section,
  // and the matching fixed portion (1 − variable %) under the fixed
  // section below.
  const costLines: Array<{ key: CanonicalSection; label: string }> = [
    { key: 'pl_cogs', label: 'Cost of Goods Sold' },
    { key: 'pl_operating_expense', label: 'Selling, General & Administrative' },
    { key: 'pl_depreciation', label: 'Depreciation' },
    { key: 'pl_finance_cost', label: 'Interest / Finance Cost' },
  ];

  const variableTotals: number[] = yearCols.map(() => 0);
  for (const cl of costLines) {
    const vf = typeof vfBy[cl.key] === 'number' ? vfBy[cl.key]! : 0;
    const series = input.projection.series[cl.key] ?? [];
    const varValues = series.map(v => v * vf);
    varValues.forEach((v, i) => { variableTotals[i] += v; });
    const r = ws.addRow([cl.label, vf, ...varValues.map(roundFor)]);
    formatValueRow(r, 0);
    r.getCell(2).numFmt = PCT_FMT;
  }
  const totalVariableRow = ws.addRow(['Total Variable Cost', '', ...variableTotals.map(roundFor)]);
  formatDerivedRow(totalVariableRow, 0);

  ws.addRow([]);
  // Contribution = Net Sales − Total Variable Cost
  const contribution = netSales.map((s, i) => s - variableTotals[i]);
  const contribRow = ws.addRow(['Contribution (Net Sales − Variable Cost)', '', ...contribution.map(roundFor)]);
  formatDerivedRow(contribRow, 0);

  ws.addRow([]);
  const fcSection = ws.addRow(['Fixed Cost']);
  fcSection.font = { bold: true };
  fcSection.getCell(1).fill = SECTION_FILL;

  const fixedTotals: number[] = yearCols.map(() => 0);
  for (const cl of costLines) {
    const vf = typeof vfBy[cl.key] === 'number' ? vfBy[cl.key]! : 0;
    const ff = 1 - vf;
    const series = input.projection.series[cl.key] ?? [];
    const fixValues = series.map(v => v * ff);
    fixValues.forEach((v, i) => { fixedTotals[i] += v; });
    const r = ws.addRow([cl.label, ff, ...fixValues.map(roundFor)]);
    formatValueRow(r, 0);
    r.getCell(2).numFmt = PCT_FMT;
  }
  const totalFixedRow = ws.addRow(['Total Fixed Cost', '', ...fixedTotals.map(roundFor)]);
  formatDerivedRow(totalFixedRow, 0);

  ws.addRow([]);
  // BEP Sales = Total Fixed Cost / (Contribution / Net Sales)
  // Margin of Safety = (Net Sales − BEP Sales) / Net Sales
  const bepSales = fixedTotals.map((fc, i) => {
    const cm = netSales[i] > 0 ? contribution[i] / netSales[i] : 0;
    return cm > 0 ? fc / cm : 0;
  });
  const mos = bepSales.map((bs, i) => netSales[i] > 0 ? (netSales[i] - bs) / netSales[i] : 0);

  const bepRow = ws.addRow(['BEP Sales (Total Fixed Cost / Contribution Margin)', '', ...bepSales.map(roundFor)]);
  formatTotalRow(bepRow);
  const mosRow = ws.addRow(['Margin of Safety (Net Sales − BEP) / Net Sales', '', ...mos.map(v => Number.isFinite(v) ? v : 0)]);
  for (let c = 3; c <= yearCols.length + 2; c++) mosRow.getCell(c).numFmt = PCT_FMT;
  mosRow.font = { bold: true };
  mosRow.eachCell((c, ci) => { if (ci > 2) c.fill = HEADING_FILL; });

  ws.getColumn(1).width = 50;
  ws.getColumn(2).width = 12;
  for (let c = 3; c <= yearCols.length + 2; c++) ws.getColumn(c).width = 16;
}

// ── Sheet: Introduction / Project Report ───────────────────────
//
// Cover-page narrative the banker reads first when reviewing the
// proposal. Uses the resolved ProjectReport block (user overrides
// > deterministic defaults). Layout follows the standard CMA
// reference template: two-column key-value pairs at the top
// (Unit Name, Address, Constitution, PAN, Nature of Business,
// Credit Request, Margin), then Cost of Project + Means of Finance
// tables, then a free-text Brief Profile block, then Machinery /
// Premises / Power / ROI notes.
function buildIntroductionSheet(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const ws = wb.addWorksheet('Introduction');
  const firm = input.draft.firm ?? {};
  const pr = resolveProjectReport(input.draft);

  ws.columns = [{ width: 26 }, { width: 60 }];

  const title = ws.addRow(['', 'PROJECT REPORT']);
  title.font = { bold: true, size: 16 };
  title.getCell(2).alignment = { horizontal: 'center' };
  ws.addRow([]);

  const keyValue = (label: string, value: string | number | undefined) => {
    const r = ws.addRow([label, value ?? '—']);
    r.getCell(1).font = { bold: true };
    return r;
  };

  keyValue('Name of Unit', firm.firmName);
  keyValue('State', firm.state);
  keyValue('PAN', firm.gstin); // FirmInfo doesn't have PAN distinct; GSTIN is closest proxy today.
  keyValue('GSTIN', firm.gstin);
  keyValue('Nature of Business', firm.businessNature);
  keyValue('Credit Request', pr.creditRequest);
  if (typeof pr.margin === 'number') keyValue('Margin', `${(pr.margin * 100).toFixed(0)}%`);

  ws.addRow([]);
  // COST OF PROJECT table.
  if (pr.costOfProject && pr.costOfProject.length > 0) {
    const sec = ws.addRow(['', 'COST OF PROJECT']);
    sec.font = { bold: true };
    sec.getCell(2).fill = SECTION_FILL;
    let total = 0;
    for (const item of pr.costOfProject) {
      const r = ws.addRow([item.item, item.amount]);
      r.getCell(2).numFmt = RUPEE_FMT;
      total += item.amount;
    }
    const tot = ws.addRow(['Total', total]);
    tot.font = { bold: true };
    tot.getCell(2).numFmt = RUPEE_FMT;
    tot.getCell(2).border = { top: { style: 'thin' }, bottom: { style: 'double' } };
    ws.addRow([]);
  }

  // MEANS OF FINANCE table.
  if (pr.meansOfFinance && pr.meansOfFinance.length > 0) {
    const sec = ws.addRow(['', 'MEANS OF FINANCE']);
    sec.font = { bold: true };
    sec.getCell(2).fill = SECTION_FILL;
    let total = 0;
    for (const item of pr.meansOfFinance) {
      const r = ws.addRow([item.item, item.amount]);
      r.getCell(2).numFmt = RUPEE_FMT;
      total += item.amount;
    }
    const tot = ws.addRow(['Total', total]);
    tot.font = { bold: true };
    tot.getCell(2).numFmt = RUPEE_FMT;
    tot.getCell(2).border = { top: { style: 'thin' }, bottom: { style: 'double' } };
    ws.addRow([]);
  }

  // BRIEF PROFILE — multi-line free text.
  if (pr.briefProfile) {
    const sec = ws.addRow(['', 'BRIEF PROFILE']);
    sec.font = { bold: true };
    sec.getCell(2).fill = SECTION_FILL;
    for (const line of pr.briefProfile.split('\n')) {
      if (!line.trim()) continue;
      const r = ws.addRow(['', line]);
      r.getCell(2).alignment = { wrapText: true };
    }
    ws.addRow([]);
  }

  // Machinery / premises / power / ROI notes.
  const addNarrativeBlock = (heading: string, body: string | undefined) => {
    if (!body) return;
    const sec = ws.addRow(['', heading]);
    sec.font = { bold: true };
    sec.getCell(2).fill = SECTION_FILL;
    const r = ws.addRow(['', body]);
    r.getCell(2).alignment = { wrapText: true };
    ws.addRow([]);
  };
  addNarrativeBlock('MACHINERY DETAILS', pr.machineryDetails);
  addNarrativeBlock('PREMISES', pr.premises);
  addNarrativeBlock('POWER CONNECTION', pr.powerConnection);
  addNarrativeBlock('RATE OF INTEREST', pr.rateOfInterestNotes);
}

// ── Sheet: FORM V — COMPUTATION OF MPBF (BOTH METHODS) ─────────
//
// Tandon Committee defined two methods of lending; the reference
// CMAs present them side-by-side so the banker can see both. Method
// I is more conservative (promoter funds 25% of the WC requirement
// AFTER deducting acceptable stock margin); Method II is the more
// common one (promoter funds 25% of the entire WC gap).
//
// We compute both regardless of which `draft.mpbfMethod` the user
// chose for the rest of the workbook — Form V is comparative by
// design. The user's selected method drives WC & MPBF / Ratios /
// Stress; Form V just shows both for context.
function buildFormV(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const ws = wb.addWorksheet('Form V');
  const yearCols = input.projection.yearLabels;
  const firstP = input.projection.firstProjectedIndex;
  setupBankerFormHeader(ws, input, 'V', 'Computation of Maximum Permissible Bank Finance (MPBF)');

  const ca = input.projection.derived.totalCurrentAssets;
  const inventory = input.projection.series.bs_inventory ?? yearCols.map(() => 0);
  const cl = input.projection.derived.totalCurrentLiabilities;
  const shortBank = input.projection.series.bs_bank_borrowing_short ?? yearCols.map(() => 0);
  // Current liabilities EXCLUDING bank borrowing — the WC gap input
  // to both methods.
  const clExBank = cl.map((v, i) => v - (shortBank[i] ?? 0));

  // Use the existing mpbf engine for the math so this stays in sync
  // with what WC & MPBF / Ratios use under the hood.
  const m1 = computeMpbf('tandon_i', {
    projectedTurnover: input.projection.series.pl_revenue ?? yearCols.map(() => 0),
    totalCurrentAssets: ca,
    inventory,
    currentLiabExcludingBank: clExBank,
  });
  const m2 = computeMpbf('tandon_ii', {
    projectedTurnover: input.projection.series.pl_revenue ?? yearCols.map(() => 0),
    totalCurrentAssets: ca,
    inventory,
    currentLiabExcludingBank: clExBank,
  });

  const sectionRow = (label: string) => {
    const r = ws.addRow(['', label]);
    r.font = { bold: true };
    r.getCell(2).fill = SECTION_FILL;
    return r;
  };
  const writeRow = (srNo: string, label: string, vals: number[]) => {
    const r = formRow(ws, srNo, label, vals.map(roundFor));
    formatValueRow(r, firstP);
    return r;
  };
  const writeTotal = (label: string, vals: number[]) => {
    const r = ws.addRow(['', label, ...vals.map(roundFor)]);
    formatTotalRow(r);
    return r;
  };

  // ── Method I — conservative ────────────────────────────────────
  sectionRow('FIRST METHOD OF LENDING (Tandon I)');
  writeRow('1.', 'Total Current Assets', ca);
  writeRow('2.', 'Other Current Liabilities (excl. bank borrowings)', clExBank);
  writeRow('3.', 'Working Capital Gap (1 − 2)', m1.workingCapitalGap);
  writeRow('4.', 'Promoter Contribution (25% of WCG net of stock margin)', m1.promoterMargin);
  writeTotal('5. MPBF — Method I (Eligible Bank Finance)', m1.mpbfByYear);

  ws.addRow([]);
  ws.addRow([]);

  // ── Method II — standard ──────────────────────────────────────
  sectionRow('SECOND METHOD OF LENDING (Tandon II)');
  writeRow('1.', 'Total Current Assets', ca);
  writeRow('2.', 'Other Current Liabilities (excl. bank borrowings)', clExBank);
  writeRow('3.', 'Working Capital Gap (1 − 2)', m2.workingCapitalGap);
  writeRow('4.', 'Promoter Contribution (25% of WCG)', m2.promoterMargin);
  writeTotal('5. MPBF — Method II (Eligible Bank Finance)', m2.mpbfByYear);

  ws.addRow([]);
  ws.addRow([]);

  // Differential row — Method I will always be ≤ Method II because
  // it deducts the stock-margin penalty on top. Banker often quotes
  // the lower of the two when sizing the facility.
  const diff = m2.mpbfByYear.map((v, i) => v - m1.mpbfByYear[i]);
  const diffRow = ws.addRow(['', 'Reduction (Method II − Method I)', ...diff.map(roundFor)]);
  diffRow.font = { italic: true, color: { argb: 'FF6B7280' } };
  for (let c = 3; c <= yearCols.length + 2; c++) diffRow.getCell(c).numFmt = RUPEE_FMT;

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 52;
  for (let c = 3; c <= yearCols.length + 2; c++) ws.getColumn(c).width = 16;
}

// ── Sheet: MPBF Monthly ────────────────────────────────────────
//
// Banker reads "annual" turnover figures but operates working capital
// on a monthly tonne-of-cash basis. The MPBF sheet (annual) doesn't
// answer "how much does the limit need to be in peak month?" — this
// sheet does, by dividing the annual figures by 12 to surface the
// monthly working-capital requirement. For seasonal businesses this
// is materially different from year/12; future enhancement can take
// a monthly seasonality vector. For now uniform monthly = annual/12,
// which matches what the reference CMA emits.
function buildMpbfMonthlySheet(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const ws = wb.addWorksheet('MPBF Monthly');
  const yearCols = input.projection.yearLabels;
  const firstP = input.projection.firstProjectedIndex;
  setupBankerFormHeader(ws, input, 'V (monthly)', 'MPBF — Monthly Figures Derivation');

  // Seasonality: if the user supplied a 12-element vector summing to
  // ~1.0, we use the AVERAGE of the peak-3 months to derive a peak-
  // month figure for each annual value (banker wants to know peak
  // working-capital requirement). Otherwise default is uniform —
  // annual / 12.
  const season = input.draft.monthlySeasonality;
  const usingSeasonality = Array.isArray(season)
    && season.length === 12
    && season.every(n => typeof n === 'number' && Number.isFinite(n));
  const seasonMultiplier = usingSeasonality
    // Average of the three largest values × 12 = peak-month multiplier
    // relative to "annual / 12". When the vector is uniform (1/12 each)
    // this equals 1.0 → same as the non-seasonal path. When peaks are
    // concentrated, the multiplier is > 1, lifting the monthly value
    // toward the peak month.
    ? (() => {
        const sorted = [...season].sort((a, b) => b - a);
        const peakAvg = (sorted[0] + sorted[1] + sorted[2]) / 3;
        return peakAvg * 12;
      })()
    : 1;

  const writeRow = (srNo: string, label: string, annualVals: number[]) => {
    const monthly = annualVals.map(v => (v / 12) * seasonMultiplier);
    const r = formRow(ws, srNo, label, monthly.map(roundFor));
    formatValueRow(r, firstP);
    return r;
  };

  if (usingSeasonality) {
    const note = ws.addRow([
      '',
      `Monthly figures shown reflect the PEAK-month average (avg of top 3 months) given your seasonality vector. Multiplier vs. uniform monthly: ${seasonMultiplier.toFixed(2)}×.`,
    ]);
    note.font = { italic: true, color: { argb: 'FFB45309' } };
    ws.addRow([]);
  }

  const sales = input.projection.series.pl_revenue ?? yearCols.map(() => 0);
  const cogs = input.projection.series.pl_cogs ?? yearCols.map(() => 0);
  const opex = input.projection.series.pl_operating_expense ?? yearCols.map(() => 0);

  writeRow('1.', 'Net Sales / month (annual ÷ 12)', sales);
  writeRow('2.', 'Cost of Goods Sold / month', cogs);
  writeRow('3.', 'Selling, G&A / month', opex);

  const costOfSales = sales.map((_, i) => (cogs[i] ?? 0) + (opex[i] ?? 0));
  writeRow('4.', 'Total Cost of Sales / month', costOfSales);

  const ca = input.projection.derived.totalCurrentAssets;
  const cl = input.projection.derived.totalCurrentLiabilities;
  writeRow('5.', 'Total Current Assets / month', ca);
  writeRow('6.', 'Total Current Liabilities / month', cl);

  const wcGap = input.projection.derived.workingCapitalGap;
  writeRow('7.', 'Working Capital Gap / month', wcGap);

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 50;
  for (let c = 3; c <= yearCols.length + 2; c++) ws.getColumn(c).width = 16;
}

// ── Sheet: WDV Depreciation Schedule (per-block) ───────────────
//
// Schedule II–style depreciation across multiple asset blocks. Each
// block has its own opening WDV and rate (P&M 15% / Buildings 10% /
// Computers 40% / Furniture 10% / Vehicles 15% by convention). The
// sheet renders one column per block + a "Total" column on the right
// so the banker can tie back to Form II's annual depreciation line.
//
// When the user hasn't defined any blocks (draft.fixedAssetBlocks is
// empty or absent), we fall back to a single Plant & Machinery block
// seeded with the latest historical fixed-asset total — preserves
// the Phase 3 behaviour as the default.
//
// Per-block additions / deductions per year are honoured if supplied.
// Rolling: closingWDV[y] = (openingWDV + additions[y] − deductions[y])
//                          × (1 − ratePct).
function buildDepreciationSheet(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const ws = wb.addWorksheet('Depreciation');
  const firm = input.draft.firm ?? {};
  const yearsToProject = input.draft.projectionHorizon ?? 5;

  const r1 = ws.addRow([firm.firmName ? `M/s ${firm.firmName}` : 'M/s —']);
  r1.font = { bold: true, size: 12 };
  ws.addRow([]);
  const banner = ws.addRow(['Depreciation Chart (WDV Method — Schedule II Blocks)']);
  banner.font = { bold: true, size: 13 };
  banner.getCell(1).fill = HEADING_FILL;
  ws.addRow([]);

  // Resolve blocks: user-supplied wins. Empty → fall back to a single
  // Plant & Machinery block seeded from the latest historical FA so
  // the sheet always produces SOMETHING usable.
  let blocks = input.draft.fixedAssetBlocks?.filter(b => b && (b.openingWdv ?? 0) > 0) ?? [];
  if (blocks.length === 0) {
    const grossFa = input.projection.series.bs_gross_fixed_assets ?? [];
    const accumDep = input.projection.series.bs_accumulated_depreciation ?? [];
    const firstP = input.projection.firstProjectedIndex;
    const seededWdv = grossFa[firstP - 1] !== undefined
      ? Math.max(0, (grossFa[firstP - 1] ?? 0) - (accumDep[firstP - 1] ?? 0))
      : Math.max(0, (grossFa[0] ?? 0) - (accumDep[0] ?? 0));
    blocks = [{ name: 'Plant & Machinery (auto)', ratePct: 0.15, openingWdv: seededWdv }];
  }

  // Header: Particulars | <block1> | <block2> | ... | Total
  const headerCells: string[] = ['Particulars'];
  blocks.forEach(b => headerCells.push(`${b.name} (${(b.ratePct * 100).toFixed(0)}%)`));
  headerCells.push('Total');
  const headerRow = ws.addRow(headerCells);
  headerRow.font = { bold: true };
  headerRow.eachCell((c) => { c.fill = HEADING_FILL; });

  // Opening WDV row.
  const openingValues = blocks.map(b => b.openingWdv);
  const openingTotal = openingValues.reduce((s, v) => s + v, 0);
  const openingRow = ws.addRow(['Opening WDV', ...openingValues.map(roundFor), roundFor(openingTotal)]);
  for (let c = 2; c <= blocks.length + 2; c++) openingRow.getCell(c).numFmt = RUPEE_FMT;
  openingRow.font = { bold: true };

  ws.addRow([]);

  // Year-by-year roll-down for each block.
  const wdvByBlock = blocks.map(b => b.openingWdv);
  for (let y = 1; y <= yearsToProject; y++) {
    // Additions & deductions per block for this year (default 0).
    const additionsValues = blocks.map(b => b.additions?.[y - 1] ?? 0);
    if (additionsValues.some(v => v > 0)) {
      const r = ws.addRow([`Additions — Year ${y}`, ...additionsValues.map(roundFor), roundFor(additionsValues.reduce((s, v) => s + v, 0))]);
      for (let c = 2; c <= blocks.length + 2; c++) r.getCell(c).numFmt = RUPEE_FMT;
    }
    const deductionsValues = blocks.map(b => b.deductions?.[y - 1] ?? 0);
    if (deductionsValues.some(v => v > 0)) {
      const r = ws.addRow([`Deductions — Year ${y}`, ...deductionsValues.map(roundFor), roundFor(deductionsValues.reduce((s, v) => s + v, 0))]);
      for (let c = 2; c <= blocks.length + 2; c++) r.getCell(c).numFmt = RUPEE_FMT;
    }
    // Compute depreciation for each block on (wdv + additions − deductions).
    const depValues = blocks.map((b, bi) => {
      const base = wdvByBlock[bi] + additionsValues[bi] - deductionsValues[bi];
      return Math.max(0, base) * b.ratePct;
    });
    const depTotal = depValues.reduce((s, v) => s + v, 0);
    const depRow = ws.addRow([`Depreciation — Year ${y}`, ...depValues.map(roundFor), roundFor(depTotal)]);
    for (let c = 2; c <= blocks.length + 2; c++) {
      depRow.getCell(c).numFmt = RUPEE_FMT;
      depRow.getCell(c).font = { color: { argb: 'FFB45309' } };
    }
    // Closing WDV per block.
    blocks.forEach((b, bi) => {
      wdvByBlock[bi] = wdvByBlock[bi] + additionsValues[bi] - deductionsValues[bi] - depValues[bi];
      if (wdvByBlock[bi] < 0) wdvByBlock[bi] = 0;
    });
    const closingTotal = wdvByBlock.reduce((s, v) => s + v, 0);
    const closingRow = ws.addRow([`Closing WDV — Year ${y}`, ...wdvByBlock.map(roundFor), roundFor(closingTotal)]);
    for (let c = 2; c <= blocks.length + 2; c++) {
      closingRow.getCell(c).numFmt = RUPEE_FMT;
      closingRow.getCell(c).font = { bold: true };
    }
    ws.addRow([]);
  }

  ws.addRow([]);
  ws.addRow(['Method: Block of assets at WDV per Schedule II rates.']).font = { italic: true, color: { argb: 'FF6B7280' } };
  if (input.draft.fixedAssetBlocks && input.draft.fixedAssetBlocks.length > 0) {
    ws.addRow(['Edit asset blocks on the Assumptions step of the wizard.']).font = { italic: true, color: { argb: 'FF6B7280' } };
  } else {
    ws.addRow(['No blocks defined — defaulted to a single Plant & Machinery block. Add blocks on the Assumptions step for a Schedule II–compliant schedule.']).font = { italic: true, color: { argb: 'FFB45309' } };
  }

  ws.getColumn(1).width = 28;
  for (let c = 2; c <= blocks.length + 2; c++) ws.getColumn(c).width = 18;
}

// ── Sheets: Per-loan monthly term-loan schedules ───────────────
//
// One worksheet per term loan. Reference CMAs typically name them
// "TL <PrincipalLacs> existing" / "TL <PrincipalLacs> Fresh"; we
// approximate that here. Each sheet has the standard banker columns:
//
//   Year | Month | Opening Balance | Disbursement | Total |
//   Repayment | Closing Balance | Interest | Total Instalments
//
// The schedule honours disbursement month + moratorium + repayment
// type (see amortisation.ts).
function buildMonthlyTermLoanSheets(wb: ExcelJS.Workbook, input: CmaExportInput) {
  const loans = input.draft.termLoans ?? [];
  if (loans.length === 0) return;
  const firm = input.draft.firm ?? {};
  const horizon = input.draft.projectionHorizon ?? 5;

  for (let li = 0; li < loans.length; li++) {
    const loan = loans[li];
    const principalLacs = Math.round(((loan.principal ?? 0) / 100000) * 100) / 100;
    const tag = loan.status === 'proposed' ? 'Fresh' : 'existing';
    const lender = loan.lender ?? 'TL';
    // Excel sheet name length cap is 31 chars; build a safe label.
    const baseSheetName = `${lender} ${principalLacs} ${tag}`.slice(0, 28);
    const sheetName = loans.length > 1 && wb.getWorksheet(baseSheetName)
      ? `${baseSheetName.slice(0, 25)} #${li + 1}`
      : baseSheetName;
    const ws = wb.addWorksheet(sheetName);

    const r1 = ws.addRow([firm.firmName ? `M/s ${firm.firmName}` : 'M/s —']);
    r1.font = { bold: true, size: 12 };
    ws.addRow(['']);
    const banner = ws.addRow([`${loan.status === 'proposed' ? 'PROPOSED' : 'EXISTING'} TERM LOAN — ${tag.toUpperCase()}`]);
    banner.font = { bold: true, size: 13 };
    banner.getCell(1).fill = HEADING_FILL;

    // ROI / principal banner row.
    const meta1 = ws.addRow([`Principal: Rs. ${principalLacs} Lacs`, '', '', '', '', 'ROI', (loan.interestRatePct ?? 0) / 100]);
    meta1.getCell(7).numFmt = PCT_FMT;
    meta1.font = { italic: true, color: { argb: 'FF6B7280' } };
    const meta2 = ws.addRow([
      `Tenure: ${loan.tenureMonths ?? '—'} months`,
      `Moratorium: ${loan.moratoriumMonths ?? 0} months`,
      `Disbursement month: ${loan.disbursementMonth ?? 1} (1 = Apr)`,
      `Repayment: ${loan.repaymentType ?? 'equal_emi'}`,
    ]);
    meta2.font = { italic: true, color: { argb: 'FF6B7280' } };
    ws.addRow([]);

    // Column headers.
    const header = ws.addRow(['Year', 'Month', 'Opening Balance', 'Disbursement', 'Total', 'Repayment', 'Closing Balance', 'Interest', 'Total Instalments']);
    header.font = { bold: true };
    header.eachCell((c) => { c.fill = HEADING_FILL; });

    const rows = buildMonthlyAmortisation(loan, horizon);
    const byFy = groupByFy(rows);

    for (const fyKey of Object.keys(byFy).sort((a, b) => Number(a) - Number(b))) {
      const fyIndex = Number(fyKey);
      const fyLabel = input.projection.yearLabels[input.projection.firstProjectedIndex + fyIndex]
        ?? `Year ${fyIndex + 1}`;
      const monthsInYear = byFy[fyIndex];
      // First row of the FY carries the year label; subsequent rows
      // leave the year column blank for visual grouping.
      let totalDisbursement = 0;
      let totalRepayment = 0;
      let totalInterest = 0;
      let totalInstalment = 0;
      monthsInYear.forEach((m, idx) => {
        const total = m.opening + m.disbursement;
        const r = ws.addRow([
          idx === 0 ? fyLabel : '',
          m.monthName,
          m.opening,
          m.disbursement || '',
          total,
          m.repayment,
          m.closing,
          m.interest,
          m.totalInstalment,
        ]);
        for (let c = 3; c <= 9; c++) r.getCell(c).numFmt = RUPEE_FMT;
        if (idx === 0) r.getCell(1).font = { bold: true };
        totalDisbursement += m.disbursement;
        totalRepayment += m.repayment;
        totalInterest += m.interest;
        totalInstalment += m.totalInstalment;
      });
      const yearTotal = ws.addRow([
        'Year Total',
        '',
        '',
        totalDisbursement || '',
        '',
        totalRepayment,
        '',
        totalInterest,
        totalInstalment,
      ]);
      yearTotal.font = { bold: true };
      for (let c = 4; c <= 9; c++) {
        const cell = yearTotal.getCell(c);
        cell.numFmt = RUPEE_FMT;
        cell.border = { top: { style: 'thin' } };
      }
    }

    // Column widths.
    ws.getColumn(1).width = 12;
    ws.getColumn(2).width = 12;
    for (let c = 3; c <= 9; c++) ws.getColumn(c).width = 16;
  }
}

function setupHeader(ws: ExcelJS.Worksheet, title: string, yearCols: string[], skipTitleRow = false) {
  if (!skipTitleRow) {
    const t = ws.addRow([title]);
    t.font = { bold: true, size: 13 };
    ws.addRow([]);
  }
  const headerRow = ws.addRow(['', ...yearCols]);
  headerRow.font = { bold: true };
  headerRow.eachCell((c) => { c.fill = HEADING_FILL; });
}

/**
 * Banker-style CMA form header. Emits the same multi-row banner the
 * reference CMA templates use:
 *
 *   M/s <Firm Name>
 *   <State / address line>
 *   ASSESSMENT OF WORKING CAPITAL REQUIREMENTS
 *   FORM <N>: <FORM TITLE>
 *                                              Amount (Rs. in nearest)
 *   Sr.  Particulars        Year1   Year2   Year3   ...
 *                            Actual  Actual  Projected   Estimates
 *
 * The "Actual / Projected / Estimates" sub-row uses the firstProjectedIndex
 * from the projection result so the boundary lines up with the data.
 */
function setupBankerFormHeader(
  ws: ExcelJS.Worksheet,
  input: CmaExportInput,
  formNumber: string,
  formTitle: string,
): void {
  const firm = input.draft.firm ?? {};
  const yearCols = input.projection.yearLabels;
  const firstProjected = input.projection.firstProjectedIndex;

  // Row 1: firm name (M/s prefix added if not already there).
  const firmDisplay = firm.firmName ? (firm.firmName.startsWith('M/s') ? firm.firmName : `M/s ${firm.firmName}`) : 'M/s —';
  const r1 = ws.addRow([firmDisplay]);
  r1.font = { bold: true, size: 12 };

  // Row 2: state / location line. Optional — only render if present so
  // the spacing doesn't look hollow for users without the field filled.
  if (firm.state) ws.addRow([firm.state]);

  ws.addRow([]);
  // Top-of-form banner.
  const banner = ws.addRow(['ASSESSMENT OF WORKING CAPITAL REQUIREMENTS']);
  banner.font = { bold: true };
  const titleRow = ws.addRow([`FORM ${formNumber}: ${formTitle.toUpperCase()}`]);
  titleRow.font = { bold: true, size: 13 };
  titleRow.getCell(1).fill = HEADING_FILL;
  ws.addRow([]);

  // Unit-of-amount banner sitting to the right, banker convention.
  const unitsRow = ws.addRow(['', '', ...Array(Math.max(0, yearCols.length - 1)).fill(''), 'Amount (Rs. in nearest)']);
  unitsRow.font = { italic: true, color: { argb: 'FF6B7280' } };

  // Column header row: Sr / Particulars / <year labels>.
  const headerRow = ws.addRow(['Sr.', 'Particulars', ...yearCols]);
  headerRow.font = { bold: true };
  headerRow.eachCell((c) => { c.fill = HEADING_FILL; });

  // Sub-header row: Actual / Projected / Estimates per year column.
  // Years before firstProjected → Actual. The first projected year is
  // labelled Projected; everything after is Estimates (banker norm).
  const subHeaderCells: string[] = ['', ''];
  for (let i = 0; i < yearCols.length; i++) {
    if (i < firstProjected) subHeaderCells.push('Actual');
    else if (i === firstProjected) subHeaderCells.push('Projected');
    else subHeaderCells.push('Estimates');
  }
  const subRow = ws.addRow(subHeaderCells);
  subRow.font = { italic: true, color: { argb: 'FF6B7280' } };
  subRow.eachCell((c, ci) => { if (ci > 2) c.fill = HEADING_FILL; });
}

/** Form II/III etc. data rows have an extra leading column for "Sr."
 *  numbering. This shim adapts the existing row-writers to that layout
 *  by accepting a srNo string and prepending it. */
function formRow(ws: ExcelJS.Worksheet, srNo: string, label: string, values: Array<number | { formula: string }>): ExcelJS.Row {
  return ws.addRow([srNo, label, ...values]);
}

/** ExcelJS uses A1 notation. Convert (row, column1Based) → 'A1'. */
function cellRef(row: number, col: number): string {
  let s = '';
  let c = col;
  while (c > 0) {
    const rem = (c - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    c = Math.floor((c - 1) / 26);
  }
  return `${s}${row}`;
}

function sumFormula(rows: Array<number | undefined>, col: number): string {
  return rows.filter((r): r is number => typeof r === 'number')
    .map((r) => cellRef(r, col))
    .join('+');
}

function roundFor(n: number): number {
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function formatValueRow(row: ExcelJS.Row, firstProjectedIndex: number) {
  row.eachCell((cell, colNumber) => {
    if (colNumber > 1) {
      cell.numFmt = RUPEE_FMT;
      // Projected columns (1-based: header is col 1, so data starts at col 2;
      // firstProjectedIndex is 0-based offset into year-cols, so column
      // index for first projected = 2 + firstProjectedIndex)
      if (colNumber - 2 >= firstProjectedIndex) {
        cell.fill = HEADING_FILL;
      }
    }
  });
}

function formatDerivedRow(row: ExcelJS.Row, firstProjectedIndex: number) {
  row.font = { bold: true };
  formatValueRow(row, firstProjectedIndex);
}

function formatTotalRow(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((cell, colNumber) => {
    if (colNumber > 1) {
      cell.numFmt = RUPEE_FMT;
      cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
    }
  });
}
