/**
 * Debug pdfGrid on the J&K Bank PDF to see what the wizard sees.
 * Loads the PDF with pdfjs-dist (same as browser), extracts text items,
 * runs the gridFromTextItems pipeline, then traces row-by-row.
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

const PDF = 'C:/Users/Prattush/Downloads/bank_unloacked.pdf';
const buf = fs.readFileSync(PDF);

const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
console.log(`pages: ${doc.numPages}`);

// Mirror what the wizard does — get text content per page, build a
// flat list of (text, x, y, page) items.
interface Item { str: string; x: number; y: number; page: number; width: number; }
const items: Item[] = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  for (const it of content.items as Array<{ str: string; transform: number[]; width: number }>) {
    items.push({
      str: it.str,
      x: it.transform[4],
      // Flip Y so top-of-page = 0 (matches our convention)
      y: viewport.height - it.transform[5] + (p - 1) * 10_000, // page offset
      page: p,
      width: it.width,
    });
  }
}
console.log(`raw text items: ${items.length}`);

// Print the first 60 items so we can see structure
console.log('\n=== first 60 text items ===');
items.slice(0, 60).forEach((it, i) => {
  console.log(
    `${i.toString().padStart(3)} p${it.page} y=${it.y.toFixed(0).padStart(6)} x=${it.x.toFixed(0).padStart(4)} "${it.str}"`,
  );
});

// Cluster items into rows by y-band (5px tolerance, typical)
const BAND = 5;
const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
const rows: Item[][] = [];
let cur: Item[] = [];
let curY = -Infinity;
for (const it of sorted) {
  if (Math.abs(it.y - curY) > BAND) {
    if (cur.length) rows.push(cur);
    cur = [it];
    curY = it.y;
  } else {
    cur.push(it);
  }
}
if (cur.length) rows.push(cur);

console.log(`\n=== ${rows.length} clustered rows. first 30: ===`);
rows.slice(0, 30).forEach((row, i) => {
  const txt = row.map((it) => `[${it.x.toFixed(0)}] ${it.str}`).join(' | ');
  console.log(`${i.toString().padStart(3)} y=${row[0].y.toFixed(0)} : ${txt.slice(0, 250)}`);
});
