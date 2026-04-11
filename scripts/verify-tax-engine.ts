/**
 * One-off verification script for the tax engine changes.
 * Run: npx tsx scripts/verify-tax-engine.ts
 */
import { calculateIncomeTax, computeTaxOnTaxableIncome } from '../src/lib/taxEngine';
import { FY_2025_26 } from '../src/data/taxRules/fy2025-26';
import { FY_2024_25 } from '../src/data/taxRules/fy2024-25';

interface Case {
  name: string;
  gross: number;
  regime: 'new' | 'old';
  expectStdDeduction?: number;
  expectTotalTaxApprox?: number;
  expectSurcharge?: number;     // tolerance ±2
  expectSurchargeRate?: number;
  expectMarginalRate?: number;
  expectTaxable?: number;
}

const cases: Case[] = [
  {
    name: 'Gross 45,000 (below std deduction cap)',
    gross: 45000,
    regime: 'new',
    expectStdDeduction: 45000,
    expectTaxable: 0,
    expectTotalTaxApprox: 0,
    expectMarginalRate: 0,
  },
  {
    name: 'Gross 15,00,000 new regime (reference case)',
    gross: 1500000,
    regime: 'new',
    expectStdDeduction: 75000,
    expectTaxable: 1425000,
    expectTotalTaxApprox: 97500,
    expectSurcharge: 0,
    expectMarginalRate: 0.15,
  },
  {
    name: 'Gross 55,00,000 new regime (surcharge 10%)',
    gross: 5500000,
    regime: 'new',
    expectSurchargeRate: 0.10,
    expectMarginalRate: 0.30,
  },
  {
    name: 'Gross 50,85,000 new regime (marginal relief boundary)',
    gross: 5085000,
    regime: 'new',
    // taxable = 50,10,000 → slab tax 10,83,000 → surcharge before relief = 1,08,300
    // allowed = slab(50L) + (10k) = 10,80,000 + 10,000 = 10,90,000
    // taxAfterRebate=10,83,000 → surcharge = 10,90,000 - 10,83,000 = 7,000
    expectSurcharge: 7000,
    expectSurchargeRate: 0.10,
    expectMarginalRate: 0.30,
  },
  {
    name: 'Gross 5,50,00,000 old regime (37% surcharge)',
    gross: 55000000,
    regime: 'old',
    expectSurchargeRate: 0.37,
    expectMarginalRate: 0.30,
  },
  {
    name: 'Gross 5,50,00,000 new regime (25% surcharge cap)',
    gross: 55000000,
    regime: 'new',
    expectSurchargeRate: 0.25,
    expectMarginalRate: 0.30,
  },
];

let pass = 0;
let fail = 0;

for (const c of cases) {
  const result = calculateIncomeTax(
    { grossSalary: c.gross, otherIncome: 0, fy: '2025-26', regime: c.regime, ageCategory: 'below60' },
    FY_2025_26,
  );

  const errors: string[] = [];
  const check = (label: string, actual: number, expected: number | undefined, tol = 2) => {
    if (expected === undefined) return;
    if (Math.abs(actual - expected) > tol) {
      errors.push(`  ${label}: expected ≈${expected}, got ${actual}`);
    }
  };
  check('stdDeduction', result.standardDeduction, c.expectStdDeduction, 0);
  check('taxable', result.taxableIncome, c.expectTaxable, 0);
  check('totalTax', result.totalTax, c.expectTotalTaxApprox, 50);
  check('surcharge', result.surcharge, c.expectSurcharge, 2);
  if (c.expectSurchargeRate !== undefined) {
    if (Math.abs(result.surchargeRate - c.expectSurchargeRate) > 0.001) {
      errors.push(`  surchargeRate: expected ${c.expectSurchargeRate}, got ${result.surchargeRate}`);
    }
  }
  if (c.expectMarginalRate !== undefined) {
    if (Math.abs(result.marginalRate - c.expectMarginalRate) > 0.001) {
      errors.push(`  marginalRate: expected ${c.expectMarginalRate}, got ${result.marginalRate}`);
    }
  }

  const ok = errors.length === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  console.log(
    `      taxable=${result.taxableIncome}  slabTax=${result.slabTax}  ` +
    `surcharge=${result.surcharge} (${(result.surchargeRate * 100).toFixed(0)}%)  ` +
    `cess=${result.cess.toFixed(0)}  total=${result.totalTax.toFixed(0)}  ` +
    `marginalRate=${(result.marginalRate * 100).toFixed(0)}%  ` +
    `effective=${result.effectiveRate.toFixed(2)}%  ` +
    `stdDed=${result.standardDeduction}`,
  );
  if (!ok) {
    for (const e of errors) console.log(e);
    fail++;
  } else {
    pass++;
  }
}

// ── ITR wizard post-deduction helper (computeTaxOnTaxableIncome) ──────────
interface ItrCase {
  name: string;
  taxable: number;
  regime: 'new' | 'old';
  rules: typeof FY_2024_25;
  expectTotalTax: number;
  expectRebate?: number;
  expectSlabTax?: number;
  expectCess?: number;
}

const itrCases: ItrCase[] = [
  {
    // Taxable 7L under AY 2025-26 (FY 2024-25) new regime: full rebate u/s 87A
    // (threshold ₹7L, max rebate ₹25k). Slabs 0-3L@0, 3-7L@5% → slab tax 20k,
    // rebate 20k, total 0.
    name: 'ITR-1 new regime, taxable 7,00,000, AY 2025-26 rules',
    taxable: 700000,
    regime: 'new',
    rules: FY_2024_25,
    expectTotalTax: 0,
    expectSlabTax: 20000,
    expectRebate: 20000,
    expectCess: 0,
  },
  {
    // Old regime below 60, taxable 10L: 2.5-5L @ 5% = 12,500; 5-10L @ 20% = 1,00,000
    // slab tax = 1,12,500; no rebate (> 5L threshold); cess 4% = 4,500; total = 1,17,000
    name: 'ITR-1 old regime, taxable 10,00,000, AY 2025-26 rules',
    taxable: 1000000,
    regime: 'old',
    rules: FY_2024_25,
    expectTotalTax: 117000,
    expectSlabTax: 112500,
    expectRebate: 0,
    expectCess: 4500,
  },
];

for (const c of itrCases) {
  const r = computeTaxOnTaxableIncome(c.taxable, c.regime, 'below60', c.rules);
  const errors: string[] = [];
  const check = (label: string, actual: number, expected: number | undefined, tol = 2) => {
    if (expected === undefined) return;
    if (Math.abs(actual - expected) > tol) {
      errors.push(`  ${label}: expected ${expected}, got ${actual}`);
    }
  };
  check('totalTax', r.totalTax, c.expectTotalTax, 2);
  check('slabTax', r.slabTax, c.expectSlabTax, 2);
  check('rebate87A', r.rebate87A, c.expectRebate, 2);
  check('cess', r.cess, c.expectCess, 2);

  const ok = errors.length === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  console.log(
    `      slabTax=${r.slabTax}  rebate=${r.rebate87A}  cess=${r.cess.toFixed(0)}  ` +
    `total=${r.totalTax.toFixed(0)}  marginal=${(r.marginalRate * 100).toFixed(0)}%`,
  );
  if (!ok) {
    for (const e of errors) console.log(e);
    fail++;
  } else {
    pass++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
