/**
 * TDS / TCS calculator engine
 *
 * Data compiled from:
 *   • threshold_limits.xlsx — 80 payment categories across Form 24Q/26Q/27Q/27EQ
 *   • TdsRates.xlsx         — rate table for AY 2025-26
 *   • TDS_SECTION_CODE.xls  — IT Act 2025 ↔ 1961 section mapping
 *
 * Design notes:
 *   • `category`  — 'resident' (Form 24Q salary + 26Q non-salary resident),
 *                  'nonResident' (Form 27Q), or 'tcs' (Form 27EQ)
 *   • `oldSection` uses IT Act 1961 numbering (194J, 194C, etc.)
 *   • `newSection` is the IT Act 2025 reference that comes into effect
 *      from FY 2026-27 onwards
 *   • `fyOverrides` capture rate/threshold changes across years; missing
 *      values fall back to the top-level defaults (current = FY 2025-26)
 *   • Without-PAN rate defaults to 20% (5% for 194-O / 194Q / 206CC cap)
 *
 * All rates are decimals (0.10 = 10%). Thresholds are in INR, annual unless
 * noted. A threshold of 0 means "no threshold — deduct on any amount".
 */

export type TdsCategory = 'resident' | 'nonResident' | 'tcs';
export type TdsFY = '2023-24' | '2024-25' | '2025-26' | '2026-27';

/**
 * How the deductor is treating this payment.
 *   • prescribed   → standard Act rate
 *   • lower        → lower rate certificate u/s 197 (user supplies the rate)
 *   • notDeducted  → payment is exempt (e.g. Form 15G/15H) — TDS = 0
 *   • transporter  → 194C-only — valid declaration from transporter operating ≤ 10 goods carriages; TDS = 0
 */
export type DeductionType = 'prescribed' | 'lower' | 'notDeducted' | 'transporter';

/** Relevant for 194 (dividend) — threshold only applies when payee is an individual */
export type PayeeStatus = 'individual' | 'other';

export const TDS_FY_OPTIONS: { value: TdsFY; label: string }[] = [
  { value: '2026-27', label: 'FY 2026-27 (AY 2027-28) — New IT Act 2025' },
  { value: '2025-26', label: 'FY 2025-26 (AY 2026-27)' },
  { value: '2024-25', label: 'FY 2024-25 (AY 2025-26)' },
  { value: '2023-24', label: 'FY 2023-24 (AY 2024-25)' },
];

export const TDS_CATEGORY_OPTIONS: { value: TdsCategory; label: string; form: string }[] = [
  { value: 'resident', label: 'Resident', form: '24Q / 26Q' },
  { value: 'nonResident', label: 'Non-Resident', form: '27Q' },
  { value: 'tcs', label: 'TCS', form: '27EQ' },
];

export const DEDUCTION_TYPE_LABELS: Record<DeductionType, string> = {
  prescribed: 'Prescribed',
  lower: 'Lower Rate (u/s 197)',
  notDeducted: 'Not Deducted (Exempt)',
  transporter: 'Transporter (194C)',
};

const DEFAULT_ALLOWED_DEDUCTION_TYPES: DeductionType[] = ['prescribed', 'lower', 'notDeducted'];

/**
 * Paycodes from the legacy FrmTdsEntry master where "Not Deducted" is NOT an allowed
 * deduction type (only Prescribed / Lower). Encoded here by our internal section id.
 */
const NO_NIL_DEDUCTION_IDS = new Set<string>([
  'r-193',        // paycode 5
  'r-194J-prof',  // paycode 8
  'r-194C-ind',   // paycode 2
  'r-194C-other', // paycode 3/4
  'r-194H',       // paycode 10
  'nr-195-int',   // paycode 11
  'nr-195-ltcg',  // paycode 12
  'nr-195-other', // paycode 13
  'r-194B',       // paycode 14
  'r-194BA',      // paycode 91-ish
  'r-194EE',      // paycode 22
  'r-194G',       // paycode 23
  'r-194I-a',     // paycode 79
  'r-194I-b',     // paycode 80
  'nr-194LC',     // paycode 51
  'r-194DA',      // paycode 52
  'r-194LBA-a',   // paycode 53
  'nr-194LB',     // paycode 50
  'r-194LA',      // paycode 40
  'r-194LBC',     // paycode 54
  'tcs-206C-tendu', // paycode 38
]);

