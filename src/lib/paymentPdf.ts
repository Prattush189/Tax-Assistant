import jsPDF from 'jspdf';

const GST_RATE = 0.18;
const COMPANY_NAME = 'Smartbiz AI';
const COMPANY_SUB  = 'Tax Planning & Advisory Platform';
const BRAND_R = 13, BRAND_G = 150, BRAND_H = 104; // #0D9668

export interface PaymentData {
  id: string;
  plan: string;
  billing: string;
  amount: number;       // paise (GST-inclusive)
  paidAt: string | null;
  expiresAt: string | null;
}

export interface UserInfo {
  name: string;
  email: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function receiptNo(id: string): string { return 'RCPT-' + id.slice(0, 8).toUpperCase(); }
function invoiceNo(id: string): string { return 'INV-'  + id.slice(0, 8).toUpperCase(); }

function planLabel(plan: string, billing: string): string {
  return `Smartbiz AI ${plan === 'pro' ? 'Pro' : 'Enterprise'} Plan \u2014 ${billing === 'monthly' ? 'Monthly' : 'Yearly'}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getBaseAmount(totalPaise: number): number {
  return Math.round((totalPaise / 100) / (1 + GST_RATE) * 100) / 100;
}
function getGstAmount(totalPaise: number): number {
  return Math.round((totalPaise / 100 - getBaseAmount(totalPaise)) * 100) / 100;
}

// ── shared header ─────────────────────────────────────────────────────────────

function drawHeader(doc: jsPDF, label: string): void {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(BRAND_R, BRAND_G, BRAND_H);
  doc.rect(0, 0, W, 18, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(COMPANY_NAME, 20, 12);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(label, W - 20, 12, { align: 'right' });
}

function drawFooter(doc: jsPDF, msg: string): void {
  const W = doc.internal.pageSize.getWidth();
  doc.setDrawColor(200, 200, 200);
  doc.line(20, 270, W - 20, 270);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(150, 150, 150);
  doc.text(msg, W / 2, 276, { align: 'center' });
  doc.text(COMPANY_NAME + ' \u00B7 ' + COMPANY_SUB, W / 2, 281, { align: 'center' });
}

// ── Receipt ───────────────────────────────────────────────────────────────────

export function generatePaymentReceipt(payment: PaymentData, user: UserInfo): void {
  const doc = new jsPDF('p', 'mm', 'a4');
  const W = doc.internal.pageSize.getWidth();
  const L = 20, R = W - 20;
  let y = 28;

  drawHeader(doc, 'PAYMENT RECEIPT');

  doc.setTextColor(30, 30, 30);

  // ── Meta row ──────────────────────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Receipt No:', L, y);
  doc.setFont('helvetica', 'normal');
  doc.text(receiptNo(payment.id), L + 29, y);

  doc.setFont('helvetica', 'bold');
  doc.text('Date:', R - 52, y);
  doc.setFont('helvetica', 'normal');
  doc.text(fmtDate(payment.paidAt), R - 41, y);
  y += 10;

  doc.setDrawColor(220, 220, 220);
  doc.line(L, y, R, y);
  y += 8;

  // ── Billed To ─────────────────────────────────────────────────────────────
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(110, 110, 110);
  doc.text('BILLED TO', L, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  doc.text(user.name, L, y);
  y += 5;
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(user.email, L, y);
  y += 12;

  // ── Item table ────────────────────────────────────────────────────────────
  doc.setFillColor(245, 247, 250);
  doc.rect(L, y, R - L, 8, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(60, 60, 60);
  doc.text('Description', L + 2, y + 5.5);
  doc.text('Amount', R - 2, y + 5.5, { align: 'right' });
  y += 10;

  const base  = getBaseAmount(payment.amount);
  const gst   = getGstAmount(payment.amount);
  const total = payment.amount / 100;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 30);
  doc.text(planLabel(payment.plan, payment.billing), L + 2, y + 5);
  doc.text(fmt(base), R - 2, y + 5, { align: 'right' });
  y += 10;

  doc.setDrawColor(220, 220, 220);
  doc.line(L, y, R, y);
  y += 6;

  // Totals
  const col = R - 60;
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('Sub-total (excl. GST)', col, y);
  doc.text(fmt(base), R - 2, y, { align: 'right' });
  y += 6;
  doc.text('IGST @ 18%', col, y);
  doc.text(fmt(gst), R - 2, y, { align: 'right' });
  y += 6;

  doc.setDrawColor(BRAND_R, BRAND_G, BRAND_H);
  doc.line(col, y, R, y);
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(BRAND_R, BRAND_G, BRAND_H);
  doc.text('Total Paid', col, y);
  doc.text(fmt(total), R - 2, y, { align: 'right' });
  y += 12;

  // Status pill
  doc.setFillColor(220, 252, 231);
  doc.roundedRect(L, y - 1, 26, 8, 2, 2, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(21, 128, 61);
  doc.text('PAID', L + 13, y + 4.5, { align: 'center' });
  y += 14;

  if (payment.expiresAt) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text('Subscription valid until: ' + fmtDate(payment.expiresAt), L, y);
  }

  drawFooter(doc, 'This is a computer-generated receipt and does not require a signature.');
  doc.save(receiptNo(payment.id) + '.pdf');
}

// ── Tax Invoice ───────────────────────────────────────────────────────────────

export function generatePaymentInvoice(payment: PaymentData, user: UserInfo): void {
  const doc = new jsPDF('p', 'mm', 'a4');
  const W = doc.internal.pageSize.getWidth();
  const L = 20, R = W - 20;
  let y = 28;

  drawHeader(doc, 'TAX INVOICE');

  doc.setTextColor(30, 30, 30);

  // ── Meta ──────────────────────────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Invoice No:', L, y);
  doc.setFont('helvetica', 'normal');
  doc.text(invoiceNo(payment.id), L + 28, y);

  doc.setFont('helvetica', 'bold');
  doc.text('Date:', R - 52, y);
  doc.setFont('helvetica', 'normal');
  doc.text(fmtDate(payment.paidAt), R - 41, y);
  y += 7;

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  doc.text('SAC Code: 9983 (IT & software services)', L, y);
  y += 10;

  doc.setDrawColor(220, 220, 220);
  doc.line(L, y, R, y);
  y += 8;

  // ── Billed By / To ────────────────────────────────────────────────────────
  const mid = W / 2 + 5;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(110, 110, 110);
  doc.text('BILLED BY', L, y);
  doc.text('BILLED TO', mid, y);
  y += 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text(COMPANY_NAME, L, y);
  doc.text(user.name, mid, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text(COMPANY_SUB, L, y);
  doc.text(user.email, mid, y);
  y += 14;

  // ── Item table ────────────────────────────────────────────────────────────
  const colDesc = L + 2;
  const colQty  = L + 100;
  const colRate = L + 120;
  const colIGST = L + 145;
  const colTot  = R - 2;

  doc.setFillColor(245, 247, 250);
  doc.rect(L, y, R - L, 8, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(60, 60, 60);
  doc.text('Description',  colDesc, y + 5.5);
  doc.text('Qty',          colQty,  y + 5.5);
  doc.text('Rate',         colRate, y + 5.5);
  doc.text('IGST 18%',     colIGST, y + 5.5);
  doc.text('Total',        colTot,  y + 5.5, { align: 'right' });
  y += 10;

  const base  = getBaseAmount(payment.amount);
  const gst   = getGstAmount(payment.amount);
  const total = payment.amount / 100;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 30, 30);
  doc.text(planLabel(payment.plan, payment.billing), colDesc, y + 5);
  doc.text('1',         colQty,  y + 5);
  doc.text(fmt(base),  colRate, y + 5);
  doc.text(fmt(gst),   colIGST, y + 5);
  doc.text(fmt(total), colTot,  y + 5, { align: 'right' });
  y += 10;

  doc.setDrawColor(220, 220, 220);
  doc.line(L, y, R, y);
  y += 6;

  // Totals block (right-aligned)
  const tCol = R - 60;
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('Taxable Amount:', tCol, y);
  doc.text(fmt(base), R - 2, y, { align: 'right' });
  y += 6;
  doc.text('IGST @ 18%:', tCol, y);
  doc.text(fmt(gst), R - 2, y, { align: 'right' });
  y += 6;

  doc.setDrawColor(BRAND_R, BRAND_G, BRAND_H);
  doc.line(tCol, y, R, y);
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(BRAND_R, BRAND_G, BRAND_H);
  doc.text('Total (INR):', tCol, y);
  doc.text(fmt(total), R - 2, y, { align: 'right' });
  y += 14;

  // ── Payment details ───────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  doc.text('Payment Mode: Online (Razorpay)', L, y);
  y += 5;
  doc.text('Payment Date: ' + fmtDate(payment.paidAt), L, y);
  y += 5;
  if (payment.expiresAt) {
    doc.text('Subscription Valid Until: ' + fmtDate(payment.expiresAt), L, y);
    y += 5;
  }
  y += 4;

  doc.setFontSize(7.5);
  doc.setTextColor(130, 130, 130);
  doc.text('Note: This invoice is issued for SaaS subscription services. IGST applicable as per the GST Act, 2017.', L, y);

  drawFooter(doc, 'This is a computer-generated tax invoice and does not require a physical signature.');
  doc.save(invoiceNo(payment.id) + '.pdf');
}
