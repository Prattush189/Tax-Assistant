/**
 * ITR wizard UI model.
 *
 * We use the CBDT JSON shape *directly* as our working draft, wrapped in a
 * DeepPartial so we can incrementally fill fields. The finalize step (on the
 * server) validates the materialized object against ajv, so mandatory fields
 * are caught at export time — not at form-input time, where enforcing them
 * would make the wizard unusable.
 */

export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

/* ---------- Minimal typed subset of the CBDT ITR-1 JSON ---------------- */
/* This mirrors server/lib/itr/types/Itr1.ts but only the fields the wizard
   actively writes to. Full schema validation still runs server-side. */

export interface UiCreationInfo {
  SWVersionNo?: string;
  SWCreatedBy?: string;
  JSONCreatedBy?: string;
  JSONCreationDate?: string;
  IntermediaryCity?: string;
  Digest?: string;
}

export interface UiFormITR1 {
  FormName?: string;
  Description?: string;
  AssessmentYear?: string;
  SchemaVer?: string;
  FormVer?: string;
}

export interface UiAssesseeName {
  FirstName?: string;
  MiddleName?: string;
  SurNameOrOrgName?: string;
}

export interface UiAddress {
  ResidenceNo?: string;
  ResidenceName?: string;
  RoadOrStreet?: string;
  LocalityOrArea?: string;
  CityOrTownOrDistrict?: string;
  StateCode?: string;
  CountryCode?: string;
  PinCode?: number;
  CountryCodeMobile?: number;
  MobileNo?: number;
  EmailAddress?: string;
}

export interface UiPersonalInfo {
  AssesseeName?: UiAssesseeName;
  PAN?: string;
  Address?: UiAddress;
  DOB?: string;
  EmployerCategory?: 'CGOV' | 'SGOV' | 'PSU' | 'PE' | 'PESG' | 'PEPS' | 'PEO' | 'OTH' | 'NA';
  AadhaarCardNo?: string;
}

export interface UiFilingStatus {
  ReturnFileSec?: 11 | 12 | 13 | 14 | 16 | 17 | 18 | 20 | 21;
  OptOutNewTaxRegime?: 'Y' | 'N';
  ItrFilingDueDate?: string;
  ReceiptNo?: string;
  OrigRetFiledDate?: string;
}

export interface UiChapVIA {
  Section80C?: number;
  Section80CCC?: number;
  Section80CCDEmployeeOrSE?: number;
  Section80CCD1B?: number;
  Section80CCDEmployer?: number;
  Section80D?: number;
  Section80DD?: number;
  Section80DDB?: number;
  Section80E?: number;
  Section80EE?: number;
  Section80EEA?: number;
  Section80EEB?: number;
  Section80G?: number;
  Section80GG?: number;
  Section80GGA?: number;
  Section80GGC?: number;
  Section80U?: number;
  Section80TTA?: number;
  Section80TTB?: number;
  AnyOthSec80CCH?: number;
  TotalChapVIADeductions?: number;
}

export interface UiIncomeDeductionsITR1 {
  GrossSalary?: number;
  Salary?: number;
  PerquisitesValue?: number;
  ProfitsInSalary?: number;
  IncomeNotified89A?: number;
  NetSalary?: number;
  DeductionUs16?: number;
  DeductionUs16ia?: number;
  ProfessionalTaxUs16iii?: number;
  IncomeFromSal?: number;
  TypeOfHP?: 'S' | 'L' | 'D';
  GrossRentReceived?: number;
  TaxPaidlocalAuth?: number;
  AnnualValue?: number;
  StandardDeduction?: number;
  InterestPayable?: number;
  TotalIncomeOfHP?: number;
  IncomeOthSrc?: number;
  GrossTotIncome?: number;
  GrossTotIncomeIncLTCG112A?: number;
  UsrDeductUndChapVIA?: UiChapVIA;
  DeductUndChapVIA?: UiChapVIA;
  TotalIncome?: number;
}

export interface UiIntrstPay {
  IntrstPayUs234A?: number;
  IntrstPayUs234B?: number;
  IntrstPayUs234C?: number;
  LateFilingFee234F?: number;
}

export interface UiTaxComputation {
  TotalTaxPayable?: number;
  Rebate87A?: number;
  TaxPayableOnRebate?: number;
  EducationCess?: number;
  GrossTaxLiability?: number;
  Section89?: number;
  NetTaxLiability?: number;
  TotalIntrstPay?: number;
  IntrstPay?: UiIntrstPay;
  TotTaxPlusIntrstPay?: number;
}

export interface UiTaxesPaid {
  AdvanceTax?: number;
  TDS?: number;
  TCS?: number;
  SelfAssessmentTax?: number;
  TotalTaxesPaid?: number;
}

export interface UiTaxPaid {
  TaxesPaid?: UiTaxesPaid;
  BalTaxPayable?: number;
}

export interface UiBankDetail {
  IFSCCode?: string;
  BankName?: string;
  BankAccountNo?: string;
  AccountType?: 'SB' | 'CA' | 'CC' | 'OD' | 'NRO' | 'OTH';
  UseForRefund?: 'true' | 'false';
}

export interface UiRefund {
  RefundDue?: number;
  BankAccountDtls?: {
    AddtnlBankDetails?: UiBankDetail[];
  };
}

export interface UiLTCG112A {
  TotSaleCnsdrn?: number;
  TotCstAcqisn?: number;
  LongCap112A?: number;
}

export interface UiVerification {
  Declaration?: {
    AssesseeVerName?: string;
    FatherName?: string;
    AssesseeVerPAN?: string;
  };
  Capacity?: 'S' | 'R';
  Place?: string;
}

