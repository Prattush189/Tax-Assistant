/**
 * Deterministic verification for the IT portal → generic profile mapper.
 * Run: npx tsx scripts/verify-portal-mapper.ts
 *
 * Uses realistic portal JSON fixtures (shape-matched to the C# reference)
 * and asserts every output slice field is correctly mapped, filtered, and
 * normalized.
 */
import { mapPortalToProfile, filterUsableBanks } from '../server/lib/itPortal/mapper';
import type {
  PortalBankMasterDetails,
  PortalJurisdictionDetails,
  PortalUserProfile,
} from '../server/lib/itPortal/types';

interface Check {
  label: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
}
const checks: Check[] = [];
function assertEq(label: string, actual: unknown, expected: unknown): void {
  checks.push({ label, pass: JSON.stringify(actual) === JSON.stringify(expected), expected, actual });
}

// ── Fixture A: happy path — full data, one validated bank, jurisdiction ──
{
  const profile: PortalUserProfile = {
    userId: 'ABCDE1234F',
    firstName: 'John',
    middleName: 'Q',
    lastName: 'Doe',
    pan: 'ABCDE1234F',
    aadhaarNum: '123456789012',
    dob: '1990-01-15',
    addrLine1Txt: 'Flat 4B',
    addrLine2Txt: 'Sunrise Heights',
    addrLine3Txt: 'MG Road',
    addrLine4Txt: 'Powai',
    addrLine5Txt: 'Mumbai',
    pinCd: 400076,
    stateCd: 27,               // numeric → padded to "27"
    countryCd: 91,
    priMobileNum: '9876543210',
    priEmailId: 'john@example.com',
  };
  const banks: PortalBankMasterDetails = {
    activeBank: [
      {
        bankAcctNum: '123456789012',
        accountType: 'SB',
        ifscCd: 'HDFC0001234',
        bankName: 'HDFC Bank',
        status: 'VALIDATED',
        activeFlag: 'Y',
        refundFlag: 'Y',
      },
      {
        bankAcctNum: '987654321098',
        accountType: 'CA',
        ifscCd: 'ICIC0005678',
        bankName: 'ICICI Bank',
        status: 'VALIDATED',
        activeFlag: 'Y',
        refundFlag: 'N',
      },
      {
        // Rejected: failed validation
        bankAcctNum: '111222333444',
        accountType: 'SB',
        ifscCd: 'SBIN0001111',
        bankName: 'SBI',
        status: 'FAILED',
        activeFlag: 'N',
        refundFlag: 'N',
      },
    ],
  };
  const jur: PortalJurisdictionDetails = {
    areaCd: 'MUM',
    areaDesc: 'Mumbai West',
    aoType: 'W',
    rangeCd: '21',
    aoNo: '3',
    aoPplrName: 'J Sharma',
    aoEmailId: 'ao-mum@itd.gov.in',
    aoBldgId: 'AKB',
    aoBldgDesc: 'Aayakar Bhavan',
  };

  const result = mapPortalToProfile(profile, banks, jur);

  assertEq('[A] name', result.name, 'John Q Doe');
  assertEq('[A] identity.firstName', result.identity.firstName, 'John');
  assertEq('[A] identity.middleName', result.identity.middleName, 'Q');
  assertEq('[A] identity.lastName', result.identity.lastName, 'Doe');
  assertEq('[A] identity.pan', result.identity.pan, 'ABCDE1234F');
  assertEq('[A] identity.aadhaar', result.identity.aadhaar, '123456789012');
  assertEq('[A] identity.dob', result.identity.dob, '1990-01-15');
  assertEq('[A] address.flatNo', result.address.flatNo, 'Flat 4B');
  assertEq('[A] address.premiseName', result.address.premiseName, 'Sunrise Heights');
  assertEq('[A] address.roadOrStreet', result.address.roadOrStreet, 'MG Road');
  assertEq('[A] address.locality', result.address.locality, 'Powai');
  assertEq('[A] address.city', result.address.city, 'Mumbai');
  assertEq('[A] address.stateCode (padded to 2 digits)', result.address.stateCode, '27');
  assertEq('[A] address.countryCode', result.address.countryCode, '91');
  assertEq('[A] address.pinCode', result.address.pinCode, 400076);
  assertEq('[A] address.mobile', result.address.mobile, 9876543210);
  assertEq('[A] address.email', result.address.email, 'john@example.com');

  // Banks
  assertEq('[A] banks.length (only 2 usable)', result.banks.length, 2);
  assertEq('[A] banks[0].ifsc', result.banks[0].ifsc, 'HDFC0001234');
  assertEq('[A] banks[0].name', result.banks[0].name, 'HDFC Bank');
  assertEq('[A] banks[0].accountNo', result.banks[0].accountNo, '123456789012');
  assertEq('[A] banks[0].type', result.banks[0].type, 'SB');
  assertEq('[A] banks[0].isDefault (refund flag Y)', result.banks[0].isDefault, true);
  assertEq('[A] banks[1].type', result.banks[1].type, 'CA');
  assertEq('[A] banks[1].isDefault', result.banks[1].isDefault, false);

  // Jurisdiction
  assertEq(
    '[A] noticeDefaults.jurisdiction.areaCode',
    result.noticeDefaults.jurisdiction?.areaCode,
    'MUM',
  );
  assertEq(
    '[A] noticeDefaults.jurisdiction.aoName',
    result.noticeDefaults.jurisdiction?.aoName,
    'J Sharma',
  );
  assertEq(
    '[A] noticeDefaults.jurisdiction.aoBuildingDescription',
    result.noticeDefaults.jurisdiction?.aoBuildingDescription,
    'Aayakar Bhavan',
  );
}

