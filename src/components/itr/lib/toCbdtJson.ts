/**
 * Converts the wizard draft into the CBDT JSON envelope expected by
 * /api/itr/validate and /api/itr/finalize.
 *
 * Placeholder CreationInfo (with Digest = '-') is inserted here so the
 * schema's `required` CreationInfo block always exists. The server finalize
 * endpoint replaces this with authoritative values and stamps the real
 * Digest.
 */
import type { ItrWizardDraft, UiChapVIA } from './uiModel';

function buildPlaceholderCreationInfo() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return {
    SWVersionNo: '1.0',
    SWCreatedBy: 'SW00000000',
    JSONCreatedBy: 'SW00000000',
    JSONCreationDate: `${yyyy}-${mm}-${dd}`,
    IntermediaryCity: 'Delhi',
    Digest: '-',
  };
}

function pickChapVIA(x?: UiChapVIA): UiChapVIA | undefined {
  if (!x) return undefined;
  return { ...x };
}

/**
 * Sums the salary across UI-only `_salaryEmployers` and writes the total
 * into the GrossSalary + TDS fields. Returns a shallow copy of the draft
 * with those fields updated.
 */
export function aggregateSalaries(draft: ItrWizardDraft): ItrWizardDraft {
  const employers = draft._salaryEmployers ?? [];
  if (employers.length === 0) return draft;
  const grossTotal = employers.reduce((acc, e) => acc + (Number(e.grossSalary) || 0), 0);
  const tdsTotal = employers.reduce((acc, e) => acc + (Number(e.tdsOnSalary) || 0), 0);
  const inc = { ...(draft.ITR1_IncomeDeductions ?? {}) };
  inc.GrossSalary = grossTotal;
  inc.Salary = grossTotal;
  const tax = { ...(draft.TaxPaid ?? {}) };
  const taxesPaid = { ...(tax.TaxesPaid ?? {}) };
  taxesPaid.TDS = tdsTotal;
  taxesPaid.TotalTaxesPaid =
    (taxesPaid.AdvanceTax ?? 0) +
    tdsTotal +
    (taxesPaid.TCS ?? 0) +
    (taxesPaid.SelfAssessmentTax ?? 0);
  tax.TaxesPaid = taxesPaid;
  return { ...draft, ITR1_IncomeDeductions: inc, TaxPaid: tax };
}

/**
 * Runs the derived-field calculations so the exported JSON has consistent
 * totals (NetSalary, IncomeFromSal, GrossTotIncome, TotalIncome, Chapter VI-A
 * totals, etc). Kept simple on purpose — the user sees these values on the
 * Review step and can cross-check before export.
 */
export function computeDerivedTotals(draft: ItrWizardDraft): ItrWizardDraft {
  const d = aggregateSalaries(draft);
  const inc = { ...(d.ITR1_IncomeDeductions ?? {}) };
  const gross = inc.GrossSalary ?? 0;
  const perqs = inc.PerquisitesValue ?? 0;
  const profits = inc.ProfitsInSalary ?? 0;
  inc.NetSalary = gross + perqs + profits;

  const sd = inc.DeductionUs16ia ?? 0;
  const ptax = inc.ProfessionalTaxUs16iii ?? 0;
  inc.DeductionUs16 = sd + ptax;
  inc.IncomeFromSal = Math.max(0, inc.NetSalary - inc.DeductionUs16);

  // House property: Let-out needs 30% SD; Self-occupied allows interest u/s 24(b)
  const hpAnnual = inc.AnnualValue ?? 0;
  const hpInterest = inc.InterestPayable ?? 0;
  const hpStdDed = inc.TypeOfHP === 'L' || inc.TypeOfHP === 'D' ? Math.round(hpAnnual * 0.3) : 0;
  inc.StandardDeduction = hpStdDed;
  inc.TotalIncomeOfHP = hpAnnual - hpStdDed - hpInterest;

  const othSrc = inc.IncomeOthSrc ?? 0;
  inc.GrossTotIncome = inc.IncomeFromSal + inc.TotalIncomeOfHP + othSrc;
  inc.GrossTotIncomeIncLTCG112A =
    inc.GrossTotIncome + (d.LTCG112A?.LongCap112A ?? 0);

  // Chapter VI-A totals
  const userChapVia = inc.UsrDeductUndChapVIA ?? {};
  const claimedTotal = sumChapVIA(userChapVia);
  inc.UsrDeductUndChapVIA = { ...userChapVia, TotalChapVIADeductions: claimedTotal };
  inc.DeductUndChapVIA = { ...(inc.DeductUndChapVIA ?? {}), ...userChapVia, TotalChapVIADeductions: claimedTotal };

  inc.TotalIncome = Math.max(0, inc.GrossTotIncome - claimedTotal);

  const out = { ...d, ITR1_IncomeDeductions: inc };
  return out;
}

