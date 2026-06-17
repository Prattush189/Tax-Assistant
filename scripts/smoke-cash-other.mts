/** Verify (1) bank-specific cash withdrawal/deposit keyword rules and
 *  (2) the Other→business-by-direction catch-all. Pure, no DB.
 *  Run: npx tsx scripts/smoke-cash-other.mts
 */
import { classifyRow, remapOtherByDirection } from '../server/lib/bankClassifier.ts';

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`); };

const cat = (narration: string, type: 'credit' | 'debit') =>
  classifyRow({ narration, type, amount: 5000 })?.category ?? null;

console.log('Cash Withdrawal — bare ATM codes (debit):');
for (const n of ['ATW/123456/SAMRALA RD', 'NWD/673673/DELHI', 'EAW/HDFC/MUMBAI', 'CWDR ATM', 'CWD-SELF', 'ATM-NFS LUDHIANA', 'ATM WDL SBI', 'NFS/ATM/0099']) {
  const c = cat(n, 'debit');
  check(`"${n}" → Cash Withdrawal`, c === 'Cash Withdrawal', `(got ${c})`);
}

console.log('\nCash Deposit — machine codes (credit):');
for (const n of ['BNA/0099845', 'CRDM CASH DEPOSIT', 'GREEN CHANNEL DEP', 'CDM/12345 SRINAGAR']) {
  const c = cat(n, 'credit');
  check(`"${n}" → Cash Deposit`, c === 'Cash Deposit', `(got ${c})`);
}

console.log('\nNegatives — must NOT become Cash Withdrawal:');
// "WDL TFR INB <merchant>" is an internet-banking payment, not a cash-out.
check('"WDL TFR INB sparkleshopp AT SAMRALA ROAD" not Cash Withdrawal', cat('WDL TFR INB sparkleshopp AT SAMRALA ROAD LUDHIANA', 'debit') !== 'Cash Withdrawal');
// "CASHFREE" counterparty must not become Cash Deposit
check('"CASHFREE PAYMENTS" credit not Cash Deposit', cat('CASHFREE PAYMENTS INDIA', 'credit') !== 'Cash Deposit');

console.log('\nOther → business by direction:');
const rows = [
  { type: 'credit' as const, category: 'Other', subcategory: null },
  { type: 'debit' as const, category: 'Other', subcategory: null },
  { type: 'credit' as const, category: 'Salary', subcategory: 'monthly' },
];
const changed = remapOtherByDirection(rows);
check('2 rows remapped', changed === 2, `(got ${changed})`);
check('credit Other → Business Income', rows[0].category === 'Business Income');
check('debit Other → Business Expenses', rows[1].category === 'Business Expenses');
check('subcategory stamped Uncategorised', rows[0].subcategory === 'Uncategorised');
check('non-Other left untouched', rows[2].category === 'Salary' && rows[2].subcategory === 'monthly');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
