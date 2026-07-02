/**
 * "Bank Summary" Excel export, built from a bank statement's
 * transactions. Mirrors the CA-office workbook format (the
 * MS MANREET KAUR HDFC sample): one sheet, receipts and payments as
 * party-grouped sections with LIVE =SUM() subtotals, so the reviewer
 * can click any total and audit the math in Excel.
 *
 * Layout (column A left blank as a gutter, data in B..F):
 *
 *   B1  ACCOUNT HOLDER
 *   B2  BANK NAME
 *   B3  ACCOUNT NO: ...
 *   B4  PERIOD FROM DD.MM.YYYY TO DD.MM.YYYY
 *   B6  DATE | PARTICULARS | AMOUNT (in Rs.) | SUB TOTAL (in Rs.) | TOTAL (in Rs.)
 *   B7  BAL B/F ................................ opening in TOTAL
 *   B8  ADD | RECEIPTS / DEPOSITS
 *       — one group per party: amounts in AMOUNT, =SUM() subtotal in
 *         SUB TOTAL on the group's last row; single-row groups put the
 *         amount straight into SUB TOTAL; blank row between groups.
 *       — last receipts row also carries =SUM(subtotals) in TOTAL.
 *       — then a row totalling opening + receipts.
 *   ... LESS | WITHDRAWALS / PAYMENTS (same pattern)
 *   ... BALANCE AS PER STATEMENT = (opening + receipts) − payments
 *
 * Opening balance is derived from the earliest dated transaction that
 * carries a running balance (balance − amount). When no transaction
 * has a balance column, the BAL B/F cell is left at 0 — the formulas
 * still tie internally.
 */
import ExcelJS from 'exceljs';
import type { BankTransaction } from '../services/api';
import type { PartyLedgerMeta, LedgerParty } from './partyLedgerPdf';

const COL = { date: 'B', part: 'C', amount: 'D', sub: 'E', total: 'F' } as const;
const NUM_FMT = '#,##0.00';

function fmtDot(d: string | null | undefined): string {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d;
}

/** Opening balance from the earliest dated txn with a running balance. */
function deriveOpening(txns: BankTransaction[]): number | null {
  const dated = txns
    .filter((t) => t.date && t.balance !== null && t.balance !== undefined)
    .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));
  const first = dated[0];
  if (!first) return null;
  return Math.round((first.balance! - first.amount) * 100) / 100;
}

function txnRange(txns: BankTransaction[]): [string | null, string | null] {
  const dated = txns.map((t) => t.date).filter((d): d is string => !!d).sort();
  return [dated[0] ?? null, dated[dated.length - 1] ?? null];
}

interface Group {
  name: string;
  rows: { date: string | null; amount: number }[];
}

/** Split each party's txns into a receipts group and a payments group,
 *  ordered by section volume (largest first), rows chronological. */
function buildGroups(parties: LedgerParty[]): { receipts: Group[]; payments: Group[] } {
  const receipts: Group[] = [];
  const payments: Group[] = [];
  for (const p of parties) {
    const sorted = [...p.txns].sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
    const cr = sorted.filter((t) => t.amount > 0).map((t) => ({ date: t.date, amount: t.amount }));
    const dr = sorted.filter((t) => t.amount < 0).map((t) => ({ date: t.date, amount: Math.abs(t.amount) }));
    if (cr.length) receipts.push({ name: p.name, rows: cr });
    if (dr.length) payments.push({ name: p.name, rows: dr });
  }
  const vol = (g: Group) => g.rows.reduce((s, r) => s + r.amount, 0);
  receipts.sort((a, b) => vol(b) - vol(a));
  payments.sort((a, b) => vol(b) - vol(a));
  return { receipts, payments };
}

