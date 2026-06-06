/**
 * Multi-sheet Excel export for the ledger-comparison report.
 *
 * The single-CSV export (LedgerCompareView.buildCompareCsv) bundles
 * every status into one flat table. That's convenient for an Excel
 * filter-by-column workflow, but the user feedback (May 2026) was that
 * reviewing 80+ rows of mixed-status data is cognitively expensive —
 * each row needs a status read before the reviewer knows what
 * judgment they're applying. Splitting by category up-front lets the
 * reviewer attack one bucket at a time.
 *
 * Sheet layout:
 *
 *   1. Summary           — headline, counts per bucket, balance check
 *   2. Matched (clean)   — bill on both sides, same amount, same day,
 *                          no caveats. Sign off without further review.
 *   3. Matched (notes)   — paired with a qualifying condition: date
 *                          drift, amount-only (no shared bill),
 *                          cross-prefix bill, bulk-attribution,
 *                          bank-anchored, etc. Each row carries a
 *                          "Match basis" column explaining why it's
 *                          here so the reviewer knows what they're
 *                          OK-ing.
 *   4. Unmatched         — bill found on one side, no counterpart
 *                          anywhere on the other. Real reconciliation
 *                          items — chase with the counterparty.
 *   5. Can't match       — rows we couldn't extract a bill ref from
 *                          AND couldn't pair by date+amount. Often
 *                          opening/closing balance markers, period-end
 *                          adjustments, or ambiguous bank-narration
 *                          shorthand (e.g. "BILL PAYMENT" with no
 *                          number).
 *
 * Sheet 4 and 5 combine both sides (A and B) into a single sheet
 * each with a Side column, because the reviewer's "is the other side
 * missing this?" question is the same question regardless of which
 * side originally surfaced the row.
 */

import ExcelJS from 'exceljs';
import type { LedgerComparisonReport } from '../../../services/api';

const RUPEE_FMT = '#,##,##0.00;[Red](#,##,##0.00);"—"';
const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4EA' },
};
const SECTION_FILL: ExcelJS.FillPattern = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' },
};
const WARN_FILL: ExcelJS.FillPattern = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4D6' },
};

/** Format a YYYY-MM-DD date as DD/MM/YYYY for Indian-locale display.
 *  Returns the raw input when it's null/empty so blank cells stay blank. */
function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Day delta between two ISO dates; null if either is unparseable. */
function dayDelta(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.round(Math.abs(tb - ta) / (24 * 60 * 60 * 1000));
}

/** Apply a header style + freeze the top row on a sheet. */
function styleHeader(ws: ExcelJS.Worksheet) {
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  // Autofilter on the header row across all columns.
  if (ws.columns.length > 0) {
    const lastCol = String.fromCharCode(64 + ws.columns.length);
    ws.autoFilter = { from: 'A1', to: `${lastCol}1` };
  }
}

/** Build and return the workbook as a Blob ready for download. */
export async function buildCompareWorkbook(
  report: LedgerComparisonReport,
  labelA: string,
  labelB: string,
): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smartbiz Tax Assistant';
  wb.created = new Date();

  buildSummarySheet(wb, report, labelA, labelB);
  buildCleanMatchedSheet(wb, report, labelA, labelB);
  buildNotesMatchedSheet(wb, report, labelA, labelB);
  buildUnmatchedSheet(wb, report, labelA, labelB);
  buildCantMatchSheet(wb, report, labelA, labelB);

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// ─── Sheet 1: Summary ─────────────────────────────────────────────

