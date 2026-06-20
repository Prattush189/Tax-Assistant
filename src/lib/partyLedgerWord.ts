/**
 * Word (.doc) sibling of partyLedgerPdf.ts — the same party ledger as an
 * editable Word document (HTML-table .doc, opens natively in Word /
 * Google Docs / LibreOffice, so no extra dependency).
 *
 * Same Dr/Cr convention as the PDF: money PAID to the party (statement
 * outflow, amount < 0) → Debit; money RECEIVED (inflow, amount > 0) →
 * Credit; running balance is Debit-positive with a Dr/Cr suffix.
 * Opening balance 0 (a bank statement carries no brought-forward party
 * balance).
 */
import type { BankTransaction } from '../services/api';
import type { PartyLedgerMeta, LedgerParty } from './partyLedgerPdf';

function escapeHtml(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function amt(n: number): string {
  const v = Math.round(Math.abs(n) * 100) / 100;
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

function balanceLabel(n: number): string {
  return amt(n) + (n > 0.005 ? ' Dr' : n < -0.005 ? ' Cr' : '');
}

/** One party's ledger as an HTML <table> section. */
function partySection(name: string, txns: BankTransaction[]): string {
  const rows = [...txns].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  const tr: string[] = [];
  tr.push(`<tr><td></td><td><i>Opening Balance</i></td><td class="r"></td><td class="r"></td><td class="r">${amt(0)}</td></tr>`);
  let balance = 0, totalDr = 0, totalCr = 0;
  for (const t of rows) {
    const debit = t.amount < 0 ? Math.abs(t.amount) : 0;
    const credit = t.amount > 0 ? t.amount : 0;
    totalDr += debit; totalCr += credit;
    balance += debit - credit;
    const ref = t.reference ? `<br/><span class="muted">Ref: ${escapeHtml(t.reference)}</span>` : '';
    tr.push(`<tr><td class="nowrap">${escapeHtml(fmtDate(t.date))}</td><td>${escapeHtml(t.narration || t.counterparty || '-')}${ref}</td><td class="r">${debit ? amt(debit) : ''}</td><td class="r">${credit ? amt(credit) : ''}</td><td class="r nowrap">${balanceLabel(balance)}</td></tr>`);
  }
  return `<h2>${escapeHtml(name) || '(unnamed)'}</h2>
<table>
<thead><tr><th>Date</th><th>Particulars</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead>
<tbody>
${tr.join('\n')}
<tr class="tot"><td colspan="2">${rows.length} transaction${rows.length === 1 ? '' : 's'} &mdash; Closing balance</td><td class="r">${amt(totalDr)}</td><td class="r">${amt(totalCr)}</td><td class="r nowrap">${balanceLabel(balance)}</td></tr>
</tbody>
</table>`;
}

function txnRange(txns: BankTransaction[]): [string | null, string | null] {
  const dated = txns.map(t => t.date).filter((d): d is string => !!d).sort();
  return [dated[0] ?? null, dated[dated.length - 1] ?? null];
}

function docHtml(title: string, sectionsHtml: string, meta: PartyLedgerMeta, from: string | null, to: string | null, subtitle?: string): string {
  const sub: string[] = [];
  if (meta.bankName) sub.push(escapeHtml(meta.bankName));
  if (meta.accountLabel) sub.push('A/c ' + escapeHtml(meta.accountLabel));
  const pf = meta.periodFrom ?? from, pt = meta.periodTo ?? to;
  if (pf || pt) sub.push(`Period: ${escapeHtml(fmtDate(pf))} to ${escapeHtml(fmtDate(pt))}`);
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
@page { size: A4; margin: 1.6cm; }
body { font-family: "Times New Roman", serif; font-size: 10.5pt; color: #1a1a1a; }
h1 { font-size: 15pt; color: #1e3a8a; margin: 0 0 4pt; }
h2 { font-size: 11.5pt; color: #1e3a8a; margin: 12pt 0 4pt; }
table { width: 100%; border-collapse: collapse; margin-bottom: 6pt; }
th, td { border: 1px solid #ccc; padding: 3px 6px; vertical-align: top; font-size: 9.5pt; }
th { background: #eef2f7; text-align: left; }
.r { text-align: right; }
.nowrap { white-space: nowrap; }
.tot { font-weight: bold; background: #f3f4f6; }
.muted { color: #777; font-size: 8.5pt; }
.sub { color: #555; font-size: 9pt; margin: 0 0 8pt; }
</style></head>
<body>
<h1>${escapeHtml(title)}</h1>
${subtitle ? `<p class="sub">${escapeHtml(subtitle)}</p>` : ''}
${sub.length ? `<p class="sub">${sub.join('  |  ')}</p>` : ''}
${sectionsHtml}
<p class="muted">Debit = paid to party (outflow). Credit = received from party (inflow). Generated from a bank statement by Smartbiz AI - opening balance not carried; verify against books of account.</p>
</body></html>`;
}

function saveDoc(html: string, filename: string): void {
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function safeName(s: string): string {
  return (s || 'party').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'party';
}

/** Build the single-party .doc HTML (no download) — testable. */
export function buildPartyLedgerDocHtml(partyName: string, txns: BankTransaction[], meta: PartyLedgerMeta = {}): string {
  const [from, to] = txnRange(txns);
  return docHtml(partyName || 'Ledger', partySection(partyName, txns), meta, from, to);
}

export function downloadPartyLedgerWord(partyName: string, txns: BankTransaction[], meta: PartyLedgerMeta = {}): void {
  saveDoc(buildPartyLedgerDocHtml(partyName, txns, meta), `ledger-${safeName(partyName)}.doc`);
}

/** Build the combined-ledger .doc HTML (no download) — testable. */
export function buildCombinedLedgerDocHtml(parties: LedgerParty[], meta: PartyLedgerMeta = {}): string {
  const all = parties.flatMap(p => p.txns);
  const [from, to] = txnRange(all);
  const sections = parties.filter(p => p.txns.length).map(p => partySection(p.name, p.txns)).join('\n');
  const subtitle = `${parties.length} part${parties.length === 1 ? 'y' : 'ies'} · ${all.length} transaction${all.length === 1 ? '' : 's'}`;
  return docHtml('Combined Ledger', sections, meta, from, to, subtitle);
}

export function downloadCombinedLedgerWord(parties: LedgerParty[], meta: PartyLedgerMeta = {}): void {
  saveDoc(buildCombinedLedgerDocHtml(parties, meta), `combined-ledger.doc`);
}
