/**
 * Server-side PDF generation using jsPDF.
 * Mirrors the frontend paymentPdf.ts but outputs a Buffer for email attachments.
 */

import jsPDF from 'jspdf';
import type { BillingDetails } from '../db/repositories/userRepo.js';
import { PLAN_AMOUNTS, planKey } from './razorpayPlans.js';
import type { PaidPlan } from './razorpayPlans.js';

const GST_RATE = 0.18;

/**
 * Look up the GST-inclusive MRP for a plan, in paise. Returns null if
 * the plan string isn't recognised (e.g. legacy data) so the PDFs fall
 * back to "no discount" rendering rather than throwing.
 */
function mrpInclPaiseFor(plan: string): number | null {
  if (plan !== 'pro' && plan !== 'enterprise') return null;
  return PLAN_AMOUNTS[planKey(plan as PaidPlan)] ?? null;
}

/**
 * Decompose a payment into base / discount / tax components for invoice
 * rendering. Discount is computed as MRP - paid (both incl. GST), then
 * reverse-calculated to its pre-GST value since dealers apply discount
 * on the taxable amount and GST is charged on the discounted base.
 *
 * Returns rupees (not paise) for direct PDF rendering.
 */
function decomposeAmount(paidPaise: number, plan: string): {
  mrpBaseExcl: number;          // MRP, excl. GST (e.g. ₹6,000)
  discountExcl: number;         // 0 when paid >= MRP
  discountedBaseExcl: number;   // = mrpBaseExcl - discountExcl
  gst: number;                  // 18% of discountedBaseExcl
  total: number;                // = paidPaise / 100
} {
  const mrpInclPaise = mrpInclPaiseFor(plan);
  const total = paidPaise / 100;
  if (mrpInclPaise === null || paidPaise >= mrpInclPaise) {
    const base = Math.round((total / (1 + GST_RATE)) * 100) / 100;
    const gst = Math.round((total - base) * 100) / 100;
    return { mrpBaseExcl: base, discountExcl: 0, discountedBaseExcl: base, gst, total };
  }
  const mrpBaseExcl = Math.round((mrpInclPaise / 100 / (1 + GST_RATE)) * 100) / 100;
  const discountedBaseExcl = Math.round((total / (1 + GST_RATE)) * 100) / 100;
  const discountExcl = Math.round((mrpBaseExcl - discountedBaseExcl) * 100) / 100;
  const gst = Math.round((total - discountedBaseExcl) * 100) / 100;
  return { mrpBaseExcl, discountExcl, discountedBaseExcl, gst, total };
}

const COMPANY_NAME    = 'Smartbiz Technologies Private Limited';
const COMPANY_BRAND   = 'Smartbiz AI';
const COMPANY_GSTIN   = '03AAUCS1499L1ZM';
const COMPANY_STATE   = 'Punjab';
const COMPANY_STATECD = '03';
const COMPANY_ADDR1 = 'House No. 48, Chaturbhuj Road, Yaseen Road';
const COMPANY_ADDR2 = 'Amritsar, Punjab \u2013 143001';
const BRAND_R = 13, BRAND_G = 150, BRAND_H = 104;

/** Intra-state when buyer is also in Punjab -> CGST+SGST. Inter-state -> IGST. */
function isIntraState(bd: BillingDetails | null | undefined): boolean {
  if (!bd) return false;
  const gstin = bd.gstin?.trim();
  if (gstin && gstin.length >= 2) return gstin.slice(0, 2) === COMPANY_STATECD;
  const s = bd.state?.trim().toLowerCase();
  if (!s) return false;
  return s === COMPANY_STATE.toLowerCase() || s === 'pb';
}

function placeOfSupply(bd: BillingDetails | null | undefined): string {
  const s = bd?.state?.trim();
  return s && s.length > 0 ? s : COMPANY_STATE;
}

export interface PdfPaymentData {
  id: string;
  plan: string;
  billing: string;
  amount: number;       // paise (GST-inclusive)
  paidAt: string | null;
  expiresAt: string | null;
}

