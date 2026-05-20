/**
 * Smoke test for server/lib/ledgerBillMatcher.ts.
 *
 * Builds two small ExtractedLedger snapshots (a sales vs purchase
 * pair) with deliberate matches, amount mismatches, only-in-A,
 * only-in-B, and no-bill rows; runs compareLedgersByBill; verifies
 * every bucket lands in the right place.
 */

import { compareLedgersByBill, normalizeBillKey, extractBillKey, extractBankRef } from '../server/lib/ledgerBillMatcher';

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

// ─── 2026-05-20 payment matcher: extractBankRef ──────────────
// Bank reference extraction from narrations — used to surface
// cheque / UTR / NEFT / IMPS / RTGS numbers on the payment-
// matches table. Informational only (not used for matching).
expect('extractBankRef null on null', extractBankRef(null), null);
expect('extractBankRef null on empty', extractBankRef(''), null);
expect('extractBankRef cheque (chq)', extractBankRef('Chq No. 123456 deposit'), '123456');
expect('extractBankRef cheque alt', extractBankRef('Cheque #987654 dt 01/04/2025'), '987654');
expect('extractBankRef NEFT', extractBankRef('NEFT-N123456789012-ACME'), 'N123456789012');
expect('extractBankRef IMPS', extractBankRef('IMPS/501234567890/PAYEE'), '501234567890');
expect('extractBankRef RTGS', extractBankRef('RTGS UTR HDFCR52025040112345678'), 'HDFCR52025040112345678');
expect('extractBankRef UTR keyword', extractBankRef('Payment received UTR: ABCD123456789012'), 'ABCD123456789012');
expect('extractBankRef plain narration', extractBankRef('Cash deposit at branch'), null);

// ─── 2026-05-20 payment matcher: date+amount pairing ─────────
// When neither side has a bill ref but the date and amount agree,
// the secondary matcher should pair them up. Each side's leftover
// goes into noBillA/B; matched pairs surface in paymentMatches.
const payA = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      // Payment from bank — no bill ref, will pair with B by date+amount.
      // Avoid the word "receipt" because RECEIPT is one of the bill
      // narration anchors (NARRATION_BILL_PATTERNS) — using it would
      // make extractBillKey treat the row as bill-bearing.
      { date: '2025-06-10', narration: 'BANK OF BARODA Chq.No.234567', voucher: null, debit: 0, credit: 50000, balance: null },
      // Leftover — no counterpart in B on this date/amount
      { date: '2025-06-12', narration: 'Adjustment', voucher: null, debit: 100, credit: 0, balance: null },
    ],
  }],
};
const payB = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      // Counterpart to the A receipt
      { date: '2025-06-10', narration: 'NEFT-N123456789012 from acme', voucher: null, debit: 50000, credit: 0, balance: null },
      // Leftover
      { date: '2025-06-15', narration: 'Bank charge', voucher: null, debit: 50, credit: 0, balance: null },
    ],
  }],
};
const payReport = compareLedgersByBill(payA, 'sales', payB, 'purchase');
expect('payment matched count', payReport.summary.paymentMatchedCount, 1);
expect('payment matches length', payReport.paymentMatches.length, 1);
expect('payment match date', payReport.paymentMatches[0]?.date, '2025-06-10');
expect('payment match amountA', payReport.paymentMatches[0]?.amountA, 50000);
expect('payment match amountB', payReport.paymentMatches[0]?.amountB, 50000);
expect('payment match diff (exact)', payReport.paymentMatches[0]?.diff, 0);
expect('payment match bankRefA', payReport.paymentMatches[0]?.bankRefA, '234567');
expect('payment match bankRefB', payReport.paymentMatches[0]?.bankRefB, 'N123456789012');
// Leftover no-bill rows after pairing
expect('no-bill A after pairing', payReport.noBillA.length, 1);
expect('no-bill B after pairing', payReport.noBillB.length, 1);
expect('headline mentions payments', /payment/i.test(payReport.summary.headline), true);

// ─── payment matcher: amount alone is not enough ─────────────
// If amounts agree but dates differ, do NOT pair — could be two
// unrelated payments of the same value.
const mismatchDateA = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-06-10', narration: 'Receipt', voucher: null, debit: 0, credit: 50000, balance: null },
    ],
  }],
};
const mismatchDateB = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-06-11', narration: 'Receipt', voucher: null, debit: 50000, credit: 0, balance: null },
    ],
  }],
};
const mismatchDateReport = compareLedgersByBill(mismatchDateA, 'sales', mismatchDateB, 'purchase');
expect('no pairing on date mismatch', mismatchDateReport.summary.paymentMatchedCount, 0);
expect('both go to no-bill', mismatchDateReport.noBillA.length + mismatchDateReport.noBillB.length, 2);

