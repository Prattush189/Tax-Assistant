/** IDBI rule smoke test: detection, column mapping, and a full
 *  balance-chain reconciliation of the printed Dr/Cr amounts.
 *
 *  Run: npx tsx scripts/smoke-idbi-rule.mts
 */
import fs from 'fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
class DOMMatrixStub { a=1;b=0;c=0;d=1;e=0;f=0; constructor(_i?:unknown){} multiply(){return this} translate(){return this} scale(){return this} rotate(){return this} invertSelf(){return this} }
(globalThis as any).DOMMatrix = DOMMatrixStub;
class Path2DStub { constructor(_i?:unknown){} addPath(){} moveTo(){} lineTo(){} closePath(){} }
(globalThis as any).Path2D = Path2DStub;
class ImageDataStub { width:number;height:number;data:Uint8ClampedArray; constructor(w:number,h:number){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4)} }
(globalThis as any).ImageData = ImageDataStub;

const { pdfjs } = await import('react-pdf');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve(__dirname, '../node_modules/pdfjs-dist/build/pdf.worker.mjs')).href;

const { extractPdfGrid, parseDate } = await import('../src/lib/pdfGrid');
const { detectAndMapBank } = await import('../src/lib/perBankRules');

const PDF = 'C:/Users/Prattush/Downloads/Account_Statement_20250331_20260331_Sun Jul 05 2026 145650 GMT+0530 (India Standard Time).pdf';
const buf = fs.readFileSync(PDF);
const raw = await extractPdfGrid(new File([new Uint8Array(buf)], 'idbi.pdf', { type: 'application/pdf' }));
if (!raw) { console.log('FAIL: no grid'); process.exit(1); }

let fails = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails++;
};

const det = detectAndMapBank(raw);
check(!!det, `detectAndMapBank fired -> ${det?.bank ?? 'null'}`);
if (!det) process.exit(1);
check(det.bank === 'IDBI Bank', `bank == IDBI Bank (got "${det.bank}")`);
check(
  det.mapping.roles.join(',') === 'date,valueDate,narration,reference,debit,credit,balance',
  `roles == date,valueDate,narration,reference,debit,credit,balance (got ${det.mapping.roles.join(',')})`,
);

const g = det.grid;
const num = (s: string) => (s ? parseFloat(s.replace(/,/g, '')) : 0);
const rows = g.rows;
check(rows.length === 1244, `1244 transaction rows (got ${rows.length})`);

// Every row must have a date, a balance, and exactly one of Dr / Cr.
let noDate = 0, noBal = 0, noAmt = 0, bothAmt = 0;
for (const r of rows) {
  if (!parseDate(r[0])) noDate++;
  if (!r[6]) noBal++;
  const d = !!r[4], c = !!r[5];
  if (!d && !c) noAmt++;
  if (d && c) bothAmt++;
}
check(noDate === 0, `every row parses a date (${noDate} bad)`);
check(noBal === 0, `every row has a balance (${noBal} missing)`);
check(noAmt === 0, `every row has an amount (${noAmt} missing)`);
check(bothAmt === 0, `no row has BOTH Dr and Cr (${bothAmt} ambiguous)`);

const debits = rows.filter(r => r[4]).length;
const credits = rows.filter(r => r[5]).length;
console.log(`\n  debits=${debits}  credits=${credits}  total=${debits + credits}`);
check(credits > 0, `credits are non-zero (was 0 before the pdfGrid merge fix)`);

// ── Balance-chain reconciliation ──────────────────────────────────
// Statement is newest-first, so walking DOWN the page goes back in
// time: balance[i] - balance[i+1] must equal the signed amount of
// transaction i.
let mismatch = 0;
const firstBad: string[] = [];
for (let i = 0; i < rows.length - 1; i++) {
  const signed = num(rows[i][5]) - num(rows[i][4]);
  const delta = +(num(rows[i][6]) - num(rows[i + 1][6])).toFixed(2);
  if (Math.abs(signed - delta) > 0.011) {
    mismatch++;
    if (firstBad.length < 5) {
      firstBad.push(`    row ${i} ${rows[i][0]} "${rows[i][2].slice(0, 40)}" dr=${rows[i][4]} cr=${rows[i][5]} bal=${rows[i][6]} prevBal=${rows[i + 1][6]} signed=${signed} delta=${delta}`);
    }
  }
}
check(mismatch === 0, `balance chain reconciles on all ${rows.length - 1} consecutive pairs (${mismatch} mismatches)`);
firstBad.forEach(l => console.log(l));

const totalDr = rows.reduce((a, r) => a + num(r[4]), 0);
const totalCr = rows.reduce((a, r) => a + num(r[5]), 0);
const closing = num(rows[0][6]);              // newest row = closing balance
const openingAfter = num(rows[rows.length - 1][6]); // oldest row's balance
const opening = +(openingAfter - (num(rows[rows.length - 1][5]) - num(rows[rows.length - 1][4]))).toFixed(2);
console.log(`\n  opening=${opening.toFixed(2)}  credits=${totalCr.toFixed(2)}  debits=${totalDr.toFixed(2)}  closing=${closing.toFixed(2)}`);
const computed = +(opening + totalCr - totalDr).toFixed(2);
check(Math.abs(computed - closing) < 0.011, `opening + credits - debits == closing (${computed} vs ${closing})`);

console.log(`\n--- first 3 mapped rows ---`);
for (let i = 0; i < 3; i++) console.log(`  ${JSON.stringify(rows[i])}`);
console.log(`--- last 2 mapped rows ---`);
for (let i = rows.length - 2; i < rows.length; i++) console.log(`  ${JSON.stringify(rows[i])}`);

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