interface FyOverride {
  rate?: number;
  rateWithoutPAN?: number;
  threshold?: number;
  perEntryThreshold?: number;
}

export interface TdsSection {
  id: string;
  category: TdsCategory;
  oldSection: string;          // IT Act 1961 reference
  newSection?: string;         // IT Act 2025 reference
  description: string;
  rate: number;                // default rate with PAN (decimal)
  rateWithoutPAN: number;      // default rate without PAN (usually 0.20)
  threshold: number;           // default aggregate threshold in INR (0 = none)
  /** Per-entry threshold — TDS triggers if single payment ≥ this OR aggregate ≥ `threshold` */
  perEntryThreshold?: number;
  thresholdNote?: string;      // e.g., "per transaction", "aggregate"
  fyOverrides?: Partial<Record<TdsFY, FyOverride>>;
  /** Allowed deduction types. Defaults to ['prescribed','lower','notDeducted']. */
  allowedDeductionTypes?: DeductionType[];
  /** When true, the aggregate threshold only applies if the payee is an individual (e.g. 194 dividend). */
  payeeStatusAffectsThreshold?: boolean;
}

// ──────────────────────────────────────────────────────────────────────────
// RESIDENT sections (Form 24Q salary + 26Q non-salary)
// ──────────────────────────────────────────────────────────────────────────

