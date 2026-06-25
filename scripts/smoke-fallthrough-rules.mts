/** Real narrations from the prod AI-fall-through report (analyze-ai-
 *  fallthrough.ts, 2026-06-25). Each was hitting Gemini; these assert the
 *  new deterministic rules now resolve them locally with the right category.
 *
 *  Categories are by-direction (no account-holder name in these tests), so
 *  credit→Business Income, debit→Business Expenses for third-party wires.
 *
 *  Run: npx tsx scripts/smoke-fallthrough-rules.mts
 */
import { classifyRow } from '../server/lib/bankClassifier.ts';

let pass = 0, fail = 0;
/** amount sign sets direction: + = credit, − = debit */
function check(narration: string, amount: number, want: string) {
  const type: 'credit' | 'debit' = amount >= 0 ? 'credit' : 'debit';
  const out = classifyRow({ narration, type, amount }, { includeExperimental: true });
  const got = out?.category ?? '(needs AI)';
  if (got === want) { pass++; console.log(`  ✓ [${type}] ${want.padEnd(18)} ${narration.slice(0, 56)}`); }
  else { fail++; console.log(`  ✗ ${narration.slice(0, 56)}\n      got=${got}  want=${want}`); }
}

console.log('UPI un-anchored (/, COLLECT/, /Paymen/, P2M, P2A):');
check('/UPI/AXIS BANK UPI/P2M/611292149087/Google India Digital', -800, 'Business Expenses');
check('I/ UPI/P2M/647937401765/Google India Digital', 12000, 'Business Income');
check('COLLECT/UPI/HDFC BANK LTD UPI/P2M/607632613345/HDFC BANK LTD', -500, 'Business Expenses');
check('/Paymen/YES BANK LIMITED YBS UPI/P2M/336735054553/MANJINDER SINGH', -1500, 'Business Expenses');
check('/Paymen/ICICI Bank', -300, 'Business Expenses');
check('/UPI/YES BANK LIMITED YBS', -250, 'Business Expenses');
check('COLLECT/UPI/HDFC BANK LTD UPI/P2A/644433952813/NAVPREET KAUR', -700, 'Business Expenses');
check('S/PUNB/Payment/ UPI/P2A/400469677391/GURLABH', 5000, 'Business Income');
check('nt usi/ UPI/P2A/202659638279/GURPARTAP/INDB/Se', 3000, 'Business Income');
check('S/HDFC/UPI/ UPI/P2M/607938623706/HDFC BANK LTD', 6000, 'Business Income');

console.log('\nIMPS / NEFT / FT un-anchored:');
check('SentIMPS510507850133Jyoti engi/HDFCX8951/P', -9000, 'Business Expenses');
check('Recd:IMPS/523918367546/JYOTI ENGI/KKBK/X8951/P', 9000, 'Business Income');
check('NEFT 000452354200 DELSEAL INDIA PRIVATE LTD RATN0', 120000, 'Business Income');
check('FT -BHARAT SINGH DR - 50100161504067 - B HARAT SINGH', -50000, 'Business Expenses');

console.log('\nSweep / FD treasury (contra → Transfers; interest → Interest Income):');
check('SWEEP TRANSFER TO [6084875898]', -100000, 'Transfers');
check('SWEEP TRANSFER TO [6084875898]', 100000, 'Transfers');
check('SWEEP-IN CREDIT - 50301086760604', 80000, 'Transfers');
check('FD PREMAT PROCEEDS: 6082345736', 50000, 'Transfers');
check('FD REDEEM PRINCIPAL -50301132245618/1', 50000, 'Transfers');
check('FD REDEEM INTEREST -50301132245618/1', 1200, 'Interest Income');
check('INT. ON SWCR ON-50301086760604', 800, 'Interest Income');

console.log('\nMandate auto-debits (APY pension, ACH):');
check('APY6052665_042025_500295885738_INSTALLME', -495, 'Investments');
check('ACH D- CHOLAMANDALAMINVESTM-Z13806364/1', -7000, 'Business Expenses');
check('ACH D- HDFC-Z13806364/9', -3500, 'Business Expenses');

console.log('\nWDL TFR → Transfers (tax-safe; often the holder’s own account):');
check('0044285527320 OF Mr. JAGDISH WDL TFR', 40000, 'Transfers');
check('000050 10123947130 WDL TFR', -40000, 'Transfers');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
