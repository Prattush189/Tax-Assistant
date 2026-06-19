/**
 * Party-wise ledger PDF, built from a bank statement's transactions.
 *
 * Two products share one section renderer:
 *   - buildPartyLedgerDoc()    : a single party's ledger.
 *   - buildCombinedLedgerDoc() : a "ledger book" — every party, each as
 *                                its own ledger-account section, in one
 *                                document.
 *
 * Each section is a T-account-style ledger:
 *   Date | Particulars | Debit | Credit | Balance(Dr/Cr)
 *
 * Sign convention (from the account holder's books):
 *   - money PAID to the party   (outflow, amount < 0) → Debit
 *   - money RECEIVED from party  (inflow,  amount > 0) → Credit
 *   - running Balance is Debit-positive (Dr), with a Dr/Cr suffix the
 *     way Tally prints a party ledger.
 *
 * Opening balance is 0 — a bank statement carries no brought-forward
 * party balance, so each section starts fresh and the footer says so.
 *
 * jsPDF's default Helvetica is WinAnsi-encoded: a single non-Latin-1
 * code point (₹, en-dash, curly quote, …) breaks glyph shaping for the
 * WHOLE string, so every user-supplied string goes through sanitize()
 * and money prints "Rs." not "₹".
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
  return rs(n) + (n > 0.005 ? ' Dr' : n < -0.005 ? ' Cr' : '');
}

export interface PartyLedgerMeta {
  bankName?: string | null;
  accountLabel?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
}

export interface LedgerParty {
  name: string;
  txns: BankTransaction[];
}

// ── Shared layout ──────────────────────────────────────────────────
const M_L = 12, M_R = 12;
const LINE_H = 4.2;

interface Ctx {
  doc: jsPDF;
  pageW: number;
  pageH: number;
  right: number;
  X: { date: number; part: number; debitR: number; creditR: number; balR: number };
  partWrap: number;
  /** Slim banner text repeated atop every continuation page. */
  runningTitle: string;
  y: number;
}

function makeCtx(doc: jsPDF, runningTitle: string): Ctx {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const right = pageW - M_R;
  const X = { date: M_L, part: M_L + 23, debitR: 132, creditR: 165, balR: right };
  return { doc, pageW, pageH, right, X, partWrap: X.debitR - X.part - 4, runningTitle, y: 0 };
}

/** Slim running banner drawn at the top of every continuation page. */
function pageBanner(ctx: Ctx) {
  const { doc, right } = ctx;
  ctx.y = 12;
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(130);
  doc.text(sanitize(ctx.runningTitle) + ' (contd.)', M_L, ctx.y);
  doc.setTextColor(0); doc.setDrawColor(210); doc.line(M_L, ctx.y + 1.5, right, ctx.y + 1.5);
  ctx.y += 5;
}

function colHead(ctx: Ctx) {
  const { doc, X, right } = ctx;
  doc.setDrawColor(170); doc.line(M_L, ctx.y, right, ctx.y); ctx.y += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
  doc.text('Date', X.date, ctx.y);
  doc.text('Particulars', X.part, ctx.y);
  doc.text('Debit', X.debitR, ctx.y, { align: 'right' });
  doc.text('Credit', X.creditR, ctx.y, { align: 'right' });
  doc.text('Balance', X.balR, ctx.y, { align: 'right' });
  ctx.y += 1.5; doc.line(M_L, ctx.y, right, ctx.y); ctx.y += 4.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
}

/** Document title block (page 1 only). */
function docTitle(ctx: Ctx, title: string, meta: PartyLedgerMeta, derivedFrom: string | null, derivedTo: string | null) {
  const { doc } = ctx;
  ctx.y = 16;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(sanitize(title) || 'Ledger', M_L, ctx.y); ctx.y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  const sub: string[] = [];
  if (meta.bankName) sub.push(sanitize(meta.bankName));
  if (meta.accountLabel) sub.push('A/c ' + sanitize(meta.accountLabel));
  if (sub.length) { doc.text(sub.join('   |   '), M_L, ctx.y); ctx.y += 5; }
  const pf = meta.periodFrom ?? derivedFrom;
  const pt = meta.periodTo ?? derivedTo;
  if (pf || pt) { doc.text(`Period: ${fmtDate(pf) || '...'} to ${fmtDate(pt) || '...'}`, M_L, ctx.y); ctx.y += 5; }
  doc.setFontSize(7.5); doc.setTextColor(120);
  doc.text('Generated from a bank statement by Smartbiz AI - opening balance not carried; verify against books of account.', M_L, ctx.y);
  doc.setTextColor(0); ctx.y += 4;
}

/** Render ONE party's ledger section at ctx.y, handling page breaks.
 *  Returns nothing; advances ctx.y past the section. */
