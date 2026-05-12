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

  // Negative cases — these MUST NOT classify as Cash Deposit:
  // Debit-direction cash withdrawals should fall through (not match this rule).
  { narration: 'CASH PAID:SELF 3476 DELHI', type: 'debit', expectNullClassification: true },
  { narration: 'CASH WDL/14-06-25',         type: 'debit', expectNullClassification: true },
  // Cash-deposit-CHARGES (counter fee) is Bank Charges, not Cash Deposit.
  // Existing rule handles this, but verify the new rule doesn't grab it.
  { narration: 'Cash Deposit Charges',      type: 'debit', expectCategory: 'Bank Charges', expectSubcategory: 'Cash Txn' },
  { narration: 'CashDep Chgs',              type: 'debit', expectCategory: 'Bank Charges', expectSubcategory: 'Cash Txn' },
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
