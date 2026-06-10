/**
 * Regression fixture for the J&K Bank GENERAL SAVING format
 * (amitT.pdf — 95 pages, 4-column grid with date fused into the
 * narration column).
 *
 * Locks in three behaviours:
 *   1. JK_BANK_SAVINGS fires (preprocess splits the leading date,
 *      positional mapping applies).
 *   2. Extraction ties to the bank's printed Grand Total to the
 *      paisa: W=13,16,104.39 / D=12,64,425.60 / net −51,678.79.
 *   3. Cross-page pendings survive the page banner (the implausible-
 *      balance guard preserves incomplete pendings — 34 transactions
 *      were lost before that fix).
 *
 * Requires the fixture PDF at C:/Users/Prattush/Downloads/amitT.pdf —
 * exits 0 with a SKIP note when absent so CI machines without the
 * fixture don't fail.
 *
 * Run: npx tsx scripts/jkbank-amit-savings-test.ts
 */

class DOMMatrixStub { a=1; b=0; c=0; d=1; e=0; f=0; constructor(_?: unknown){} multiply(){return this;} translate(){return this;} scale(){return this;} rotate(){return this;} invertSelf(){return this;} }
class Path2DStub { constructor(_?: unknown){} addPath(){} moveTo(){} lineTo(){} closePath(){} }
class ImageDataStub { width: number; height: number; data: Uint8ClampedArray; constructor(w: number, h: number){ this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } }
(globalThis as Record<string, unknown>).DOMMatrix = DOMMatrixStub;
(globalThis as Record<string, unknown>).Path2D = Path2DStub;
(globalThis as Record<string, unknown>).ImageData = ImageDataStub;

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = 'C:/Users/Prattush/Downloads/amitT.pdf';

if (!fs.existsSync(FIXTURE)) {
  console.log(`SKIP — fixture not found: ${FIXTURE}`);
  process.exit(0);
}

const { pdfjs } = await import('react-pdf');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve(__dirname, '../node_modules/pdfjs-dist/build/pdf.worker.mjs')).href;
const { extractPdfGrid, applyMapping } = await import('../src/lib/pdfGrid');
const { detectAndMapBank } = await import('../src/lib/perBankRules');

const buf = fs.readFileSync(FIXTURE);
const file = new File([new Uint8Array(buf)], 'amitT.pdf', { type: 'application/pdf' });
const grid = await extractPdfGrid(file);
if (!grid) { console.error('FAIL: no grid extracted'); process.exit(1); }

let failures = 0;
const expect = (label: string, cond: boolean) => {
  if (cond) console.log(`  ok  ${label}`);
  else { console.error(`FAIL  ${label}`); failures++; }
};

const detected = detectAndMapBank(grid);
expect('JK_BANK_SAVINGS rule fires', detected?.bank === 'J&K Bank (Savings)');
if (!detected) process.exit(1);
expect('roles are date/narration/debit/credit/balance',
  JSON.stringify(detected.mapping.roles) === JSON.stringify(['date', 'narration', 'debit', 'credit', 'balance']));

const result = applyMapping(detected.grid, detected.mapping, 'bank');
let credits = 0, debits = 0;
for (const r of result.rows) {
  if (r.amount > 0) credits += r.amount; else debits += -r.amount;
}
// Bank's printed Grand Total on page 94 of the statement.
expect(`inflow ties to printed D total (got ${credits.toFixed(2)})`, Math.abs(credits - 1264425.60) < 0.005);
expect(`outflow ties to printed W total (got ${debits.toFixed(2)})`, Math.abs(debits - 1316104.39) < 0.005);
expect(`transaction count is 1631 (got ${result.rows.length})`, result.rows.length === 1631);
expect('not detected as cash credit', result.stats.isCashCredit === false);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