// ── Fixture B: no refund flag set — first bank should be defaulted ────────
{
  const profile: PortalUserProfile = {
    firstName: 'Jane',
    lastName: 'Smith',
    pan: 'XYZAB5678C',
  };
  const banks: PortalBankMasterDetails = {
    activeBank: [
      {
        bankAcctNum: '111',
        ifscCd: 'AAA0000001',
        bankName: 'A Bank',
        accountType: 'SB',
        status: 'VALIDATED',
        activeFlag: 'Y',
        refundFlag: 'N',
      },
      {
        bankAcctNum: '222',
        ifscCd: 'BBB0000002',
        bankName: 'B Bank',
        accountType: 'CA',
        status: 'VALIDATED',
        activeFlag: 'Y',
        refundFlag: 'N',
      },
    ],
  };

  const result = mapPortalToProfile(profile, banks, null);
  assertEq('[B] name', result.name, 'Jane Smith');
  assertEq('[B] banks.length', result.banks.length, 2);
  assertEq('[B] banks[0].isDefault (auto-default since none flagged)', result.banks[0].isDefault, true);
  assertEq('[B] banks[1].isDefault', result.banks[1].isDefault, false);
  assertEq('[B] jurisdiction block dropped when null', result.noticeDefaults.jurisdiction, undefined);
}

// ── Fixture C: multiple refund flags — keep only the first ───────────────
{
  const profile: PortalUserProfile = { pan: 'PQRST9999Z' };
  const banks: PortalBankMasterDetails = {
    activeBank: [
      { bankAcctNum: '1', ifscCd: 'X0000000001', bankName: 'X', accountType: 'SB', status: 'VALIDATED', activeFlag: 'Y', refundFlag: 'Y' },
      { bankAcctNum: '2', ifscCd: 'Y0000000002', bankName: 'Y', accountType: 'SB', status: 'VALIDATED', activeFlag: 'Y', refundFlag: 'Y' },
    ],
  };
  const result = mapPortalToProfile(profile, banks, null);
  assertEq('[C] name falls back to PAN', result.name, 'PQRST9999Z');
  assertEq('[C] banks[0].isDefault (kept)', result.banks[0].isDefault, true);
  assertEq('[C] banks[1].isDefault (demoted)', result.banks[1].isDefault, false);
}

// ── Fixture D: empty portal response — degrades gracefully ───────────────
{
  const profile: PortalUserProfile = {};
  const result = mapPortalToProfile(profile, null, null);
  assertEq('[D] name fallback', result.name, 'Imported profile');
  assertEq('[D] identity is empty', Object.values(result.identity).filter(Boolean).length, 0);
  assertEq('[D] banks.length', result.banks.length, 0);
  assertEq('[D] jurisdiction undefined', result.noticeDefaults.jurisdiction, undefined);
}

// ── Fixture E: filterUsableBanks directly ────────────────────────────────
{
  const banks = [
    { activeFlag: 'Y', status: 'VALIDATED' },
    { activeFlag: 'N', status: 'VALIDATED' }, // active-false kept if validated
    { activeFlag: 'Y', status: 'PENDING' },   // active-true kept regardless
    { activeFlag: 'N', status: 'FAILED' },    // rejected
  ];
  const filtered = filterUsableBanks(banks);
  assertEq('[E] filtered count', filtered.length, 3);
}

// ── Report ────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
for (const c of checks) {
  if (c.pass) {
    pass++;
    console.log(`PASS  ${c.label}`);
  } else {
    fail++;
    console.log(`FAIL  ${c.label}`);
    console.log(`        expected: ${JSON.stringify(c.expected)}`);
    console.log(`        actual:   ${JSON.stringify(c.actual)}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