export async function buildBankSummaryWorkbook(
  parties: LedgerParty[],
  meta: PartyLedgerMeta = {},
  opts: {
    /** Carry the statement's derived opening balance into BAL B/F.
     *  True for the whole-statement summary; false for a single party's
     *  ledger, which starts at 0 (a bank statement carries no
     *  brought-forward PARTY balance — same convention as the PDF). */
    includeOpening?: boolean;
  } = {},
): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Bank Summary');
  ws.columns = [
    { width: 3 },   // A gutter
    { width: 13 },  // B date
    { width: 58 },  // C particulars
    { width: 16 },  // D amount
    { width: 16 },  // E sub total
    { width: 16 },  // F total
  ];

  const allTxns = parties.flatMap((p) => p.txns);
  const [dFrom, dTo] = txnRange(allTxns);
  const opening = (opts.includeOpening ?? true) ? deriveOpening(allTxns) ?? 0 : 0;

  let r = 1;
  const setHeader = (text: string, bold = true) => {
    const c = ws.getCell(`${COL.date}${r}`);
    c.value = text;
    c.font = { bold, size: bold ? 11 : 10 };
    r += 1;
  };
  if (meta.accountHolder) setHeader(meta.accountHolder.toUpperCase());
  if (meta.bankName) setHeader(meta.bankName.toUpperCase());
  if (meta.accountLabel) setHeader(`ACCOUNT NO: ${meta.accountLabel}`);
  const pf = meta.periodFrom ?? dFrom;
  const pt = meta.periodTo ?? dTo;
  if (pf || pt) setHeader(`PERIOD FROM ${fmtDot(pf) || '...'} TO ${fmtDot(pt) || '...'}`);

  // Column header row.
  const headRow = r;
  const heads: Array<[string, string]> = [
    [COL.date, 'DATE'],
    [COL.part, 'PARTICULARS'],
    [COL.amount, 'AMOUNT (in Rs.)'],
    [COL.sub, 'SUB TOTAL (in Rs.)'],
    [COL.total, 'TOTAL (in Rs.)'],
  ];
  for (const [col, label] of heads) {
    const c = ws.getCell(`${col}${headRow}`);
    c.value = label;
    c.font = { bold: true };
    c.alignment = { horizontal: col === COL.date || col === COL.part ? 'left' : 'right' };
    c.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
  }
  r += 1;

  // BAL B/F.
  const balBfRow = r;
  ws.getCell(`${COL.date}${r}`).value = fmtDot(pf) || '';
  ws.getCell(`${COL.part}${r}`).value = 'BAL B/F';
  ws.getCell(`${COL.part}${r}`).font = { bold: true };
  const bfCell = ws.getCell(`${COL.total}${r}`);
  bfCell.value = opening;
  bfCell.numFmt = NUM_FMT;
  bfCell.font = { bold: true };
  r += 1;

  const { receipts, payments } = buildGroups(parties);

  /** Emit one section (ADD receipts / LESS payments). Returns the row
   *  holding the section's grand total (the =SUM over subtotals). */
  const emitSection = (label: [string, string], groups: Group[]): number => {
    ws.getCell(`${COL.date}${r}`).value = label[0];
    ws.getCell(`${COL.date}${r}`).font = { bold: true };
    ws.getCell(`${COL.part}${r}`).value = label[1];
    ws.getCell(`${COL.part}${r}`).font = { bold: true };
    const sectionStart = r;
    r += 1;

    let lastDataRow = r - 1;
    for (const g of groups) {
      const start = r;
      for (let i = 0; i < g.rows.length; i++) {
        const row = g.rows[i];
        ws.getCell(`${COL.date}${r}`).value = fmtDot(row.date);
        ws.getCell(`${COL.part}${r}`).value = g.name;
        if (g.rows.length === 1) {
          // Single-row group: amount goes straight into SUB TOTAL.
          const c = ws.getCell(`${COL.sub}${r}`);
          c.value = row.amount;
          c.numFmt = NUM_FMT;
        } else {
          const c = ws.getCell(`${COL.amount}${r}`);
          c.value = row.amount;
          c.numFmt = NUM_FMT;
          if (i === g.rows.length - 1) {
            const s = ws.getCell(`${COL.sub}${r}`);
            s.value = { formula: `SUM(${COL.amount}${start}:${COL.amount}${r})` };
            s.numFmt = NUM_FMT;
            s.font = { bold: true };
          }
        }
        lastDataRow = r;
        r += 1;
      }
      r += 1; // blank row between groups
    }

    // Section grand total: sum of the SUB TOTAL column over the section.
    const totalCell = ws.getCell(`${COL.total}${lastDataRow}`);
    totalCell.value = { formula: `SUM(${COL.sub}${sectionStart}:${COL.sub}${lastDataRow})` };
    totalCell.numFmt = NUM_FMT;
    totalCell.font = { bold: true };
    return lastDataRow;
  };

  const receiptsTotalRow = emitSection(['ADD', 'RECEIPTS / DEPOSITS'], receipts);

  // Opening + receipts.
  const subTotalRow = r;
  ws.getCell(`${COL.part}${r}`).value = 'TOTAL (BAL B/F + RECEIPTS)';
  ws.getCell(`${COL.part}${r}`).font = { bold: true };
  const stCell = ws.getCell(`${COL.total}${r}`);
  stCell.value = { formula: `${COL.total}${balBfRow}+${COL.total}${receiptsTotalRow}` };
  stCell.numFmt = NUM_FMT;
  stCell.font = { bold: true };
  stCell.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
  r += 2;

  const paymentsTotalRow = emitSection(['LESS', 'WITHDRAWALS / PAYMENTS'], payments);

  // Closing balance.
  ws.getCell(`${COL.date}${r}`).value = fmtDot(pt) || '';
  ws.getCell(`${COL.part}${r}`).value = (opts.includeOpening ?? true)
    ? 'BALANCE AS PER STATEMENT'
    : 'NET (RECEIPTS - PAYMENTS)';
  ws.getCell(`${COL.part}${r}`).font = { bold: true };
  const closeCell = ws.getCell(`${COL.total}${r}`);
  closeCell.value = { formula: `${COL.total}${subTotalRow}-${COL.total}${paymentsTotalRow}` };
  closeCell.numFmt = NUM_FMT;
  closeCell.font = { bold: true };
  closeCell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function safeName(s: string): string {
  return (s || 'party').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'party';
}

export async function downloadCombinedLedgerXlsx(
  parties: LedgerParty[],
  meta: PartyLedgerMeta = {},
): Promise<void> {
  const blob = await buildBankSummaryWorkbook(parties, meta);
  const base = meta.accountHolder ? safeName(meta.accountHolder) : 'bank';
  const today = new Date().toISOString().slice(0, 10);
  triggerDownload(blob, `${base}-bank-summary-${today}.xlsx`);
}

export async function downloadPartyLedgerXlsx(
  partyName: string,
  txns: BankTransaction[],
  meta: PartyLedgerMeta = {},
): Promise<void> {
  const blob = await buildBankSummaryWorkbook([{ name: partyName, txns }], meta, { includeOpening: false });
  triggerDownload(blob, `ledger-${safeName(partyName)}.xlsx`);
}
