/**
 * Converts the wizard draft into the CBDT JSON envelope expected by
 * /api/itr/validate and /api/itr/finalize.
 *
 * Placeholder CreationInfo (with Digest = '-') is inserted here so the
 * schema's `required` CreationInfo block always exists. The server finalize
 * endpoint replaces this with authoritative values and stamps the real
 * Digest.
 */
import type { ItrWizardDraft, UiChapVIA, UiTaxComputation } from './uiModel';
import { sumChapVIAForRegime, filterChapVIAForRegime } from './uiModel';
import { computeTaxOnTaxableIncome } from '../../../lib/taxEngine';
import { getTaxRules } from '../../../data/taxRules';
import type { AgeCategory, TaxRegime } from '../../../types';

/**
 * Map wizard `assessmentYear` (e.g. '2025') to the corresponding FY key used
 * by the tax rules data module. AY is the year FOLLOWING the income year — AY
 * 2025-26 assessments taxes FY 2024-25 income.
 */
function fyForAssessmentYear(ay: string): string {
  if (ay === '2025') return '2024-25';
  if (ay === '2026') return '2025-26';
  if (ay === '2027') return '2026-27';
  return '2024-25';
}

/**
 * Derive age category from DOB as of the last day of the FY being filed
 * (= 31 March of the AY start year). Defaults to 'below60' when DOB is
 * missing or unparseable.
 */
function deriveAgeCategory(dobIso: string | undefined, ay: string): AgeCategory {
  if (!dobIso) return 'below60';
  const dob = new Date(dobIso);
  if (Number.isNaN(dob.getTime())) return 'below60';
  const ayEnd = new Date(`${ay}-03-31`);
  let age = ayEnd.getFullYear() - dob.getFullYear();
  const m = ayEnd.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && ayEnd.getDate() < dob.getDate())) age -= 1;
  if (age >= 80) return 'superSenior80plus';
  if (age >= 60) return 'senior60to80';
  return 'below60';
}

