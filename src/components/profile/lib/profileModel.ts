/**
 * TypeScript shapes for the new generic profiles feature.
 *
 * The `GenericProfile` type in src/services/api.ts uses `unknown` records for
 * slices — this file declares the concrete shape that the UI writes into
 * them. Each tab component reads/writes its own slice with strong typing.
 */

export type AccountType = 'SB' | 'CA' | 'CC' | 'OD' | 'NRO' | 'OTH';
export type EmployerCategory =
  | 'CGOV'
  | 'SGOV'
  | 'PSU'
  | 'PE'
  | 'PESG'
  | 'PEPS'
  | 'PEO'
  | 'OTH'
  | 'NA';

export interface IdentitySlice {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  pan?: string;
  aadhaar?: string;
  dob?: string;                    // YYYY-MM-DD
  employerCategory?: EmployerCategory;
  fatherName?: string;             // used in ITR Verification
}

export interface AddressSlice {
  flatNo?: string;
  premiseName?: string;
  roadOrStreet?: string;
  locality?: string;
  city?: string;
  stateCode?: string;              // CBDT state code, e.g. "09"
  countryCode?: string;            // CBDT country code, e.g. "91"
  pinCode?: number;
  mobileCountryCode?: number;
  mobile?: number;
  email?: string;
}

export interface BankSlice {
  uid: string;                     // UI-only — stable id for React lists
  ifsc?: string;
  name?: string;
  accountNo?: string;
  type?: AccountType;
  isDefault?: boolean;             // exactly one should be true for refund
}

export interface JurisdictionBlock {
  areaCode?: string;
  areaDescription?: string;
  aoType?: string;
  rangeCode?: string;
  aoNumber?: string;
  aoName?: string;
  aoEmail?: string;
  aoBuildingId?: string;
  aoBuildingDescription?: string;
}

export interface NoticeDefaultsSlice {
  senderName?: string;
  senderPan?: string;
  senderGstin?: string;
  senderAddress?: string;
  recipientOfficer?: string;
  recipientOffice?: string;
  recipientAddress?: string;
  /**
   * Assessing officer jurisdiction details imported from the Income Tax
   * portal via /api/it-portal/import. Stored here so the notice drafter can
   * optionally address the AO directly in future.
   */
  jurisdiction?: JurisdictionBlock;
}

/* ---------- Per-AY slices ------------------------------------------------ */

export interface SalaryEmployer {
  uid: string;
  employerName?: string;
  tan?: string;
  grossSalary?: number;
  tdsOnSalary?: number;
}

export interface SalaryIncomeSlice {
  employers?: SalaryEmployer[];
  otherSourcesIncome?: number;
  perquisites?: number;
  profitsInSalary?: number;
  professionalTax?: number;
  standardDeduction?: number;
}

export interface DeductionsSlice {
  section80C?: number;
  section80CCC?: number;
  section80CCDEmployeeOrSE?: number;
  section80CCD1B?: number;
  section80CCDEmployer?: number;
  section80D?: number;
  section80DD?: number;
  section80DDB?: number;
  section80E?: number;
  section80EE?: number;
  section80EEA?: number;
  section80EEB?: number;
  section80G?: number;
  section80GG?: number;
  section80GGA?: number;
  section80GGC?: number;
  section80U?: number;
  section80TTA?: number;
  section80TTB?: number;
}

export interface BusinessSlice {
  scheme?: '44AD' | '44ADA' | '44AE' | 'NONE';
  natureCode?: string;
  tradeName?: string;
  grossTurnoverCash?: number;
  grossTurnoverDigital?: number;
  grossReceipts?: number;
  numHeavyVehicles?: number;
  numOtherVehicles?: number;
  monthsOwned?: number;
  sundryDebtors?: number;
  sundryCreditors?: number;
  stockInTrade?: number;
  cashBalance?: number;
}

export interface PerAySlice {
  salary?: SalaryIncomeSlice;
  deductions?: DeductionsSlice;
  business?: BusinessSlice;
}

export function emptyIdentity(): IdentitySlice {
  return {};
}

export function emptyAddress(): AddressSlice {
  return {};
}

export function emptyNoticeDefaults(): NoticeDefaultsSlice {
  return {};
}

export function emptyPerAy(): PerAySlice {
  return { salary: { employers: [] }, deductions: {}, business: { scheme: 'NONE', monthsOwned: 12 } };
}

/** Supported AYs in the UI — keep in sync with calculator / ITR wizard. */
export const PROFILE_AYS = ['2024-25', '2025-26', '2026-27'] as const;
export type ProfileAy = typeof PROFILE_AYS[number];

export function ensureAySlice(
  perAy: Record<string, Record<string, unknown>>,
  year: string,
): PerAySlice {
  const existing = perAy?.[year] as PerAySlice | undefined;
  return existing ?? emptyPerAy();
}
