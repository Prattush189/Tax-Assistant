import { jsPDF } from 'jspdf';
import type { LedgerScrutinyDetail, LedgerScrutinyObservation } from '../../services/api';

const MARGIN = 14;
const PAGE_W = 210;
const PAGE_H = 297;
const LINE = 5;

function fmtINR(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_H - MARGIN) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function severityColor(sev: 'high' | 'warn' | 'info'): [number, number, number] {
  if (sev === 'high') return [185, 28, 28];
  if (sev === 'warn') return [180, 83, 9];
  return [3, 105, 161];
}

function wrapText(doc: jsPDF, text: string, width: number): string[] {
  return doc.splitTextToSize(text, width) as string[];
}

function renderHeader(doc: jsPDF, detail: LedgerScrutinyDetail): number {
  const { job, accounts } = detail;
  let y = MARGIN;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('LEDGER SCRUTINY REPORT', PAGE_W / 2, y + 4, { align: 'center' });
  y += 9;

  doc.setDrawColor(16, 185, 129);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);

  const lines = [
    `Assessee: ${job.partyName ?? job.name ?? '—'}`,
    job.gstin ? `GSTIN: ${job.gstin}` : null,
    `Period: ${job.periodFrom ?? '—'} to ${job.periodTo ?? '—'}`,
    `Accounts: ${accounts.length} · Transactions: ${accounts.reduce((s, a) => s + a.txCount, 0).toLocaleString('en-IN')}`,
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
  ].filter((l): l is string => !!l);

  for (const line of lines) {
    doc.text(line, MARGIN, y);
    y += LINE;
  }
  y += 2;

  // Summary chips
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('Summary', MARGIN, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const summary = [
    { label: 'High', count: job.totalFlagsHigh, color: [185, 28, 28] as [number, number, number] },
    { label: 'Warn', count: job.totalFlagsWarn, color: [180, 83, 9] as [number, number, number] },
    { label: 'Info', count: job.totalFlagsInfo, color: [3, 105, 161] as [number, number, number] },
  ];
  let x = MARGIN;
  for (const item of summary) {
    doc.setTextColor(...item.color);
    doc.text(`${item.label}: ${item.count}`, x, y);
    x += 30;
  }
  doc.setTextColor(40, 40, 40);
  doc.text(`Total flagged amount: Rs. ${fmtINR(job.totalFlaggedAmount)}`, x, y);
  y += 8;

  return y;
}

function renderObservation(doc: jsPDF, obs: LedgerScrutinyObservation, y: number): number {
  const sev = obs.severity;
  const [r, g, b] = severityColor(sev);
  const bodyWidth = PAGE_W - MARGIN * 2 - 6;

  // Estimate height
  const messageLines = wrapText(doc, obs.message, bodyWidth);
  const actionLines = obs.suggestedAction ? wrapText(doc, `Action: ${obs.suggestedAction}`, bodyWidth) : [];
  const estimated = 6 + messageLines.length * LINE + actionLines.length * LINE + 4;
  y = ensureSpace(doc, y, estimated);

  // Severity bar
  doc.setFillColor(r, g, b);
  doc.rect(MARGIN, y, 2, estimated - 2, 'F');

  // Header row: severity + code + date + amount
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(r, g, b);
  doc.text(sev.toUpperCase(), MARGIN + 5, y + 4);
  doc.setTextColor(100, 100, 100);
  doc.setFont('helvetica', 'normal');
  doc.text(obs.code, MARGIN + 22, y + 4);
  if (obs.dateRef) doc.text(obs.dateRef, MARGIN + 60, y + 4);
  if (obs.amount !== null) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40, 40, 40);
    doc.text(`Rs. ${fmtINR(Math.abs(obs.amount))}`, PAGE_W - MARGIN - 2, y + 4, { align: 'right' });
  }
  y += 6;

  // Message
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  for (const line of messageLines) {
    doc.text(line, MARGIN + 5, y);
    y += LINE;
  }

  // Suggested action
  if (actionLines.length > 0) {
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(9);
    for (const line of actionLines) {
      doc.text(line, MARGIN + 5, y);
      y += LINE;
    }
  }
  y += 3;
  return y;
}

function renderFooter(doc: jsPDF, y: number): void {
  y = ensureSpace(doc, y, 38);
  y += 6;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  const disclaimer =
    'This report is an AI-assisted preliminary scrutiny based on the uploaded ledger only. Section citations refer to the Income-tax Act, 1961 and the GST Acts. Findings should be verified against the assessee\'s books, vouchers, bank statements, and TDS / GST returns before acting.';
  const wrapped = doc.splitTextToSize(disclaimer, PAGE_W - MARGIN * 2) as string[];
  for (const l of wrapped) {
    doc.text(l, MARGIN, y);
    y += 4.5;
  }
  y += 8;

  // Signature block
  doc.setDrawColor(80, 80, 80);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, MARGIN + 60, y);
  doc.line(PAGE_W - MARGIN - 60, y, PAGE_W - MARGIN, y);
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text('Reviewed by (Chartered Accountant)', MARGIN, y + 4);
  doc.text('Date / Membership No.', PAGE_W - MARGIN - 60, y + 4);
}

export function renderLedgerScrutinyPdf(detail: LedgerScrutinyDetail): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  let y = renderHeader(doc, detail);

  // Group observations by account id (or 'ledger-wide')
  const byAccount = new Map<string | null, LedgerScrutinyObservation[]>();
  for (const obs of detail.observations) {
    const k = obs.accountId;
    const arr = byAccount.get(k) ?? [];
    arr.push(obs);
    byAccount.set(k, arr);
  }

  // Ledger-wide observations first
  const ledgerWide = byAccount.get(null);
  if (ledgerWide && ledgerWide.length > 0) {
    y = ensureSpace(doc, y, 10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('Ledger-wide observations', MARGIN, y);
    y += 6;
    for (const obs of ledgerWide) y = renderObservation(doc, obs, y);
    y += 3;
  }

  // Per-account
  for (const acc of detail.accounts) {
    const obsList = byAccount.get(acc.id) ?? [];
    y = ensureSpace(doc, y, 18);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    const accTitle = acc.accountType ? `${acc.name} [${acc.accountType.toUpperCase()}]` : acc.name;
    const titleLines = wrapText(doc, accTitle, PAGE_W - MARGIN * 2);
    for (const line of titleLines) {
      doc.text(line, MARGIN, y);
      y += LINE;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text(
      `Opening Rs. ${fmtINR(acc.opening)} · Closing Rs. ${fmtINR(acc.closing)} · Dr Rs. ${fmtINR(acc.totalDebit)} · Cr Rs. ${fmtINR(acc.totalCredit)} · ${acc.txCount} txns`,
      MARGIN,
      y,
    );
    y += LINE + 1;

    if (obsList.length === 0) {
      doc.setTextColor(20, 130, 80);
      doc.setFontSize(9);
      doc.text('No flags raised on this account.', MARGIN + 2, y);
      y += LINE + 2;
    } else {
      for (const obs of obsList) y = renderObservation(doc, obs, y);
      y += 2;
    }
  }

  renderFooter(doc, y);

  const safeName = (detail.job.partyName ?? detail.job.name ?? 'ledger-scrutiny').replace(/[^a-z0-9_-]+/gi, '_');
  doc.save(`${safeName}-scrutiny.pdf`);
}
