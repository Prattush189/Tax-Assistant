/**
 * Rent Receipt Generator — produces a multi-page PDF with one receipt per month.
 */
import jsPDF from 'jspdf';

export interface RentReceiptInput {
  tenantName: string;
  landlordName: string;
  landlordPan?: string;
  propertyAddress: string;
  monthlyRent: number;
  fromMonth: number;   // 1-12
  fromYear: number;
  toMonth: number;     // 1-12
  toYear: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function numberToWords(n: number): string {
  if (n === 0) return 'Zero';
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

export function generateRentReceipts(input: RentReceiptInput): void {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const margin = 20;

  // Build list of months
  const months: { month: number; year: number }[] = [];
  let m = input.fromMonth, yr = input.fromYear;
  while (yr < input.toYear || (yr === input.toYear && m <= input.toMonth)) {
    months.push({ month: m, year: yr });
    m++;
    if (m > 12) { m = 1; yr++; }
  }

  const rentFormatted = '₹ ' + Math.round(input.monthlyRent).toLocaleString('en-IN');
  const rentWords = numberToWords(input.monthlyRent);

  months.forEach((period, idx) => {
    if (idx > 0) doc.addPage();
    let y = 30;
    const monthName = MONTHS[period.month - 1];
    const lastDay = new Date(period.year, period.month, 0).getDate();

    // Border
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.rect(margin - 5, 15, pw - 2 * (margin - 5), ph - 30);

    // Header
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('RENT RECEIPT', pw / 2, y, { align: 'center' });
    y += 10;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(`For the month of ${monthName} ${period.year}`, pw / 2, y, { align: 'center' });
    y += 12;
    doc.setTextColor(0);

    // Divider
    doc.setLineWidth(0.3);
    doc.line(margin, y, pw - margin, y);
    y += 10;

    // Body
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const lineH = 8;

    doc.text(`Received from:`, margin, y);
    doc.setFont('helvetica', 'bold');
    doc.text(input.tenantName, margin + 40, y);
    y += lineH;

    doc.setFont('helvetica', 'normal');
    doc.text(`Amount:`, margin, y);
    doc.setFont('helvetica', 'bold');
    doc.text(`${rentFormatted}  (${rentWords})`, margin + 40, y);
    y += lineH;

    doc.setFont('helvetica', 'normal');
    doc.text(`For period:`, margin, y);
    doc.text(`01/${String(period.month).padStart(2, '0')}/${period.year} to ${lastDay}/${String(period.month).padStart(2, '0')}/${period.year}`, margin + 40, y);
    y += lineH;

    doc.text(`Property:`, margin, y);
    // Wrap long address
    const addrLines = doc.splitTextToSize(input.propertyAddress, pw - 2 * margin - 40);
    doc.text(addrLines, margin + 40, y);
    y += lineH * Math.max(1, addrLines.length);

    y += 5;
    doc.setLineWidth(0.2);
    doc.line(margin, y, pw - margin, y);
    y += 10;

    // Landlord details
    doc.setFont('helvetica', 'normal');
    doc.text(`Received by:`, margin, y);
    doc.setFont('helvetica', 'bold');
    doc.text(input.landlordName, margin + 40, y);
    y += lineH;

    if (input.landlordPan) {
      doc.setFont('helvetica', 'normal');
      doc.text(`PAN:`, margin, y);
      doc.text(input.landlordPan, margin + 40, y);
      y += lineH;
    }

    y += 15;

    // Revenue stamp
    doc.setDrawColor(180);
    doc.setLineWidth(0.3);
    doc.rect(pw - margin - 35, y, 35, 20);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('Revenue', pw - margin - 17.5, y + 8, { align: 'center' });
    doc.text('Stamp', pw - margin - 17.5, y + 13, { align: 'center' });

    // Signature line
    doc.setTextColor(0);
    doc.setFontSize(10);
    doc.text('_________________________', margin, y + 15);
    doc.text('Signature of Landlord', margin, y + 21);

    // Date
    doc.setFontSize(9);
    doc.text(`Date: ${lastDay}/${String(period.month).padStart(2, '0')}/${period.year}`, margin, y + 30);

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text('Generated by Smartbiz AI (ai.smartbizin.com)', pw / 2, ph - 18, { align: 'center' });
  });

  doc.save(`rent-receipts-${input.fromYear}.pdf`);
}
