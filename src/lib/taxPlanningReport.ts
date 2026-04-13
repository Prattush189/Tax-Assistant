/**
 * Tax Planning / Regime Comparison Report — detailed PDF with optimization suggestions.
 * Uses the existing tax engine results to generate a comprehensive printable report.
 */
import jsPDF from 'jspdf';
import type { IncomeTaxResult } from './taxEngine';

function fmt(n: number): string {
  return '₹ ' + Math.round(n).toLocaleString('en-IN');
}

function pct(n: number): string {
  return n.toFixed(2) + '%';
}

export function generateTaxPlanningReport(
  oldResult: IncomeTaxResult,
  newResult: IncomeTaxResult,
  fy: string,
  userName?: string,
  deductionDetails?: {
    section80C?: number;
    section80D?: number;
    section80CCD1B?: number;
    nps80CCD2?: number;
    section80E?: number;
    section80G?: number;
    section80TTA?: number;
    hra?: number;
  },
): void {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const ml = 18;
  const mr = 18;
  let y = 15;

  const now = new Date();
  const today = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

  function sectionHeader(title: string) {
    checkBreak(20);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(13, 150, 104);
    doc.text(title, ml, y);
    y += 1;
    doc.setDrawColor(13, 150, 104);
    doc.setLineWidth(0.6);
    doc.line(ml, y, pw - mr, y);
    y += 7;
    doc.setTextColor(0);
  }

  function row(label: string, value: string, bold = false) {
    doc.setFontSize(10);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, ml + 4, y);
    doc.text(value, pw - mr - 4, y, { align: 'right' });
    y += 6;
  }

  function note(text: string) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100);
    const lines = doc.splitTextToSize(text, pw - ml - mr - 8);
    doc.text(lines, ml + 4, y);
    y += lines.length * 4.5;
    doc.setTextColor(0);
  }

  function checkBreak(needed: number) {
    if (y + needed > ph - 25) {
      doc.addPage();
      y = 15;
    }
  }

  // ── Cover ──────────────────────────────────────────────────────────
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(13, 150, 104);
  doc.text('Tax Planning Report', pw / 2, y + 10, { align: 'center' });
  y += 20;
  doc.setFontSize(14);
  doc.setTextColor(60);
  doc.text(`Financial Year ${fy}`, pw / 2, y, { align: 'center' });
  y += 10;
  if (userName) {
    doc.setFontSize(12);
    doc.text(`Prepared for: ${userName}`, pw / 2, y, { align: 'center' });
    y += 8;
  }
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Date: ${today}`, pw / 2, y, { align: 'center' });
  y += 15;
  doc.setTextColor(0);

  // ── 1. Executive Summary ───────────────────────────────────────────
  sectionHeader('1. Executive Summary');
  const diff = oldResult.totalTax - newResult.totalTax;
  const betterRegime = diff > 0 ? 'New' : diff < 0 ? 'Old' : 'Both Equal';
  const savings = Math.abs(diff);

  row('Gross Income', fmt(oldResult.grossIncome));
  row('Total Tax (Old Regime)', fmt(oldResult.totalTax));
  row('Total Tax (New Regime)', fmt(newResult.totalTax));
  y += 2;
  row('Better Regime', betterRegime + ' Regime', true);
  row('Tax Savings', fmt(savings), true);
  row('Old Regime Effective Rate', pct(oldResult.effectiveRate));
  row('New Regime Effective Rate', pct(newResult.effectiveRate));
  y += 4;

  if (diff > 0) {
    note(`Recommendation: File under the New Regime to save ${fmt(savings)}. The new regime offers lower slab rates with fewer deductions.`);
  } else if (diff < 0) {
    note(`Recommendation: File under the Old Regime to save ${fmt(savings)}. Your deductions make the old regime more tax-efficient.`);
  } else {
    note('Both regimes result in equal tax. Choose based on flexibility — new regime is simpler, old allows more deductions.');
  }
  y += 4;

  // ── 2. Income Breakdown ───────────────────────────────────────────
  sectionHeader('2. Income Breakdown');
  row('Gross Salary + Other Income', fmt(oldResult.grossIncome));
  row('Standard Deduction (Old)', fmt(oldResult.standardDeduction));
  row('Standard Deduction (New)', fmt(newResult.standardDeduction));
  if (oldResult.hraExemption > 0) row('HRA Exemption (Old)', fmt(oldResult.hraExemption));
  const otherDed = oldResult.totalDeductions - oldResult.standardDeduction - oldResult.hraExemption;
  if (otherDed > 0) row('Chapter VI-A Deductions (Old)', fmt(otherDed));
  row('Taxable Income (Old)', fmt(oldResult.taxableIncome));
  row('Taxable Income (New)', fmt(newResult.taxableIncome));
  y += 4;

  // ── 3. Slab-by-Slab Comparison ────────────────────────────────────
  sectionHeader('3. Slab-by-Slab Tax Computation');

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Old Regime', ml + 4, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  for (const slab of oldResult.slabBreakdown) {
    row(`  ${slab.slab}`, fmt(slab.tax));
  }
  row('  Slab Tax Total', fmt(oldResult.slabTax), true);
  if (oldResult.rebate87A > 0) row('  Less: Rebate 87A', fmt(oldResult.rebate87A));
  if (oldResult.surcharge > 0) row(`  Surcharge (${(oldResult.surchargeRate * 100).toFixed(0)}%)`, fmt(oldResult.surcharge));
  row('  Cess (4%)', fmt(oldResult.cess));
  row('  Total Tax', fmt(oldResult.totalTax), true);
  y += 4;

  checkBreak(40);
  doc.setFont('helvetica', 'bold');
  doc.text('New Regime', ml + 4, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  for (const slab of newResult.slabBreakdown) {
    row(`  ${slab.slab}`, fmt(slab.tax));
  }
  row('  Slab Tax Total', fmt(newResult.slabTax), true);
  if (newResult.rebate87A > 0) row('  Less: Rebate 87A', fmt(newResult.rebate87A));
  if (newResult.marginalRelief > 0) row('  Less: Marginal Relief', fmt(newResult.marginalRelief));
  if (newResult.surcharge > 0) row(`  Surcharge (${(newResult.surchargeRate * 100).toFixed(0)}%)`, fmt(newResult.surcharge));
  row('  Cess (4%)', fmt(newResult.cess));
  row('  Total Tax', fmt(newResult.totalTax), true);
  y += 4;

  // ── 4. Optimization Suggestions ───────────────────────────────────
  checkBreak(40);
  sectionHeader('4. Optimization Suggestions');
  const suggestions: string[] = [];

  const d = deductionDetails ?? {};
  const used80C = d.section80C ?? 0;
  if (used80C < 150000 && diff < 0) {
    const gap = 150000 - used80C;
    const potentialSaving = Math.round(gap * oldResult.marginalRate * 1.04);
    suggestions.push(`Invest ₹ ${Math.round(gap).toLocaleString('en-IN')} more under Section 80C (ELSS, PPF, LIC) to save up to ₹ ${potentialSaving.toLocaleString('en-IN')} in tax.`);
  }

  const used80D = d.section80D ?? 0;
  if (used80D < 25000) {
    suggestions.push('Take health insurance to claim up to ₹25,000 under Section 80D (₹50,000 if senior citizen).');
  }

  const usedNPS = d.section80CCD1B ?? 0;
  if (usedNPS < 50000) {
    suggestions.push(`Invest ₹ ${(50000 - usedNPS).toLocaleString('en-IN')} in NPS under 80CCD(1B) for additional ₹50,000 deduction beyond 80C.`);
  }

  if (oldResult.grossIncome > 1200000 && diff > 0) {
    suggestions.push('With income above ₹12L, the new regime offers lower slab rates that outweigh old regime deductions.');
  }

  if (oldResult.grossIncome <= 700000) {
    suggestions.push('Your income is within the ₹7L rebate threshold under the old regime — consider maximizing 80C to bring taxable income below ₹5L for zero tax.');
  }

  if (newResult.totalTax === 0 && oldResult.totalTax === 0) {
    suggestions.push('Your total tax is NIL under both regimes. No optimization needed — but consider investing for future years.');
  }

  if (suggestions.length === 0) {
    suggestions.push('Your deductions are well-optimized. Continue the current investment pattern.');
  }

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  for (let i = 0; i < suggestions.length; i++) {
    checkBreak(12);
    const lines = doc.splitTextToSize(`${i + 1}. ${suggestions[i]}`, pw - ml - mr - 8);
    doc.text(lines, ml + 4, y);
    y += lines.length * 5 + 2;
  }
  y += 4;

  // ── 5. Action Items ────────────────────────────────────────────────
  checkBreak(30);
  sectionHeader('5. Action Items');
  const actions = [
    `File your ITR under the ${betterRegime} Regime for FY ${fy}.`,
    'Ensure all TDS entries match Form 26AS / AIS before filing.',
    'Keep investment proofs (80C, 80D, rent receipts) for at least 6 years.',
    'Pay any advance tax due to avoid interest u/s 234B/234C.',
  ];
  for (let i = 0; i < actions.length; i++) {
    checkBreak(8);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`☐ ${actions[i]}`, ml + 4, y);
    y += 6;
  }

  // ── Footer ─────────────────────────────────────────────────────────
  const fy2 = ph - 18;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(130);
  doc.text('Disclaimer: This report is for informational purposes only. Consult a qualified CA for official filing and investment decisions.', pw / 2, fy2, { align: 'center' });
  doc.text(`Generated on ${today} by Smartbiz AI (ai.smartbizin.com)`, pw / 2, fy2 + 4, { align: 'center' });

  doc.save(`tax-planning-report-FY-${fy}.pdf`);
}
