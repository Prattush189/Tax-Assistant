/**
 * Targeted hunt for the source of the ₹97,710 gross over-count
 * (and the ₹48,000 net mismatch vs the printed balance trajectory)
 * on bank_unloacked.pdf.
 *
 * Strategy:
 *   1. Pull text items via pdfjs-dist (same as the browser wizard).
 *   2. Cluster into rows by y-band — same approach pdfGrid.ts uses.
 *   3. Identify rows that look like real transactions (date + amount).
 *   4. Compute the balance-delta-implied amount for each transaction
 *      from the printed running balance and compare against the
 *      printed W/D column amount.
 *   5. Print every row where amount ≠ balance-delta. That's the
 *      list we need to fix.
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

const PDF = 'C:/Users/Prattush/Downloads/bank_unloacked.pdf';
const buf = fs.readFileSync(PDF);
const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;

interface RawItem { str: string; x: number; y: number; page: number; }
const items: RawItem[] = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  for (const it of content.items as Array<{ str: string; transform: number[] }>) {
    const s = it.str.trim();
    if (!s) continue;
    items.push({
      str: s,
      x: it.transform[4],
      y: viewport.height - it.transform[5] + (p - 1) * 1000,
      page: p,
    });
  }
}

// Y-band cluster (5px — same as pdfGrid's Y_TOLERANCE).
items.sort((a, b) => a.y - b.y);
const rows: RawItem[][] = [];
let cur: RawItem[] = [];
let curY = -Infinity;
for (const it of items) {
  if (cur.length === 0 || Math.abs(it.y - curY) <= 5) {
    cur.push(it);
    curY = cur.length === 1 ? it.y : (curY + it.y) / 2;
  } else {
    rows.push(cur);
    cur = [it];
    curY = it.y;
  }
}
if (cur.length) rows.push(cur);

// Parse each row into {date, narr, W, D, balance}. Column x-bands:
//   date     x ~  23-50
//   narr     x ~  85-260
//   chq.no   x ~ 260-300
//   W (debit)x ~ 330-420
//   D (cred) x ~ 430-490
//   balance  x ~ 500-560
function parseRow(items: RawItem[]) {
  let date = '', narr: string[] = [], W = '', D = '', bal = '', page = items[0].page;
  for (const it of items.sort((a, b) => a.x - b.x)) {
    if (/^\d{2}-\d{2}-\d{4}$/.test(it.str) && it.x < 80) date = it.str;
    else if (it.x < 270) narr.push(it.str);
    else if (it.x >= 320 && it.x < 420 && /^-?[\d,]+\.\d{2}$/.test(it.str)) W = it.str;
    else if (it.x >= 420 && it.x < 500 && /^-?[\d,]+\.\d{2}$/.test(it.str)) D = it.str;
    else if (it.x >= 500 && /^-?[\d,]+\.\d{2}\s*(?:Dr|Cr)?$/i.test(it.str)) bal = it.str;
  }
  const parse = (s: string) => parseFloat(s.replace(/[Dd]r|[Cc]r|,/g, '')) || 0;
  return { date, narr: narr.join(' '), W: parse(W), D: parse(D), bal: parse(bal), Wraw: W, Draw: D, balraw: bal, page };
}

// Find real transaction rows — must have a date + (W or D or balance).
// Skip header / footer / blank rows.
const txRows = rows.map(parseRow).filter(r => r.bal || r.W || r.D);

// Find the FIRST balance encountered to use as opening anchor.
let openingBal: number | null = null;
for (const r of txRows) {
  if (r.bal && !r.date && !r.W && !r.D) {
    openingBal = r.bal; // bare opening row
    break;
  }
}
if (openingBal == null) {
  // No bare opening row — use the printed first balance as anchor,
  // assuming the first transaction's amount is correct.
  const first = txRows[0];
  if (first && first.bal) {
    // pre-tx balance = post-tx - amount(if Debit, +; if Credit, -)
    openingBal = first.bal + (first.W || 0) - (first.D || 0);
  }
}
console.log(`Opening balance anchor: ${openingBal?.toFixed(2)}`);

// Sequentially compute "real" amount per row from balance delta and
// compare against printed W/D.
let prevBal = openingBal;
let mismatches = 0;
let extraW = 0, extraD = 0;
console.log(`\n${'#'.padStart(3)}  ${'page'.padStart(4)}  ${'date'.padEnd(10)}  ${'W(printed)'.padStart(11)}  ${'D(printed)'.padStart(11)}  ${'balance'.padStart(13)}  ${'real-delta'.padStart(11)}  narration`);
txRows.forEach((r, i) => {
  if (!r.bal) return;
  let realAmt = 0;
  let realDir = '';
  if (prevBal != null) {
    realAmt = r.bal - prevBal;
    realDir = realAmt > 0 ? 'D' : realAmt < 0 ? 'W' : '-';
  }
  const printedSigned = (r.D || 0) - (r.W || 0);
  const err = Math.abs(printedSigned - realAmt);
  const flag = err > 0.5 ? '❌' : '';
  if (err > 0.5) {
    mismatches++;
    if (r.W) extraW += r.W; // printed-only debit, not in real
    if (r.D) extraD += r.D;
    console.log(
      `${(i + 1).toString().padStart(3)}  ${r.page.toString().padStart(4)}  ${r.date.padEnd(10)}  ${r.W.toFixed(2).padStart(11)}  ${r.D.toFixed(2).padStart(11)}  ${r.bal.toFixed(2).padStart(13)}  ${realAmt.toFixed(2).padStart(11)}  ${flag} ${r.narr.slice(0, 70)}`,
    );
  }
  prevBal = r.bal;
});

console.log(`\nTotal mismatches: ${mismatches}`);
console.log(`Sum of printed W on mismatched rows: ${extraW.toFixed(2)}`);
console.log(`Sum of printed D on mismatched rows: ${extraD.toFixed(2)}`);
