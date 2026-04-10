import type { TaxRules } from '../types';
import { calculateIncomeTax } from './taxEngine';
import { getTaxRules } from '../data/taxRules';

export interface AdvanceTaxInput {
  estimatedAnnualIncome: number;
  tdsAlreadyDeducted: number;
  selfAssessmentPaid: number;
  fy: string;
}

export interface AdvanceTaxInstallment {
  dueDate: string;       // "15 June 2026"
  cumulativePercent: number; // 15, 45, 75, 100
  cumulativeAmount: number;
  installmentAmount: number; // amount due this quarter
}

export interface AdvanceTaxResult {
  totalTaxLiability: number;  // computed from income using slab rates
  totalTdsCredit: number;
  netTaxPayable: number;
  advanceTaxRequired: boolean; // true if netTaxPayable >= 10000
  installments: AdvanceTaxInstallment[];
  interest234B: number;       // interest for default in payment
  interest234C: number;       // interest for deferral
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Parse FY string (e.g. "2026-27") to get the start year (2026) and end year (2027).
 */
function parseFY(fy: string): { startYear: number; endYear: number } {
  const [start, endSuffix] = fy.split('-');
  const startYear = Number(start);
  const endYear = Number(start.slice(0, 2) + endSuffix);
  return { startYear, endYear };
}

function formatDate(day: number, month: number, year: number): string {
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

// ── Quarterly installment schedule ──────────────────────────────────────────

const QUARTER_SCHEDULE = [
  { month: 6, day: 15, cumulativePercent: 15 },   // Q1: 15 June
  { month: 9, day: 15, cumulativePercent: 45 },   // Q2: 15 September
  { month: 12, day: 15, cumulativePercent: 75 },  // Q3: 15 December
  { month: 3, day: 15, cumulativePercent: 100 },  // Q4: 15 March
];

function buildInstallments(
  netTaxPayable: number,
  fy: string,
): AdvanceTaxInstallment[] {
  const { startYear, endYear } = parseFY(fy);
  let previousCumulative = 0;

  return QUARTER_SCHEDULE.map((q) => {
    // Q1-Q3 fall in the start year; Q4 falls in the end year
    const year = q.month >= 4 ? startYear : endYear;
    const cumulativeAmount = Math.round(netTaxPayable * (q.cumulativePercent / 100));
    const installmentAmount = cumulativeAmount - previousCumulative;
    previousCumulative = cumulativeAmount;

    return {
      dueDate: formatDate(q.day, q.month, year),
      cumulativePercent: q.cumulativePercent,
      cumulativeAmount,
      installmentAmount,
    };
  });
}

// ── Interest calculations ───────────────────────────────────────────────────

/**
 * Section 234B: Interest for default in payment of advance tax.
 * If advance tax paid < 90% of assessed tax, interest is 1% per month (simple)
 * on the shortfall amount, from April of the AY until date of payment.
 * For simplicity, we compute for 12 months (full AY) assuming no payment made.
 */
function calculateInterest234B(netTaxPayable: number): number {
  if (netTaxPayable <= 0) return 0;
  // 1% per month for 12 months on the unpaid tax
  const months = 12;
  return Math.round(netTaxPayable * 0.01 * months);
}

/**
 * Section 234C: Interest for deferment of advance tax installments.
 * 1% per month (simple) on the shortfall from each installment due date
 * until the next installment due date (3 months each, except last = 1 month).
 * Assuming zero advance tax payments made.
 */
function calculateInterest234C(
  installments: AdvanceTaxInstallment[],
): number {
  if (installments.length === 0) return 0;

  let total = 0;
  const monthGaps = [3, 3, 3, 1]; // months between due dates (Q1->Q2, Q2->Q3, Q3->Q4, Q4->March end)

  for (let i = 0; i < installments.length; i++) {
    const shortfall = installments[i].cumulativeAmount; // assuming 0 paid
    if (shortfall > 0) {
      total += shortfall * 0.01 * monthGaps[i];
    }
  }

  return Math.round(total);
}

// ── Main calculation ────────────────────────────────────────────────────────

export function calculateAdvanceTax(input: AdvanceTaxInput): AdvanceTaxResult {
  const { estimatedAnnualIncome, tdsAlreadyDeducted, selfAssessmentPaid, fy } = input;

  const rules = getTaxRules(fy);

  // Compute total tax liability using the new regime slab rates (default)
  const taxResult = calculateIncomeTax(
    {
      grossSalary: estimatedAnnualIncome,
      otherIncome: 0,
      fy,
      regime: 'new',
      ageCategory: 'below60',
    },
    rules,
  );

  const totalTaxLiability = Math.round(taxResult.totalTax);
  const totalTdsCredit = tdsAlreadyDeducted;
  const netTaxPayable = Math.max(0, totalTaxLiability - tdsAlreadyDeducted - selfAssessmentPaid);
  const advanceTaxRequired = netTaxPayable >= 10000;

  const installments = advanceTaxRequired ? buildInstallments(netTaxPayable, fy) : [];

  // Interest calculations (worst case: no advance tax paid at all)
  const interest234B = advanceTaxRequired ? calculateInterest234B(netTaxPayable) : 0;
  const interest234C = advanceTaxRequired ? calculateInterest234C(installments) : 0;

  return {
    totalTaxLiability,
    totalTdsCredit,
    netTaxPayable,
    advanceTaxRequired,
    installments,
    interest234B,
    interest234C,
  };
}
