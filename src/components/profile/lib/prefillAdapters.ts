/**
 * Pure conversion helpers that translate a generic profile into the
 * partial shapes consumed by the ITR wizard, Notice form, and Calculator
 * Income Tax tab. One-way only (profile → consumer).
 */
import { GenericProfile } from '../../../services/api';
import {
  IdentitySlice,
  AddressSlice,
  BankSlice,
  NoticeDefaultsSlice,
  PerAySlice,
  SalaryEmployer,
  DeductionsSlice,
  BusinessSlice,
  ensureAySlice,
} from './profileModel';
import type {
  ItrWizardDraft,
  UiPersonalInfo,
  UiAddress,
  UiBankDetail,
  UiSalaryEmployer,
  UiChapVIA,
} from '../../itr/lib/uiModel';

export function getIdentity(p: GenericProfile): IdentitySlice {
  return (p.identity as IdentitySlice) ?? {};
}

export function getAddress(p: GenericProfile): AddressSlice {
  return (p.address as AddressSlice) ?? {};
}

export function getBanks(p: GenericProfile): BankSlice[] {
  return Array.isArray(p.banks) ? (p.banks as BankSlice[]) : [];
}

export function getNoticeDefaults(p: GenericProfile): NoticeDefaultsSlice {
  return (p.noticeDefaults as NoticeDefaultsSlice) ?? {};
}

export function getPerAy(p: GenericProfile, ay: string): PerAySlice {
  return ensureAySlice(p.perAy, ay);
}

/* ---------- ITR Wizard adapters ----------------------------------------- */

/**
 * Merges profile identity + address slices into an ITR draft's PersonalInfo
 * block. Returns a new draft; caller uses it as the `onChange` payload.
 */
export function profileToItrPersonal(
  profile: GenericProfile,
  draft: ItrWizardDraft,
): ItrWizardDraft {
  const id = getIdentity(profile);
  const addr = getAddress(profile);

  const newPersonal: UiPersonalInfo = {
    ...(draft.PersonalInfo ?? {}),
    AssesseeName: {
      ...(draft.PersonalInfo?.AssesseeName ?? {}),
      FirstName: id.firstName ?? draft.PersonalInfo?.AssesseeName?.FirstName,
      MiddleName: id.middleName ?? draft.PersonalInfo?.AssesseeName?.MiddleName,
      SurNameOrOrgName: id.lastName ?? draft.PersonalInfo?.AssesseeName?.SurNameOrOrgName,
    },
    PAN: id.pan ?? draft.PersonalInfo?.PAN,
    AadhaarCardNo: id.aadhaar ?? draft.PersonalInfo?.AadhaarCardNo,
    DOB: id.dob ?? draft.PersonalInfo?.DOB,
    EmployerCategory: id.employerCategory ?? draft.PersonalInfo?.EmployerCategory,
  };

  const newAddress: UiAddress = {
    ...(draft.PersonalInfo?.Address ?? {}),
    ResidenceNo: addr.flatNo ?? draft.PersonalInfo?.Address?.ResidenceNo,
    ResidenceName: addr.premiseName ?? draft.PersonalInfo?.Address?.ResidenceName,
    RoadOrStreet: addr.roadOrStreet ?? draft.PersonalInfo?.Address?.RoadOrStreet,
    LocalityOrArea: addr.locality ?? draft.PersonalInfo?.Address?.LocalityOrArea,
    CityOrTownOrDistrict: addr.city ?? draft.PersonalInfo?.Address?.CityOrTownOrDistrict,
    StateCode: addr.stateCode ?? draft.PersonalInfo?.Address?.StateCode,
    CountryCode: addr.countryCode ?? draft.PersonalInfo?.Address?.CountryCode,
    PinCode: addr.pinCode ?? draft.PersonalInfo?.Address?.PinCode,
    CountryCodeMobile: addr.mobileCountryCode ?? draft.PersonalInfo?.Address?.CountryCodeMobile,
    MobileNo: addr.mobile ?? draft.PersonalInfo?.Address?.MobileNo,
    EmailAddress: addr.email ?? draft.PersonalInfo?.Address?.EmailAddress,
  };

  newPersonal.Address = newAddress;

  // Verification uses fatherName from identity slice
  const newVerification = {
    ...(draft.Verification ?? {}),
    Declaration: {
      ...(draft.Verification?.Declaration ?? {}),
      AssesseeVerName: [id.firstName, id.middleName, id.lastName]
        .filter(Boolean)
        .join(' ')
        || draft.Verification?.Declaration?.AssesseeVerName,
      FatherName: id.fatherName ?? draft.Verification?.Declaration?.FatherName,
      AssesseeVerPAN: id.pan ?? draft.Verification?.Declaration?.AssesseeVerPAN,
    },
  };

  return { ...draft, PersonalInfo: newPersonal, Verification: newVerification };
}