function buildPlaceholderCreationInfo() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return {
    SWVersionNo: '1.0',
    SWCreatedBy: 'SW20000015',
    JSONCreatedBy: 'SW20000015',
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
  const entAlw = inc.EntertainmentAlw16ii ?? 0;
  inc.DeductionUs16 = sd + ptax + entAlw;
  inc.IncomeFromSal = Math.max(0, inc.NetSalary - inc.DeductionUs16);

  // House property: Let-out needs 30% SD; Self-occupied allows interest u/s 24(b)
  const hpAnnual = inc.AnnualValue ?? 0;
  const hpInterest = inc.InterestPayable ?? 0;
  const hpStdDed = inc.TypeOfHP === 'L' || inc.TypeOfHP === 'D' ? Math.round(hpAnnual * 0.3) : 0;
  inc.StandardDeduction = hpStdDed;
  inc.TotalIncomeOfHP = hpAnnual - hpStdDed - hpInterest + (inc.ArrearsUnrealizedRentRcvd ?? 0);

  // Other sources — subtract family pension std deduction u/s 57(iia)
  const othSrc = (inc.IncomeOthSrc ?? 0) - (inc.DeductionUs57iia ?? 0);
  inc.GrossTotIncome = inc.IncomeFromSal + inc.TotalIncomeOfHP + othSrc;
  inc.GrossTotIncomeIncLTCG112A =
    inc.GrossTotIncome + (d.LTCG112A?.LongCap112A ?? 0);

  // ── Regime derivation ───────────────────────────────────────────────────
  // OptOutNewTaxRegime: 'Y' = opted out (= old regime), 'N' = default (= new).
  const regime: TaxRegime = d.FilingStatus?.OptOutNewTaxRegime === 'Y' ? 'old' : 'new';

  // ── Chapter VI-A totals (regime-aware) ─────────────────────────────────
  // In new regime, only 80CCD(2) and 80CCH are deductible from taxable
  // income. Any other Chapter VI-A values entered in the draft (stale from
  // a previous old-regime session, or entered while the UI was gated) are
  // ignored for the tax calc and stripped from the DeductUndChapVIA block
  // written to the CBDT envelope. The raw UsrDeductUndChapVIA is preserved
  // so toggling back to old regime restores the user's values.
  const userChapVia = inc.UsrDeductUndChapVIA ?? {};
  const claimedTotal = sumChapVIAForRegime(userChapVia, regime);
  inc.UsrDeductUndChapVIA = { ...userChapVia, TotalChapVIADeductions: claimedTotal };
  const allowedChapVia = filterChapVIAForRegime(userChapVia, regime);
  inc.DeductUndChapVIA = { ...allowedChapVia, TotalChapVIADeductions: claimedTotal };

  // ITR-1 cap: TotalIncome ≤ ₹51,25,000 (schema maximum field constraint)
  const rawTotalIncome = Math.max(0, inc.GrossTotIncome - claimedTotal);
  inc.TotalIncome = Math.min(rawTotalIncome, 5125000);

  // ── Auto-build TDSonSalaries from employers ────────────────────────────
  const employers = d._salaryEmployers ?? [];
  if (employers.length > 0) {
    const tdsOnSalary = employers
      .filter(e => (e.grossSalary ?? 0) > 0 || (e.tdsOnSalary ?? 0) > 0)
      .map(e => ({
        EmployerOrDeductorOrCollectTAN: e.tan,
        EmployerOrDeductorOrCollectName: e.employerName,
        IncChrgSal: e.grossSalary ?? 0,
        TotalTDSSal: e.tdsOnSalary ?? 0,
      }));
    if (tdsOnSalary.length > 0) {
      (d as unknown as Record<string, unknown>).TDSonSalaries = { TDSonSalary: tdsOnSalary };
    }
  }

  // ── Auto-aggregate TDS/TCS/TaxPayments into TaxPaid.TaxesPaid ──────
  {
    const tdsSalaryTotal = (d.TDSonSalaries?.TDSonSalary ?? [])
      .reduce((acc: number, e: { TotalTDSSal?: number }) => acc + (e.TotalTDSSal ?? 0), 0);
    const tdsOtherTotal = (d.TDSonOthThanSals?.TDSonOthThanSal ?? [])
      .reduce((acc: number, e: { TotalTDSonOthThanSals?: number }) => acc + (e.TotalTDSonOthThanSals ?? 0), 0);
    const tcsTotal = (d.ScheduleTCS?.TCS ?? [])
      .reduce((acc: number, e: { TotalTCS?: number }) => acc + (e.TotalTCS ?? 0), 0);
    const taxPmtTotal = (d.TaxPayments?.TaxPayment ?? [])
      .reduce((acc: number, e: { Amt?: number }) => acc + (e.Amt ?? 0), 0);

    const tp = d.TaxPaid ?? {};
    const existingTp = tp.TaxesPaid ?? {};
    // Only override aggregates if itemized entries exist; otherwise keep user-entered values
    const hasTdsItems = (d.TDSonSalaries?.TDSonSalary?.length ?? 0) > 0 || (d.TDSonOthThanSals?.TDSonOthThanSal?.length ?? 0) > 0;
    const hasTcsItems = (d.ScheduleTCS?.TCS?.length ?? 0) > 0;
    const hasTaxPmtItems = (d.TaxPayments?.TaxPayment?.length ?? 0) > 0;
    const tds = hasTdsItems ? tdsSalaryTotal + tdsOtherTotal : (existingTp.TDS ?? 0);
    const tcsVal = hasTcsItems ? tcsTotal : (existingTp.TCS ?? 0);
    const advTax = hasTaxPmtItems ? taxPmtTotal : (existingTp.AdvanceTax ?? 0);
    const selfAssess = existingTp.SelfAssessmentTax ?? 0;
    d.TaxPaid = {
      ...tp,
      TaxesPaid: {
        ...existingTp,
        TDS: tds,
        TCS: tcsVal,
        AdvanceTax: advTax,
        SelfAssessmentTax: selfAssess,
        TotalTaxesPaid: tds + tcsVal + advTax + selfAssess,
      },
    };
  }

  // ── Tax computation ────────────────────────────────────────────────────
  const ageCategory = deriveAgeCategory(d.PersonalInfo?.DOB, d.assessmentYear);
  const fy = fyForAssessmentYear(d.assessmentYear);
  const rules = getTaxRules(fy);
  const taxRes = computeTaxOnTaxableIncome(inc.TotalIncome ?? 0, regime, ageCategory, rules);

  const priorTax = d.ITR1_TaxComputation ?? {};
  const priorIntrst = priorTax.IntrstPay ?? {};
  const section89 = priorTax.Section89 ?? 0;

  const totalIntrst =
    (priorIntrst.IntrstPayUs234A ?? 0) +
    (priorIntrst.IntrstPayUs234B ?? 0) +
    (priorIntrst.IntrstPayUs234C ?? 0) +
    (priorIntrst.LateFilingFee234F ?? 0);

  const grossTaxLiability = Math.round(taxRes.totalTax);
  const netTax = Math.max(0, grossTaxLiability - section89);
  const totTaxPlusIntrst = netTax + totalIntrst;

  const nextTax: UiTaxComputation = {
    TotalTaxPayable: Math.round(taxRes.slabTax),
    Rebate87A: Math.round(taxRes.rebate87A),
    TaxPayableOnRebate: Math.round(taxRes.taxAfterRebate),
    EducationCess: Math.round(taxRes.cess),
    GrossTaxLiability: grossTaxLiability,
    Section89: section89,
    NetTaxLiability: netTax,
    TotalIntrstPay: totalIntrst,
    IntrstPay: { ...priorIntrst },
    TotTaxPlusIntrstPay: totTaxPlusIntrst,
  };

  // Bal payable / refund due
  const totalPaid = d.TaxPaid?.TaxesPaid?.TotalTaxesPaid ?? 0;
  const bal = totTaxPlusIntrst - totalPaid;
  const nextTaxPaid = {
    ...(d.TaxPaid ?? {}),
    BalTaxPayable: Math.max(0, bal),
  };
  const nextRefund = {
    ...(d.Refund ?? {}),
    RefundDue: Math.max(0, -bal),
  };

  return {
    ...d,
    ITR1_IncomeDeductions: inc,
    ITR1_TaxComputation: nextTax,
    TaxPaid: nextTaxPaid,
    Refund: nextRefund,
  };
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
    // TDS / TCS / TaxPayments schedules — include if populated
    if (d.TDSonSalaries?.TDSonSalary?.length) inner.TDSonSalaries = d.TDSonSalaries;
    if (d.TDSonOthThanSals?.TDSonOthThanSal?.length) inner.TDSonOthThanSals = d.TDSonOthThanSals;
    if (d.ScheduleTCS?.TCS?.length) inner.ScheduleTCS = d.ScheduleTCS;
    if (d.TaxPayments?.TaxPayment?.length) inner.TaxPayments = d.TaxPayments;
    if (d.TaxReturnPreparer) inner.TaxReturnPreparer = d.TaxReturnPreparer;

    // Detailed schedules — include if populated
    if (d.Schedule80G) inner.Schedule80G = d.Schedule80G;
    if (d.Schedule80GGA?.DonationDtlsSciRsrchRuralDev?.length) inner.Schedule80GGA = d.Schedule80GGA;
    if (d.Schedule80GGC?.Schedule80GGCDetails?.length) inner.Schedule80GGC = d.Schedule80GGC;
    if (d.Schedule80D) inner.Schedule80D = { Sec80DSelfFamSrCtznHealth: d.Schedule80D };
    if (d.Schedule80DD?.DeductionAmount) inner.Schedule80DD = d.Schedule80DD;
    if (d.Schedule80U?.DeductionAmount) inner.Schedule80U = d.Schedule80U;
    if (d.Schedule80E?.Schedule80EDtls?.length) inner.Schedule80E = d.Schedule80E;
    if (d.Schedule80EE?.Schedule80EEDtls?.length) inner.Schedule80EE = d.Schedule80EE;
    if (d.Schedule80EEA?.Schedule80EEADtls?.length) inner.Schedule80EEA = d.Schedule80EEA;
    if (d.Schedule80EEB?.Schedule80EEBDtls?.length) inner.Schedule80EEB = d.Schedule80EEB;
    if (d.Schedule80C?.Schedule80CDtls?.length) inner.Schedule80C = d.Schedule80C;
    if (d.ScheduleUs24B?.ScheduleUs24BDtls?.length) inner.ScheduleUs24B = d.ScheduleUs24B;
    if (d.ScheduleEA10_13A) inner.ScheduleEA10_13A = d.ScheduleEA10_13A;

    // Include exempt allowances and other source breakup inside IncomeDeductions
    const incBlock = inner.ITR1_IncomeDeductions as Record<string, unknown>;
    if (d.AllwncExemptUs10?.AllwncExemptUs10Dtls?.length) {
      incBlock.AllwncExemptUs10 = d.AllwncExemptUs10;
    }
    if (d.OthersInc?.OthersIncDtlsOthSrc?.length) {
      incBlock.OthersInc = d.OthersInc;
    }
    if (d.ExemptIncAgriOthUs10?.ExemptIncAgriOthUs10Dtls?.length) {
      incBlock.ExemptIncAgriOthUs10 = { ExemptIncAgriOthUs10Dtls: d.ExemptIncAgriOthUs10.ExemptIncAgriOthUs10Dtls };
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
