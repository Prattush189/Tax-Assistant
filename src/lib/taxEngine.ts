import type { TaxRules, AgeCategory, TaxRegime, Slab } from '../types';

export interface HRAInput {
  actualHRA: number;
  basicPlusDa: number;
  rentPaid: number;
  isMetroCity: boolean;
}

export interface IncomeTaxInput {
  grossSalary: number;       // Total salary before any deduction
  otherIncome: number;       // Interest, rental, etc.
  fy: string;
  regime: TaxRegime;
  ageCategory: AgeCategory;
  // Old regime only (ignored in new regime):
  deductions?: {
    section80C?: number;
    section80D_self?: number;
    section80D_parents?: number;
    section80CCD1B?: number;
    isSelfSenior?: boolean;
    isParentsSenior?: boolean;
    // Extended deductions
    section80E?: number;      // Education loan interest
    section80G?: number;      // Donations
    section80TTA?: number;    // Savings interest
    section24b?: number;      // Home loan interest
    section80EEB?: number;    // EV loan interest
  };
  hra?: HRAInput;            // Only for old regime salaried
}

export interface SlabBreakdown {
  slab: string;
  taxableAmount: number;
  tax: number;
}

export interface IncomeTaxResult {
  grossIncome: number;
  standardDeduction: number;
  hraExemption: number;
  totalDeductions: number;
  taxableIncome: number;
  slabTax: number;
  slabBreakdown: SlabBreakdown[];
  rebate87A: number;
  marginalRelief: number;
  taxAfterRebate: number;
  surcharge: number;
  surchargeRate: number;      // e.g., 0.10 for 10%
  cess: number;
  totalTax: number;
  effectiveRate: number;      // totalTax / grossIncome as a percentage
}

// ── Core helpers ──────────────────────────────────────────────────────────────

/**
 * Compute slab tax and per-slab breakdown for a given income and slab table.
 */
export function computeSlabTax(
  income: number,
  slabs: Slab[],
): { total: number; breakdown: SlabBreakdown[] } {
  let remaining = income;
  let total = 0;
  const breakdown: SlabBreakdown[] = [];
  let prevLimit = 0;

  for (const slab of slabs) {
    if (remaining <= 0) break;

    const bandSize = slab.upTo === Infinity ? remaining : Math.min(remaining, slab.upTo - prevLimit);
    const taxableAmount = Math.min(remaining, bandSize);
    const tax = taxableAmount * slab.rate;
    total += tax;

    if (slab.rate > 0) {
      const label =
        slab.upTo === Infinity
          ? `Above ₹${(prevLimit / 100000).toFixed(1)}L`
          : prevLimit === 0
          ? `Up to ₹${(slab.upTo / 100000).toFixed(1)}L`
          : `₹${(prevLimit / 100000).toFixed(1)}L – ₹${(slab.upTo / 100000).toFixed(1)}L`;

      breakdown.push({ slab: label, taxableAmount, tax });
    }

    remaining -= taxableAmount;
    prevLimit = slab.upTo === Infinity ? prevLimit : slab.upTo;
  }

  return { total, breakdown };
}

/**
 * Calculate HRA exemption (old regime, salaried).
 * CRITICAL: base is basic+DA — NOT gross salary.
 * Returns 0 if rentPaid is 0 (no HRA claim).
 */
export function calculateHRAExemption(input: HRAInput): number {
  const { actualHRA, basicPlusDa, rentPaid, isMetroCity } = input;

  if (rentPaid <= 0) return 0;

  const cityPct = isMetroCity ? 0.50 : 0.40;
  const cityComponent = cityPct * basicPlusDa;
  const rentMinusThreshold = rentPaid - 0.10 * basicPlusDa;

  const exemption = Math.min(actualHRA, cityComponent, rentMinusThreshold);
  return Math.max(0, exemption);
}

/**
 * Apply marginal relief logic for the new regime.
 * Prevents the ₹12L threshold cliff.
 *
 * - If taxableIncome <= rebateThreshold: full rebate applies (up to maxRebate), no marginal relief
 * - If taxableIncome > rebateThreshold: no rebate; marginal relief = max(0, slabTax − excessAboveThreshold)
 */
