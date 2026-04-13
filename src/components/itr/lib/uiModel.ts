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
  NoticeNo?: string;
  NoticeDateUnderSec?: string;
  // 7th proviso to section 139(1)
  SeventhProvisio139?: 'Y' | 'N';
  IncrExpAggAmt2LkTrvFrgnCntryFlg?: 'Y' | 'N';
  AmtSeventhProvisio139ii?: number;
  IncrExpAggAmt1LkElctrctyPrYrFlg?: 'Y' | 'N';
  AmtSeventhProvisio139iii?: number;
  clauseiv7provisio139i?: 'Y' | 'N';
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
  IncomeNotifiedOther89A?: number;
  NetSalary?: number;
  DeductionUs16?: number;
  DeductionUs16ia?: number;
  EntertainmentAlw16ii?: number;
  ProfessionalTaxUs16iii?: number;
  IncomeFromSal?: number;
  TypeOfHP?: 'S' | 'L' | 'D';
  GrossRentReceived?: number;
  TaxPaidlocalAuth?: number;
  AnnualValue?: number;
  StandardDeduction?: number;
  InterestPayable?: number;
  ArrearsUnrealizedRentRcvd?: number;
  TotalIncomeOfHP?: number;
  IncomeOthSrc?: number;
  DeductionUs57iia?: number;   // family pension std deduction (max ₹25k)
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

// ── Exempt allowances u/s 10 ────────────────────────────────────────────

export interface UiAllwncExemptUs10Entry {
  SalNatureDesc?: string;      // '10(5)','10(10)','10(10A)','10(10AA)','10(13A)', etc.
  SalOthNatureDesc?: string;   // free text if nature is 'EIC'
  SalOthAmount?: number;
}

export const EXEMPT_ALLOWANCE_NATURES: ReadonlyArray<{ code: string; label: string }> = [
  { code: '10(5)', label: 'Leave travel concession (LTA)' },
  { code: '10(10)', label: 'Gratuity' },
  { code: '10(10A)', label: 'Commuted pension' },
  { code: '10(10AA)', label: 'Leave encashment on retirement' },
  { code: '10(10B)(i)', label: 'Compensation — CG notified limit' },
  { code: '10(10B)(ii)', label: 'Compensation — scheme' },
  { code: '10(10C)', label: 'VRS compensation' },
  { code: '10(10CC)', label: 'Tax-free perquisites' },
  { code: '10(13A)', label: 'HRA' },
  { code: '10(14)(i)', label: 'Prescribed allowances (special)' },
  { code: '10(14)(ii)', label: 'Transport / conveyance' },
  { code: 'EIC', label: 'Other exempt income' },
];

// ── Other source income breakup ─────────────────────────────────────────

export interface UiOtherSourceEntry {
  OthSrcNatureDesc?: string;    // 'SAV','IFD','TAX','FAP','DIV','OTH' etc.
  OthSrcOthNatureDesc?: string; // free text if 'OTH'
  OthSrcOthAmount?: number;
}

export const OTHER_SOURCE_NATURES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'SAV', label: 'Savings bank interest' },
  { code: 'IFD', label: 'FD / deposit interest' },
  { code: 'TAX', label: 'Interest from IT refund' },
  { code: 'FAP', label: 'Family pension' },
  { code: 'DIV', label: 'Dividend income' },
  { code: 'OTH', label: 'Other' },
];

// ── Schedule EA 10(13A) — HRA exemption calc ────────────────────────────

export interface UiScheduleEA1013A {
  Placeofwork?: '1' | '2';     // 1=metro, 2=other
  ActlHRARecv?: number;
  ActlRentPaid?: number;
  BasicSalary?: number;
  DearnessAllwnc?: number;
  DtlsSalUsSec171?: number;    // salary u/s 17(1)
}

// ── Schedule 80D — Health insurance ─────────────────────────────────────

export interface UiSchedule80D {
  SeniorCitizenFlag?: 'Y' | 'N' | 'S';
  SelfAndFamily?: number;
  HealthInsPremSlfFam?: number;
  PrevHlthChckUpSlfFam?: number;
  ParentsSeniorCitizenFlag?: 'Y' | 'N' | 'P';
  Parents?: number;
  HlthInsPremParents?: number;
  PrevHlthChckUpParents?: number;
}