function buildSummarySheet(
  wb: ExcelJS.Workbook,
  report: LedgerComparisonReport,
  labelA: string,
  labelB: string,
) {
  const ws = wb.addWorksheet('Summary');
  ws.columns = [
    { width: 38 },
    { width: 18 },
    { width: 60 },
  ];

  // Headline at the top so the very first cell tells the user what
  // they're looking at without needing to scan rows.
  ws.addRow(['Reconciliation summary']).font = { bold: true, size: 14 };
  ws.addRow([]);
  ws.addRow(['Headline', '', report.summary.headline]).font = { bold: true };
  ws.addRow([`Side A (${labelA})`, '', `${report.summary.totalA.toLocaleString('en-IN')} transactions`]);
  ws.addRow([`Side B (${labelB})`, '', `${report.summary.totalB.toLocaleString('en-IN')} transactions`]);
  ws.addRow([]);

  // Match counts. Group by category so the user can see at a glance
  // how many rows are in each output sheet.
  const sectionRow = ws.addRow(['Match counts', 'Count', 'Notes']);
  sectionRow.font = { bold: true };
  sectionRow.fill = SECTION_FILL;

  // Compute the "clean" vs "notes" split that the matched sheets use.
  const { clean: cleanMatched, notes: notesMatched } = splitMatchedByCondition(report);

  const rows: Array<[string, number, string]> = [
    ['Matched (clean) — sign off',
      cleanMatched.length,
      'Bill key matches on both sides at the same amount and date — or paired with a journal entry on exactly the same day.'],
    ['Matched (with notes) — review',
      notesMatched.length,
      'Same underlying transaction but with a caveat: date drift, amount-only, cross-prefix bill, symmetric duplicates, bank-anchored, or amount mismatch on the same bill.'],
    ['Unmatched — chase counterparty',
      report.summary.onlyInACount + report.summary.onlyInBCount,
      'Bill found on one side, no counterpart anywhere on the other. Real reconciliation items.'],
    [`Can’t match (${labelA})`,
      report.summary.noBillCountA,
      `${labelA} rows where the matcher could not extract a bill reference AND could not pair by date+amount.`],
    [`Can’t match (${labelB})`,
      report.summary.noBillCountB,
      `${labelB} rows where the matcher could not extract a bill reference AND could not pair by date+amount.`],
  ];
  for (const [label, count, note] of rows) {
    const r = ws.addRow([label, count, note]);
    if (count > 0 && (label.startsWith('Matched (with notes)') || label.startsWith('Unmatched') || label.startsWith('Can’t match'))) {
      r.fill = WARN_FILL;
    }
  }

  ws.addRow([]);
  const balRow = ws.addRow(['Balance check', '', '']);
  balRow.font = { bold: true };
  balRow.fill = SECTION_FILL;
  ws.addRow([`Opening ${labelA}`, report.balanceCheck.openingA]);
  ws.addRow([`Opening ${labelB}`, report.balanceCheck.openingB]);
  ws.addRow(['Opening gap', report.balanceCheck.openingGap]);
  ws.addRow([`Closing ${labelA}`, report.balanceCheck.closingA]);
  ws.addRow([`Closing ${labelB}`, report.balanceCheck.closingB]);
  ws.addRow(['Closing gap', report.balanceCheck.closingGap]);
  ws.addRow(['Note', '', report.balanceCheck.note]);

  // Format the numeric balance-check cells as ₹.
  for (const rowNum of [balRow.number + 1, balRow.number + 2, balRow.number + 3, balRow.number + 4, balRow.number + 5, balRow.number + 6]) {
    const cell = ws.getCell(rowNum, 2);
    cell.numFmt = RUPEE_FMT;
  }

  styleHeader(ws);
}

// ─── Sheet 2: Matched (clean) ─────────────────────────────────────

function buildCleanMatchedSheet(
  wb: ExcelJS.Workbook,
  report: LedgerComparisonReport,
  labelA: string,
  labelB: string,
) {
  const ws = wb.addWorksheet('Matched (clean)');
  ws.columns = [
    { header: 'Bill', key: 'bill', width: 28 },
    { header: 'Date', key: 'date', width: 12 },
    { header: `${labelA} amount`, key: 'amountA', width: 14, style: { numFmt: RUPEE_FMT } },
    { header: `${labelB} amount`, key: 'amountB', width: 14, style: { numFmt: RUPEE_FMT } },
    { header: `${labelA} narration`, key: 'narrationA', width: 60 },
    { header: `${labelB} narration`, key: 'narrationB', width: 60 },
  ];
  const { clean } = splitMatchedByCondition(report);
  for (const row of clean) {
    ws.addRow({
      bill: row.bill,
      date: fmtDate(row.dateA ?? row.dateB ?? null),
      amountA: row.amountA,
      amountB: row.amountB,
      narrationA: row.narrationA,
      narrationB: row.narrationB,
    });
  }
  styleHeader(ws);
}

// ─── Sheet 3: Matched (with notes) ────────────────────────────────

function buildNotesMatchedSheet(
  wb: ExcelJS.Workbook,
  report: LedgerComparisonReport,
  labelA: string,
  labelB: string,
) {
  const ws = wb.addWorksheet('Matched (with notes)');
  ws.columns = [
    { header: 'Match basis', key: 'basis', width: 38 },
    { header: 'Bill', key: 'bill', width: 28 },
    { header: `${labelA} date`, key: 'dateA', width: 12 },
    { header: `${labelB} date`, key: 'dateB', width: 12 },
    { header: 'Gap', key: 'gap', width: 8 },
    { header: `${labelA} amount`, key: 'amountA', width: 14, style: { numFmt: RUPEE_FMT } },
    { header: `${labelB} amount`, key: 'amountB', width: 14, style: { numFmt: RUPEE_FMT } },
    { header: 'Diff', key: 'diff', width: 12, style: { numFmt: RUPEE_FMT } },
    { header: `${labelA} narration`, key: 'narrationA', width: 60 },
    { header: `${labelB} narration`, key: 'narrationB', width: 60 },
  ];
  const { notes } = splitMatchedByCondition(report);
  for (const row of notes) {
    const gap = dayDelta(row.dateA, row.dateB);
    ws.addRow({
      basis: row.basis,
      bill: row.bill,
      dateA: fmtDate(row.dateA),
      dateB: fmtDate(row.dateB),
      gap: gap === null ? '' : (gap === 0 ? '—' : `${gap}d`),
      amountA: row.amountA,
      amountB: row.amountB,
      diff: row.diff ?? '',
      narrationA: row.narrationA,
      narrationB: row.narrationB,
    });
  }
  styleHeader(ws);
}

