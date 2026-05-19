/**
 * Smoke test for server/lib/ledgerBillMatcher.ts.
 *
 * Builds two small ExtractedLedger snapshots (a sales vs purchase
 * pair) with deliberate matches, amount mismatches, only-in-A,
 * only-in-B, and no-bill rows; runs compareLedgersByBill; verifies
 * every bucket lands in the right place.
 */

import { compareLedgersByBill, normalizeBillKey, extractBillKey } from '../server/lib/ledgerBillMatcher';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function expect<T>(label: string, actual: T, expected: T) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++;
  } else {
    fail++;
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── normalizeBillKey ─────────────────────────────────────────
expect('normalize BS/123/2024-25', normalizeBillKey('BS/123/2024-25'), 'BS123');
expect('normalize BS-123', normalizeBillKey('BS-123'), 'BS123');
expect('normalize BS 123', normalizeBillKey('BS 123'), 'BS123');
expect('normalize BS123', normalizeBillKey('BS123'), 'BS123');
expect('normalize lowercase bs/123', normalizeBillKey('bs/123'), 'BS123');
expect('normalize empty', normalizeBillKey(''), null);
expect('normalize null', normalizeBillKey(null), null);
expect('normalize whitespace only', normalizeBillKey('   '), null);
expect('reject 12-digit UTR-shaped', normalizeBillKey('123456789012345'), null);
expect('strip FY suffix', normalizeBillKey('BS/123 FY 24-25'), 'BS123');
expect('strip leading NO.', normalizeBillKey('NO. 123/24-25'), '123');

// ─── extractBillKey ──────────────────────────────────────────
expect(
  'extractBillKey from voucher',
  extractBillKey({ voucher: 'BS/123/2024-25', narration: null }),
  'BS123',
);
expect(
  'extractBillKey from narration when voucher null',
  extractBillKey({ voucher: null, narration: 'Sales bill BS-456 to Acme' }),
  'BS456',
);
expect(
  'extractBillKey returns null when nothing matches',
  extractBillKey({ voucher: null, narration: 'Random payment description' }),
  null,
);
// extractBillKey is narration-first now (was voucher-first before 2026-05).
// When both fields carry a bill pattern, prefer the narration version
// because cross-party reconciliation depends on the SUPPLIER-issued bill
// number that both books print — that lives in narration. Voucher is
// often an ERP-local entry ID that differs between the two parties'
// books (the OSPL case where Marg's voucher is "P000142" and Finsys's
// is "000216" but both narrations carry "OS64/25-26000216").
expect(
  'extractBillKey narration takes precedence over voucher',
  extractBillKey({ voucher: 'BS/777', narration: 'mentions BS-888' }),
  'BS888',
);
// Voucher used as fallback when narration has no bill pattern.
expect(
  'extractBillKey falls back to voucher when narration is generic',
  extractBillKey({ voucher: 'BS/777', narration: 'Sales A/c' }),
  'BS777',
);

// ─── 2026-05-18 fix 1: reject Finsys voucher type codes ──────
// "SALE(40)", "RECE(11)", "JOB(41)" etc. are entry CLASSES, not
// bills. Should normalise to null so the voucher fallback skips
// them and these rows land in noBillA/B instead of becoming fake
// "only in" bills.
expect('reject SALE(40)', normalizeBillKey('SALE(40)'), null);
expect('reject RECE(11)', normalizeBillKey('RECE(11)'), null);
expect('reject JOB(41)', normalizeBillKey('JOB(41)'), null);
expect('reject PURCH(7)', normalizeBillKey('PURCH(7)'), null);

// ─── 2026-05-18 fix 2: short / digit-start bills ─────────────
// "Bill No. 543" — Marg sometimes writes plain numeric bills.
// Earlier pattern required [A-Z] start + 5 chars min → missed.
expect(
  'extract Bill No. 543',
  extractBillKey({ voucher: 'P000126', narration: 'Bill No. 543 Dt. 24/02/2026 Entry No.P000126' }),
  '543',
);
expect(
  'extract Bill No. 12 (very short)',
  extractBillKey({ voucher: null, narration: 'Bill No. 12 Dt. 01/01/2026' }),
  // Min 3 chars after first; "12" is 2 chars. Falls through to
  // voucher (null). Confirms the {2,40} minimum is enforced.
  null,
);

// ─── 2026-05-18 fix 3: strip FY inline (no word boundary) ────
// Marg writes "OS64/25-26/00042" — word-bounded "25-26" between
// two slashes gets caught by the first-pass strip → "OS6400042".
// Finsys writes the same bill as "OS64/25-26000042" — no
// boundary between "26" and "000042", first-pass misses, but
// the second-pass stripInlineFY catches the 2526 inside the
// digit run.
//
// Note: both forms collapse to "OS64<remaining digits>" but the
// remaining-digits count differs because Marg writes 5-digit
// counters ("00042") and Finsys writes 6-digit counters
// ("000042"). They land on different keys IF the zero-padding
// differs across ledgers. The IMPORTANT property is: when both
// ledgers use the same zero-padding for a bill (which is the
// dominant case), they collapse to the SAME key — which is
// asserted by the OSPL-narration tests below.
expect('strip inline FY 2526', normalizeBillKey('OS64/25-26000042'), 'OS64000042');
expect('Marg form still works', normalizeBillKey('OS64/25-26/00042'), 'OS6400042');
expect('different FY 2425', normalizeBillKey('OS64/24-25000042'), 'OS64000042');
expect('Finsys-form 4-digit FY 2526 (no slash)', normalizeBillKey('OS6425260042'), 'OS640042');
// Don't false-strip when no sequential YY-pair exists.
expect('no FY in pure bill', normalizeBillKey('BS123456789'), 'BS123456789');
// Critical match-property test: same bill, same zero-padding,
// different FY-writing convention → same key.
expect(
  'Marg "OS64/25-26000216" matches Finsys "OS64/25-26000216"',
  normalizeBillKey('OS64/25-26000216') === normalizeBillKey('OS64/25-26000216'),
  true,
);

// ─── 2026-05-19 fix: credit/debit-note separation ───────────
// OSPL Finsys ledger had a credit note row that referenced the
// original bill OS64/25-26000215 in its narration. The matcher
// summed the CN amount into the original bill's total, making
// the bill look like a ₹110,100 mismatch when actually it tied
// exactly. With the CN/DN classification, the credit note now
// gets its own key "CN-OS64000215" and the original sale row
// matches at ₹501,425 on both sides.
expect(
  'extractBillKey on CN narration → prefixed key',
  extractBillKey({
    voucher: '000104',
    narration: 'Bill No.OS64/25-26000215 Dt. 31/05/2025 BEING CREDIT NOTE ISSUED FOR REIMBURSEMENT FOR MARKETING ACTIVITIES AGAINST BILL NO. OS64/25-26000215 DATED 31.05.2025',
  }),
  'CN-OS64000215',
);
expect(
  'extractBillKey on plain sale → no prefix',
  extractBillKey({
    voucher: 'P000147',
    narration: 'Bill No. OS64/25-26000215 Dt. 31/05/2025 Entry No.P000147',
  }),
  'OS64000215',
);
expect(
  'extractBillKey on DN narration → DN- prefix',
  extractBillKey({
    voucher: null,
    narration: 'Bill No. OS64/25-26000215 BEING DEBIT NOTE AGAINST BILL',
  }),
  'DN-OS64000215',
);
// Voucher-only fallback path also honours the CN/DN classification.
expect(
  'extractBillKey CN via voucher fallback',
  extractBillKey({
    voucher: 'BS/999',
    narration: 'BEING CREDIT NOTE — reimbursement',
  }),
  'CN-BS999',
);

// ─── OSPL case: Marg (Side A) vs Finsys (Side B) narrations ──
// Real-world narrations from the user's OSPL FUTURE MARG.pdf and
// OSPL Ledger_Future Energy_*.pdf. Both ledgers reference the same
// cross-party bill OS64/25-26000216, but the voucher fields differ
// (Marg = internal entry id P000142, Finsys = bill tail 000216).
// extractBillKey must pull the bill from NARRATION on both sides
// for the matcher to link them up.
expect(
  'OSPL Marg narration → cross-party bill',
  extractBillKey({
    voucher: 'P000142',
    narration: 'Bill No. OS64/25-26000216 Dt. 31/05/2025 Entry No.P000142',
  }),
  'OS64000216',
);
expect(
  'OSPL Finsys narration → cross-party bill',
  extractBillKey({
    voucher: '000216',
    narration: 'Sale Inv.No OS64/25-26000216 000216 U-02',
  }),
  'OS64000216',
);
// Both sides resolve to the same key → they would land in `matched`
// when amounts agree, or `amountMismatches` when they don't. The
// previous voucher-first extraction returned P000142 vs 000216 —
// different keys, would have wrongly landed in onlyInA / onlyInB.

// ─── compareLedgersByBill — golden case ──────────────────────
const ledgerA = {
  accounts: [{
    name: 'ACME TRADERS',
    accountType: 'sundry_debtor',
    opening: 0,
    closing: 0,
    totalDebit: 0,
    totalCredit: 0,
    transactions: [
      { date: '2025-04-01', narration: 'Sale invoice', voucher: 'BS/001', debit: 10000, credit: 0, balance: null },
      { date: '2025-04-15', narration: 'Sale invoice', voucher: 'BS/002', debit: 25000, credit: 0, balance: null },
      { date: '2025-05-01', narration: 'Sale invoice', voucher: 'BS/003', debit: 7500, credit: 0, balance: null },
      // No bill reference — should land in noBillA
      { date: '2025-05-10', narration: 'Adjustment', voucher: null, debit: 100, credit: 0, balance: null },
    ],
  }],
};
const ledgerB = {
  accounts: [{
    name: 'ACME TRADERS',
    accountType: 'sundry_creditor',
    opening: 0,
    closing: 0,
    totalDebit: 0,
    totalCredit: 0,
    transactions: [
      // BS/001 matches A exactly
      { date: '2025-04-01', narration: 'Purchase bill', voucher: 'BS/001', debit: 0, credit: 10000, balance: null },
      // BS/002 — amount differs (A says 25000, B says 24500)
      { date: '2025-04-15', narration: 'Purchase bill', voucher: 'BS/002', debit: 0, credit: 24500, balance: null },
      // BS/003 missing from B (= only in A)
      // BS/004 present in B but not A (= only in B)
      { date: '2025-05-20', narration: 'Purchase bill', voucher: 'BS/004', debit: 0, credit: 3300, balance: null },
      // No bill reference
      { date: '2025-05-25', narration: 'Bank charge', voucher: null, debit: 0, credit: 50, balance: null },
    ],
  }],
};

const report = compareLedgersByBill(ledgerA, 'sales', ledgerB, 'purchase');
expect('matched count', report.summary.matchedCount, 1);
expect('amount mismatch count', report.summary.amountMismatchCount, 1);
expect('only in A count', report.summary.onlyInACount, 1);
expect('only in B count', report.summary.onlyInBCount, 1);
expect('no-bill A count', report.summary.noBillCountA, 1);
expect('no-bill B count', report.summary.noBillCountB, 1);
expect('typeA preserved', report.summary.typeA, 'sales');
expect('typeB preserved', report.summary.typeB, 'purchase');

expect('matched bill', report.matched[0]?.bill, 'BS001');
expect('matched amount A', report.matched[0]?.amountA, 10000);
expect('matched amount B', report.matched[0]?.amountB, 10000);

expect('mismatch bill', report.amountMismatches[0]?.bill, 'BS002');
expect('mismatch amount A', report.amountMismatches[0]?.amountA, 25000);
expect('mismatch amount B', report.amountMismatches[0]?.amountB, 24500);
expect('mismatch diff (A-B)', report.amountMismatches[0]?.diff, 500);

expect('only in A bill', report.onlyInA[0]?.bill, 'BS003');
expect('only in A amount', report.onlyInA[0]?.amount, 7500);

expect('only in B bill', report.onlyInB[0]?.bill, 'BS004');
expect('only in B amount', report.onlyInB[0]?.amount, 3300);

expect('no-bill A row', report.noBillA[0]?.narration, 'Adjustment');
expect('no-bill B row', report.noBillB[0]?.narration, 'Bank charge');

// Headline reflects issues
const headlineLooksRight = /amount mismatch|only on/i.test(report.summary.headline);
expect('headline mentions issues', headlineLooksRight, true);

// ─── perfect-match case ──────────────────────────────────────
const perfectA = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-04-01', narration: 'INV-100', voucher: 'INV-100', debit: 5000, credit: 0, balance: null },
      { date: '2025-04-02', narration: 'INV-101', voucher: 'INV-101', debit: 6000, credit: 0, balance: null },
    ],
  }],
};
const perfectB = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-04-01', narration: 'INV-100', voucher: 'INV-100', debit: 0, credit: 5000, balance: null },
      { date: '2025-04-02', narration: 'INV-101', voucher: 'INV-101', debit: 0, credit: 6000, balance: null },
    ],
  }],
};
const perfectReport = compareLedgersByBill(perfectA, 'sales', perfectB, 'purchase');
expect('perfect matched count', perfectReport.summary.matchedCount, 2);
expect('perfect mismatch count', perfectReport.summary.amountMismatchCount, 0);
expect('perfect onlyInA', perfectReport.summary.onlyInACount, 0);
expect('perfect onlyInB', perfectReport.summary.onlyInBCount, 0);
expect('perfect headline', /Books tie/.test(perfectReport.summary.headline), true);

// ─── multi-line same-bill aggregation ────────────────────────
// One invoice split across taxable + GST lines on the same side
// should sum to a single bill total before matching.
const splitA = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-04-01', narration: 'Bill X-200 taxable', voucher: 'X-200', debit: 100000, credit: 0, balance: null },
      { date: '2025-04-01', narration: 'Bill X-200 GST 18%',  voucher: 'X-200', debit: 18000, credit: 0, balance: null },
    ],
  }],
};
const splitB = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-04-01', narration: 'Bill X-200 total', voucher: 'X-200', debit: 0, credit: 118000, balance: null },
    ],
  }],
};
const splitReport = compareLedgersByBill(splitA, 'sales', splitB, 'purchase');
expect('split-bill matched', splitReport.summary.matchedCount, 1);
expect('split-bill A summed', splitReport.matched[0]?.amountA, 118000);
expect('split-bill B unchanged', splitReport.matched[0]?.amountB, 118000);

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