// ─── 2026-05-20 payment matcher: ±₹1 rounding tolerance ─────
// Real OSPL case: Marg books CRN-0232-00656 at ₹73,733,626 on
// 31/07/2025, Finsys books a BANK OF BARODA cheque receipt at
// ₹73,733,625 the same day. Same payment, off by ₹1 because the
// two ERPs round differently. Exact-paise matching missed this
// pair; ±₹1 tolerance catches it.
const tolA = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-07-31', narration: 'CRN-0232-00656', voucher: null, debit: 0, credit: 73_733_626, balance: null },
    ],
  }],
};
const tolB = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      // Same payment, A truncated paise to 73_733_626, B rounded to 73_733_625.
      { date: '2025-07-31', narration: 'BANK OF BARODA Chq.No.310725 BEING AMOUNT RECEIVED', voucher: null, debit: 73_733_625, credit: 0, balance: null },
    ],
  }],
};
const tolReport = compareLedgersByBill(tolA, 'sales', tolB, 'purchase');
expect('tolerance: pair matched', tolReport.summary.paymentMatchedCount, 1);
expect('tolerance: amountA preserved', tolReport.paymentMatches[0]?.amountA, 73_733_626);
expect('tolerance: amountB preserved', tolReport.paymentMatches[0]?.amountB, 73_733_625);
expect('tolerance: diff = 1', tolReport.paymentMatches[0]?.diff, 1);
expect('tolerance: bankRefB cheque', tolReport.paymentMatches[0]?.bankRefB, '310725');
expect('tolerance: nothing left in no-bill', tolReport.noBillA.length + tolReport.noBillB.length, 0);

// ─── payment matcher: ₹2 gap is NOT tolerated by the tight pass ──
// The tight pass only accepts ±₹1 — protects the "clean pair"
// bucket from admitting genuinely-different payments. The unique-
// date loose pass DOES catch the pair afterwards (1:1 on the date)
// and surfaces it for human review. Plain-narration rows used
// here so the bill extractor doesn't grab them first.
const beyondA = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-07-31', narration: 'CRN-A only', voucher: null, debit: 0, credit: 50000, balance: null },
    ],
  }],
};
const beyondB = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-07-31', narration: 'HDFC bank ref', voucher: null, debit: 50002, credit: 0, balance: null },
    ],
  }],
};
const beyondReport = compareLedgersByBill(beyondA, 'sales', beyondB, 'purchase');
expect('beyond tolerance: tight pass skips', beyondReport.summary.paymentMatchedCount, 0);
expect('beyond tolerance: loose pass catches', beyondReport.summary.paymentDateMatchedCount, 1);
expect('beyond tolerance: diff = 2', beyondReport.paymentDateMatches[0]?.diff, 2);

// ─── payment matcher: exact beats fuzzy on same day ─────────
// When the same day has both an exact-match candidate and a
// ±₹1 candidate, exact should win — otherwise a clean pair
// gets shunted into a fuzzy bucket while the real fuzzy pair
// becomes a false no-bill row.
// Use plain narrations with no bill-pattern keywords (no Receipt /
// Invoice / Bill / VCH) — otherwise the bill extractor swallows the
// row before the payment matcher ever sees it.
const exactBeatsA = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-07-31', narration: 'CRN-0232-A', voucher: null, debit: 0, credit: 50000, balance: null },
    ],
  }],
};
const exactBeatsB = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      // Fuzzy candidate first (would win on first-fit), exact second.
      { date: '2025-07-31', narration: 'HDFC fuzzy candidate', voucher: null, debit: 49999, credit: 0, balance: null },
      { date: '2025-07-31', narration: 'HDFC exact candidate', voucher: null, debit: 50000, credit: 0, balance: null },
    ],
  }],
};
const exactBeatsReport = compareLedgersByBill(exactBeatsA, 'sales', exactBeatsB, 'purchase');
expect('exact beats fuzzy: one pair', exactBeatsReport.summary.paymentMatchedCount, 1);
expect('exact beats fuzzy: diff = 0', exactBeatsReport.paymentMatches[0]?.diff, 0);
expect('exact beats fuzzy: exact picked', exactBeatsReport.paymentMatches[0]?.narrationB, 'HDFC exact candidate');
expect('exact beats fuzzy: fuzzy left over', exactBeatsReport.noBillB[0]?.narration, 'HDFC fuzzy candidate');

