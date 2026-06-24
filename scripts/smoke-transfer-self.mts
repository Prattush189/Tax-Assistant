/** Transfers should mean own-account ↔ own-account ONLY. A wire/UPI to a
 *  third party is Business Income (credit) / Business Expenses (debit).
 *  Cases drawn from the user's real HDFC + ICICI exports. Pure, no DB.
 *  Run: npx tsx scripts/smoke-transfer-self.mts
 */
import { classifyRow } from '../server/lib/bankClassifier.ts';

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`); };
const cat = (narration: string, type: 'credit' | 'debit', accountHolder?: string | null) =>
  classifyRow({ narration, type, amount: 1000, accountHolder })?.category ?? null;

const HOLDER = 'JAGJIT CHEMIST & DRUG STORE';

console.log('Third-party wire/UPI → Income/Expense (not Transfers):');
check('IMPS credit from GOOGLEINDIADIGITAL → Business Income',
  cat('IMPS/48/513520482170/**0000 /GOOGLEINDIADIGITAL/IMP', 'credit', HOLDER) === 'Business Income',
  `(got ${cat('IMPS/48/513520482170/**0000 /GOOGLEINDIADIGITAL/IMP', 'credit', HOLDER)})`);
check('IMPS credit from PERFIOS → Business Income',
  cat('IMPS/48/513520926891/**0091 /PERFIOS SOFTWARE SOL/g', 'credit', HOLDER) === 'Business Income');
check('UPI debit to iddyakhan713@ok → Business Expenses',
  cat('UPI/iddyakhan713@ok/UPI/Jammu and Kashm/509377881329/ICl14da', 'debit', HOLDER) === 'Business Expenses');
check('MMT/IMPS debit to mohsin nay → Business Expenses',
  cat('MMT/IMPS/510120279339/mohsin MOBILE BANKING nay/JAKA0PATHER', 'debit', HOLDER) === 'Business Expenses');
check('TRFR FROM: THE WANI FOOTWEAR (credit) → Business Income',
  cat('TRFR FROM: THE WANI FOOTWEAR', 'credit', HOLDER) === 'Business Income');
check('NEFT debit to a vendor → Business Expenses',
  cat('NEFT-HDFC0001234-STAR JEWELLERS-ref', 'debit', HOLDER) === 'Business Expenses');

console.log('\nSelf-transfer (counterparty = account holder) → Transfers:');
check('NEFT to own name → Transfers',
  cat('NEFT-HDFC0001234-JAGJIT CHEMIST AND DRUG STORE-ref', 'debit', HOLDER) === 'Transfers',
  `(got ${cat('NEFT-HDFC0001234-JAGJIT CHEMIST AND DRUG STORE-ref', 'debit', HOLDER)})`);
check('IMPS from own name (abbreviated) → Transfers',
  cat('IMPS/48/999/**0000 /JAGJIT CHEMIST/IMP', 'credit', HOLDER) === 'Transfers',
  `(got ${cat('IMPS/48/999/**0000 /JAGJIT CHEMIST/IMP', 'credit', HOLDER)})`);
check('BIL/INFT (own-account internal) → Transfers', cat('BIL/INFT/000123/SAVINGS', 'debit', HOLDER) === 'Transfers');
check('explicit "self" → Transfers even without holder name', cat('NEFT-X-TO SELF-ref', 'debit', null) === 'Transfers');

console.log('\nFalse-positive guard — shared single word is NOT self:');
check('"JAGJIT TRADERS" vendor ≠ self (only shares JAGJIT) → Business Expenses',
  cat('NEFT-HDFC0001234-JAGJIT TRADERS-ref', 'debit', HOLDER) === 'Business Expenses',
  `(got ${cat('NEFT-HDFC0001234-JAGJIT TRADERS-ref', 'debit', HOLDER)})`);

console.log('\nNo holder name → fall back to direction:');
check('IMPS debit, no holder → Business Expenses', cat('MMT/IMPS/510120279339/mohsin nay/JAKA0PATHER', 'debit', null) === 'Business Expenses');
check('IMPS credit, no holder → Business Income', cat('IMPS/48/513520482170/**0000 /GOOGLEINDIADIGITAL/IMP', 'credit', null) === 'Business Income');

console.log('\nMerchant/charge rules still win over the transfer rules:');
check('UPI to swiggy → Personal (not Income/Expense)', cat('UPI/swiggy.stores@icici/UPI/.../123', 'debit', HOLDER) === 'Personal',
  `(got ${cat('UPI/swiggy.stores@icici/UPI/.../123', 'debit', HOLDER)})`);
check('Charges for PORD still Bank Charges', classifyRow({ narration: 'Charges for PORD Customer Payment :003', type: 'debit', amount: 5, accountHolder: HOLDER })?.category === 'Bank Charges');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
