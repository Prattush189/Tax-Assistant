/**
 * One-off verification for the regime-locked Chapter VI-A fix.
 * Run: npx tsx scripts/verify-regime-chapvia.ts
 *
 * Reproduces the bug scenario from the plan:
 *   - Build a draft with gross 15L salary + stale 80C 1.5L
 *   - Run computeDerivedTotals with OptOutNewTaxRegime='N' (NEW regime)
 *     → expect TotalChapVIADeductions = 0 (stale 80C ignored)
 *     → expect TotalIncome = 14,25,000 (stale 80C not subtracted)
 *     → expect GrossTaxLiability = 1,30,000 (AY 2025-26 new regime)
 *     → expect DeductUndChapVIA to contain only the 2 allowed keys
 *   - Re-run with OptOutNewTaxRegime='Y' (OLD regime)
 *     → expect TotalChapVIADeductions = 1,50,000
 *     → expect TotalIncome = 12,75,000
 *     → expect DeductUndChapVIA to contain the 80C value
 */
import { computeDerivedTotals } from '../src/components/itr/lib/toCbdtJson';
import { emptyDraft } from '../src/components/itr/lib/uiModel';
import type { ItrWizardDraft, UiChapVIA } from '../src/components/itr/lib/uiModel';

function buildDraft(regime: 'new' | 'old'): ItrWizardDraft {
  const d = emptyDraft('ITR1');
  d.PersonalInfo = { DOB: '1990-01-01' };
  d.FilingStatus = {
    ...(d.FilingStatus ?? {}),
    OptOutNewTaxRegime: regime === 'new' ? 'N' : 'Y',
  };
  d.ITR1_IncomeDeductions = {
    ...(d.ITR1_IncomeDeductions ?? {}),
    GrossSalary: 1500000,
    Salary: 1500000,
    NetSalary: 1500000,
    DeductionUs16ia: 75000,
    ProfessionalTaxUs16iii: 0,
    UsrDeductUndChapVIA: {
      ...((d.ITR1_IncomeDeductions?.UsrDeductUndChapVIA ?? {}) as UiChapVIA),
      // Stale 80C — entered in old regime, still in draft when user toggles
      // to new regime. Should NOT count in the new-regime total.
      Section80C: 150000,
    },
  };
  return d;
}

interface Check {
  label: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
}

const checks: Check[] = [];
function assertEq(label: string, actual: unknown, expected: unknown): void {
  checks.push({ label, pass: actual === expected, expected, actual });
}

// ── New regime ────────────────────────────────────────────────────────────
{
  const draft = buildDraft('new');
  const out = computeDerivedTotals(draft);
  const inc = out.ITR1_IncomeDeductions!;
  const tax = out.ITR1_TaxComputation!;

  assertEq('[new] TotalIncome', inc.TotalIncome, 1425000);
  assertEq('[new] UsrDeductUndChapVIA.TotalChapVIADeductions', inc.UsrDeductUndChapVIA?.TotalChapVIADeductions, 0);
  assertEq('[new] DeductUndChapVIA.TotalChapVIADeductions', inc.DeductUndChapVIA?.TotalChapVIADeductions, 0);
  assertEq('[new] DeductUndChapVIA.Section80C absent (undefined)', inc.DeductUndChapVIA?.Section80C, undefined);
  assertEq('[new] UsrDeductUndChapVIA.Section80C preserved (1,50,000)', inc.UsrDeductUndChapVIA?.Section80C, 150000);
  assertEq('[new] TotalTaxPayable (slab tax)', tax.TotalTaxPayable, 125000);
  assertEq('[new] EducationCess', tax.EducationCess, 5000);
  assertEq('[new] GrossTaxLiability', tax.GrossTaxLiability, 130000);
  assertEq('[new] NetTaxLiability', tax.NetTaxLiability, 130000);
}

// ── Old regime ────────────────────────────────────────────────────────────
{
  const draft = buildDraft('old');
  const out = computeDerivedTotals(draft);
  const inc = out.ITR1_IncomeDeductions!;
  const tax = out.ITR1_TaxComputation!;

  assertEq('[old] TotalIncome', inc.TotalIncome, 1275000);
  assertEq('[old] UsrDeductUndChapVIA.TotalChapVIADeductions', inc.UsrDeductUndChapVIA?.TotalChapVIADeductions, 150000);
  assertEq('[old] DeductUndChapVIA.TotalChapVIADeductions', inc.DeductUndChapVIA?.TotalChapVIADeductions, 150000);
  assertEq('[old] DeductUndChapVIA.Section80C = 1,50,000', inc.DeductUndChapVIA?.Section80C, 150000);
  // Old regime below 60: 2.5-5L × 5% = 12,500 ; 5-10L × 20% = 1,00,000 ;
  // 10-12.75L × 30% = 82,500 ; total slab = 1,95,000 ; cess 4% = 7,800
  // totalTax = 2,02,800
  assertEq('[old] TotalTaxPayable (slab tax)', tax.TotalTaxPayable, 195000);
  assertEq('[old] EducationCess', tax.EducationCess, 7800);
  assertEq('[old] GrossTaxLiability', tax.GrossTaxLiability, 202800);
}

// ── Report ────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
for (const c of checks) {
  if (c.pass) {
    pass += 1;
    console.log(`PASS  ${c.label}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${c.label}`);
    console.log(`        expected: ${JSON.stringify(c.expected)}`);
    console.log(`        actual:   ${JSON.stringify(c.actual)}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
