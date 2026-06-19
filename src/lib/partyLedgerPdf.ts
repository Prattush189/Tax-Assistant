/**
 * Party-wise ledger PDF, built from a bank statement's transactions.
 *
 * The "Top counterparties" panel groups every transaction by party; this
 * turns ONE party's slice into a printable T-account-style ledger the
 * user can hand to a CA or attach to the party's file:
 *
 *   Date | Particulars | Debit | Credit | Balance(Dr/Cr)
 *
 * Sign convention (from the account holder's books):
 *   - money PAID to the party (statement outflow, amount < 0) → Debit
 *     (the party's account is debited)
 *   - money RECEIVED from the party (statement inflow, amount > 0) →
 *     Credit
 *   - running Balance is Debit-positive (Dr) and carries a Dr/Cr suffix,
 *     the way Tally prints a party ledger.
 *
 * Opening balance is 0 — a bank statement doesn't carry the party's
 * brought-forward balance, so we start fresh and the footer says so.
 *
 * jsPDF's default Helvetica is WinAnsi-encoded: a single non-Latin-1
 * code point (₹, en-dash, curly quote, …) breaks glyph shaping for the
 * WHOLE string, so every user-supplied string is run through sanitize()
 * and money is printed "Rs." not "₹".
 */
import { jsPDF } from 'jspdf';
import type { BankTransaction } from '../services/api';

function sanitize(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

function rs(n: number): string {
  const v = Math.round(Math.abs(n) * 100) / 100;
  return 'Rs. ' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

function balanceLabel(n: number): string {
  // Dr-positive convention; 0 carries no suffix.
  return rs(n) + (n > 0.005 ? ' Dr' : n < -0.005 ? ' Cr' : '');
}

export interface PartyLedgerMeta {
  bankName?: string | null;
  accountLabel?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
}

/** Build the ledger doc (no download) — separated so it's unit-testable
 *  without a DOM. */
export function buildPartyLedgerDoc(
  partyName: string,
  txns: BankTransaction[],
  meta: PartyLedgerMeta = {},
): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const mL = 12, mR = 12;
  const right = pageW - mR;

  // Chronological, undated rows last.
  const rows = [...txns].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });

  const X = { date: mL, part: mL + 23, debitR: 132, creditR: 165, balR: right };
  const partWrap = X.debitR - X.part - 4;
  const lineH = 4.2;
  let y = 0;

  const drawColHead = () => {
    doc.setDrawColor(170); doc.line(mL, y, right, y); y += 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    doc.text('Date', X.date, y);
    doc.text('Particulars', X.part, y);
    doc.text('Debit', X.debitR, y, { align: 'right' });
    doc.text('Credit', X.creditR, y, { align: 'right' });
    doc.text('Balance', X.balR, y, { align: 'right' });
    y += 1.5; doc.line(mL, y, right, y); y += 4.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  };

  const header = () => {
    y = 16;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(sanitize(partyName) || 'Ledger', mL, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    doc.text('Ledger Account', mL, y); y += 5;
    const sub: string[] = [];
    if (meta.bankName) sub.push(sanitize(meta.bankName));
    if (meta.accountLabel) sub.push('A/c ' + sanitize(meta.accountLabel));
    if (sub.length) { doc.text(sub.join('   |   '), mL, y); y += 5; }
    const pf = meta.periodFrom ?? (rows.length ? rows[0].date : null);
    const pt = meta.periodTo ?? (rows.length ? rows[rows.length - 1].date : null);
    if (pf || pt) {
      doc.text(`Period: ${fmtDate(pf) || '...'} to ${fmtDate(pt) || '...'}`, mL, y); y += 5;
    }
    doc.setFontSize(7.5); doc.setTextColor(120);
    doc.text('Generated from a bank statement by Smartbiz AI - opening balance not carried; verify against books of account.', mL, y);
    doc.setTextColor(0); y += 3;
    drawColHead();
  };

  header();

  // Opening balance line.
  let balance = 0;
  doc.setFont('helvetica', 'italic');
  doc.text('Opening Balance', X.part, y);
  doc.text(rs(0), X.balR, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  y += 6;

  let totalDr = 0, totalCr = 0;
  for (const t of rows) {
    const debit = t.amount < 0 ? Math.abs(t.amount) : 0;   // paid to party
    const credit = t.amount > 0 ? t.amount : 0;            // received from party
    totalDr += debit; totalCr += credit;
    balance += debit - credit;

    const narr = sanitize(t.narration || t.counterparty || '-') || '-';
    const partLines = doc.splitTextToSize(narr, partWrap) as string[];
    const allLines = t.reference ? [...partLines, sanitize('Ref: ' + t.reference)] : partLines;
    const rowH = Math.max(lineH, allLines.length * lineH) + 1.5;

    if (y + rowH > pageH - 20) { doc.addPage(); header(); }

    const yTop = y;
    doc.text(fmtDate(t.date), X.date, yTop);
    allLines.forEach((ln, i) => doc.text(ln, X.part, yTop + i * lineH));
    if (debit) doc.text(rs(debit), X.debitR, yTop, { align: 'right' });
    if (credit) doc.text(rs(credit), X.creditR, yTop, { align: 'right' });
    doc.text(balanceLabel(balance), X.balR, yTop, { align: 'right' });
    y = yTop + rowH;
  }

  if (y + 18 > pageH - 12) { doc.addPage(); header(); }
  y += 1.5; doc.setDrawColor(120); doc.line(mL, y, right, y); y += 5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(`${rows.length} transaction${rows.length === 1 ? '' : 's'}`, X.date, y);
  doc.text(rs(totalDr), X.debitR, y, { align: 'right' });
  doc.text(rs(totalCr), X.creditR, y, { align: 'right' });
  doc.text('Closing ' + balanceLabel(balance), X.balR, y, { align: 'right' });
  y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(120);
  doc.text('Debit = paid to party (outflow).  Credit = received from party (inflow).', mL, y);

  return doc;
}

export function downloadPartyLedgerPdf(
  partyName: string,
  txns: BankTransaction[],
  meta: PartyLedgerMeta = {},
): void {
  const doc = buildPartyLedgerDoc(partyName, txns, meta);
  const safe = (partyName || 'party').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'party';
  doc.save(`ledger-${safe}.pdf`);
}