function renderPartySection(ctx: Ctx, partyName: string, txns: BankTransaction[]) {
  const { doc, X, right, pageH } = ctx;
  ctx.runningTitle = partyName;

  // Keep the heading + column head + first row together: if we're too
  // far down the page to fit them, break first.
  if (ctx.y > pageH - 40) { doc.addPage(); pageBanner(ctx); }

  // Party heading.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(sanitize(partyName) || '(unnamed)', M_L, ctx.y); ctx.y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  colHead(ctx);

  // Chronological, undated rows last.
  const rows = [...txns].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });

  // Opening balance.
  let balance = 0;
  doc.setFont('helvetica', 'italic');
  doc.text('Opening Balance', X.part, ctx.y);
  doc.text(rs(0), X.balR, ctx.y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  ctx.y += 6;

  let totalDr = 0, totalCr = 0;
  for (const t of rows) {
    const debit = t.amount < 0 ? Math.abs(t.amount) : 0;
    const credit = t.amount > 0 ? t.amount : 0;
    totalDr += debit; totalCr += credit;
    balance += debit - credit;

    const narr = sanitize(t.narration || t.counterparty || '-') || '-';
    const partLines = doc.splitTextToSize(narr, ctx.partWrap) as string[];
    const allLines = t.reference ? [...partLines, sanitize('Ref: ' + t.reference)] : partLines;
    const rowH = Math.max(LINE_H, allLines.length * LINE_H) + 1.5;

    if (ctx.y + rowH > pageH - 20) { doc.addPage(); pageBanner(ctx); colHead(ctx); }

    const yTop = ctx.y;
    doc.text(fmtDate(t.date), X.date, yTop);
    allLines.forEach((ln, i) => doc.text(ln, X.part, yTop + i * LINE_H));
    if (debit) doc.text(rs(debit), X.debitR, yTop, { align: 'right' });
    if (credit) doc.text(rs(credit), X.creditR, yTop, { align: 'right' });
    doc.text(balanceLabel(balance), X.balR, yTop, { align: 'right' });
    ctx.y = yTop + rowH;
  }

  // Section totals.
  if (ctx.y + 12 > pageH - 14) { doc.addPage(); pageBanner(ctx); colHead(ctx); }
  ctx.y += 1; doc.setDrawColor(120); doc.line(M_L, ctx.y, right, ctx.y); ctx.y += 5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(`${rows.length} transaction${rows.length === 1 ? '' : 's'}`, X.date, ctx.y);
  doc.text(rs(totalDr), X.debitR, ctx.y, { align: 'right' });
  doc.text(rs(totalCr), X.creditR, ctx.y, { align: 'right' });
  doc.text('Closing ' + balanceLabel(balance), X.balR, ctx.y, { align: 'right' });
  ctx.y += 9;
  doc.setFont('helvetica', 'normal');
}

function txnRange(txns: BankTransaction[]): [string | null, string | null] {
  const dated = txns.map(t => t.date).filter((d): d is string => !!d).sort();
  return [dated[0] ?? null, dated[dated.length - 1] ?? null];
}

// ── Single-party ledger ────────────────────────────────────────────
export function buildPartyLedgerDoc(
  partyName: string,
  txns: BankTransaction[],
  meta: PartyLedgerMeta = {},
): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4');
  const ctx = makeCtx(doc, partyName);
  const [from, to] = txnRange(txns);
  docTitle(ctx, partyName, meta, from, to);
  ctx.y += 1;
  renderPartySection(ctx, partyName, txns);
  doc.setFontSize(7.5); doc.setTextColor(120);
  doc.text('Debit = paid to party (outflow).  Credit = received from party (inflow).', M_L, Math.min(ctx.y, ctx.pageH - 8));
  doc.setTextColor(0);
  return doc;
}

export function downloadPartyLedgerPdf(
  partyName: string,
  txns: BankTransaction[],
  meta: PartyLedgerMeta = {},
): void {
  const doc = buildPartyLedgerDoc(partyName, txns, meta);
  doc.save(`ledger-${safeName(partyName)}.pdf`);
}

// ── Combined ledger book (all parties) ─────────────────────────────
export function buildCombinedLedgerDoc(
  parties: LedgerParty[],
  meta: PartyLedgerMeta = {},
): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4');
  const ctx = makeCtx(doc, 'Combined Ledger');
  const allTxns = parties.flatMap(p => p.txns);
  const [from, to] = txnRange(allTxns);
  docTitle(ctx, 'Combined Ledger', meta, from, to);
  doc.setFontSize(8.5); doc.setTextColor(90);
  doc.text(`${parties.length} part${parties.length === 1 ? 'y' : 'ies'} · ${allTxns.length} transaction${allTxns.length === 1 ? '' : 's'}`, M_L, ctx.y);
  doc.setTextColor(0); ctx.y += 6;

  for (const p of parties) {
    if (!p.txns.length) continue;
    renderPartySection(ctx, p.name, p.txns);
  }
  return doc;
}

export function downloadCombinedLedgerPdf(
  parties: LedgerParty[],
  meta: PartyLedgerMeta = {},
): void {
  const doc = buildCombinedLedgerDoc(parties, meta);
  const today = new Date().toISOString().slice(0, 10);
  doc.save(`combined-ledger-${today}.pdf`);
}

function safeName(s: string): string {
  return (s || 'party').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'party';
}