export function profileToItrBanks(
  profile: GenericProfile,
  draft: ItrWizardDraft,
): ItrWizardDraft {
  const banks = getBanks(profile);
  if (banks.length === 0) return draft;

  // Ensure exactly one is marked as refund — prefer the isDefault one
  const mapped: UiBankDetail[] = banks.map((b, i) => ({
    IFSCCode: b.ifsc,
    BankName: b.name,
    BankAccountNo: b.accountNo,
    AccountType: b.type ?? 'SB',
    UseForRefund:
      b.isDefault === true
        ? 'true'
        : banks.every((x) => !x.isDefault) && i === 0
          ? 'true'
          : 'false',
  }));

  return {
    ...draft,
    Refund: {
      ...(draft.Refund ?? {}),
      BankAccountDtls: { AddtnlBankDetails: mapped },
    },
  };
}

export function profileToItrIncome(
  profile: GenericProfile,
  draft: ItrWizardDraft,
  ay: string,
): ItrWizardDraft {
  const per = getPerAy(profile, ay);
  const salary = per.salary ?? {};
  const employers: UiSalaryEmployer[] =
    (salary.employers ?? []).map((e: SalaryEmployer) => ({
      _uid: e.uid || crypto.randomUUID(),
      employerName: e.employerName,
      tan: e.tan,
      grossSalary: e.grossSalary,
      tdsOnSalary: e.tdsOnSalary,
    }));
  return {
    ...draft,
    _salaryEmployers: employers,
    ITR1_IncomeDeductions: {
      ...(draft.ITR1_IncomeDeductions ?? {}),
      PerquisitesValue: salary.perquisites ?? draft.ITR1_IncomeDeductions?.PerquisitesValue,
      ProfitsInSalary: salary.profitsInSalary ?? draft.ITR1_IncomeDeductions?.ProfitsInSalary,
      ProfessionalTaxUs16iii:
        salary.professionalTax ?? draft.ITR1_IncomeDeductions?.ProfessionalTaxUs16iii,
      DeductionUs16ia:
        salary.standardDeduction ?? draft.ITR1_IncomeDeductions?.DeductionUs16ia,
      IncomeOthSrc:
        salary.otherSourcesIncome ?? draft.ITR1_IncomeDeductions?.IncomeOthSrc,
    },
  };
}

export function profileToItrDeductions(
  profile: GenericProfile,
  draft: ItrWizardDraft,
  ay: string,
): ItrWizardDraft {
  const d = getPerAy(profile, ay).deductions ?? {};
  const mapped: Partial<UiChapVIA> = {};
  const keys: Array<keyof DeductionsSlice> = [
    'section80C',
    'section80CCC',
    'section80CCDEmployeeOrSE',
    'section80CCD1B',
    'section80CCDEmployer',
    'section80D',
    'section80DD',
    'section80DDB',
    'section80E',
    'section80EE',
    'section80EEA',
    'section80EEB',
    'section80G',
    'section80GG',
    'section80GGA',
    'section80GGC',
    'section80U',
    'section80TTA',
    'section80TTB',
  ];
  for (const k of keys) {
    if (d[k] !== undefined) {
      // Convert 'section80C' → 'Section80C'
      const camel = (k.charAt(0).toUpperCase() + k.slice(1)) as keyof UiChapVIA;
      (mapped as Record<string, number>)[camel] = Number(d[k]) || 0;
    }
  }
  return {
    ...draft,
    ITR1_IncomeDeductions: {
      ...(draft.ITR1_IncomeDeductions ?? {}),
      UsrDeductUndChapVIA: {
        ...(draft.ITR1_IncomeDeductions?.UsrDeductUndChapVIA ?? {}),
        ...mapped,
      },
      DeductUndChapVIA: {
        ...(draft.ITR1_IncomeDeductions?.DeductUndChapVIA ?? {}),
        ...mapped,
      },
    },
  };
}

