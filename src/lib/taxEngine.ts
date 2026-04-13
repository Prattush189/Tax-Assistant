import type { TaxRules, AgeCategory, TaxRegime, Slab, SurchargeBracket, TaxpayerCategory } from '../types';

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
  category?: TaxpayerCategory; // default 'Individual'
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
  marginalRate: number;       // top slab rate actually reached, e.g. 0.30
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
 *
 * Marginal relief rule: the total (tax + surcharge) at income I must not
 * exceed (tax at threshold T, no surcharge) + (I − T). This means as you
 * cross a surcharge threshold, the extra tax burden cannot outrun the extra
 * rupees earned above the threshold.
 *
 * Correct formula:
 *   allowed      = taxSlabAt(T) + (I − T)
 *   preRelief    = taxAfterRebate + taxAfterRebate × rate
 *   surcharge    = max(0, allowed − taxAfterRebate)   (only if preRelief > allowed)
 */
export function computeSurcharge(
  taxAfterRebate: number,
  taxableIncome: number,
  brackets: SurchargeBracket[],
  slabTaxAt: (income: number) => number,
): { surcharge: number; surchargeRate: number } {
  if (taxAfterRebate <= 0) return { surcharge: 0, surchargeRate: 0 };

  // Find the highest bracket the income strictly exceeds.
  let active: SurchargeBracket | undefined;
  for (const b of brackets) {
    if (taxableIncome > b.above) active = b;
  }
  if (!active) return { surcharge: 0, surchargeRate: 0 };

  let surcharge = taxAfterRebate * active.rate;

  // Marginal relief against the threshold this surcharge rate kicks in at.
  const taxAtThreshold = slabTaxAt(active.above);
  const allowed = taxAtThreshold + (taxableIncome - active.above);
  if (taxAfterRebate + surcharge > allowed) {
    surcharge = Math.max(0, allowed - taxAfterRebate);
  }

  return { surcharge: Math.round(surcharge), surchargeRate: active.rate };
}

/**
 * Result shape for the post-deduction tax pipeline. Subset of IncomeTaxResult
 * without the gross-income / deduction fields.
 */
export interface TaxOnIncomeResult {
  slabTax: number;
  slabBreakdown: SlabBreakdown[];
  rebate87A: number;
  marginalRelief: number;
  taxAfterRebate: number;
  surcharge: number;
  surchargeRate: number;
  cess: number;
  totalTax: number;
  marginalRate: number;
}

/**
 * Compute tax on an already-taxable income (post standard deduction, HRA,
 * Chapter VI-A — all deductions subtracted upstream by the caller).
 *
 * Use when the caller owns the deduction pipeline and only needs the
 * post-deduction tax math (e.g. the ITR wizard, which already computes
 * TotalIncome per CBDT rules before invoking this helper).
 *
 * For the full end-to-end flow (gross salary → deductions → tax), use
 * `calculateIncomeTax`.
 */
export function computeTaxOnTaxableIncome(
  taxableIncome: number,
  regime: TaxRegime,
  ageCategory: AgeCategory,
  rules: TaxRules,
): TaxOnIncomeResult {
  const slabs = regime === 'new' ? rules.newRegime.slabs : rules.oldRegime.slabs[ageCategory];

  const { total: slabTax, breakdown: slabBreakdown } = computeSlabTax(taxableIncome, slabs);

  let rebate87A = 0;
  let marginalRelief = 0;
  let taxAfterRebate: number;

  if (regime === 'new') {
    const res = applyMarginalRelief(slabTax, taxableIncome, rules.newRegime);
    rebate87A = res.rebate87A;
    marginalRelief = res.marginalRelief;
    taxAfterRebate = res.effectiveTax;
  } else {
    const { maxRebate, incomeThreshold } = rules.oldRegime.rebate87A;
    if (taxableIncome <= incomeThreshold) {
      rebate87A = Math.min(slabTax, maxRebate);
    }
    taxAfterRebate = slabTax - rebate87A;
  }

  const brackets = regime === 'new' ? rules.surcharge.new : rules.surcharge.old;
  const { surcharge, surchargeRate } = computeSurcharge(
    taxAfterRebate,
    taxableIncome,
    brackets,
    (inc) => computeSlabTax(inc, slabs).total,
  );

  const taxPlusSurcharge = taxAfterRebate + surcharge;
  const cess = taxPlusSurcharge * rules.cess;
  const totalTax = taxPlusSurcharge + cess;
  const marginalRate = topSlabRateReached(taxableIncome, slabs);

  return {
    slabTax,
    slabBreakdown,
    rebate87A,
    marginalRelief,
    taxAfterRebate,
    surcharge,
    surchargeRate,
    cess,
    totalTax,
    marginalRate,
  };
}

/**
 * Compute flat-rate tax for Firms / Companies (no slabs, no regime choice).
 */
