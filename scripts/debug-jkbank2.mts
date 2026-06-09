/** Reconstruct the bank's actual transactions from the raw pdfjs output
 *  and compare against the CSV. */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import Papa from 'papaparse';

const PDF = 'C:/Users/Prattush/Downloads/bank_unloacked.pdf';
const CSV = 'C:/Users/Prattush/Downloads/2026-04-01_2026-04-30.csv';

const buf = fs.readFileSync(PDF);
const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;

interface Item { str: string; x: number; y: number; }
const balsByPage: Array<{ page: number; y: number; bal: number; raw: string }> = [];
const dates: Array<{ page: number; y: number; date: string }> = [];
const amts: Array<{ page: number; y: number; x: number; amt: number; raw: string }> = [];

for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  for (const it of content.items as Array<{ str: string; transform: number[]; width: number }>) {
    const str = it.str.trim();
    if (!str) continue;
    const x = it.transform[4];
    const y = viewport.height - it.transform[5];
    // balance?
    const balM = /^-?[\d,]+\.\d{2}\s*(?:Dr|Cr)?$/i.exec(str);
    if (balM && x > 500) {
      const num = parseFloat(str.replace(/[Dd]r|[Cc]r|,/g, ''));
      balsByPage.push({ page: p, y, bal: num, raw: str });
      continue;
    }
    // date?
    if (/^\d{2}-\d{2}-\d{4}$/.test(str) && x < 50) {
      dates.push({ page: p, y, date: str });
      continue;
    }
    // amount? (in withdrawal or deposit column, x roughly 330-470)
    const amtM = /^[\d,]+\.\d{2}$/.exec(str);
    if (amtM && x > 320 && x < 480) {
      amts.push({ page: p, y, x, amt: parseFloat(str.replace(/,/g, '')), raw: str });
    }
  }
}

// Compute deltas from sequential balances per page (page order)
balsByPage.sort((a, b) => a.page - b.page || a.y - b.y);
console.log(`Found ${balsByPage.length} balances total`);

let prevBal: number | null = null;
let realDebits = 0;
let realCredits = 0;
let i = 0;
for (const b of balsByPage) {
  i++;
  if (prevBal != null) {
    const delta = b.bal - prevBal;
    if (delta < 0) realDebits += -delta;
    else if (delta > 0) realCredits += delta;
  }
  prevBal = b.bal;
}
console.log(`Real debits from balance deltas: ${realDebits.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
console.log(`Real credits from balance deltas: ${realCredits.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

// Sum withdrawal-column and deposit-column amounts (rough x bands)
const wAmts = amts.filter(a => a.x > 330 && a.x < 400);
const dAmts = amts.filter(a => a.x > 430 && a.x < 490);
console.log(`Sum of withdrawal-column amounts: ${wAmts.reduce((a, x) => a + x.amt, 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${wAmts.length} amounts)`);
console.log(`Sum of deposit-column amounts:    ${dAmts.reduce((a, x) => a + x.amt, 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${dAmts.length} amounts)`);

// CSV totals
const rows = Papa.parse<{ Type: string; Amount: string }>(fs.readFileSync(CSV, 'utf8'), { header: true, skipEmptyLines: true }).data;
let csvD = 0, csvC = 0;
rows.forEach(r => { const a = parseFloat(r.Amount) || 0; if (r.Type === 'Debit') csvD += a; else if (r.Type === 'Credit') csvC += a; });
console.log(`CSV debit total:  ${csvD.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
console.log(`CSV credit total: ${csvC.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
