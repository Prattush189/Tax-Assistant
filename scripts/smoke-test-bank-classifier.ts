/**
 * Smoke test for server/lib/bankClassifier.ts.
 *
 * Each test case is `{ narration, type, expect: { category, subcategory? } | null }`.
 * The cases come from BANK CHARGES FORMAT.xlsx (the user's wishlist)
 * plus realistic narrations sampled from actual statements (HDFC,
 * JKBank, ICICI dumps the smoke-test-bank-rules script produced).
 *
 * Run with:
 *   npx tsx scripts/smoke-test-bank-classifier.ts
 */

import { classifyRow, extractCounterparty, extractReference, markRecurring } from '../server/lib/bankClassifier';

interface Case {
  narration: string;
  type: 'credit' | 'debit';
  amount?: number;
  expect: { category: string; subcategory?: string | null } | null;
  expectCounterparty?: string | null;
  expectReference?: string | null;
}

const CASES: Case[] = [
  // ─── Bank Charges (xlsx anchor list) ────────────────────────
  { narration: 'ATM CHARGES QUARTERLY', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'ATM' } },
  { narration: 'ATM ANN.CHRG INCL GST', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'ATM' } },
  { narration: 'ATM WDR', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'ATM' } },
  { narration: 'DEBIT ATM CARD', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'ATM' } },
  { narration: 'CHRGS/NEFT/MBK', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'NEFT/IMPS/RTGS' } },
  { narration: 'CHRGS/IMPS/MBK', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'NEFT/IMPS/RTGS' } },
  { narration: 'NEFT CHGS BRN INCL GST', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'NEFT/IMPS/RTGS' } },
  { narration: 'RTGS CHGS BRN INCL GST', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'NEFT/IMPS/RTGS' } },
  { narration: 'RTGS-GST-COMMISSION CHARGE', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'NEFT/IMPS/RTGS' } },
  { narration: 'IMPS CHARGES', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'NEFT/IMPS/RTGS' } },
  { narration: 'SMS CHARGES MONTHLY', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'SMS' } },
  { narration: 'SMS CHRG FOR:01-01-2024to31-03-2024', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'SMS' } },
  { narration: 'MAB CHRG', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Min Balance' } },
  { narration: 'Min Bal Chrgfrom 01-01-2024 to 31-03-2024', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Min Balance' } },
  { narration: 'Avg bal Chgs Incl GST', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Min Balance' } },
  { narration: 'MINIMUM BALANCE CHARGES', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Min Balance' } },
  { narration: 'LOAN_PROC', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Loan Processing' } },
  { narration: 'Loan Processing Fee', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Loan Processing' } },
  { narration: 'CIBIL', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'CIBIL' } },
  { narration: 'CHEQUE BOOK CHGS', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Cheque' } },
  { narration: 'CHEQUE BOOK CHARGES', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Cheque' } },
  { narration: 'CHEQUE BOOK CHAREGS', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Cheque' } },
  { narration: 'Cash Deposit Charges', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Cash Txn' } },
  { narration: 'CashDep Chgs', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Cash Txn' } },
  { narration: 'Cash Txn Chgs-Branch', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Cash Txn' } },
  { narration: 'POS Rental', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'POS Rental' } },
  { narration: 'SoundBox Rent MAR-2026', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'SoundBox Rent' } },
  { narration: 'Penal Charges', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Penal' } },
  { narration: 'Penal Cha', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Penal' } },
  { narration: 'Reject Insufficient Balance', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Penal' } },
  { narration: 'INSPC CHARGES', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Inspection' } },
  { narration: 'Outward Rejection Charges', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Rejection' } },
  { narration: 'Inward Rejection Charges', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Rejection' } },
  { narration: 'DEBIT CARD ANNUAL FEE', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Card Fee' } },
  { narration: 'ADHOC STMT CHGS INCL GST', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Other' } },
  { narration: 'ACCT MAIN CHARGES', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Other' } },
  { narration: 'INCIDENTAL CHARGES', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Other' } },
  { narration: 'LOW DENOMINATION CHARGE', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Other' } },

  // ─── Bank Interest ─────────────────────────────────────────
  { narration: '0277020100000092:Int.Coll:01-03-2026 to 31-03-2026', type: 'debit', expect: { category: 'Bank Interest (Dr)', subcategory: 'Loan Interest' } },
  { narration: 'Int.Pd:01-04-2024 to 30-06-2024', type: 'credit', expect: { category: 'Bank Interest (Cr)', subcategory: 'Savings' } },
  { narration: 'CREDIT INTEREST', type: 'credit', expect: { category: 'Bank Interest (Cr)', subcategory: 'Savings' } },

  // ─── Insurance — distinct from INSPC ──────────────────────
  { narration: '8823938-1_PROPERTY_INS_ERGO_WC_RENEWAL_M', type: 'debit', expect: { category: 'Insurance', subcategory: 'Premium' } },
  { narration: 'INS-RENEWAL-PREMIUM-VEHICLE', type: 'debit', expect: { category: 'Insurance', subcategory: 'Premium' } },

  // ─── Mobile / Utilities ───────────────────────────────────
  { narration: 'BIL/BPAY/BSNL MOBILE', type: 'debit', expect: { category: 'Mobile Charges', subcategory: 'BSNL' } },
  { narration: 'BIL/BPAY/AIRTEL', type: 'debit', expect: { category: 'Mobile Charges', subcategory: 'Airtel' } },
  { narration: 'BIL/BPAY/JIO', type: 'debit', expect: { category: 'Mobile Charges', subcategory: 'Jio' } },
  { narration: 'PAYTMJIO RECHARGE', type: 'debit', expect: { category: 'Mobile Charges', subcategory: 'Jio' } },
  { narration: 'BILL DK POWER DEVELOPMENT', type: 'debit', expect: { category: 'Electricity Charges', subcategory: 'DISCOM' } },
  { narration: 'BILL DKP ELECTRICITY', type: 'debit', expect: { category: 'Electricity Charges', subcategory: 'DISCOM' } },
  { narration: 'WATER BILL FEB', type: 'debit', expect: { category: 'Water Charges', subcategory: 'Municipal' } },

  // ─── Loan EMI / Salary / Rent ─────────────────────────────
  { narration: 'EMI 88588864 CHQ S885888640061', type: 'debit', expect: { category: 'Loan EMI' } },
  { narration: 'Loan Recovery For0060265240000147', type: 'debit', expect: { category: 'Loan EMI' } },
  { narration: 'NEFT-HDFC-SALARY MAR-N123456', type: 'credit', expect: { category: 'Salary' } },
  { narration: 'RENT FOR APRIL', type: 'credit', expect: { category: 'Rent Received' } },
  { narration: 'OFFICE RENT MARCH', type: 'debit', expect: { category: 'Business Expenses' } },

  // ─── Investments ─────────────────────────────────────────
  { narration: 'SIP HDFC EQUITY FUND', type: 'debit', expect: { category: 'Investments', subcategory: 'MF' } },
  { narration: 'ZERODHA-FUNDS-ADD', type: 'debit', expect: { category: 'Investments', subcategory: 'MF' } },
  { narration: 'GROWW INVESTMENT', type: 'debit', expect: { category: 'Investments', subcategory: 'MF' } },

  // ─── GST / TDS / Taxes ───────────────────────────────────
  { narration: 'GSTN-26AAAAA0000A1Z5-FEB2025', type: 'debit', expect: { category: 'GST Payments' } },
  { narration: 'TDS PAYMENT 26Q', type: 'debit', expect: { category: 'TDS' } },
  { narration: 'CHALLAN 280 ADV TAX FY25', type: 'debit', expect: { category: 'Taxes Paid', subcategory: 'Advance Tax' } },

  // ─── Transfers (personal counterparty) ────────────────────
  { narration: 'UPI/509077863301/FROM: rajabilalmatta.rb@okicici/TO: sf3458311-4@okaxis/UPI', type: 'credit', expect: { category: 'Transfers' } },
  { narration: 'mTFR/9682308046/AAMIR LIYAQAT', type: 'credit', expect: { category: 'Transfers' } },

  // ─── Transfers — business counterparty (declined → null) ──
  // These should fall through to AI because the counterparty looks
  // like a business (PAYTM PAYMENTS, ENTERPRISES suffix).
  { narration: 'RTGS-PAYTM PAYMENTS SERVICES LIMIT-YESB0000001', type: 'credit', expect: null },
  { narration: 'NEFT-HDFC-ABC ENTERPRISES PVT LTD-N987654', type: 'debit', expect: null },

  // ─── Genuinely ambiguous → null ──────────────────────────
  { narration: 'BHAT GROCERIES', type: 'debit', expect: null },
  { narration: 'AMAZON SHOPPING', type: 'debit', expect: null },

  // ─── Counterparty extraction tests ────────────────────────
  {
    narration: 'UPI/509077863301/FROM: rajabilalmatta.rb@okicici/TO: sf3458311-4@okaxis/UPI',
    type: 'credit',
    expect: { category: 'Transfers' },
    expectCounterparty: 'rajabilalmatta.rb@okicici',
  },
  {
    // Realistic NEFT UTR is 16 chars (4-letter IFSC prefix + 12 digit
    // running counter). Shorter refs in narrations are typically the
    // payment-system batch counter, not UTR.
    narration: 'NEFT-HDFC-SALARY MAR-N235010050001234',
    type: 'credit',
    expect: { category: 'Salary' },
    expectCounterparty: 'SALARY MAR',
    expectReference: 'N235010050001234',
  },
];

function eq(a: unknown, b: unknown): boolean {
  return a === b;
}

function run(): void {
  let pass = 0;
  let fail = 0;
  const failures: string[] = [];

  for (const c of CASES) {
    const result = classifyRow({ narration: c.narration, type: c.type, amount: c.amount });

    // Category check.
    if (c.expect === null) {
      if (result !== null) {
        fail++;
        failures.push(`expected null, got ${JSON.stringify(result)} — ${c.narration}`);
        continue;
      }
    } else {
      if (result === null) {
        fail++;
        failures.push(`expected ${c.expect.category}, got null — ${c.narration}`);
        continue;
      }
      if (!eq(result.category, c.expect.category)) {
        fail++;
        failures.push(`category mismatch: expected "${c.expect.category}", got "${result.category}" — ${c.narration}`);
        continue;
      }
      if (c.expect.subcategory !== undefined && !eq(result.subcategory, c.expect.subcategory)) {
        fail++;
        failures.push(`subcategory mismatch: expected "${c.expect.subcategory}", got "${result.subcategory}" — ${c.narration}`);
        continue;
      }
    }

    // Counterparty check (when explicitly asserted).
    if (c.expectCounterparty !== undefined) {
      const cp = extractCounterparty(c.narration);
      if (!eq(cp, c.expectCounterparty)) {
        fail++;
        failures.push(`counterparty mismatch: expected "${c.expectCounterparty}", got "${cp}" — ${c.narration}`);
        continue;
      }
    }

    // Reference check (when explicitly asserted).
    if (c.expectReference !== undefined) {
      const ref = extractReference(c.narration);
      if (!eq(ref, c.expectReference)) {
        fail++;
        failures.push(`reference mismatch: expected "${c.expectReference}", got "${ref}" — ${c.narration}`);
        continue;
      }
    }

    pass++;
  }

  // Recurring-detection smoke
  const recurringRows = [
    { narration: 'EMI 88588864 CHQ S885888640061 04248858', amount: -46973, isRecurring: false },
    { narration: 'EMI 88588864 CHQ S885888640071 05248858', amount: -46973, isRecurring: false },
    { narration: 'EMI 88420946 CHQ S884209460061 04248842', amount: -46973, isRecurring: false },
    { narration: 'UPI/Random/abc@okhdfc/once', amount: -2500, isRecurring: false },
  ];
  markRecurring(recurringRows);
  const recurringFlags = recurringRows.map(r => r.isRecurring);
  // Expect: rows 0-2 (matching EMI prefix + same ₹46,973) → all true; row 3 → false.
  if (!recurringFlags[0] || !recurringFlags[1] || !recurringFlags[2]) {
    fail++;
    failures.push(`recurring detection: expected all 3 EMI rows true, got ${JSON.stringify(recurringFlags)}`);
  } else if (recurringFlags[3]) {
    fail++;
    failures.push(`recurring detection: row 3 should be false, got true`);
  } else {
    pass++;
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
}

run();