export function applyMarginalRelief(
  slabTax: number,
  taxableIncome: number,
  rules: TaxRules['newRegime'],
): { effectiveTax: number; rebate87A: number; marginalRelief: number } {
  const { maxRebate, incomeThreshold } = rules.rebate87A;

  if (taxableIncome <= incomeThreshold) {
    const rebate87A = Math.min(slabTax, maxRebate);
    return { effectiveTax: 0, rebate87A, marginalRelief: 0 };
  }

  // Above threshold — no rebate; apply marginal relief
  const excessAboveThreshold = taxableIncome - incomeThreshold;
  const marginalRelief = Math.max(0, slabTax - excessAboveThreshold);
  const effectiveTax = slabTax - marginalRelief;

  return { effectiveTax, rebate87A: 0, marginalRelief };
}

/**
 * Compute surcharge on tax based on taxable income.
 * Includes marginal relief to prevent cliff at thresholds.
 */
export function computeSurcharge(
  taxAfterRebate: number,
  taxableIncome: number,
  regime: TaxRegime,
): { surcharge: number; surchargeRate: number } {
  if (taxAfterRebate <= 0) return { surcharge: 0, surchargeRate: 0 };

  // Surcharge slabs
  const surchargeSlabs = [
    { threshold: 5000000,  rate: 0.10 },  // ₹50L–₹1Cr
    { threshold: 10000000, rate: 0.15 },  // ₹1Cr–₹2Cr
    { threshold: 20000000, rate: 0.25 },  // ₹2Cr–₹5Cr
    { threshold: 50000000, rate: regime === 'new' ? 0.25 : 0.37 }, // Above ₹5Cr (25% cap for new regime)
  ];

  let surchargeRate = 0;
  for (const slab of surchargeSlabs) {
    if (taxableIncome > slab.threshold) {
      surchargeRate = slab.rate;
    }
  }

  if (surchargeRate === 0) return { surcharge: 0, surchargeRate: 0 };

  let surcharge = taxAfterRebate * surchargeRate;

  // Marginal relief: surcharge cannot exceed income above the threshold
  const applicableThreshold = surchargeSlabs.find(s => taxableIncome <= s.threshold * 2 && taxableIncome > s.threshold)?.threshold;
  if (applicableThreshold) {
    const excessIncome = taxableIncome - applicableThreshold;
    if (surcharge > excessIncome) {
      surcharge = excessIncome;
    }
  }

  return { surcharge: Math.round(surcharge), surchargeRate };
}

// ── Main calculation ──────────────────────────────────────────────────────────

/**
 * Calculate income tax for a given input and tax rules.
 * Pure function — no side effects, no React dependencies.
 * 87A rebate applies ONLY against slab tax on normal income.
 * Capital gains tax is handled separately in capitalGainsEngine.ts.
 */
