/** Verify bank-charge coverage: the "Charges for PORD" lines, POSRENT,
 *  the generic small-amount charge net, and its false-positive guards.
 *  Cases drawn from the real HDFC/BoB OD statement. Pure, no DB.
 *  Run: npx tsx scripts/smoke-bank-charges.mts
 */
import { classifyRow } from '../server/lib/bankClassifier.ts';

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`); };
const cat = (narration: string, type: 'credit' | 'debit', amount: number) => {
  const r = classifyRow({ narration, type, amount });
  return r ? `${r.category}/${r.subcategory}` : null;
};

console.log('Real rows that were mis-tagged as Business Expenses:');
for (const [n, amt] of [
  ['Charges for PORD Customer Payment :003595543027', 2.65],
  ['Charges for PORD Customer Payment :003592950491', 5.6],
  ['Charges for PORD Customer Payment :003567102823', 58],
] as const) {
  const c = cat(n, 'debit', amt);
  check(`"${n.slice(0, 32)}…" ₹${amt} → Bank Charges`, c?.startsWith('Bank Charges') ?? false, `(got ${c})`);
}
check('POSRENT_MAR26_62014649 ₹561 → Bank Charges/POS Rental', cat('POSRENT_MAR26_62014649', 'debit', 561) === 'Bank Charges/POS Rental', `(got ${cat('POSRENT_MAR26_62014649', 'debit', 561)})`);
check('SMS Charges for MAR 26 ₹8.73 → Bank Charges/SMS (specific wins)', cat('SMS Charges for MAR 26', 'debit', 8.73) === 'Bank Charges/SMS', `(got ${cat('SMS Charges for MAR 26', 'debit', 8.73)})`);

console.log('\nGeneric small-charge net (debit ≤ ₹100):');
for (const [n, amt] of [
  ['UNKNOWN BANK FEE', 15],
  ['SOME RANDOM CHG', 22],
  ['MISC LEVY', 50],
  ['SERVICE COMMISSION', 99],
] as const) {
  const c = cat(n, 'debit', amt);
  check(`"${n}" ₹${amt} → Bank Charges`, c === 'Bank Charges/Other', `(got ${c})`);
}

console.log('\nNamed charges that must win at ANY amount:');
for (const [n, amt, want] of [
  ['PROCESSING CHARGES', 2500, 'Bank Charges'],
  ['BANK CHARGES', 500, 'Bank Charges'],
  ['DP CHARGES', 300, 'Bank Charges'],
  ['AMC', 590, 'Bank Charges'],
  ['DD CHARGES', 150, 'Bank Charges'],
] as const) {
  const c = cat(n, 'debit', amt);
  check(`"${n}" ₹${amt} → ${want}`, c?.startsWith(want) ?? false, `(got ${c})`);
}

console.log('\nFalse-positive guards — must NOT become Bank Charges:');
// Above the ceiling: a real business expense with a charge word
check('"COURIER CHARGES" ₹800 → not Bank Charges', !(cat('COURIER CHARGES', 'debit', 800) ?? '').startsWith('Bank Charges'), `(got ${cat('COURIER CHARGES', 'debit', 800)})`);
check('"FREIGHT CHARGES" ₹1500 → not Bank Charges', !(cat('FREIGHT CHARGES', 'debit', 1500) ?? '').startsWith('Bank Charges'));
// Specific merchant rule must beat the generic net even at small amount
check('"NETFLIX FEE" ₹50 → Personal/Subscriptions (not Bank Charges)', cat('NETFLIX FEE', 'debit', 50) === 'Personal/Subscriptions', `(got ${cat('NETFLIX FEE', 'debit', 50)})`);
// A credit carrying "charges" is not a debit fee
check('credit "REFUND OF CHARGES" ₹50 → not Bank Charges', !(cat('REFUND OF CHARGES', 'credit', 50) ?? '').startsWith('Bank Charges'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