export interface PdfBuyer {
  name: string;
  email: string;
  billingDetails?: BillingDetails | null;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return 'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function docNo(id: string): string { return 'AI-' + id.slice(0, 10).toUpperCase(); }

function planLabel(plan: string, billing: string): string {
  return `${COMPANY_BRAND} ${plan === 'pro' ? 'Pro' : 'Enterprise'} Plan - ${billing === 'monthly' ? 'Monthly' : 'Yearly'}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getBase(totalPaise: number): number {
  return Math.round((totalPaise / 100) / (1 + GST_RATE) * 100) / 100;
}
function getGst(totalPaise: number): number {
  return Math.round((totalPaise / 100 - getBase(totalPaise)) * 100) / 100;
}

function toBuffer(doc: jsPDF): Buffer {
  const ab = doc.output('arraybuffer');
  return Buffer.from(ab);
}

// ── shared header / footer ────────────────────────────────────────────────────

function drawHeader(doc: jsPDF, label: string): void {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(BRAND_R, BRAND_G, BRAND_H);
  doc.rect(0, 0, W, 18, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(COMPANY_BRAND, 20, 11);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text(COMPANY_NAME, 20, 15.5);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(label, W - 20, 12, { align: 'right' });
}

function drawFooter(doc: jsPDF, msg: string): void {
  const W = doc.internal.pageSize.getWidth();
  doc.setDrawColor(200, 200, 200);
  doc.line(20, 270, W - 20, 270);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(150, 150, 150);
  doc.text(msg, W / 2, 275, { align: 'center' });
  doc.text(COMPANY_NAME + '  |  GSTIN: ' + COMPANY_GSTIN, W / 2, 280, { align: 'center' });
}

function drawBilledToBlock(doc: jsPDF, buyer: PdfBuyer, x: number, startY: number): void {
  const bd = buyer.billingDetails;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 30, 30);
  doc.text(bd?.name ?? buyer.name, x, startY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(70, 70, 70);
  let y = startY + 5;
  doc.text(buyer.email, x, y); y += 4.5;
  if (bd) {
    doc.text(bd.addressLine1, x, y); y += 4.5;
    if (bd.addressLine2) { doc.text(bd.addressLine2, x, y); y += 4.5; }
    doc.text(`${bd.city}, ${bd.state} - ${bd.pincode}`, x, y); y += 4.5;
    if (bd.gstin) doc.text('GSTIN: ' + bd.gstin, x, y);
  }
}

// ── Receipt ───────────────────────────────────────────────────────────────────

export function buildReceiptBuffer(payment: PdfPaymentData, buyer: PdfBuyer): Buffer {
  const doc = new jsPDF('p', 'mm', 'a4');
  const W = doc.internal.pageSize.getWidth();
  const L = 20, R = W - 20;
  let y = 28;

  drawHeader(doc, 'PAYMENT RECEIPT');
  doc.setTextColor(30, 30, 30);

  // Meta row
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text('Receipt No:', L, y); doc.setFont('helvetica', 'normal');
  doc.text(docNo(payment.id), L + 29, y);
  doc.setFont('helvetica', 'bold');
  doc.text('Date:', R - 52, y); doc.setFont('helvetica', 'normal');
  doc.text(fmtDate(payment.paidAt), R - 41, y);
  y += 10;

  doc.setDrawColor(220, 220, 220); doc.line(L, y, R, y); y += 8;

  // Billed By / To
  const mid = W / 2 + 5;
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(110, 110, 110);
  doc.text('BILLED BY', L, y); doc.text('BILLED TO', mid, y); y += 5;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(30, 30, 30);
  doc.text(COMPANY_BRAND, L, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(70, 70, 70);
  let byY = y + 5;
  doc.text(COMPANY_NAME, L, byY); byY += 4.5;
  doc.text('GSTIN: ' + COMPANY_GSTIN, L, byY); byY += 4.5;
  doc.text(COMPANY_ADDR1, L, byY); byY += 4.5;
  doc.text(COMPANY_ADDR2, L, byY);

  drawBilledToBlock(doc, buyer, mid, y);
  y = Math.max(byY, y + 24) + 8;

  doc.setDrawColor(220, 220, 220); doc.line(L, y, R, y); y += 8;

  // Item table
  doc.setFillColor(245, 247, 250); doc.rect(L, y, R - L, 8, 'F');
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(60, 60, 60);
  doc.text('Description', L + 2, y + 5.5); doc.text('Amount', R - 2, y + 5.5, { align: 'right' }); y += 10;

  const { mrpBaseExcl, discountExcl, discountedBaseExcl, gst, total } = decomposeAmount(payment.amount, payment.plan);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(30, 30, 30);
  doc.text(planLabel(payment.plan, payment.billing), L + 2, y + 5);
  doc.text(fmt(mrpBaseExcl), R - 2, y + 5, { align: 'right' }); y += 10;

  doc.setDrawColor(220, 220, 220); doc.line(L, y, R, y); y += 6;

  const col = R - 65;
  doc.setFontSize(9); doc.setTextColor(80, 80, 80);
  doc.text('Sub-total (excl. GST)', col, y); doc.text(fmt(mrpBaseExcl), R - 2, y, { align: 'right' }); y += 6;
  if (discountExcl > 0) {
    doc.text('Discount', col, y); doc.text('-' + fmt(discountExcl), R - 2, y, { align: 'right' }); y += 6;
    doc.text('Discounted taxable amount', col, y); doc.text(fmt(discountedBaseExcl), R - 2, y, { align: 'right' }); y += 6;
  }
  if (isIntraState(buyer.billingDetails)) {
    const half = Math.round((gst / 2) * 100) / 100;
    doc.text('CGST @ 9%', col, y); doc.text(fmt(half), R - 2, y, { align: 'right' }); y += 6;
    doc.text('SGST @ 9%', col, y); doc.text(fmt(gst - half), R - 2, y, { align: 'right' }); y += 6;
  } else {
    doc.text('IGST @ 18%', col, y); doc.text(fmt(gst), R - 2, y, { align: 'right' }); y += 6;
  }

  doc.setDrawColor(BRAND_R, BRAND_G, BRAND_H); doc.line(col, y, R, y); y += 6;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(BRAND_R, BRAND_G, BRAND_H);
  doc.text('Total Paid', col, y); doc.text(fmt(total), R - 2, y, { align: 'right' }); y += 12;

  // Status pill
  doc.setFillColor(220, 252, 231); doc.roundedRect(L, y - 1, 26, 8, 2, 2, 'F');
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(21, 128, 61);
  doc.text('PAID', L + 13, y + 4.5, { align: 'center' }); y += 14;

  if (payment.expiresAt) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
    doc.text('Plan valid until: ' + fmtDate(payment.expiresAt), L, y);
  }

  drawFooter(doc, 'This is a computer-generated receipt and does not require a signature.');
  return toBuffer(doc);
}

// ── Tax Invoice ───────────────────────────────────────────────────────────────

export function buildInvoiceBuffer(payment: PdfPaymentData, buyer: PdfBuyer): Buffer {
  const doc = new jsPDF('p', 'mm', 'a4');
  const W = doc.internal.pageSize.getWidth();
  const L = 20, R = W - 20;
  let y = 28;

  drawHeader(doc, 'TAX INVOICE');
  doc.setTextColor(30, 30, 30);

  // Meta
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text('Invoice No:', L, y); doc.setFont('helvetica', 'normal');
  doc.text(docNo(payment.id), L + 28, y);
  doc.setFont('helvetica', 'bold');
  doc.text('Date:', R - 52, y); doc.setFont('helvetica', 'normal');
  doc.text(fmtDate(payment.paidAt), R - 41, y); y += 7;

  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80);
  doc.text(`SAC Code: 9983 (IT & software services)  |  Place of Supply: ${placeOfSupply(buyer.billingDetails)}`, L, y); y += 10;

  doc.setDrawColor(220, 220, 220); doc.line(L, y, R, y); y += 8;

  // Billed By / To
  const mid = W / 2 + 5;
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(110, 110, 110);
  doc.text('BILLED BY', L, y); doc.text('BILLED TO', mid, y); y += 5;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(30, 30, 30);
  doc.text(COMPANY_BRAND, L, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(70, 70, 70);
  let byY = y + 5;
  doc.text(COMPANY_NAME, L, byY); byY += 4.5;
  doc.text('GSTIN: ' + COMPANY_GSTIN, L, byY); byY += 4.5;
  doc.text(COMPANY_ADDR1, L, byY); byY += 4.5;
  doc.text(COMPANY_ADDR2, L, byY);

  drawBilledToBlock(doc, buyer, mid, y);
  y = Math.max(byY, y + 24) + 10;

  doc.setDrawColor(220, 220, 220); doc.line(L, y, R, y); y += 8;

  // Item table — all numeric columns right-aligned at staggered x-positions
  const intra = isIntraState(buyer.billingDetails);
  const colDesc = L + 2, colQty = L + 92, colRate = L + 122, colTax = L + 152, colTot = R - 2;
  doc.setFillColor(245, 247, 250); doc.rect(L, y, R - L, 8, 'F');
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(60, 60, 60);
  doc.text('Description', colDesc, y + 5.5);
  doc.text('Qty',  colQty,  y + 5.5, { align: 'right' });
  doc.text('Rate', colRate, y + 5.5, { align: 'right' });
  doc.text(intra ? 'GST 18%' : 'IGST 18%', colTax, y + 5.5, { align: 'right' });
  doc.text('Total', colTot, y + 5.5, { align: 'right' }); y += 10;

  const { mrpBaseExcl, discountExcl, discountedBaseExcl, gst, total } = decomposeAmount(payment.amount, payment.plan);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(30, 30, 30);
  doc.text(planLabel(payment.plan, payment.billing), colDesc, y + 5);
  doc.text('1', colQty, y + 5, { align: 'right' });
  doc.text(fmt(mrpBaseExcl), colRate, y + 5, { align: 'right' });
  doc.text(fmt(gst), colTax, y + 5, { align: 'right' });
  doc.text(fmt(total), colTot, y + 5, { align: 'right' }); y += 10;

  doc.setDrawColor(220, 220, 220); doc.line(L, y, R, y); y += 6;

  const tCol = R - 65;
  doc.setFontSize(9); doc.setTextColor(80, 80, 80);
  doc.text('Taxable Amount (excl. GST):', tCol, y); doc.text(fmt(mrpBaseExcl), R - 2, y, { align: 'right' }); y += 6;
  if (discountExcl > 0) {
    doc.text('Discount:', tCol, y); doc.text('-' + fmt(discountExcl), R - 2, y, { align: 'right' }); y += 6;
    doc.text('Discounted Taxable Amount:', tCol, y); doc.text(fmt(discountedBaseExcl), R - 2, y, { align: 'right' }); y += 6;
  }
  if (intra) {
    const half = Math.round((gst / 2) * 100) / 100;
    doc.text('CGST @ 9%:', tCol, y); doc.text(fmt(half), R - 2, y, { align: 'right' }); y += 6;
    doc.text('SGST @ 9%:', tCol, y); doc.text(fmt(gst - half), R - 2, y, { align: 'right' }); y += 6;
  } else {
    doc.text('IGST @ 18%:', tCol, y); doc.text(fmt(gst), R - 2, y, { align: 'right' }); y += 6;
  }

  doc.setDrawColor(BRAND_R, BRAND_G, BRAND_H); doc.line(tCol, y, R, y); y += 6;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(BRAND_R, BRAND_G, BRAND_H);
  doc.text('Total (INR):', tCol, y); doc.text(fmt(total), R - 2, y, { align: 'right' }); y += 14;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(80, 80, 80);
  doc.text('Payment Mode: Online (Razorpay)', L, y); y += 5;
  doc.text('Payment Date: ' + fmtDate(payment.paidAt), L, y); y += 5;
  if (payment.expiresAt) { doc.text('Plan Valid Until: ' + fmtDate(payment.expiresAt), L, y); y += 5; }
  y += 4;
  doc.setFontSize(7.5); doc.setTextColor(130, 130, 130);
  doc.text(
    intra
      ? 'Note: This invoice is for SaaS subscription services. CGST + SGST applicable (intra-state supply) as per CGST Act, 2017.'
      : 'Note: This invoice is for SaaS subscription services. IGST applicable (inter-state supply) as per IGST Act, 2017.',
    L, y);

  drawFooter(doc, 'This is a computer-generated tax invoice and does not require a physical signature.');
  return toBuffer(doc);
}
