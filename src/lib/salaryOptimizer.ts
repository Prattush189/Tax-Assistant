/**
 * Salary Structure Optimizer — suggests optimal CTC breakup to minimize tax.
 * Pure function, no side effects.
 */
import { calculateIncomeTax, type IncomeTaxResult } from './taxEngine';
import { getTaxRules } from '../data/taxRules';

export interface SalaryOptimizerInput {
  ctc: number;
  isMetroCity: boolean;
  monthlyRent: number;         // actual rent paid per month
  fy: string;
}

export interface SalaryBreakdown {
  basic: number;
  hra: number;
  specialAllowance: number;
  npsEmployer: number;         // employer NPS (10% of basic, tax-free)
  grossSalary: number;
}

export interface SalaryOptimizerResult {
  currentBreakdown: SalaryBreakdown;   // typical 50% basic
  optimizedBreakdown: SalaryBreakdown; // optimized structure
  currentTax: IncomeTaxResult;
  optimizedTax: IncomeTaxResult;
  annualSavings: number;
}

function buildBreakdown(ctc: number, basicPercent: number, npsPercent: number): SalaryBreakdown {
  const basic = Math.round(ctc * basicPercent);
  const npsEmployer = Math.round(basic * npsPercent);
  const hra = Math.round(basic * 0.50); // 50% of basic for HRA
  const specialAllowance = Math.max(0, ctc - basic - hra - npsEmployer);
  return { basic, hra, specialAllowance, npsEmployer, grossSalary: ctc };
}

export function optimizeSalary(input: SalaryOptimizerInput): SalaryOptimizerResult {
  const { ctc, isMetroCity, monthlyRent, fy } = input;
  const rules = getTaxRules(fy);
  const annualRent = monthlyRent * 12;

  // Current: typical 50% basic, no employer NPS
  const currentBreakdown = buildBreakdown(ctc, 0.50, 0);

  // Try different basic percentages (40-50%) with employer NPS (10%)
  let bestTax = Infinity;
  let bestBasicPct = 0.40;
  let bestNpsPct = 0.10;

  for (let basicPct = 0.35; basicPct <= 0.55; basicPct += 0.01) {
    for (const npsPct of [0, 0.05, 0.10]) {
      const breakdown = buildBreakdown(ctc, basicPct, npsPct);
      const result = calculateIncomeTax({
        grossSalary: ctc,
        otherIncome: 0,
        fy,
        regime: 'old',
        ageCategory: 'below60',
        deductions: {
          section80C: 150000,
          section80CCD1B: 50000,
        },
        hra: {
          actualHRA: breakdown.hra,
          basicPlusDa: breakdown.basic,
          rentPaid: annualRent,
          isMetroCity,
        },
      }, rules);

      if (result.totalTax < bestTax) {
        bestTax = result.totalTax;
        bestBasicPct = basicPct;
        bestNpsPct = npsPct;
      }
    }
  }

  const optimizedBreakdown = buildBreakdown(ctc, bestBasicPct, bestNpsPct);

  const currentTax = calculateIncomeTax({
    grossSalary: ctc,
    otherIncome: 0,
    fy,
    regime: 'old',
    ageCategory: 'below60',
    deductions: { section80C: 150000 },
    hra: {
      actualHRA: currentBreakdown.hra,
      basicPlusDa: currentBreakdown.basic,
      rentPaid: annualRent,
      isMetroCity,
    },
  }, rules);

  const optimizedTax = calculateIncomeTax({
    grossSalary: ctc,
    otherIncome: 0,
    fy,
    regime: 'old',
    ageCategory: 'below60',
    deductions: { section80C: 150000, section80CCD1B: 50000 },
    hra: {
      actualHRA: optimizedBreakdown.hra,
      basicPlusDa: optimizedBreakdown.basic,
      rentPaid: annualRent,
      isMetroCity,
    },
  }, rules);

  return {
    currentBreakdown,
    optimizedBreakdown,
    currentTax,
    optimizedTax,
    annualSavings: currentTax.totalTax - optimizedTax.totalTax,
  };
}