// ─── Sheet 4: Unmatched ──────────────────────────────────────────

function buildUnmatchedSheet(
  wb: ExcelJS.Workbook,
  report: LedgerComparisonReport,
  labelA: string,
  labelB: string,
) {
  const ws = wb.addWorksheet('Unmatched');
  ws.columns = [
    { header: 'Side', key: 'side', width: 16 },
    { header: 'Bill', key: 'bill', width: 28 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Amount', key: 'amount', width: 14, style: { numFmt: RUPEE_FMT } },
    { header: 'Narration', key: 'narration', width: 80 },
  ];
  for (const row of report.onlyInA) {
    ws.addRow({
      side: labelA,
      bill: row.bill,
      date: fmtDate(row.date),
      amount: row.amount,
      narration: row.narration,
    });
  }
  for (const row of report.onlyInB) {
    ws.addRow({
      side: labelB,
      bill: row.bill,
      date: fmtDate(row.date),
      amount: row.amount,
      narration: row.narration,
    });
  }
  styleHeader(ws);
}

// ─── Sheet 5: Can't match ─────────────────────────────────────────

function buildCantMatchSheet(
  wb: ExcelJS.Workbook,
  report: LedgerComparisonReport,
  labelA: string,
  labelB: string,
) {
  const ws = wb.addWorksheet('Can’t match');
  ws.columns = [
    { header: 'Side', key: 'side', width: 16 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Amount', key: 'amount', width: 14, style: { numFmt: RUPEE_FMT } },
    { header: 'Narration', key: 'narration', width: 100 },
  ];
  for (const row of report.noBillA) {
    ws.addRow({
      side: labelA,
      date: fmtDate(row.date),
      amount: row.amount,
      narration: row.narration,
    });
  }
  for (const row of report.noBillB) {
    ws.addRow({
      side: labelB,
      date: fmtDate(row.date),
      amount: row.amount,
      narration: row.narration,
    });
  }
  styleHeader(ws);
}

// ─── The "clean vs notes" classifier ──────────────────────────────

interface CleanMatchedRow {
  bill: string;
  dateA: string | null;
  dateB: string | null;
  amountA: number;
  amountB: number;
  narrationA: string;
  narrationB: string;
}

interface NotesMatchedRow extends CleanMatchedRow {
  basis: string;
  diff: number | null;
}

/**
 * Split the union of all matched / qualified / mismatched rows across
 * the report into two output buckets:
 *   - clean: bill present on both sides, exact amount, same date (or
 *            payment matched on same date with same amount). No
 *            judgment required — sign off.
 *   - notes: matched with a caveat. Each row gets a `basis` explaining
 *            the condition so the reviewer knows what they're agreeing
 *            to.
 *
 * The classifier walks every "matched-like" bucket in the report and
 * tags each row appropriately:
 *   - matched           → "Exact bill match" (clean) OR
 *                         "Cross-prefix bill" / "Date drift Nd" / etc.
 *                         when the bill string contains "↔" or the
 *                         dates don't agree
 *   - amountMismatches  → "Bill matched, amount differs by ₹X" (notes)
 *   - paymentMatches    → "Date+amount, same day" (clean) OR
 *                         "Date+amount, dates ±Nd apart / bulk-pair"
 *                         (notes) when dateB is populated
 *   - paymentDateMatches → "Same date, amount differs" (notes)
 *   - paymentBankMatches → "Bank-anchored, ±Nd/±X%" (notes)
 *   - amountOnlyMatches → "Amount only, Nd apart" (notes)
 */
function splitMatchedByCondition(
  report: LedgerComparisonReport,
): { clean: CleanMatchedRow[]; notes: NotesMatchedRow[] } {
  const clean: CleanMatchedRow[] = [];
  const notes: NotesMatchedRow[] = [];

  // Bill-key matched bucket — split based on whether the bill carries
  // the digit-tail "A ↔ B" marker (qualified) or the dates differ
  // (qualified) or it's fully clean.
  for (const row of report.matched) {
    const isCrossPrefix = row.bill.includes(' ↔ ');
    const gap = dayDelta(row.dateA, row.dateB);
    const hasDateDrift = gap !== null && gap > 0;
    if (!isCrossPrefix && !hasDateDrift) {
      clean.push({
        bill: row.bill,
        dateA: row.dateA,
        dateB: row.dateB,
        amountA: row.amountA,
        amountB: row.amountB,
        narrationA: row.narrationA,
        narrationB: row.narrationB,
      });
    } else {
      const basisParts: string[] = [];
      if (isCrossPrefix) basisParts.push('Cross-prefix bill (digit-tail)');
      if (hasDateDrift) basisParts.push(`Date drift ${gap}d`);
      notes.push({
        basis: basisParts.join(' · '),
        bill: row.bill,
        dateA: row.dateA,
        dateB: row.dateB,
        amountA: row.amountA,
        amountB: row.amountB,
        narrationA: row.narrationA,
        narrationB: row.narrationB,
        diff: null,
      });
    }
  }

  // Bills matched but amount disagrees — always a notes row.
  for (const row of report.amountMismatches) {
    notes.push({
      basis: `Bill matched, amount differs by ₹${row.diff.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
      bill: row.bill,
      dateA: row.dateA,
      dateB: row.dateB,
      amountA: row.amountA,
      amountB: row.amountB,
      narrationA: row.narrationA,
      narrationB: row.narrationB,
      diff: row.diff,
    });
  }

  // Payment matches (no shared bill). Clean when dates agree (Pass 1
  // exact); notes when dateB is populated (Pass 1.5 window or bulk-pair).
  for (const row of report.paymentMatches) {
    const datesDiffer = row.dateB && row.dateB !== row.date;
    if (!datesDiffer) {
      clean.push({
        bill: '—',                          // no shared bill
        dateA: row.date,
        dateB: row.date,
        amountA: row.amountA,
        amountB: row.amountB,
        narrationA: row.narrationA + (row.bankRefA ? ` [ref ${row.bankRefA}]` : ''),
        narrationB: row.narrationB + (row.bankRefB ? ` [ref ${row.bankRefB}]` : ''),
      });
    } else {
      const gap = dayDelta(row.date, row.dateB ?? null);
      notes.push({
        basis: `Date+amount pair, dates ${gap}d apart`,
        bill: '—',
        dateA: row.date,
        dateB: row.dateB ?? null,
        amountA: row.amountA,
        amountB: row.amountB,
        narrationA: row.narrationA + (row.bankRefA ? ` [ref ${row.bankRefA}]` : ''),
        narrationB: row.narrationB + (row.bankRefB ? ` [ref ${row.bankRefB}]` : ''),
        diff: row.diff > 0 ? row.diff : null,
      });
    }
  }

  // Payment date matches (same date, amount differs — always notes).
  for (const row of report.paymentDateMatches) {
    notes.push({
      basis: `Same date, amount differs by ₹${row.diff.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
      bill: '—',
      dateA: row.date,
      dateB: row.date,
      amountA: row.amountA,
      amountB: row.amountB,
      narrationA: row.narrationA + (row.bankRefA ? ` [ref ${row.bankRefA}]` : ''),
      narrationB: row.narrationB + (row.bankRefB ? ` [ref ${row.bankRefB}]` : ''),
      diff: row.diff,
    });
  }

  // Bank-anchored pairs — always notes (the loosest of the loose).
  for (const row of report.paymentBankMatches) {
    const basisCondition = row.matchedBy === 'date'
      ? (row.dateDeltaDays === 0 ? 'same date' : `dates ±${Math.abs(row.dateDeltaDays)}d`)
      : `amount within tol, ${row.dateDeltaDays}d apart`;
    notes.push({
      basis: `Bank-anchored (${row.bankAnchor}, ${basisCondition})`,
      bill: '—',
      dateA: row.dateA,
      dateB: row.dateB,
      amountA: row.amountA,
      amountB: row.amountB,
      narrationA: row.narrationA + (row.bankRefA ? ` [ref ${row.bankRefA}]` : ''),
      narrationB: row.narrationB + (row.bankRefB ? ` [ref ${row.bankRefB}]` : ''),
      diff: row.diff > 0 ? row.diff : null,
    });
  }

  // Amount-only matches — always notes (the date gap is the whole
  // point of the bucket).
  for (const row of report.amountOnlyMatches) {
    notes.push({
      basis: row.dateGapDays === 0
        ? 'Amount only, same date'
        : `Amount only, ${row.dateGapDays}d apart`,
      bill: row.bill,
      dateA: row.dateA,
      dateB: row.dateB,
      amountA: row.amountA,
      amountB: row.amountB,
      narrationA: row.narrationA,
      narrationB: row.narrationB,
      diff: row.diff > 0 ? row.diff : null,
    });
  }

  return { clean, notes };
}