const RESIDENT_SECTIONS: TdsSection[] = [
  {
    id: 'r-192',
    category: 'resident',
    oldSection: '192',
    newSection: '392',
    description: 'Salary',
    rate: 0,
    rateWithoutPAN: 0.20,
    threshold: 0,
    thresholdNote: 'As per slab — basic exemption limit',
  },
  {
    id: 'r-192A',
    category: 'resident',
    oldSection: '192A',
    newSection: '392(7)',
    description: 'Premature withdrawal from EPF',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 50000,
  },
  {
    id: 'r-193',
    category: 'resident',
    oldSection: '193',
    newSection: '393(1) Sl. 5(i)',
    description: 'Interest on securities',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 10000,
  },
  {
    id: 'r-194',
    category: 'resident',
    oldSection: '194',
    newSection: '393(1) Sl. 7',
    description: 'Dividends',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 10000,
    thresholdNote: 'Threshold applies only when payee is an Individual/HUF',
    payeeStatusAffectsThreshold: true,
    fyOverrides: {
      '2023-24': { threshold: 5000 },
      '2024-25': { threshold: 5000 },
    },
  },
  {
    id: 'r-194A',
    category: 'resident',
    oldSection: '194A',
    newSection: '393(1) Sl. 5(iii)',
    description: 'Interest other than on securities',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 50000,
    thresholdNote: '₹1,00,000 for senior citizens (Budget 2025 update)',
    fyOverrides: {
      '2023-24': { threshold: 40000 },
      '2024-25': { threshold: 40000 },
    },
  },
  {
    id: 'r-194B',
    category: 'resident',
    oldSection: '194B',
    newSection: '393(3) Sl. 1',
    description: 'Winnings from lottery / crossword / card games',
    rate: 0.30,
    rateWithoutPAN: 0.30,
    threshold: 10000,
  },
  {
    id: 'r-194BA',
    category: 'resident',
    oldSection: '194BA',
    newSection: '393(3) Sl. 2',
    description: 'Winnings from online games',
    rate: 0.30,
    rateWithoutPAN: 0.30,
    threshold: 0,
  },
  {
    id: 'r-194BB',
    category: 'resident',
    oldSection: '194BB',
    newSection: '393(3) Sl. 3',
    description: 'Winnings from horse races',
    rate: 0.30,
    rateWithoutPAN: 0.30,
    threshold: 10000,
  },
  {
    id: 'r-194C-ind',
    category: 'resident',
    oldSection: '194C',
    newSection: '393(1) Sl. 6(i)(a)',
    description: 'Contractor — individual / HUF',
    rate: 0.01,
    rateWithoutPAN: 0.20,
    threshold: 100000,        // aggregate across FY
    perEntryThreshold: 30000, // OR any single bill ≥ 30K
    thresholdNote: '₹30,000 single bill OR ₹1,00,000 aggregate in FY',
    allowedDeductionTypes: ['prescribed', 'lower', 'transporter'],
  },
  {
    id: 'r-194C-other',
    category: 'resident',
    oldSection: '194C',
    newSection: '393(1) Sl. 6(i)(b)',
    description: 'Contractor — company / firm / other',
    rate: 0.02,
    rateWithoutPAN: 0.20,
    threshold: 100000,
    perEntryThreshold: 30000,
    thresholdNote: '₹30,000 single bill OR ₹1,00,000 aggregate in FY',
    allowedDeductionTypes: ['prescribed', 'lower', 'transporter'],
  },
  {
    id: 'r-194D',
    category: 'resident',
    oldSection: '194D',
    newSection: '393(1) Sl. 1(i)',
    description: 'Insurance commission',
    rate: 0.02,
    rateWithoutPAN: 0.20,
    threshold: 20000,
    fyOverrides: {
      '2023-24': { rate: 0.05, threshold: 15000 },
      '2024-25': { rate: 0.05, threshold: 15000 },
    },
  },
  {
    id: 'r-194DA',
    category: 'resident',
    oldSection: '194DA',
    newSection: '393(1) Sl. 8(i)',
    description: 'Life insurance policy payout (non-exempt portion)',
    rate: 0.02,
    rateWithoutPAN: 0.20,
    threshold: 100000,
    fyOverrides: {
      '2023-24': { rate: 0.05 },
      '2024-25': { rate: 0.05 },
    },
  },
  {
    id: 'r-194EE',
    category: 'resident',
    oldSection: '194EE',
    newSection: '393(3) Sl. 6',
    description: 'NSS deposits withdrawal',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 2500,
  },
  {
    id: 'r-194F',
    category: 'resident',
    oldSection: '194F',
    description: 'Repurchase of MF units by UTI',
    rate: 0.20,
    rateWithoutPAN: 0.20,
    threshold: 0,
  },
  {
    id: 'r-194G',
    category: 'resident',
    oldSection: '194G',
    newSection: '393(3) Sl. 4',
    description: 'Commission on sale of lottery tickets',
    rate: 0.02,
    rateWithoutPAN: 0.20,
    threshold: 20000,
    fyOverrides: {
      '2023-24': { rate: 0.05, threshold: 15000 },
      '2024-25': { rate: 0.05, threshold: 15000 },
    },
  },
  {
    id: 'r-194H',
    category: 'resident',
    oldSection: '194H',
    newSection: '393(1) Sl. 1(ii)',
    description: 'Commission / brokerage',
    rate: 0.02,
    rateWithoutPAN: 0.20,
    threshold: 20000,
    fyOverrides: {
      '2023-24': { rate: 0.05, threshold: 15000 },
      '2024-25': { rate: 0.05, threshold: 15000 },
    },
  },
  {
    id: 'r-194I-a',
    category: 'resident',
    oldSection: '194I(a)',
    newSection: '393(1) Sl. 2(ii).D(a)',
    description: 'Rent — Plant, Machinery, Equipment',
    rate: 0.02,
    rateWithoutPAN: 0.20,
    threshold: 600000,
    thresholdNote: '₹50,000 per month',
    fyOverrides: {
      '2023-24': { threshold: 240000 },
      '2024-25': { threshold: 240000 },
    },
  },
  {
    id: 'r-194I-b',
    category: 'resident',
    oldSection: '194I(b)',
    newSection: '393(1) Sl. 2(ii).D(b)',
    description: 'Rent — Land, Building, Furniture',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 600000,
    thresholdNote: '₹50,000 per month',
    fyOverrides: {
      '2023-24': { threshold: 240000 },
      '2024-25': { threshold: 240000 },
    },
  },
  {
    id: 'r-194IA',
    category: 'resident',
    oldSection: '194IA',
    description: 'Transfer of immovable property',
    rate: 0.01,
    rateWithoutPAN: 0.20,
    threshold: 5000000,
    thresholdNote: 'On consideration ≥ ₹50 lakh',
  },
  {
    id: 'r-194IB',
    category: 'resident',
    oldSection: '194IB',
    description: 'Rent by individual/HUF (not subject to audit)',
    rate: 0.02,
    rateWithoutPAN: 0.20,
    threshold: 600000,
    thresholdNote: 'Rent > ₹50,000 per month',
    fyOverrides: {
      '2023-24': { rate: 0.05 },
      '2024-25': { rate: 0.05 },
    },
  },
  {
    id: 'r-194IC',
    category: 'resident',
    oldSection: '194IC',
    description: 'Payment under Joint Development Agreement',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 0,
  },
  {
    id: 'r-194J-fts',
    category: 'resident',
    oldSection: '194J(a)',
    newSection: '393(1) Sl. 6(iii).D(a)',
    description: 'Fees for Technical Services / Call centre / Royalty (film)',
    rate: 0.02,
    rateWithoutPAN: 0.20,
    threshold: 50000,
    fyOverrides: {
      '2023-24': { threshold: 30000 },
      '2024-25': { threshold: 30000 },
    },
  },
  {
    id: 'r-194J-prof',
    category: 'resident',
    oldSection: '194J(b)',
    newSection: '393(1) Sl. 6(iii).D(b)',
    description: 'Professional fees / Royalty',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 50000,
    fyOverrides: {
      '2023-24': { threshold: 30000 },
      '2024-25': { threshold: 30000 },
    },
  },
  {
    id: 'r-194K',
    category: 'resident',
    oldSection: '194K',
    newSection: '393(1) Sl. 4(i)',
    description: 'Income from Mutual Fund units',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 10000,
    fyOverrides: {
      '2023-24': { threshold: 5000 },
      '2024-25': { threshold: 5000 },
    },
  },
  {
    id: 'r-194LA',
    category: 'resident',
    oldSection: '194LA',
    newSection: '393(1) Sl. 3(iii)',
    description: 'Compensation on compulsory acquisition of immovable property',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 500000,
    fyOverrides: {
      '2023-24': { threshold: 250000 },
      '2024-25': { threshold: 250000 },
    },
  },
  {
    id: 'r-194LBA-a',
    category: 'resident',
    oldSection: '194LBA(1)',
    newSection: '393(1) Sl. 4(ii)',
    description: 'Business trust — interest / dividend to resident unit holder',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 0,
  },
  {
    id: 'r-194LBB',
    category: 'resident',
    oldSection: '194LBB',
    newSection: '393(1) Sl. 4(iii)',
    description: 'Investment fund income to resident unit holder',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 0,
  },
  {
    id: 'r-194LBC',
    category: 'resident',
    oldSection: '194LBC',
    newSection: '393(1) Sl. 4(iv)',
    description: 'Securitization trust income to resident investor',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 0,
    fyOverrides: {
      '2023-24': { rate: 0.25 },
      '2024-25': { rate: 0.25 },
    },
  },
  {
    id: 'r-194M',
    category: 'resident',
    oldSection: '194M',
    description: 'Contract / professional / commission by individual (not liable to audit)',
    rate: 0.02,
    rateWithoutPAN: 0.20,
    threshold: 5000000,
    fyOverrides: {
      '2023-24': { rate: 0.05 },
      '2024-25': { rate: 0.05 },
    },
  },
  {
    id: 'r-194N-coop',
    category: 'resident',
    oldSection: '194N',
    newSection: '393(3) Sl. 5.D(a)',
    description: 'Cash withdrawal — recipient is a co-operative society',
    rate: 0.02,
    rateWithoutPAN: 0.20,
    threshold: 30000000,
    thresholdNote: '> ₹3 crore per FY',
  },
  {
    id: 'r-194N-other',
    category: 'resident',
    oldSection: '194N',
    newSection: '393(3) Sl. 5.D(b)',
    description: 'Cash withdrawal — recipient other than co-operative',
    rate: 0.02,
    rateWithoutPAN: 0.20,
    threshold: 10000000,
    thresholdNote: '> ₹1 crore per FY',
  },
  {
    id: 'r-194O',
    category: 'resident',
    oldSection: '194O',
    newSection: '393(1) Sl. 8(v)',
    description: 'Payment by e-commerce operator to participant',
    rate: 0.001,
    rateWithoutPAN: 0.05,
    threshold: 500000,
    fyOverrides: {
      '2023-24': { rate: 0.01 },
    },
  },
  {
    id: 'r-194P',
    category: 'resident',
    oldSection: '194P',
    newSection: '393(1) Sl. 8(iii)',
    description: 'TDS on senior citizen (age ≥ 75) pension + interest',
    rate: 0,
    rateWithoutPAN: 0.20,
    threshold: 0,
    thresholdNote: 'As per slab rates',
  },
  {
    id: 'r-194Q',
    category: 'resident',
    oldSection: '194Q',
    newSection: '393(1) Sl. 8(ii)',
    description: 'Purchase of goods',
    rate: 0.001,
    rateWithoutPAN: 0.05,
    threshold: 5000000,
  },
  {
    id: 'r-194R',
    category: 'resident',
    oldSection: '194R',
    newSection: '393(1) Sl. 8(iv)',
    description: 'Benefits or perquisites arising from business / profession',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 20000,
    fyOverrides: {
      '2023-24': { threshold: 20000 },
      '2024-25': { threshold: 20000 },
    },
  },
  {
    id: 'r-194S',
    category: 'resident',
    oldSection: '194S',
    newSection: '393(1) Sl. 8(vi)',
    description: 'Transfer of virtual digital asset (crypto/NFT)',
    rate: 0.01,
    rateWithoutPAN: 0.20,
    threshold: 10000,
    thresholdNote: '₹50,000 for specified persons',
  },
  {
    id: 'r-194T',
    category: 'resident',
    oldSection: '194T',
    newSection: '393(3) Sl. 7',
    description: 'Partner remuneration / interest from firm',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 20000,
  },
];

