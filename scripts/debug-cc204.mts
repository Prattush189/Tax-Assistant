import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync('C:/Users/Prattush/Downloads/cc204.pdf')) }).promise;
const page = await doc.getPage(1);
const vp = page.getViewport({ scale: 1 });
const items = (await page.getTextContent()).items as Array<{ str: string; transform: number[]; width: number }>;
const norm = items
  .filter(i => i.str?.trim())
  .map(i => ({ s: i.str, x: i.transform[4], y: vp.height - i.transform[5], w: i.width }));
norm.sort((a, b) => a.y - b.y || a.x - b.x);
console.log('item count:', norm.length);

// Find the transaction area — skip header until we hit a date pattern
let started = false;
let count = 0;
for (const it of norm) {
  if (/^\d{2}-\d{2}-\d{4}$/.test(it.s)) started = true;
  if (started && count < 60) {
    console.log(String(count).padStart(3), 'y=' + it.y.toFixed(0).padStart(4), 'x=' + it.x.toFixed(0).padStart(4), 'w=' + it.w.toFixed(0).padStart(3), JSON.stringify(it.s.slice(0, 50)));
    count++;
  }
}