// ── Schedule 80G — Donations ────────────────────────────────────────────

export interface UiDonationEntry {
  DoneeWithPanName?: string;
  DoneePAN?: string;
  ArnNbr?: string;
  DonationAmtCash?: number;
  DonationAmtOtherMode?: number;
}

export interface UiSchedule80G {
  Don100Percent?: UiDonationEntry[];
  Don50PercentNoApprReqd?: UiDonationEntry[];
  Don100PercentApprReqd?: UiDonationEntry[];
  Don50PercentApprReqd?: UiDonationEntry[];
}

// ── Schedule 80C — Investments ──────────────────────────────────────────

export interface UiSchedule80CEntry {
  IdentificationNo?: string;   // policy / account number
  Amount?: number;
}

// ── Schedule Us24B — Housing loan ───────────────────────────────────────

export interface UiLoanEntry24B {
  LoanTknFrom?: 'B' | 'I';    // B=Bank, I=Other
  BankOrInstnName?: string;
  LoanAccNoOfBankOrInstnRefNo?: string;
  DateofLoan?: string;
  TotalLoanAmt?: number;
  LoanOutstndngAmt?: number;
  InterestPayable?: number;
}

// ── Schedule 80DD / 80U — Disability ────────────────────────────────────

export interface UiSchedule80DD {
  NatureOfDisability?: '1' | '2';     // 1=40-80%, 2=>80%
  TypeOfDisability?: '1' | '2';       // 1=disability, 2=severe
  DependentType?: '1' | '2' | '3' | '4' | '5' | '6' | '7';
  DependentPan?: string;
  DependentAadhaar?: string;
  Form10IAAckNum?: string;
  UDIDNum?: string;
  DeductionAmount?: number;
}

export interface UiSchedule80U {
  NatureOfDisability?: '1' | '2';
  TypeOfDisability?: '1' | '2';
  Form10IAAckNum?: string;
  UDIDNum?: string;
  DeductionAmount?: number;
}

// ── Schedule 80E/80EE/80EEA/80EEB — Loan details ───────────────────────

export interface UiLoanEntryGeneric {
  LoanTknFrom?: 'B' | 'I';
  BankOrInstnName?: string;
  LoanAccNo?: string;
  DateofLoan?: string;
  TotalLoanAmt?: number;
  LoanOutstndngAmt?: number;
  InterestAmt?: number;
}

// ── Schedule 80GGA / 80GGC — Donation details ───────────────────────────

export interface UiDonationDetailEntry {
  DoneeName?: string;
  DoneePAN?: string;
  DonationAmtCash?: number;
  DonationAmtOtherMode?: number;
  EligibleDonationAmt?: number;
}

// ── Exempt income reporting ─────────────────────────────────────────────

export interface UiExemptIncomeEntry {
  NatureDesc?: string;          // 'AGRI', '10(10BC)', '10(10D)', '10(11)', '10(12)', etc.
  OthNatOfInc?: string;
  OthAmount?: number;
}

export const EXEMPT_INCOME_NATURES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'AGRI', label: 'Agricultural income' },
  { code: '10(10D)', label: 'Insurance maturity (10(10D))' },
  { code: '10(11)', label: 'Statutory provident fund (10(11))' },
  { code: '10(12)', label: 'Recognized provident fund (10(12))' },
  { code: '10(12C)', label: 'NPS trust (10(12C))' },
  { code: '10(10BC)', label: 'Compensation to athletes (10(10BC))' },
  { code: 'OTH', label: 'Other exempt income' },
];

// ── ITR-4 Business Income (ScheduleBP) ──────────────────────────────────

export interface UiGoodsDtlsUs44AE {
  RegNumberGoodsCarriage?: string;
  OwnedLeasedHiredFlag?: 'OWN' | 'LEASE' | 'HIRED';
  TonnageCapacity?: number;       // 1-100
  HoldingPeriod?: number;         // months 1-12
  PresumptiveIncome?: number;
}

export interface UiTurnoverGSTIN {
  GSTIN?: string;                  // 15 chars
  GrossTurnover?: number;
  GrossReceipt?: number;
}