export function profileToItrBusiness(
  profile: GenericProfile,
  draft: ItrWizardDraft,
  ay: string,
): ItrWizardDraft {
  const b: BusinessSlice = getPerAy(profile, ay).business ?? {};
  // BusinessIncomeStep stores on draft._businessIncome (see the step component)
  return {
    ...draft,
    _businessIncome: {
      scheme: b.scheme ?? 'NONE',
      natureCode: b.natureCode,
      tradeName: b.tradeName,
      grossTurnoverCash: b.grossTurnoverCash,
      grossTurnoverDigital: b.grossTurnoverDigital,
      grossReceipts: b.grossReceipts,
      numHeavyVehicles: b.numHeavyVehicles,
      numOtherVehicles: b.numOtherVehicles,
      monthsOwned: b.monthsOwned ?? 12,
      sundryDebtors: b.sundryDebtors,
      sundryCreditors: b.sundryCreditors,
      stockInTrade: b.stockInTrade,
      cashBalance: b.cashBalance,
      presumptiveIncome: 0, // recomputed by the step on first edit
    },
  } as ItrWizardDraft;
}

/* ---------- Notice form adapter ----------------------------------------- */

export interface NoticeFormPrefill {
  senderName?: string;
  senderAddress?: string;
  senderPan?: string;
  senderGstin?: string;
  recipientOfficer?: string;
  recipientOffice?: string;
  recipientAddress?: string;
}

export function profileToNoticeForm(profile: GenericProfile): NoticeFormPrefill {
  const id = getIdentity(profile);
  const addr = getAddress(profile);
  const defaults = getNoticeDefaults(profile);

  const fullName = [id.firstName, id.middleName, id.lastName].filter(Boolean).join(' ');
  const senderAddrLine = [
    addr.flatNo,
    addr.premiseName,
    addr.roadOrStreet,
    addr.locality,
    addr.city,
    addr.pinCode ? String(addr.pinCode) : undefined,
  ]
    .filter(Boolean)
    .join(', ');

  return {
    senderName: defaults.senderName || fullName || undefined,
    senderAddress: defaults.senderAddress || senderAddrLine || undefined,
    senderPan: defaults.senderPan || id.pan,
    senderGstin: defaults.senderGstin,
    recipientOfficer: defaults.recipientOfficer,
    recipientOffice: defaults.recipientOffice,
    recipientAddress: defaults.recipientAddress,
  };
}

/* ---------- Calculator adapter (Income Tax tab) ------------------------- */

export interface CalculatorPrefill {
  grossSalary?: string;
  otherIncome?: string;
  deductions?: {
    section80C?: string;
    section80D_self?: string;
    section80D_parents?: string;
    section80CCD1B?: string;
    section80E?: string;
    section80G?: string;
    section80TTA?: string;
    section24b?: string;
    section80EEB?: string;
  };
}

export function profileToCalculator(profile: GenericProfile, ay: string): CalculatorPrefill {
  const per = getPerAy(profile, ay);
  const salary = per.salary ?? {};
  const d = per.deductions ?? {};
  const employers = salary.employers ?? [];
  const totalGross = employers.reduce((acc, e) => acc + (Number(e.grossSalary) || 0), 0);
  const num = (n: number | undefined) => (n ? String(n) : '');
  return {
    grossSalary: totalGross > 0 ? String(totalGross) : '',
    otherIncome: num(salary.otherSourcesIncome),
    deductions: {
      section80C: num(d.section80C),
      section80D_self: num(d.section80D),
      section80D_parents: '',
      section80CCD1B: num(d.section80CCD1B),
      section80E: num(d.section80E),
      section80G: num(d.section80G),
      section80TTA: num(d.section80TTA),
      section24b: '',
      section80EEB: num(d.section80EEB),
    },
  };
}