export function calculateIncomeTax(
  input: IncomeTaxInput,
  rules: TaxRules,
): IncomeTaxResult {
  const { grossSalary, otherIncome, regime, ageCategory, deductions, hra } = input;
  const grossIncome = grossSalary + otherIncome;

  // ── Standard deduction ────────────────────────────────────────────────────
  const standardDeduction =
    regime === 'new'
      ? rules.newRegime.standardDeduction
      : rules.oldRegime.standardDeduction;

  // ── HRA exemption (old regime only) ──────────────────────────────────────
  let hraExemption = 0;
  if (regime === 'old' && hra) {
    hraExemption = calculateHRAExemption(hra);
  }

  // ── Other deductions (old regime only) ───────────────────────────────────
  let totalOtherDeductions = 0;

  if (regime === 'old' && deductions) {
    const limits = rules.oldRegime.deductionLimits;
    const isSelfSenior = deductions.isSelfSenior ?? false;
    const isParentsSenior = deductions.isParentsSenior ?? false;

    const sec80C = Math.min(deductions.section80C ?? 0, limits.section80C);
    const sec80D_self = Math.min(
      deductions.section80D_self ?? 0,
      isSelfSenior ? limits.section80D_self_senior : limits.section80D_self,
    );
    const sec80D_parents = Math.min(
      deductions.section80D_parents ?? 0,
      isParentsSenior ? limits.section80D_parents_senior : limits.section80D_parents,
    );
    const sec80CCD1B = Math.min(deductions.section80CCD1B ?? 0, limits.section80CCD1B);

    // Extended deductions
    const sec80E = Math.min(deductions.section80E ?? 0, limits.section80E ?? Infinity);
    const sec80G = Math.min(deductions.section80G ?? 0, limits.section80G ?? Infinity);
    const sec80TTA = Math.min(
      deductions.section80TTA ?? 0,
      isSelfSenior ? (limits.section80TTA_senior ?? 50000) : (limits.section80TTA ?? 10000),
    );
    const sec24b = Math.min(deductions.section24b ?? 0, limits.section24b ?? 200000);
    const sec80EEB = Math.min(deductions.section80EEB ?? 0, limits.section80EEB ?? 150000);

    totalOtherDeductions = sec80C + sec80D_self + sec80D_parents + sec80CCD1B
      + sec80E + sec80G + sec80TTA + sec24b + sec80EEB;
  }

  const totalDeductions = standardDeduction + hraExemption + totalOtherDeductions;
  const taxableIncome = Math.max(0, grossIncome - totalDeductions);

  // ── Slab tax ──────────────────────────────────────────────────────────────
  let slabs: Slab[];
  if (regime === 'new') {
    slabs = rules.newRegime.slabs;
  } else {
    slabs = rules.oldRegime.slabs[ageCategory];
  }

  const { total: slabTax, breakdown: slabBreakdown } = computeSlabTax(taxableIncome, slabs);

  // ── Rebate / marginal relief ──────────────────────────────────────────────
  let rebate87A = 0;
  let marginalRelief = 0;
  let taxAfterRebate: number;

  if (regime === 'new') {
    const result = applyMarginalRelief(slabTax, taxableIncome, rules.newRegime);
    rebate87A = result.rebate87A;
    marginalRelief = result.marginalRelief;
    taxAfterRebate = result.effectiveTax;
  } else {
    // Old regime: simple 87A rebate, no marginal relief
    const { maxRebate, incomeThreshold } = rules.oldRegime.rebate87A;
    if (taxableIncome <= incomeThreshold) {
      rebate87A = Math.min(slabTax, maxRebate);
    }
    taxAfterRebate = slabTax - rebate87A;
  }

  // ── Surcharge ─────────────────────────────────────────────────────────────
  const { surcharge, surchargeRate } = computeSurcharge(taxAfterRebate, taxableIncome, regime);
  const taxPlusSurcharge = taxAfterRebate + surcharge;

  // ── Cess (on tax + surcharge) ────────────────────────────────────────────
  const cess = taxPlusSurcharge * rules.cess;
  const totalTax = taxPlusSurcharge + cess;
  const effectiveRate = grossIncome > 0 ? (totalTax / grossIncome) * 100 : 0;

  return {
    grossIncome,
    standardDeduction,
    hraExemption,
    totalDeductions,
    taxableIncome,
    slabTax,
    slabBreakdown,
    rebate87A,
    marginalRelief,
    taxAfterRebate,
    surcharge,
    surchargeRate,
    cess,
    totalTax,
    effectiveRate,
  };
}

// REFERENCE TEST CASES (verified against incometax.gov.in calculator):
//
// FY 2025-26 New Regime, ₹15L salary, below60:
//   taxableIncome = 15,00,000 - 75,000 = 14,25,000
//   slabTax:
//     4L@0%     = 0
//     4L@5%     = 20,000
//     4L@10%    = 40,000
//     2.25L@15% = 33,750
//   slabTax = 93,750
//   No rebate (taxableIncome 14.25L > 12L threshold), no marginal relief
//   cess = 93,750 × 4% = 3,750
//   totalTax = 97,500
//
// FY 2025-26 New Regime, ₹12.1L salary, below60:
//   taxableIncome = 12,10,000 - 75,000 = 11,35,000
//   11.35L ≤ 12L threshold → full rebate applies
//   slabTax:
//     4L@0%    = 0
//     4L@5%    = 20,000
//     3.35L@10%= 33,500
//   slabTax = 53,500
//   rebate87A = min(53,500, 60,000) = 53,500 → full rebate
//   totalTax = 0 (rebate covers all slab tax)
//
// FY 2025-26 New Regime, ₹13L gross, below60:
//   taxableIncome = 13,00,000 - 75,000 = 12,25,000 → above 12L threshold
//   slabTax:
//     4L@0%    = 0
//     4L@5%    = 20,000
//     4L@10%   = 40,000
//     0.25L@15%= 3,750
//   slabTax = 63,750
//   excessAboveThreshold = 12,25,000 - 12,00,000 = 25,000
//   marginalRelief = max(0, 63,750 - 25,000) = 38,750
//   taxAfterRebate = 63,750 - 38,750 = 25,000
//   cess = 25,000 × 4% = 1,000
//   totalTax = 26,000
