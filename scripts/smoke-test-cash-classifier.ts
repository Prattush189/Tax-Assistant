// Quick sanity check that "By Cash" / cash-deposit narrations land in
// the new "Cash Deposit" category instead of the AI-fallback Business
// Income bucket. Mirrors the J&K Bank Cash Credit narrations from the
// May-2026 screenshot.
//
//   npx tsx scripts/smoke-test-cash-classifier.ts
import { classifyRow } from '../server/lib/bankClassifier';

interface Case {
  narration: string;
  type: 'credit' | 'debit';
  expectCategory: string;
  expectSubcategory?: string | null;
  // null means "should fall through to AI (return null from classifier)"
  expectNullClassification?: boolean;
}

const cases: Case[] = [
  // Screenshot rows: J&K Bank CC "By Cash: N" — should now hit Cash Deposit.
  { narration: 'By Cash: 2',     type: 'credit', expectCategory: 'Cash Deposit', expectSubcategory: 'Counter' },
  { narration: 'By Cash: 3',     type: 'credit', expectCategory: 'Cash Deposit', expectSubcategory: 'Counter' },
  { narration: 'By Cash: 4',     type: 'credit', expectCategory: 'Cash Deposit', expectSubcategory: 'Counter' },
  { narration: 'By Cash: 128',   type: 'credit', expectCategory: 'Cash Deposit', expectSubcategory: 'Counter' },
  // Variants seen on other formats.
  { narration: 'BY CASH -SRINAGAR - KARAN NAGAR',     type: 'credit', expectCategory: 'Cash Deposit', expectSubcategory: 'Counter' },
  { narration: 'BY CSH 1234',                         type: 'credit', expectCategory: 'Cash Deposit', expectSubcategory: 'Counter' },
  { narration: 'CASH DEPOSIT branch counter',         type: 'credit', expectCategory: 'Cash Deposit', expectSubcategory: 'Counter' },
  // CDM / cash acceptor machine narrations.
  { narration: 'CAM/25271OAR/CASH DEP-Other/02-10-25/5228', type: 'credit', expectCategory: 'Cash Deposit', expectSubcategory: 'CDM / ATM' },
  { narration: 'CDM deposit at branch',                     type: 'credit', expectCategory: 'Cash Deposit', expectSubcategory: 'CDM / ATM' },

  // Cash withdrawal rules (2026-06): debit-direction cash rows now have
  // their own Cash Withdrawal category instead of falling through to AI.
  { narration: 'CASH PAID:SELF 3476 DELHI',                  type: 'debit',  expectCategory: 'Cash Withdrawal', expectSubcategory: 'Counter' },
  { narration: 'CASH WDL/14-06-25',                          type: 'debit',  expectCategory: 'Cash Withdrawal', expectSubcategory: 'ATM / CDM' },
  { narration: 'CAM/34761HRY/CASH WDL/11-04-25',             type: 'debit',  expectCategory: 'Cash Withdrawal', expectSubcategory: 'ATM / CDM' },
  // Cash-deposit-CHARGES (counter fee) is Bank Charges, not Cash Deposit.
  // Existing rule handles this, but verify the new rule doesn't grab it.
  { narration: 'Cash Deposit Charges',                       type: 'debit',  expectCategory: 'Bank Charges', expectSubcategory: 'Cash Txn' },
  { narration: 'CashDep Chgs',                               type: 'debit',  expectCategory: 'Bank Charges', expectSubcategory: 'Cash Txn' },
  // 2026-06: spaceless ICICI / HDFC charge labels — these previously
  // missed the cash-txn-charges regex because it required spaces.
  { narration: 'CashTxnChgs-Branch-Dec25+GST',               type: 'debit',  expectCategory: 'Bank Charges', expectSubcategory: 'Cash Txn' },
  { narration: 'CashDepChgs',                                type: 'debit',  expectCategory: 'Bank Charges', expectSubcategory: 'Cash Txn' },

  // ICICI 5-segment UPI format — `transfer-personal` rule should fire
  // via the new `upi-icici-2nd-seg` counterparty pattern. Counterparty
  // is a personal-looking VPA local-part or short name → Transfers.
  { narration: 'UPI/ahlamfarooq36-2/UPI/AXIS BANK/545722638994/ICI7357b1518bc44a999604e46e3810a83c/', type: 'debit',  expectCategory: 'Transfers' },
  { narration: 'UPI/iddyakhan713@ok/UPI/Jammu and Kashm/509377881329/ICI14da96dd17f943d0ba5ca296c6daadcf/', type: 'debit',  expectCategory: 'Transfers' },
  { narration: 'UPI/MOHSIN NAY/wanimohsin161@U/UPI/Jammu and/605845207468/IClc3256395aa8413f809488902fe5db5c/', type: 'credit', expectCategory: 'Transfers' },

  // TRFR FROM:/TO: internal transfer rule (J&K / ICICI).
  { narration: 'TRFR FROM:THE WANI FOOTWEAR',                type: 'credit', expectCategory: 'Transfers' },
  { narration: 'TRFR TO:PARTY NAME LTD',                     type: 'debit',  expectCategory: 'Transfers' },

  // MMT/IMPS — ICICI's IMPS prefix.
  { narration: 'MMT/IMPS/509523467771/irham shaf/JAKA0HKADAL', type: 'debit', expectCategory: 'Transfers' },
];

let passed = 0;
let failed = 0;
for (const c of cases) {
  const result = classifyRow({ narration: c.narration, type: c.type });
  if (c.expectNullClassification) {
    if (result === null) {
      console.log(`  PASS  null (AI fallback) for "${c.narration}" [${c.type}]`);
      passed++;
    } else {
      console.log(`  FAIL  "${c.narration}" [${c.type}] — expected null, got ${result.category}/${result.subcategory ?? '-'}`);
      failed++;
    }
    continue;
  }
  if (!result) {
    console.log(`  FAIL  "${c.narration}" [${c.type}] — expected ${c.expectCategory}/${c.expectSubcategory ?? '-'}, got null`);
    failed++;
    continue;
  }
  const catOk = result.category === c.expectCategory;
  const subOk = c.expectSubcategory === undefined || result.subcategory === c.expectSubcategory;
  if (catOk && subOk) {
    console.log(`  PASS  "${c.narration}" [${c.type}] → ${result.category}/${result.subcategory ?? '-'}`);
    passed++;
  } else {
    console.log(`  FAIL  "${c.narration}" [${c.type}] — expected ${c.expectCategory}/${c.expectSubcategory ?? '-'}, got ${result.category}/${result.subcategory ?? '-'}`);
    failed++;
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