function sumChapVIA(c: UiChapVIA): number {
  const keys: Array<keyof UiChapVIA> = [
    'Section80C',
    'Section80CCC',
    'Section80CCDEmployeeOrSE',
    'Section80CCD1B',
    'Section80CCDEmployer',
    'Section80D',
    'Section80DD',
    'Section80DDB',
    'Section80E',
    'Section80EE',
    'Section80EEA',
    'Section80EEB',
    'Section80G',
    'Section80GG',
    'Section80GGA',
    'Section80GGC',
    'Section80U',
    'Section80TTA',
    'Section80TTB',
    'AnyOthSec80CCH',
  ];
  return keys.reduce((acc, k) => acc + (Number(c[k]) || 0), 0);
}

/**
 * Shapes the wizard draft into the CBDT envelope `{ ITR: { ITR1: {...} } }`.
 * Drops UI-only keys (`_salaryEmployers`) and includes a placeholder
 * CreationInfo; the server finalize endpoint fills these for real.
 */
export function toCbdtJson(draft: ItrWizardDraft): Record<string, unknown> {
  const d = computeDerivedTotals(draft);
  const ci = d.CreationInfo ?? buildPlaceholderCreationInfo();

  if (d.formType === 'ITR1') {
    const inner: Record<string, unknown> = {
      CreationInfo: ci,
      Form_ITR1: d.Form_ITR1,
      PersonalInfo: d.PersonalInfo,
      FilingStatus: d.FilingStatus,
      ITR1_IncomeDeductions: {
        ...(d.ITR1_IncomeDeductions ?? {}),
        UsrDeductUndChapVIA: pickChapVIA(d.ITR1_IncomeDeductions?.UsrDeductUndChapVIA),
        DeductUndChapVIA: pickChapVIA(d.ITR1_IncomeDeductions?.DeductUndChapVIA),
      },
      ITR1_TaxComputation: d.ITR1_TaxComputation,
      TaxPaid: d.TaxPaid,
      Refund: d.Refund,
      Verification: d.Verification,
    };
    if (d.LTCG112A && (d.LTCG112A.LongCap112A ?? 0) > 0) {
      inner.LTCG112A = d.LTCG112A;
    }
    return { ITR: { ITR1: inner } };
  }

  // ITR-4 envelope (Phase C scaffold)
  const inner: Record<string, unknown> = {
    CreationInfo: ci,
    Form_ITR1: d.Form_ITR1, // Note: the schema key is Form_ITR4 in reality — client just stores labels
    PersonalInfo: d.PersonalInfo,
    FilingStatus: d.FilingStatus,
    IncomeDeductions: d.IncomeDeductions ?? d.ITR1_IncomeDeductions,
    TaxComputation: d.TaxComputation ?? d.ITR1_TaxComputation,
    TaxPaid: d.TaxPaid,
    Refund: d.Refund,
    Verification: d.Verification,
  };
  return { ITR: { ITR4: inner } };
}
