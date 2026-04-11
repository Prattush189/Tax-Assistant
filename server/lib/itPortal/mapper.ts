/**
 * Pure mapping from the portal's raw JSON shapes into the generic profile
 * slice types used by the rest of the app.
 *
 * IMPORTANT: this module is pure — no side effects, no DB, no HTTP. Keep it
 * testable via scripts/verify-portal-mapper.ts.
 */
import type {
  PortalBankAccount,
  PortalBankMasterDetails,
  PortalJurisdictionDetails,
  PortalUserProfile,
} from './types.js';

// ── Duplicated slice shapes ───────────────────────────────────────────────
// We can't import from `src/components/profile/lib/profileModel.ts` because
// that module lives under the Vite-built client tree. Keep a minimal subset
// of the types inline — the route that consumes the mapper JSON-stringifies
// these anyway, so shape matching is all that matters.

export type AccountType = 'SB' | 'CA' | 'CC' | 'OD' | 'NRO' | 'OTH';

export interface IdentitySlice {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  pan?: string;
  aadhaar?: string;
  dob?: string;
}

export interface AddressSlice {
  flatNo?: string;
  premiseName?: string;
  roadOrStreet?: string;
  locality?: string;
  city?: string;
  stateCode?: string;
  countryCode?: string;
  pinCode?: number;
  mobileCountryCode?: number;
  mobile?: number;
  email?: string;
}

export interface BankSlice {
  uid: string;
  ifsc?: string;
  name?: string;
  accountNo?: string;
  type?: AccountType;
  isDefault?: boolean;
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
  jurisdiction?: JurisdictionBlock;
}

export interface MappedProfile {
  name: string;
  identity: IdentitySlice;
  address: AddressSlice;
  banks: BankSlice[];
  noticeDefaults: NoticeDefaultsSlice;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function mapAccountType(portalType: string | undefined): AccountType | undefined {
  if (!portalType) return undefined;
  const upper = portalType.toUpperCase();
  if (upper === 'SB' || upper === 'SAVINGS') return 'SB';
  if (upper === 'CA' || upper === 'CURRENT') return 'CA';
  if (upper === 'CC') return 'CC';
  if (upper === 'OD') return 'OD';
  if (upper === 'NRO') return 'NRO';
  return 'OTH';
}

function toMobileNumber(input: string | undefined): number | undefined {
  if (!input) return undefined;
  const digits = input.replace(/\D/g, '');
  if (digits.length === 0) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
}

function padStateCode(v: string | number | undefined): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  // CBDT state codes are 2-digit strings; portal sometimes returns a number.
  return s.padStart(2, '0');
}

// ── Bank filtering ────────────────────────────────────────────────────────

/**
 * The portal returns banks in three buckets: activeBank, inActiveBank,
 * failedBank. We only import from activeBank, and within that we only take
 * rows that are still usable (VALIDATED status or activeFlag = 'Y').
 */
export function filterUsableBanks(
  banks: PortalBankAccount[] | undefined,
): PortalBankAccount[] {
  if (!Array.isArray(banks)) return [];
  return banks.filter(
    (b) =>
      (b.activeFlag ?? '').toUpperCase() === 'Y' ||
      (b.status ?? '').toUpperCase() === 'VALIDATED',
  );
}

// ── Main mapping ──────────────────────────────────────────────────────────

export function mapPortalToProfile(
  profile: PortalUserProfile,
  bankDetails: PortalBankMasterDetails | null,
  jurisdiction: PortalJurisdictionDetails | null,
): MappedProfile {
  const identity: IdentitySlice = {
    firstName: profile.firstName || undefined,
    middleName: profile.middleName || undefined,
    lastName: profile.lastName || undefined,
    pan: profile.pan || undefined,
    aadhaar: profile.aadhaarNum || undefined,
    dob: profile.dob || undefined,
  };

  const address: AddressSlice = {
    flatNo: profile.addrLine1Txt || undefined,
    premiseName: profile.addrLine2Txt || undefined,
    roadOrStreet: profile.addrLine3Txt || undefined,
    locality: profile.addrLine4Txt || undefined,
    city: profile.addrLine5Txt || undefined,
    stateCode: padStateCode(profile.stateCd),
    countryCode: profile.countryCd ? String(profile.countryCd) : undefined,
    pinCode:
      typeof profile.pinCd === 'number' && Number.isFinite(profile.pinCd)
        ? profile.pinCd
        : undefined,
    mobile: toMobileNumber(profile.priMobileNum),
    email: profile.priEmailId || undefined,
  };

  const usableBanks = filterUsableBanks(bankDetails?.activeBank);
  const banks: BankSlice[] = usableBanks.map((b, i) => ({
    uid: `portal-${i}`,
    ifsc: b.ifscCd || undefined,
    name: b.bankName || undefined,
    accountNo: b.bankAcctNum || undefined,
    type: mapAccountType(b.accountType),
    isDefault: (b.refundFlag ?? '').toUpperCase() === 'Y',
  }));
  // Ensure at most one bank is marked as default — prefer the first one
  // flagged by the portal, otherwise mark the first bank as default.
  if (banks.length > 0 && !banks.some((b) => b.isDefault)) {
    banks[0].isDefault = true;
  } else if (banks.filter((b) => b.isDefault).length > 1) {
    let seen = false;
    for (const b of banks) {
      if (b.isDefault) {
        if (seen) b.isDefault = false;
        else seen = true;
      }
    }
  }

  const jurisdictionBlock: JurisdictionBlock | undefined = jurisdiction
    ? {
        areaCode: jurisdiction.areaCd || undefined,
        areaDescription: jurisdiction.areaDesc || undefined,
        aoType: jurisdiction.aoType || undefined,
        rangeCode: jurisdiction.rangeCd || undefined,
        aoNumber: jurisdiction.aoNo || undefined,
        aoName: jurisdiction.aoPplrName || undefined,
        aoEmail: jurisdiction.aoEmailId || undefined,
        aoBuildingId: jurisdiction.aoBldgId || undefined,
        aoBuildingDescription: jurisdiction.aoBldgDesc || undefined,
      }
    : undefined;
  // If every field is empty, drop the whole block
  const hasAnyJurisdictionField =
    jurisdictionBlock !== undefined &&
    Object.values(jurisdictionBlock).some((v) => v !== undefined && v !== '');
  const noticeDefaults: NoticeDefaultsSlice = hasAnyJurisdictionField
    ? { jurisdiction: jurisdictionBlock }
    : {};

  const nameParts = [profile.firstName, profile.middleName, profile.lastName]
    .filter((s): s is string => Boolean(s && s.trim()))
    .map((s) => s.trim());
  const fullName =
    nameParts.length > 0
      ? nameParts.join(' ')
      : profile.pan || 'Imported profile';

  return {
    name: fullName,
    identity,
    address,
    banks,
    noticeDefaults,
  };
}
