/**
 * Salary Slip (Payslip) Generator — produces a single-page A4 PDF
 * payslip in the standard Indian format: employer header, employee
 * detail block, side-by-side Earnings / Deductions tables, and a
 * net-pay summary with the amount in words.
 *
 * Mirrors the jsPDF approach in rentReceiptPdf.ts (direct draw calls,
 * `doc.save()` to download) so the two slip generators stay
 * consistent and easy to maintain together.
 */
import jsPDF from 'jspdf';

/** A single earnings or deductions line item. */
export interface PayslipLineItem {
  label: string;
  amount: number;
}

export interface SalarySlipInput {
  /** Employer / company block (printed as the masthead). */
  companyName: string;
  companyAddress?: string;
  /** Pay period. month is 1-12. */
  month: number;
  year: number;
  /** Employee identity block. */
  employeeName: string;
  employeeId?: string;
  designation?: string;
  department?: string;
  pan?: string;
  bankAccount?: string;
  /** Attendance — optional; shown only when provided. */
  paidDays?: number;
  lopDays?: number;
  /** Earnings and deductions. Net pay is gross − total deductions. */
  earnings: PayslipLineItem[];
  deductions: PayslipLineItem[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Convert a whole-rupee number to Indian-system words. Shared shape
 *  with rentReceiptPdf.numberToWords — kept local so the two files
 *  stay independent (no shared-helper coupling between unrelated
 *  generators). */
function numberToWords(n: number): string {
  if (n === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convert(num: number): string {
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' and ' + convert(num % 100) : '');
    if (num < 100000) return convert(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + convert(num % 1000) : '');
    if (num < 10000000) return convert(Math.floor(num / 100000)) + ' Lakh' + (num % 100000 ? ' ' + convert(num % 100000) : '');
    return convert(Math.floor(num / 10000000)) + ' Crore' + (num % 10000000 ? ' ' + convert(num % 10000000) : '');
  }
  return convert(Math.round(n)) + ' Rupees Only';
}

const inr = (n: number) => 'Rs. ' + Math.round(n).toLocaleString('en-IN');

export function sumLineItems(items: PayslipLineItem[]): number {
  return items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
}

export function generateSalarySlip(input: SalarySlipInput): void {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const margin = 16;
  const innerW = pw - 2 * margin;

  // Filter out blank/zero line items so the tables stay tight.
  const earnings = input.earnings.filter(e => (Number(e.amount) || 0) !== 0 || e.label.trim());
  const deductions = input.deductions.filter(d => (Number(d.amount) || 0) !== 0 || d.label.trim());
  const grossEarnings = sumLineItems(earnings);
  const totalDeductions = sumLineItems(deductions);
  const netPay = grossEarnings - totalDeductions;

  // Outer border.
  doc.setDrawColor(40);
  doc.setLineWidth(0.4);
  doc.rect(margin, 14, innerW, ph - 28);

  let y = 24;

  // ── Masthead ──────────────────────────────────────────────────
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20);
  doc.text(input.companyName || 'Company Name', pw / 2, y, { align: 'center' });
  y += 6;

  if (input.companyAddress && input.companyAddress.trim()) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(90);
    const addrLines = doc.splitTextToSize(input.companyAddress.trim(), innerW - 20);
    doc.text(addrLines, pw / 2, y, { align: 'center' });
    y += 4.5 * addrLines.length;
  }
  y += 3;

  // Payslip title band.
  doc.setFillColor(235, 244, 238);
  doc.rect(margin, y, innerW, 9, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20);
  doc.text(
    `PAYSLIP FOR ${(MONTHS[input.month - 1] ?? '').toUpperCase()} ${input.year}`,
    pw / 2, y + 6, { align: 'center' },
  );
  y += 15;

  // ── Employee detail block (two columns) ───────────────────────
  doc.setFontSize(9);
  doc.setTextColor(40);
  const colGap = innerW / 2;
  const leftX = margin + 2;
  const rightX = margin + colGap + 2;

  const detailPairs: Array<[string, string | undefined]> = [
    ['Employee Name', input.employeeName],
    ['Employee ID', input.employeeId],
    ['Designation', input.designation],
    ['Department', input.department],
    ['PAN', input.pan],
    ['Bank A/C', input.bankAccount],
  ];
  if (input.paidDays != null) detailPairs.push(['Paid Days', String(input.paidDays)]);
  if (input.lopDays != null) detailPairs.push(['LOP Days', String(input.lopDays)]);