export interface UiSalaryEmployer {
  /** UI-only ID for React list stability */
  _uid: string;
  employerName?: string;
  tan?: string;
  employerCategory?: UiPersonalInfo['EmployerCategory'];
  grossSalary?: number;
  tdsOnSalary?: number;
}

/**
 * The outer wizard draft shape. This merges all the slices above plus some
 * UI-only state (employers array, accordion flags) that isn't part of CBDT
 * JSON. The mapper in `toCbdtJson` strips the UI-only bits.
 */
export interface ItrWizardDraft {
  formType: 'ITR1' | 'ITR4';
  assessmentYear: '2025';
  CreationInfo?: UiCreationInfo;
  Form_ITR1?: UiFormITR1;
  PersonalInfo?: UiPersonalInfo;
  FilingStatus?: UiFilingStatus;
  ITR1_IncomeDeductions?: UiIncomeDeductionsITR1;
  /** For ITR-4 the top-level key is `IncomeDeductions`, not `ITR1_IncomeDeductions`. */
  IncomeDeductions?: UiIncomeDeductionsITR1;
  ITR1_TaxComputation?: UiTaxComputation;
  TaxComputation?: UiTaxComputation;
  TaxPaid?: UiTaxPaid;
  Refund?: UiRefund;
  LTCG112A?: UiLTCG112A;
  Verification?: UiVerification;
  /** UI-only: multi-employer list (flattened to the schema totals on export) */
  _salaryEmployers?: UiSalaryEmployer[];
}

export type StepId =
  | 'formPicker'
  | 'personal'
  | 'filing'
  | 'income'
  | 'business'
  | 'deductions'
  | 'taxes'
  | 'bank'
  | 'review';

export function getStepOrder(formType: 'ITR1' | 'ITR4'): StepId[] {
  const base: StepId[] = [
    'formPicker',
    'personal',
    'filing',
    'income',
  ];
  if (formType === 'ITR4') base.push('business');
  base.push('deductions', 'taxes', 'bank', 'review');
  return base;
}

export const STEP_LABELS: Record<StepId, string> = {
  formPicker: 'Form',
  personal: 'Personal Info',
  filing: 'Filing Status',
  income: 'Income',
  business: 'Business Income',
  deductions: 'Deductions',
  taxes: 'Taxes Paid',
  bank: 'Bank & Refund',
  review: 'Review & Export',
};

export function emptyDraft(formType: 'ITR1' | 'ITR4' = 'ITR1'): ItrWizardDraft {
  return {
    formType,
    assessmentYear: '2025',
    Form_ITR1: {
      FormName: formType === 'ITR1' ? 'ITR-1' : 'ITR-4',
      Description:
        formType === 'ITR1'
          ? 'For Indls with Salary, one HP, other sources'
          : 'For Indls/HUF/Firm with presumptive business income',
      AssessmentYear: '2025',
      SchemaVer: 'Ver1.0',
      FormVer: 'Ver1.0',
    },
    FilingStatus: {
      ReturnFileSec: 11,
      OptOutNewTaxRegime: 'N',
      ItrFilingDueDate: '2025-07-31',
    },
    ITR1_IncomeDeductions: {
      GrossSalary: 0,
      Salary: 0,
      IncomeNotified89A: 0,
      NetSalary: 0,
      DeductionUs16: 0,
      DeductionUs16ia: 0,
      IncomeFromSal: 0,
      AnnualValue: 0,
      StandardDeduction: 0,
      TotalIncomeOfHP: 0,
      IncomeOthSrc: 0,
      GrossTotIncome: 0,
      GrossTotIncomeIncLTCG112A: 0,
      UsrDeductUndChapVIA: zeroChapVIA(),
      DeductUndChapVIA: zeroChapVIA(),
      TotalIncome: 0,
    },
    ITR1_TaxComputation: {
      TotalTaxPayable: 0,
      Rebate87A: 0,
      TaxPayableOnRebate: 0,
      EducationCess: 0,
      GrossTaxLiability: 0,
      Section89: 0,
      NetTaxLiability: 0,
      TotalIntrstPay: 0,
      IntrstPay: { IntrstPayUs234A: 0, IntrstPayUs234B: 0, IntrstPayUs234C: 0, LateFilingFee234F: 0 },
      TotTaxPlusIntrstPay: 0,
    },
    TaxPaid: {
      TaxesPaid: { AdvanceTax: 0, TDS: 0, TCS: 0, SelfAssessmentTax: 0, TotalTaxesPaid: 0 },
      BalTaxPayable: 0,
    },
    Refund: {
      RefundDue: 0,
      BankAccountDtls: { AddtnlBankDetails: [] },
    },
    Verification: {
      Declaration: {},
      Capacity: 'S',
    },
    _salaryEmployers: [],
  };
}

export function zeroChapVIA(): UiChapVIA {
  return {
    Section80C: 0,
    Section80CCC: 0,
    Section80CCDEmployeeOrSE: 0,
    Section80CCD1B: 0,
    Section80CCDEmployer: 0,
    Section80D: 0,
    Section80DD: 0,
    Section80DDB: 0,
    Section80E: 0,
    Section80EE: 0,
    Section80EEA: 0,
    Section80EEB: 0,
    Section80G: 0,
    Section80GG: 0,
    Section80GGA: 0,
    Section80GGC: 0,
    Section80U: 0,
    Section80TTA: 0,
    Section80TTB: 0,
    AnyOthSec80CCH: 0,
    TotalChapVIADeductions: 0,
  };
}