export interface UiFinanclPartclrOfBusiness {
  // Liabilities
  PartnerMemberOwnCapital?: number;
  SecuredLoans?: number;
  UnSecuredLoans?: number;
  Advances?: number;
  SundryCreditors?: number;
  OthrCurrLiab?: number;
  TotCapLiabilities?: number;     // auto-sum
  // Assets
  FixedAssets?: number;
  Inventories?: number;
  SundryDebtors?: number;
  BalWithBanks?: number;
  CashInHand?: number;
  LoansAndAdvances?: number;
  OtherAssets?: number;
  TotalAssets?: number;           // auto-sum
}

export interface UiBusinessIncome {
  scheme: '44AD' | '44ADA' | '44AE' | 'NONE';
  natureCode?: string;
  tradeName?: string;
  // 44AD — 3-way turnover split
  grossTurnoverBank?: number;
  grossTurnoverCash?: number;
  grossTurnoverOther?: number;
  presumptiveInc6Per?: number;    // auto: 6% of bank
  presumptiveInc8Per?: number;    // auto: 8% of (cash + other)
  totalPresumptive44AD?: number;
  // 44ADA — 3-way receipt split
  grossReceiptsBank?: number;
  grossReceiptsCash?: number;
  grossReceiptsOther?: number;
  totalPresumptive44ADA?: number; // auto: 50% of total
  // 44AE
  goodsVehicles?: UiGoodsDtlsUs44AE[];
  salaryInterestByFirm?: number;
  totalPresumptive44AE?: number;
  // GSTIN
  gstinTurnover?: UiTurnoverGSTIN[];
  // Financial particulars
  financials?: UiFinanclPartclrOfBusiness;
}

export function defaultBusinessIncome(): UiBusinessIncome {
  return { scheme: 'NONE' };
}

// ── TDS / TCS / Tax Payments schedules ──────────────────────────────────

export interface UiTDSonSalaryEntry {
  EmployerOrDeductorOrCollectTAN?: string;
  EmployerOrDeductorOrCollectName?: string;
  IncChrgSal?: number;        // income charged to salary
  TotalTDSSal?: number;       // TDS deducted
}

export interface UiTDSonOtherEntry {
  EmployerOrDeductorOrCollectTAN?: string;
  EmployerOrDeductorOrCollectName?: string;
  UniqueTDSCerNo?: string;    // unique TDS certificate number
  AmtForTaxDeworDed?: number; // gross amount
  DeductedYr?: string;        // FY of deduction (YYYY-YY)
  TotalTDSonOthThanSals?: number;
  ClaimOutOfTotTDSOnAmtPaid?: number;
}

export interface UiTCSEntry {
  EmployerOrDeductorOrCollectTAN?: string;
  EmployerOrDeductorOrCollectName?: string;
  AmtTaxCollected?: number;
  CollectedYr?: string;
  TotalTCS?: number;
  ClaimOutOfTotTCS?: number;
}

export interface UiTaxPaymentEntry {
  BSRCode?: string;
  DateDep?: string;           // YYYY-MM-DD
  SrlNoOfChaln?: string;
  Amt?: number;
}

