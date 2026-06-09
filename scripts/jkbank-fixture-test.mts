/**
 * Reproducible regression test against the J&K Bank statement that
 * surfaces the ₹97,710 gross-total over-count. Loads bank_unloacked.pdf
 * end-to-end through the real `extractPdfGrid` and `applyMapping`
 * pipeline (same code the browser wizard runs), captures the output,
 * computes ground truth from the balance trajectory, and reports the
 * gap with row-level detail so we can iterate fixes against it.
 *
 * Usage:
 *   npx tsx scripts/jkbank-fixture-test.mts
 */
import fs from 'fs';
import { Blob } from 'buffer';

// pdfjs-dist needs DOMMatrix when imported in Node. We don't call any
// matrix-using paths (no rendering, just text extraction), so a stub
// is enough to clear the top-level constructor reference.
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
// Path2D — referenced inside pdfjs.mjs as a fallback for canvas paths.
class Path2DStub {
  constructor(_init?: unknown) { /* no-op */ }
  addPath() { /* no-op */ }
  moveTo() { /* no-op */ }
  lineTo() { /* no-op */ }
  closePath() { /* no-op */ }
}
(globalThis as { Path2D?: typeof Path2DStub }).Path2D = Path2DStub;
// ImageData stub — pdfjs renders images even when we only ask for text.
class ImageDataStub {
  width: number; height: number; data: Uint8ClampedArray;
  constructor(w: number, h: number) {
    this.width = w; this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
}
(globalThis as { ImageData?: typeof ImageDataStub }).ImageData = ImageDataStub;

// Disable worker thread — Node loads everything in main thread anyway.
const pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjsModule.GlobalWorkerOptions.workerSrc = ''; // empty string disables worker

const {
  extractPdfGrid,
  suggestMapping,
  applyMapping,
} = await import('../src/lib/pdfGrid');

const PDF_PATH = 'C:/Users/Prattush/Downloads/bank_unloacked.pdf';
const buf = fs.readFileSync(PDF_PATH);

// Mock a File-like object — the wizard calls `.arrayBuffer()`, `.type`,
// and `.name`. Node 18+ Blob has arrayBuffer(); we add the other two
// properties as a tiny shim.
const blob = new Blob([buf], { type: 'application/pdf' });
const file = Object.assign(blob, {
  name: 'bank_unloacked.pdf',
  lastModified: Date.now(),
}) as unknown as File;

console.log(`PDF size: ${(buf.length / 1024).toFixed(1)} KB`);

const grid = await extractPdfGrid(file);
if (!grid) {
  console.error('extractPdfGrid returned null — text layer missing');
  process.exit(1);
}
console.log(`grid: ${grid.rows.length} rows × ${grid.columnCount} columns`);

const mapping = suggestMapping(grid);
console.log('column mapping:', JSON.stringify(mapping, null, 2));

const mapped = applyMapping(grid, mapping, { kind: 'bank' });
console.log(`applyMapping → ${mapped.transactions.length} transactions`);
console.log('stats:', JSON.stringify(mapped.stats, null, 2));

// === GROUND-TRUTH COMPUTATION =====================================
//
// Bank's printed running balance is the only consistent ground truth.
// PDF page 1 opening shown at top: -12,79,294.23 Dr
// PDF page 6 last row balance:     -13,72,089.51 Dr
// Net change should equal sum(credits) - sum(debits) of every
// real transaction.
const PRINTED_OPENING = -1279294.23;
const PRINTED_CLOSING = -1372089.51;
const PRINTED_NET = PRINTED_CLOSING - PRINTED_OPENING;
console.log(`\nGROUND TRUTH (from PDF cover): opening=${PRINTED_OPENING}, closing=${PRINTED_CLOSING}, net=${PRINTED_NET.toFixed(2)}`);

// === EXTRACTED TOTALS =============================================
let debits = 0;
let credits = 0;
for (const t of mapped.transactions) {
  if (t.amount < 0) debits += -t.amount;
  else credits += t.amount;
}
const extractedNet = credits - debits;
console.log(`EXTRACTED: ${mapped.transactions.length} rows, debits=${debits.toFixed(2)}, credits=${credits.toFixed(2)}, net=${extractedNet.toFixed(2)}`);
console.log(`Gap vs ground-truth net: ${(extractedNet - PRINTED_NET).toFixed(2)}`);

// === PER-PAGE / PER-DATE COLUMN-SUM RECONCILIATION ================
// The bank prints a per-page footer:
//   Page 1: W 121,160 / D 107,352.42
//   Page 2: W 139,610 / D 107,045.50
//   Page 3: W 158,700 / D 89,875.92
//   Page 4: W 72,000  / D 79,058.88
//   Page 5: W 114,660 / D 79,652.00
//   Page 6: W 650     / D 3,000.00
// These should match our per-date sums if rows are aligned correctly.
// Group extracted rows by month-day chunks that match each PDF page's
// date range; report the discrepancy per chunk.
const PAGE_DATE_BANDS: Array<{ label: string; from: string; to: string; W: number; D: number }> = [
  { label: 'Page 1', from: '2026-04-01', to: '2026-04-06', W: 121160,   D: 107352.42 },
  { label: 'Page 2', from: '2026-04-07', to: '2026-04-08', W: 139610,   D: 107045.50 },
  { label: 'Page 3', from: '2026-04-09', to: '2026-04-13', W: 158700,   D: 89875.92  },
  { label: 'Page 4', from: '2026-04-14', to: '2026-04-20', W: 72000,    D: 79058.88  },
  { label: 'Page 5', from: '2026-04-20', to: '2026-04-30', W: 114660,   D: 79652.00  },
  { label: 'Page 6', from: '2026-04-30', to: '2026-04-30', W: 650,      D: 3000.00   },
];

console.log(`\n${'Page'.padEnd(8)} ${'Bank-W'.padStart(12)} ${'Ours-W'.padStart(12)} ${'ΔW'.padStart(10)}  ${'Bank-D'.padStart(12)} ${'Ours-D'.padStart(12)} ${'ΔD'.padStart(10)}`);
for (const p of PAGE_DATE_BANDS) {
  let ourW = 0, ourD = 0;
  for (const t of mapped.transactions) {
    if (!t.date) continue;
    if (t.date < p.from || t.date > p.to) continue;
    if (t.amount < 0) ourW += -t.amount;
    else ourD += t.amount;
  }
  const dW = ourW - p.W;
  const dD = ourD - p.D;
  const flag = Math.abs(dW) > 1 || Math.abs(dD) > 1 ? ' ❌' : ' ✓';
  console.log(
    `${p.label.padEnd(8)} ${p.W.toFixed(2).padStart(12)} ${ourW.toFixed(2).padStart(12)} ${dW.toFixed(2).padStart(10)}  ${p.D.toFixed(2).padStart(12)} ${ourD.toFixed(2).padStart(12)} ${dD.toFixed(2).padStart(10)}${flag}`,
  );
}

// === SUSPECT-ROW DUMP =============================================
// Within each over-counting page, list rows where amount and balance
// don't reconcile against the previous row's balance.
console.log(`\n=== Suspect rows (balance does not follow from prior balance) ===`);
let prevBal: number | null = null;
let suspects = 0;
mapped.transactions.forEach((t, i) => {
  if (t.balance == null) return;
  if (prevBal != null) {
    const expected = prevBal + t.amount;
    const err = Math.abs(expected - t.balance);
    if (err > 0.05) {
      suspects++;
      console.log(
        `  row ${i + 1}  ${t.date}  amt=${t.amount.toFixed(2).padStart(11)}  bal=${t.balance.toFixed(2).padStart(13)}  prev=${prevBal.toFixed(2).padStart(13)}  err=${err.toFixed(2)}`,
      );
      console.log(`     narration: ${t.narration?.slice(0, 80)}`);
    }
  }
  prevBal = t.balance;
});
console.log(`suspect rows: ${suspects}`);

// === EXIT CODE ====================================================
const totalErr = Math.abs(extractedNet - PRINTED_NET);
if (totalErr > 1) {
  console.log(`\n❌ FAIL: extracted net differs from ground-truth net by ₹${totalErr.toFixed(2)}`);
  process.exit(1);
}
console.log(`\n✓ PASS: extracted totals match ground truth within ₹1`);