// ──────────────────────────────────────────────────────────────────────────
// NON-RESIDENT sections (Form 27Q)
// ──────────────────────────────────────────────────────────────────────────

const NONRESIDENT_SECTIONS: TdsSection[] = [
  {
    id: 'nr-194E',
    category: 'nonResident',
    oldSection: '194E',
    description: 'Payment to non-resident sportsmen / sports association',
    rate: 0.20,
    rateWithoutPAN: 0.20,
    threshold: 0,
  },
  {
    id: 'nr-194LB',
    category: 'nonResident',
    oldSection: '194LB',
    description: 'Interest from infrastructure debt fund to NR',
    rate: 0.05,
    rateWithoutPAN: 0.20,
    threshold: 0,
  },
  {
    id: 'nr-194LBA-2',
    category: 'nonResident',
    oldSection: '194LBA(2)',
    description: 'Business trust interest/dividend to non-resident unit holder',
    rate: 0.05,
    rateWithoutPAN: 0.20,
    threshold: 0,
  },
  {
    id: 'nr-194LBA-3',
    category: 'nonResident',
    oldSection: '194LBA(3)',
    description: 'Business trust rental income to non-resident unit holder',
    rate: 0.30,
    rateWithoutPAN: 0.30,
    threshold: 0,
  },
  {
    id: 'nr-194LBB',
    category: 'nonResident',
    oldSection: '194LBB',
    description: 'Investment fund income to non-resident unit holder',
    rate: 0.30,
    rateWithoutPAN: 0.30,
    threshold: 0,
    thresholdNote: 'Rates per DTAA may apply',
  },
  {
    id: 'nr-194LBC',
    category: 'nonResident',
    oldSection: '194LBC',
    description: 'Securitization trust income to non-resident investor',
    rate: 0.30,
    rateWithoutPAN: 0.30,
    threshold: 0,
  },
  {
    id: 'nr-194LC',
    category: 'nonResident',
    oldSection: '194LC',
    description: 'Interest on external commercial borrowing (ECB)',
    rate: 0.05,
    rateWithoutPAN: 0.20,
    threshold: 0,
  },
  {
    id: 'nr-194LD',
    category: 'nonResident',
    oldSection: '194LD',
    description: 'Interest on government / rupee-denominated bonds',
    rate: 0.05,
    rateWithoutPAN: 0.20,
    threshold: 0,
  },
  {
    id: 'nr-195-int',
    category: 'nonResident',
    oldSection: '195',
    description: 'Other interest payments to NR (non-treaty)',
    rate: 0.20,
    rateWithoutPAN: 0.20,
    threshold: 0,
    thresholdNote: 'Rates per DTAA may apply',
  },
  {
    id: 'nr-195-ltcg',
    category: 'nonResident',
    oldSection: '195',
    description: 'Long-term capital gains to NR',
    rate: 0.125,
    rateWithoutPAN: 0.20,
    threshold: 0,
    fyOverrides: {
      '2023-24': { rate: 0.20 },
      '2024-25': { rate: 0.20 },
    },
  },
  {
    id: 'nr-195-other',
    category: 'nonResident',
    oldSection: '195',
    description: 'Other income chargeable to NR',
    rate: 0.30,
    rateWithoutPAN: 0.30,
    threshold: 0,
  },
  {
    id: 'nr-196A',
    category: 'nonResident',
    oldSection: '196A',
    description: 'Income from MF units to NR',
    rate: 0.20,
    rateWithoutPAN: 0.20,
    threshold: 0,
  },
  {
    id: 'nr-196B',
    category: 'nonResident',
    oldSection: '196B',
    description: 'Income from offshore fund units',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 0,
  },
  {
    id: 'nr-196C',
    category: 'nonResident',
    oldSection: '196C',
    description: 'Income from FCCB / GDR',
    rate: 0.10,
    rateWithoutPAN: 0.20,
    threshold: 0,
  },
  {
    id: 'nr-196D',
    category: 'nonResident',
    oldSection: '196D',
    description: 'Income of FII from securities (other than interest under 194LD)',
    rate: 0.20,
    rateWithoutPAN: 0.20,
    threshold: 0,
  },
];

