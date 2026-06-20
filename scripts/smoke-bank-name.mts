/** Verify bank-NAME detection: the account's own bank wins over the
 *  counterparty banks named in UPI narrations (the bug that labelled a
 *  Bank of Maharashtra statement "HDFC Bank"). Pure, no DB.
 *  Run: npx tsx scripts/smoke-bank-name.mts
 */
import { extractBankMetadata } from '../server/lib/bankStatementMetadata.ts';

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`); };

// A BOM account whose UPI rows all name OTHER banks (HDFC, SBIN, ICIC…).
const upiHeavy = (n: number) => Array.from({ length: n }, (_, i) => ({
  date: '2025-04-01',
  narration: `UPI 5091777${i}/HDFC/PARTY ${i}/UPI`,
  amount: -100 - i,
}));

const bankOf = (filename: string | null, rows: { date: string | null; narration: string; amount: number }[]) =>
  extractBankMetadata(filename, rows).bankName;

console.log('Filename names the account bank — beats counterparty frequency:');
check('BOM_Statement…PDF + 300 /HDFC/ rows → Bank of Maharashtra',
  bankOf('BOM_Statement_xxxxxxxx0541_20250401_20260331.PDF', upiHeavy(300)) === 'Bank of Maharashtra',
  `(got ${bankOf('BOM_Statement_xxxxxxxx0541.PDF', upiHeavy(300))})`);
check('"HDFC BANK-1.pdf" → HDFC Bank', bankOf('HDFC BANK-1.pdf', upiHeavy(5)) === 'HDFC Bank');
check('"ICICI BANK FORMAT-2.pdf" → ICICI Bank', bankOf('ICICI BANK FORMAT-2.pdf', upiHeavy(50)) === 'ICICI Bank');
check('"Canara_Bank_2025.csv" → Canara Bank', bankOf('Canara_Bank_2025.csv', upiHeavy(50)) === 'Canara Bank');
check('"JKBANK FORMAT-1.pdf" → J&K Bank', bankOf('JKBANK FORMAT-1.pdf', upiHeavy(50)) === 'J&K Bank');

console.log('\nBOM markers also detected (filename + narration variants):');
check('filename with bare BOM. → Bank of Maharashtra', bankOf('BOM.statement.pdf', upiHeavy(20)) === 'Bank of Maharashtra');
check('"BOMBAY DYEING.pdf" is NOT Bank of Maharashtra', bankOf('BOMBAY DYEING.pdf', []) !== 'Bank of Maharashtra', `(got ${bankOf('BOMBAY DYEING.pdf', [])})`);
// MAHB IFSC in a row (generic filename) → BOM via frequency fallback.
check('generic file + MAHB0 IFSC in rows → Bank of Maharashtra',
  bankOf('statement.pdf', [{ date: '2025-04-01', narration: 'IFSC MAHB0001245 OPENING', amount: 0 }]) === 'Bank of Maharashtra');

console.log('\nNo filename — frequency fallback still works:');
check('generic file + HDFC-heavy rows → HDFC Bank (fallback)', bankOf('statement (3).pdf', upiHeavy(50)) === 'HDFC Bank');
check('null filename + J&K-heavy rows → J&K Bank',
  bankOf(null, Array.from({ length: 30 }, () => ({ date: '2025-04-01', narration: 'JAMMU AND KASHMIR BANK CHARGES', amount: -5 }))) === 'J&K Bank');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
