/** Reproduce the BROWSER extraction path for the SBI statement.
 *
 *  extractPdfGrid(file, password) runs the identical pdfjs getDocument
 *  call the browser uses (same password-decrypt path), so the grid this
 *  produces matches what the browser builds. We then:
 *    - run detectAndMapBank and report whether the SBI rule fires,
 *    - locate the first row index of every SBI fingerprint marker, to
 *      prove the old 30-row window missed it and the new 60-row window
 *      + "relationship summary" cover-title anchor catches it.
 *
 *  Run: npx tsx scripts/debug-sbi-fingerprint.mts
 */
import fs from 'fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// pdfjs-dist needs DOMMatrix/Path2D/ImageData at import time in Node.
class DOMMatrixStub {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  constructor(_init?: unknown) { /* no-op */ }
  multiply() { return this; }
  translate() { return this; }
  scale() { return this; }
  rotate() { return this; }
  invertSelf() { return this; }
}
(globalThis as { DOMMatrix?: typeof DOMMatrixStub }).DOMMatrix = DOMMatrixStub;
class Path2DStub {
  constructor(_init?: unknown) { /* no-op */ }
  addPath() { /* no-op */ }
  moveTo() { /* no-op */ }
  lineTo() { /* no-op */ }
  closePath() { /* no-op */ }
}
(globalThis as { Path2D?: typeof Path2DStub }).Path2D = Path2DStub;
class ImageDataStub {
  width: number; height: number; data: Uint8ClampedArray;
  constructor(w: number, h: number) {
    this.width = w; this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
}
(globalThis as { ImageData?: typeof ImageDataStub }).ImageData = ImageDataStub;

// Point react-pdf's OWN pdfjs instance (the one extractPdfGrid uses) at
// the real worker file. Setting it on a different pdfjs-dist build does
// nothing for react-pdf's singleton.
const { pdfjs } = await import('react-pdf');
const workerPath = path.resolve(__dirname, '../node_modules/pdfjs-dist/build/pdf.worker.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

const { extractPdfGrid } = await import('../src/lib/pdfGrid');
const { detectAndMapBank } = await import('../src/lib/perBankRules');

const PDF = 'C:/Users/Prattush/Downloads/AI STUFF/AccountStatement_09062026_145403 (1) (1).pdf';
const PASSWORD = '35997280183';

const MARKERS: Array<{ label: string; test: (s: string) => boolean }> = [
  { label: 'sbi.co.in', test: s => s.includes('sbi.co.in') },
  { label: 'state bank of india', test: s => s.includes('state bank of india') },
  { label: 'SBIN0xxxx (IFSC)', test: s => /\bsbin0\d{4,}\b/i.test(s) },
  { label: 'relationship summary', test: s => s.includes('relationship summary') },
  { label: 'my information ... branch information', test: s => /\bmy information\b.*\bbranch information\b/i.test(s) },
];

function firstRowIndex(rows: string[][], test: (s: string) => boolean): number {
  for (let i = 0; i < rows.length; i++) {
    if (test(rows[i].join(' ').toLowerCase())) return i;
  }
  return -1;
}

const buf = fs.readFileSync(PDF);
const file = new File([new Uint8Array(buf)], 'AccountStatement.pdf', { type: 'application/pdf' });

const grid = await extractPdfGrid(file, PASSWORD);
if (!grid) {
  console.log('NO GRID (extraction failed)');
  process.exit(1);
}

console.log(`grid: columnCount=${grid.columnCount} rows=${grid.rows.length} pages=${grid.pageCount}`);
console.log(`headers: ${JSON.stringify(grid.columnHeaders)}`);
console.log('');
console.log('SBI marker first-appearance row index (-1 = absent):');
for (const m of MARKERS) {
  const idx = firstRowIndex(grid.rows, m.test);
  const in30 = idx >= 0 && idx < 30 ? 'IN old-30' : (idx >= 0 ? 'PAST old-30' : '-- absent');
  const in60 = idx >= 0 && idx < 60 ? 'IN new-60' : (idx >= 0 ? 'PAST new-60' : '-- absent');
  console.log(`  ${m.label.padEnd(42)} row=${String(idx).padStart(4)}   ${in30.padEnd(11)} ${in60}`);
}
console.log('');

const detected = detectAndMapBank(grid);
if (detected) {
  console.log(`[PASS] detectAndMapBank -> ${detected.bank}`);
  console.log(`       roles: ${detected.mapping.roles.join(' / ')}`);
} else {
  console.log('[FAIL] detectAndMapBank -> null (would fall to wizard)');
}