export interface UiTaxReturnPreparer {
  IdentificationNoOfTRP?: string;
  NameOfTRP?: string;
  ReImbFrmGov?: number;
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
  TaxReturnPreparer?: UiTaxReturnPreparer;
  // TDS/TCS/TaxPayments schedules
  TDSonSalaries?: { TDSonSalary?: UiTDSonSalaryEntry[] };
  TDSonOthThanSals?: { TDSonOthThanSal?: UiTDSonOtherEntry[] };
  ScheduleTCS?: { TCS?: UiTCSEntry[] };
  TaxPayments?: { TaxPayment?: UiTaxPaymentEntry[] };
  // Detailed schedules (line-item breakups)
  AllwncExemptUs10?: { AllwncExemptUs10Dtls?: UiAllwncExemptUs10Entry[]; TotalAllwncExemptUs10?: number };
  OthersInc?: { OthersIncDtlsOthSrc?: UiOtherSourceEntry[] };
  ScheduleEA10_13A?: UiScheduleEA1013A;
  Schedule80D?: UiSchedule80D;
  Schedule80G?: UiSchedule80G;
  Schedule80C?: { Schedule80CDtls?: UiSchedule80CEntry[]; TotalAmt?: number };
  ScheduleUs24B?: { ScheduleUs24BDtls?: UiLoanEntry24B[]; TotalInterestUs24B?: number };
  Schedule80DD?: UiSchedule80DD;
  Schedule80U?: UiSchedule80U;
  Schedule80E?: { Schedule80EDtls?: UiLoanEntryGeneric[]; TotalInterest80E?: number };
  Schedule80EE?: { Schedule80EEDtls?: UiLoanEntryGeneric[]; TotalInterest80EE?: number };
  Schedule80EEA?: { PropStmpDtyVal?: number; Schedule80EEADtls?: UiLoanEntryGeneric[]; TotalInterest80EEA?: number };
  Schedule80EEB?: { Schedule80EEBDtls?: UiLoanEntryGeneric[]; TotalInterest80EEB?: number };
  Schedule80GGA?: { DonationDtlsSciRsrchRuralDev?: UiDonationDetailEntry[]; TotalDonationsUs80GGA?: number; TotalEligibleDonationAmt80GGA?: number };
  Schedule80GGC?: { Schedule80GGCDetails?: UiDonationDetailEntry[]; TotalDonationsUs80GGC?: number; TotalEligibleDonationAmt80GGC?: number };
  ExemptIncAgriOthUs10?: { ExemptIncAgriOthUs10Dtls?: UiExemptIncomeEntry[] };
  /** UI-only: multi-employer list (flattened to the schema totals on export) */
  _salaryEmployers?: UiSalaryEmployer[];
  /** UI-only: ITR-4 business income state (mapped to ScheduleBP on export) */
  _businessIncome?: UiBusinessIncome;
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
      SeventhProvisio139: 'N',
      IncrExpAggAmt2LkTrvFrgnCntryFlg: 'N',
      IncrExpAggAmt1LkElctrctyPrYrFlg: 'N',
      clauseiv7provisio139i: 'N',
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

/**
 * Canonical list of Chapter VI-A line-item keys. Shared between the mapper
 * (toCbdtJson) and the wizard's Deductions step so the total is computed from
 * a single source of truth.
 */
export const CHAP_VIA_KEYS: Array<keyof UiChapVIA> = [
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

export function sumChapVIA(c: UiChapVIA | undefined): number {
  if (!c) return 0;
  return CHAP_VIA_KEYS.reduce((acc, k) => acc + (Number(c[k]) || 0), 0);
}

/**
 * Chapter VI-A sections still allowed under the NEW tax regime for ITR-1
 * (Finance Act 2023+). Full list: 80CCD(2), 80CCH (Agniveer), 80JJAA.
 * 80JJAA isn't modelled in UiChapVIA's 20-key surface — only two here.
 */
export const NEW_REGIME_CHAP_VIA_KEYS: Array<keyof UiChapVIA> = [
  'Section80CCDEmployer',   // 80CCD(2)
  'AnyOthSec80CCH',         // 80CCH
];

/**
 * Regime-aware Chapter VI-A sum. Under the new regime, only the two allowed
 * sections contribute; under the old regime, all 20 line items contribute.
 */
export function sumChapVIAForRegime(
  c: UiChapVIA | undefined,
  regime: 'new' | 'old',
): number {
  if (!c) return 0;
  const keys = regime === 'new' ? NEW_REGIME_CHAP_VIA_KEYS : CHAP_VIA_KEYS;
  return keys.reduce((acc, k) => acc + (Number(c[k]) || 0), 0);
}

/**
 * Produces the DeductUndChapVIA block for the CBDT envelope. Under the new
 * regime we strip the disallowed fields so the server business rule
 * `ruleTotalChapVIAMatches` sees a consistent { fields, total } pair.
 *
 * Upstream callers are expected to preserve the user's raw
 * UsrDeductUndChapVIA separately so toggling back to old regime restores
 * their values.
 */
export function filterChapVIAForRegime(
  c: UiChapVIA | undefined,
  regime: 'new' | 'old',
): UiChapVIA {
  if (!c) return { TotalChapVIADeductions: 0 };
  if (regime === 'old') {
    return { ...c };
  }
  const filtered: UiChapVIA = {};
  for (const k of NEW_REGIME_CHAP_VIA_KEYS) {
    const v = c[k];
    if (typeof v === 'number') filtered[k] = v;
  }
  return filtered;
}