// ─── 2026-05-20 unique-date pairing (loose, amount differs) ──
// Real OSPL-style case: A has ₹2,67,750 on 30/06 (CRN-0232 ref),
// B has ₹2,67,000 on 30/06 (BANK OF BARODA cheque). ₹750 is well
// outside ±₹1 so the tight pass skips it, but the date is unique
// on both sides → almost certainly the same payment with a real
// discrepancy. Surface in paymentDateMatches for human review.
const uniqDateA = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-06-30', narration: 'CRN-0232-00650', voucher: null, debit: 0, credit: 267_750, balance: null },
    ],
  }],
};
const uniqDateB = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-06-30', narration: 'BANK OF BARODA Chq.No.300625 BEING AMOUNT RECEIVED', voucher: null, debit: 267_000, credit: 0, balance: null },
    ],
  }],
};
const uniqDateReport = compareLedgersByBill(uniqDateA, 'sales', uniqDateB, 'purchase');
expect('unique-date: tight pass empty', uniqDateReport.summary.paymentMatchedCount, 0);
expect('unique-date: loose pass picked it up', uniqDateReport.summary.paymentDateMatchedCount, 1);
expect('unique-date: amountA preserved', uniqDateReport.paymentDateMatches[0]?.amountA, 267_750);
expect('unique-date: amountB preserved', uniqDateReport.paymentDateMatches[0]?.amountB, 267_000);
expect('unique-date: diff = 750', uniqDateReport.paymentDateMatches[0]?.diff, 750);
expect('unique-date: nothing left in no-bill', uniqDateReport.noBillA.length + uniqDateReport.noBillB.length, 0);

// ─── unique-date pairing: ambiguous days stay in no-bill ─────
// When the same day has 2 leftover rows on A and 1 on B (or any
// other non-1:1 layout), we can't pick which goes with which
// without amount as a tiebreaker. Don't auto-pair — leave all
// three in no-bill so the user decides.
const ambigA = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-06-30', narration: 'CRN-0232-A1', voucher: null, debit: 0, credit: 100_000, balance: null },
      { date: '2025-06-30', narration: 'CRN-0232-A2', voucher: null, debit: 0, credit: 200_000, balance: null },
    ],
  }],
};
const ambigB = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-06-30', narration: 'HDFC BANK transfer', voucher: null, debit: 150_000, credit: 0, balance: null },
    ],
  }],
};
const ambigReport = compareLedgersByBill(ambigA, 'sales', ambigB, 'purchase');
expect('ambiguous: no tight match', ambigReport.summary.paymentMatchedCount, 0);
expect('ambiguous: no loose match either', ambigReport.summary.paymentDateMatchedCount, 0);
expect('ambiguous: all 3 stay in no-bill', ambigReport.noBillA.length + ambigReport.noBillB.length, 3);

// ─── unique-date pairing: tight pass wins over loose ─────────
// If a date has a clean ±₹1 pair AND another row on each side,
// the tight pass consumes the clean pair first, so the leftovers
// have only 1 row each on that date → the loose pass picks them
// up. Net: 1 in paymentMatches + 1 in paymentDateMatches.
const layeredA = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-06-30', narration: 'CRN-A-clean', voucher: null, debit: 0, credit: 50_000, balance: null },
      { date: '2025-06-30', narration: 'CRN-A-discrepant', voucher: null, debit: 0, credit: 100_000, balance: null },
    ],
  }],
};
const layeredB = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-06-30', narration: 'HDFC clean', voucher: null, debit: 50_000, credit: 0, balance: null },
      { date: '2025-06-30', narration: 'HDFC discrepant', voucher: null, debit: 99_500, credit: 0, balance: null },
    ],
  }],
};
const layeredReport = compareLedgersByBill(layeredA, 'sales', layeredB, 'purchase');
expect('layered: 1 tight match', layeredReport.summary.paymentMatchedCount, 1);
expect('layered: 1 loose match', layeredReport.summary.paymentDateMatchedCount, 1);
expect('layered: loose diff = 500', layeredReport.paymentDateMatches[0]?.diff, 500);
expect('layered: no leftovers', layeredReport.noBillA.length + layeredReport.noBillB.length, 0);

// ─── payment matcher: first-come matching for duplicates ─────
// If A has two rows for the same date+amount and B has only one,
// pair the first A row with the B row; the second A row is left
// over. (Greedy first-fit is good enough; not trying to be smart
// about it because there's no narration signal to disambiguate.)
const dupA = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-06-10', narration: 'Receipt 1', voucher: null, debit: 0, credit: 25000, balance: null },
      { date: '2025-06-10', narration: 'Receipt 2', voucher: null, debit: 0, credit: 25000, balance: null },
    ],
  }],
};
const dupB = {
  accounts: [{ name: 'X', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0,
    transactions: [
      { date: '2025-06-10', narration: 'NEFT', voucher: null, debit: 25000, credit: 0, balance: null },
    ],
  }],
};
const dupReport = compareLedgersByBill(dupA, 'sales', dupB, 'purchase');
expect('dup: one pair', dupReport.summary.paymentMatchedCount, 1);
expect('dup: one leftover A', dupReport.noBillA.length, 1);
expect('dup: zero leftover B', dupReport.noBillB.length, 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