  // Render in two columns: even-index rows on the left, odd on the right.
  const rowsPerCol = Math.ceil(detailPairs.length / 2);
  const detailStartY = y;
  let maxColY = y;
  detailPairs.forEach((pair, i) => {
    const [label, value] = pair;
    if (!value) return;
    const col = i < rowsPerCol ? 0 : 1;
    const rowInCol = col === 0 ? i : i - rowsPerCol;
    const x = col === 0 ? leftX : rightX;
    const rowY = detailStartY + rowInCol * 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(110);
    doc.text(`${label}:`, x, rowY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30);
    doc.text(value, x + 28, rowY);
    if (rowY > maxColY) maxColY = rowY;
  });
  y = maxColY + 8;

  // ── Earnings / Deductions tables (side by side) ───────────────
  const tableTop = y;
  const tableW = (innerW - 4) / 2;
  const earnX = margin;
  const dedX = margin + tableW + 4;
  const rowH = 6.5;

  const drawTableHeader = (x: number, title: string) => {
    doc.setFillColor(245, 246, 248);
    doc.rect(x, tableTop, tableW, 8, 'F');
    doc.setDrawColor(200);
    doc.setLineWidth(0.2);
    doc.rect(x, tableTop, tableW, 8);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40);
    doc.text(title, x + 2, tableTop + 5.5);
    doc.text('Amount', x + tableW - 2, tableTop + 5.5, { align: 'right' });
  };
  drawTableHeader(earnX, 'Earnings');
  drawTableHeader(dedX, 'Deductions');

  const drawRows = (x: number, items: PayslipLineItem[]): number => {
    let ry = tableTop + 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(50);
    for (const item of items) {
      doc.setDrawColor(225);
      doc.setLineWidth(0.1);
      doc.rect(x, ry, tableW, rowH);
      const labelLines = doc.splitTextToSize(item.label || '-', tableW - 30);
      doc.text(labelLines[0] ?? '-', x + 2, ry + 4.4);
      doc.text(inr(Number(item.amount) || 0), x + tableW - 2, ry + 4.4, { align: 'right' });
      ry += rowH;
    }
    return ry;
  };
  const earnEndY = drawRows(earnX, earnings);
  const dedEndY = drawRows(dedX, deductions);

  // Pad the shorter table with blank rows so the two totals align.
  const bottomRowsY = Math.max(earnEndY, dedEndY);
  const padTable = (x: number, fromY: number) => {
    let py = fromY;
    while (py < bottomRowsY - 0.01) {
      doc.setDrawColor(225);
      doc.setLineWidth(0.1);
      doc.rect(x, py, tableW, rowH);
      py += rowH;
    }
  };
  padTable(earnX, earnEndY);
  padTable(dedX, dedEndY);

  // Totals row.
  const totalsY = bottomRowsY;
  const drawTotal = (x: number, label: string, amount: number) => {
    doc.setFillColor(235, 244, 238);
    doc.rect(x, totalsY, tableW, 8, 'F');
    doc.setDrawColor(180);
    doc.setLineWidth(0.2);
    doc.rect(x, totalsY, tableW, 8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(20);
    doc.text(label, x + 2, totalsY + 5.5);
    doc.text(inr(amount), x + tableW - 2, totalsY + 5.5, { align: 'right' });
  };
  drawTotal(earnX, 'Gross Earnings', grossEarnings);
  drawTotal(dedX, 'Total Deductions', totalDeductions);
  y = totalsY + 14;

  // ── Net pay summary ───────────────────────────────────────────
  doc.setFillColor(20, 83, 45);
  doc.rect(margin, y, innerW, 11, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255);
  doc.text('NET PAY', margin + 3, y + 7);
  doc.text(inr(netPay), pw - margin - 3, y + 7, { align: 'right' });
  y += 16;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(60);
  const words = numberToWords(Math.max(0, netPay));
  const wordLines = doc.splitTextToSize(`In words: ${words}`, innerW - 4);
  doc.text(wordLines, margin + 2, y);
  y += 5 * wordLines.length + 6;

  // ── Footer ────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    'This is a computer-generated payslip and does not require a signature.',
    pw / 2, ph - 24, { align: 'center' },
  );
  doc.setFontSize(7);
  doc.setTextColor(150);
  doc.text('Generated by Smartbiz AI (ai.smartbizin.com)', pw / 2, ph - 19, { align: 'center' });

  const periodTag = `${MONTHS[input.month - 1] ?? ''}-${input.year}`;
  const nameTag = (input.employeeName || 'employee').trim().replace(/\s+/g, '-').toLowerCase();
  doc.save(`payslip-${nameTag}-${periodTag}.pdf`);
}