// ──────────────────────────────────────────────────────────────────────────
// TCS sections (Form 27EQ — Section 206C & 206CC)
// ──────────────────────────────────────────────────────────────────────────

const TCS_SECTIONS: TdsSection[] = [
  {
    id: 'tcs-206C-liquor',
    category: 'tcs',
    oldSection: '206C(1)',
    newSection: '394(1) Sl. 1',
    description: 'Sale of alcoholic liquor for human consumption',
    rate: 0.01,
    rateWithoutPAN: 0.05,
    threshold: 0,
  },
  {
    id: 'tcs-206C-tendu',
    category: 'tcs',
    oldSection: '206C(1)',
    newSection: '394(1) Sl. 2',
    description: 'Sale of tendu leaves',
    rate: 0.05,
    rateWithoutPAN: 0.10,
    threshold: 0,
  },
  {
    id: 'tcs-206C-timber-lease',
    category: 'tcs',
    oldSection: '206C(1)',
    newSection: '394(1) Sl. 3',
    description: 'Sale of timber under forest lease',
    rate: 0.025,
    rateWithoutPAN: 0.05,
    threshold: 0,
    fyOverrides: {
      '2023-24': { rate: 0.025 },
      '2024-25': { rate: 0.025 },
    },
  },
  {
    id: 'tcs-206C-timber-other',
    category: 'tcs',
    oldSection: '206C(1)',
    newSection: '394(1) Sl. 3',
    description: 'Sale of timber other than forest lease',
    rate: 0.025,
    rateWithoutPAN: 0.05,
    threshold: 0,
  },
  {
    id: 'tcs-206C-forest',
    category: 'tcs',
    oldSection: '206C(1)',
    newSection: '394(1) Sl. 3',
    description: 'Sale of other forest produce',
    rate: 0.025,
    rateWithoutPAN: 0.05,
    threshold: 0,
  },
  {
    id: 'tcs-206C-scrap',
    category: 'tcs',
    oldSection: '206C(1)',
    newSection: '394(1) Sl. 4',
    description: 'Sale of scrap',
    rate: 0.01,
    rateWithoutPAN: 0.05,
    threshold: 0,
  },
  {
    id: 'tcs-206C-minerals',
    category: 'tcs',
    oldSection: '206C(1)',
    newSection: '394(1) Sl. 5',
    description: 'Sale of minerals (coal / lignite / iron ore)',
    rate: 0.01,
    rateWithoutPAN: 0.05,
    threshold: 0,
  },
  {
    id: 'tcs-206C-1C-toll',
    category: 'tcs',
    oldSection: '206C(1C)',
    newSection: '394(1) Sl. 9',
    description: 'Lease of toll plaza',
    rate: 0.02,
    rateWithoutPAN: 0.05,
    threshold: 0,
  },
  {
    id: 'tcs-206C-1C-parking',
    category: 'tcs',
    oldSection: '206C(1C)',
    newSection: '394(1) Sl. 9',
    description: 'Lease of parking lot',
    rate: 0.02,
    rateWithoutPAN: 0.05,
    threshold: 0,
  },
  {
    id: 'tcs-206C-1C-mine',
    category: 'tcs',
    oldSection: '206C(1C)',
    newSection: '394(1) Sl. 9',
    description: 'Lease of mine / quarry (excl. petroleum / natural gas)',
    rate: 0.02,
    rateWithoutPAN: 0.05,
    threshold: 0,
  },
  {
    id: 'tcs-206C-1F-motor',
    category: 'tcs',
    oldSection: '206C(1F)',
    newSection: '394(1) Sl. 6(a)',
    description: 'Sale of motor vehicle > ₹10 lakh',
    rate: 0.01,
    rateWithoutPAN: 0.05,
    threshold: 1000000,
  },
  {
    id: 'tcs-206C-1F-luxury',
    category: 'tcs',
    oldSection: '206C(1F)',
    newSection: '394(1) Sl. 6(b)',
    description: 'Sale of luxury goods > ₹10 lakh (watch / art / yacht / handbag etc.)',
    rate: 0.01,
    rateWithoutPAN: 0.05,
    threshold: 1000000,
    thresholdNote: 'Applicable from 22 Apr 2025',
  },
  {
    id: 'tcs-206C-1G-lrs-edu',
    category: 'tcs',
    oldSection: '206C(1G)',
    newSection: '394(1) Sl. 7(a)',
    description: 'LRS — education / medical treatment (> ₹10 lakh)',
    rate: 0.05,
    rateWithoutPAN: 0.10,
    threshold: 1000000,
    fyOverrides: {
      '2023-24': { threshold: 700000 },
    },
  },
  {
    id: 'tcs-206C-1G-lrs-other',
    category: 'tcs',
    oldSection: '206C(1G)',
    newSection: '394(1) Sl. 7(b)',
    description: 'LRS — other purposes (> ₹10 lakh)',
    rate: 0.20,
    rateWithoutPAN: 0.20,
    threshold: 1000000,
    fyOverrides: {
      '2023-24': { rate: 0.05, threshold: 700000 },
    },
  },
  {
    id: 'tcs-206C-1G-tour',
    category: 'tcs',
    oldSection: '206C(1G)',
    newSection: '394(1) Sl. 8',
    description: 'Overseas tour programme package',
    rate: 0.05,
    rateWithoutPAN: 0.10,
    threshold: 0,
    thresholdNote: '5% up to ₹10L, 20% above (FY 2025-26+)',
    fyOverrides: {
      '2023-24': { rate: 0.05 },
    },
  },
  {
    id: 'tcs-206C-1H-goods',
    category: 'tcs',
    oldSection: '206C(1H)',
    description: 'Sale of goods > ₹50 lakh (turnover > ₹10 Cr)',
    rate: 0.001,
    rateWithoutPAN: 0.01,
    threshold: 5000000,
    thresholdNote: 'Omitted from 1 Apr 2025 (replaced by 194Q)',
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Combined + lookup
// ──────────────────────────────────────────────────────────────────────────

export const TDS_SECTIONS: TdsSection[] = [
  ...RESIDENT_SECTIONS,
  ...NONRESIDENT_SECTIONS,
  ...TCS_SECTIONS,
];

export function getTdsSectionsForCategory(category: TdsCategory): TdsSection[] {
  return TDS_SECTIONS.filter(s => s.category === category);
}

export interface ResolvedTdsRates {
  rate: number;
  rateWithoutPAN: number;
  threshold: number;
  perEntryThreshold?: number;
}

/** Resolve effective rate + threshold for a section in a given FY. */
export function resolveTdsRates(section: TdsSection, fy: TdsFY): ResolvedTdsRates {
  const override = section.fyOverrides?.[fy];
  return {
    rate: override?.rate ?? section.rate,
    rateWithoutPAN: override?.rateWithoutPAN ?? section.rateWithoutPAN,
    threshold: override?.threshold ?? section.threshold,
    perEntryThreshold: override?.perEntryThreshold ?? section.perEntryThreshold,
  };
}

/** Allowed deduction types for a section — falls back to default list. */
export function getAllowedDeductionTypes(section: TdsSection): DeductionType[] {
  if (section.allowedDeductionTypes) return section.allowedDeductionTypes;
  if (NO_NIL_DEDUCTION_IDS.has(section.id)) return ['prescribed', 'lower'];
  return DEFAULT_ALLOWED_DEDUCTION_TYPES;
}

// ──────────────────────────────────────────────────────────────────────────
// Calculation
// ──────────────────────────────────────────────────────────────────────────

export interface TdsInput {
  sectionId: string;
  fy: TdsFY;
  amount: number;                  // current payment
  hasPAN: boolean;
  deductionType?: DeductionType;   // defaults to 'prescribed'
  /** Prior payments to the same deductee in the same FY (for 194C aggregate trigger). */
  aggregatePaid?: number;
  /** Custom lower rate (decimal) when deductionType='lower', e.g. 0.02 = 2% */
  lowerRate?: number;
  /** Relevant for 194 dividend — threshold only applies to individuals */
  payeeStatus?: PayeeStatus;
}

export type TdsSkipReason = 'belowThreshold' | 'notDeducted' | 'transporter';

export interface TdsResult {
  section: TdsSection;
  fy: TdsFY;
  amount: number;
  tdsRate: number;
  tdsAmount: number;
  netPayment: number;
  belowThreshold: boolean;
  effectiveThreshold: number;       // aggregate threshold that applied
  effectivePerEntryThreshold?: number;
  skipReason?: TdsSkipReason;
  triggeredBy?: 'perEntry' | 'aggregate' | 'none';
  aggregateTotal?: number;          // amount + aggregatePaid, if provided
}

export function calculateTDS(input: TdsInput): TdsResult {
  const {
    sectionId, fy, amount, hasPAN,
    deductionType = 'prescribed',
    aggregatePaid = 0,
    lowerRate,
    payeeStatus = 'individual',
  } = input;

  const section = TDS_SECTIONS.find(s => s.id === sectionId);
  if (!section) {
    throw new Error(`Unknown TDS section: ${sectionId}`);
  }

  const resolved = resolveTdsRates(section, fy);
  const baseResult = {
    section,
    fy,
    amount,
    effectiveThreshold: resolved.threshold,
    effectivePerEntryThreshold: resolved.perEntryThreshold,
  };

  // ── 1. Explicit non-deduction paths ──
  if (deductionType === 'notDeducted') {
    return {
      ...baseResult,
      tdsRate: 0,
      tdsAmount: 0,
      netPayment: amount,
      belowThreshold: false,
      skipReason: 'notDeducted',
      triggeredBy: 'none',
    };
  }

  if (deductionType === 'transporter') {
    return {
      ...baseResult,
      tdsRate: 0,
      tdsAmount: 0,
      netPayment: amount,
      belowThreshold: false,
      skipReason: 'transporter',
      triggeredBy: 'none',
    };
  }

  // ── 2. Threshold resolution ──
  // For 194 dividend: threshold only applies if payee is an Individual/HUF.
  const effectiveAggThreshold = section.payeeStatusAffectsThreshold && payeeStatus === 'other'
    ? 0
    : resolved.threshold;

  const aggregateTotal = amount + Math.max(0, aggregatePaid);

  // Determine whether TDS is triggered.
  // Rule:
  //   • perEntry set  → trigger if amount ≥ perEntry OR aggregateTotal ≥ aggThreshold
  //   • perEntry unset → trigger if aggregateTotal ≥ aggThreshold
  let triggered = false;
  let triggeredBy: 'perEntry' | 'aggregate' | 'none' = 'none';

  if (resolved.perEntryThreshold !== undefined && resolved.perEntryThreshold > 0) {
    if (amount >= resolved.perEntryThreshold) {
      triggered = true;
      triggeredBy = 'perEntry';
    } else if (effectiveAggThreshold > 0 && aggregateTotal >= effectiveAggThreshold) {
      triggered = true;
      triggeredBy = 'aggregate';
    } else if (effectiveAggThreshold === 0) {
      // No aggregate cap either → any payment below per-entry is safe
      triggered = false;
    }
  } else {
    if (effectiveAggThreshold === 0 || aggregateTotal >= effectiveAggThreshold) {
      triggered = true;
      triggeredBy = effectiveAggThreshold === 0 ? 'none' : 'aggregate';
    }
  }

  if (!triggered) {
    return {
      ...baseResult,
      tdsRate: 0,
      tdsAmount: 0,
      netPayment: amount,
      belowThreshold: true,
      skipReason: 'belowThreshold',
      triggeredBy: 'none',
      aggregateTotal,
    };
  }

  // ── 3. Rate selection ──
  let tdsRate: number;
  if (deductionType === 'lower') {
    // Lower-rate certificate u/s 197 — user supplies the rate
    tdsRate = lowerRate !== undefined && lowerRate >= 0 ? lowerRate : resolved.rate;
  } else {
    // Prescribed
    tdsRate = hasPAN ? resolved.rate : resolved.rateWithoutPAN;
  }

  const tdsAmount = amount * tdsRate;
  const netPayment = amount - tdsAmount;

  return {
    ...baseResult,
    tdsRate,
    tdsAmount,
    netPayment,
    belowThreshold: false,
    triggeredBy,
    aggregateTotal,
  };
}
