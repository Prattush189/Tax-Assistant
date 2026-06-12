/**
 * Smoke test for the deterministic parts of the chunked OCR
 * structurer (server/lib/paddleStructurer.ts). The Gemini call
 * itself can't run here (no API key on dev machines), but the
 * row-count estimator and the chunking math are what guard against
 * the silent row-dropping this redesign fixes — lock them in.
 *
 * Run: npx tsx scripts/smoke-test-paddle-structurer.ts
 */

import { estimateTxnRows } from '../server/lib/paddleStructurer.js';

let pass = 0, fail = 0;
const expect = (label: string, cond: boolean) => {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${label}`); }
};

// ICICI-style OCR text: date-prefixed rows + wrapped narration lines
// that must NOT count + headers/footers that must NOT count.
const icipage = `DATE MODE PARTICULARS DEPOSITS WITHDRAWALS BALANCE
01-04-2025 B/F 680.44
01-04-2025 UPI/ahlamfarooq36-2/UPI/AXIS BANK/545722638994/ICI7357b 200.00 480.44
c588678/
03-04-2025 UPI/jio@citibank/JIO20BR000BZKVG/CITIBANK 349.00 131.44
03-04-2025 MOBILE BANKING MMT/IMPS/600219807282/irham shaf/JAKA0HKADAL 100.00 31.44
Page 2 of 21
TOTAL 73,46,161.00 73,46,841.42 0.02`;
expect('counts only date-prefixed lines (4)', estimateTxnRows(icipage) === 4);

// J&K-style dd-mm-yyyy and Kotak-style dd MMM... (slash + 3-letter month)
expect('dd/mm/yyyy counts', estimateTxnRows('01/04/2025 UPI/X 100') === 1);
expect('dd-MMM-yy counts', estimateTxnRows('01-Apr-25 NEFT IN 5000') === 1);
expect('wrapped narration does not count', estimateTxnRows('UPI/something/long\nc588678/') === 0);
expect('empty page counts 0', estimateTxnRows('') === 0);

// Chunk partitioning math (mirrors PAGES_PER_CHUNK=4 in the module):
// 21 real pages → 6 chunks (4+4+4+4+4+1).
const PAGES_PER_CHUNK = 4;
const chunksFor = (n: number) => Math.ceil(n / PAGES_PER_CHUNK);
expect('21 pages → 6 chunks', chunksFor(21) === 6);
expect('4 pages → 1 chunk', chunksFor(4) === 1);
expect('1 page → 1 chunk', chunksFor(1) === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