export function computeFlatRateTax(
  taxableIncome: number,
  rate: number,
  surchargeThreshold: number,
  surchargeRate: number,
  cessRate: number,
): TaxOnIncomeResult {
  const baseTax = Math.round(taxableIncome * rate);
  let surcharge = 0;
  let actualSurchargeRate = 0;
  if (taxableIncome > surchargeThreshold) {
    surcharge = Math.round(baseTax * surchargeRate);
    actualSurchargeRate = surchargeRate;
    // Marginal relief for firms: tax+surcharge at income I should not exceed
    // tax at threshold T + (I - T)
    const taxAtThreshold = Math.round(surchargeThreshold * rate);
    const allowed = taxAtThreshold + (taxableIncome - surchargeThreshold);
    if (baseTax + surcharge > allowed) {
      surcharge = Math.max(0, allowed - baseTax);
    }
  }
  const taxPlusSurcharge = baseTax + surcharge;
  const cess = taxPlusSurcharge * cessRate;
  const totalTax = taxPlusSurcharge + cess;

  return {
    slabTax: baseTax,
    slabBreakdown: [{ slab: `Flat ${(rate * 100).toFixed(0)}%`, taxableAmount: taxableIncome, tax: baseTax }],
    rebate87A: 0,
    marginalRelief: 0,
    taxAfterRebate: baseTax,
    surcharge,
    surchargeRate: actualSurchargeRate,
    cess,
    totalTax,
    marginalRate: rate,
  };
}

/**
 * Category-aware tax computation. Routes to the correct calculator based
 * on the taxpayer category.
 */
export function computeTaxForCategory(
  taxableIncome: number,
  regime: TaxRegime,
  ageCategory: AgeCategory,
  category: TaxpayerCategory,
  rules: TaxRules,
): TaxOnIncomeResult {
  switch (category) {
    case 'Firm':
      return computeFlatRateTax(
        taxableIncome,
        rules.firm.rate,
        rules.firm.surchargeThreshold,
        rules.firm.surchargeRate,
        rules.cess,
      );
    case 'Company': {
      // Default to section 115BAA (22% + 10% surcharge) — most common
      return computeFlatRateTax(
        taxableIncome,
        rules.company.section115BAARate,
        0, // surcharge is flat 10% regardless of income under 115BAA
        rules.company.surcharge115BAA,
        rules.cess,
      );
    }
    case 'HUF': {
      // HUF uses same slabs as Individual below-60 but NO rebate u/s 87A
      const slabs = regime === 'new' ? rules.newRegime.slabs : rules.oldRegime.slabs.below60;
      const { total: slabTax, breakdown: slabBreakdown } = computeSlabTax(taxableIncome, slabs);
      // No rebate, no marginal relief for HUF
      const brackets = regime === 'new' ? rules.surcharge.new : rules.surcharge.old;
      const { surcharge, surchargeRate } = computeSurcharge(
        slabTax,
        taxableIncome,
        brackets,
        (inc) => computeSlabTax(inc, slabs).total,
      );
      const taxPlusSurcharge = slabTax + surcharge;
      const cess = taxPlusSurcharge * rules.cess;
      return {
        slabTax,
        slabBreakdown,
        rebate87A: 0,
        marginalRelief: 0,
        taxAfterRebate: slabTax,
        surcharge,
        surchargeRate,
        cess,
        totalTax: taxPlusSurcharge + cess,
        marginalRate: topSlabRateReached(taxableIncome, slabs),
      };
    }
    case 'Individual':
    default:
      return computeTaxOnTaxableIncome(taxableIncome, regime, ageCategory, rules);
  }
}

/**
 * Determine the top slab rate the income actually reaches.
 * Walks the slab table and returns the rate of the band the last rupee lands in.
 */
function topSlabRateReached(taxableIncome: number, slabs: Slab[]): number {
  if (taxableIncome <= 0) return 0;
  let prevLimit = 0;
  let topRate = 0;
  for (const slab of slabs) {
    if (taxableIncome > prevLimit) {
      topRate = slab.rate;
    }
    if (slab.upTo === Infinity) break;
    prevLimit = slab.upTo;
  }
  return topRate;
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
  // Cap at the actual gross so the displayed math never reads negative when
  // the statutory deduction exceeds the user's gross (e.g. ₹45k gross with a
  // ₹75k statutory deduction should show "−45,000", not "−75,000").
  const statutoryStandardDeduction =
    regime === 'new'
      ? rules.newRegime.standardDeduction
      : rules.oldRegime.standardDeduction;
  const standardDeduction = Math.min(statutoryStandardDeduction, Math.max(0, grossIncome));

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

  // ── Post-deduction pipeline (slabs → rebate → surcharge → cess) ─────────
  const postDed = computeTaxOnTaxableIncome(taxableIncome, regime, ageCategory, rules);
  const effectiveRate = grossIncome > 0 ? (postDed.totalTax / grossIncome) * 100 : 0;

  return {
    grossIncome,
    standardDeduction,
    hraExemption,
    totalDeductions,
    taxableIncome,
    slabTax: postDed.slabTax,
    slabBreakdown: postDed.slabBreakdown,
    rebate87A: postDed.rebate87A,
    marginalRelief: postDed.marginalRelief,
    taxAfterRebate: postDed.taxAfterRebate,
    surcharge: postDed.surcharge,
    surchargeRate: postDed.surchargeRate,
    cess: postDed.cess,
    totalTax: postDed.totalTax,
    effectiveRate,
    marginalRate: postDed.marginalRate,
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
