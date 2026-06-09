// Polyfill BEFORE any pdfjs/react-pdf import (which is hoisted by ESM).
class DOMMatrixStub { a=1; b=0; c=0; d=1; e=0; f=0; constructor(_?: unknown){}; multiply(){return this;} translate(){return this;} scale(){return this;} rotate(){return this;} invertSelf(){return this;} }
class Path2DStub { constructor(_?:unknown){} addPath(){} moveTo(){} lineTo(){} closePath(){} }
class ImageDataStub { width:number; height:number; data:Uint8ClampedArray; constructor(w:number,h:number){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);} }
(globalThis as Record<string, unknown>).DOMMatrix = DOMMatrixStub;
(globalThis as Record<string, unknown>).Path2D = Path2DStub;
(globalThis as Record<string, unknown>).ImageData = ImageDataStub;

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic imports after polyfill setup.
const { pdfjs } = await import('react-pdf');
const workerPath = path.resolve(__dirname, '../node_modules/pdfjs-dist/build/pdf.worker.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

const { extractPdfGrid, applyMapping } = await import('../src/lib/pdfGrid');
const { detectAndMapBank } = await import('../src/lib/perBankRules');

async function main() {
  const buf = fs.readFileSync('C:/Users/Prattush/Downloads/cc204.pdf');
  const file = new File([new Uint8Array(buf)], 'cc204.pdf', { type: 'application/pdf' });
  const grid = await extractPdfGrid(file);
  if (!grid) throw new Error('no grid');
  console.log(`grid: ${grid.rows.length} rows × ${grid.columnCount} cols`);
  console.log(`column headers: ${JSON.stringify(grid.columnHeaders)}`);

  const detected = detectAndMapBank(grid);
  if (!detected) {
    console.log('NO RULE FIRED — would fall through to wizard');
    return;
  }
  console.log(`auto-detected bank: ${detected.bank}`);
  console.log(`mapping: ${JSON.stringify(detected.mapping.roles)}`);

  const result = applyMapping(detected.grid, detected.mapping, 'bank');
  const rows = result.rows;
  console.log(`applyMapping: ${rows.length} transactions`);
  console.log(`stats: ${JSON.stringify((result as { stats?: unknown }).stats)}`);

  let credits = 0, debits = 0, badAmount = 0;
  for (const r of rows) {
    if (r.amount === null || r.amount === undefined || !Number.isFinite(r.amount)) {
      badAmount++;
      continue;
    }
    if (r.amount > 0) credits += r.amount;
    else debits += -r.amount;
  }
  console.log(`\n=== Totals from extracted rows ===`);
  console.log(`Inflow (credits):  ₹${credits.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
  console.log(`Outflow (debits):  ₹${debits.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
  console.log(`Net:               ₹${(credits - debits).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
  console.log(`Bad amount rows:   ${badAmount}`);
  console.log();
  console.log(`Bank's printed Grand Total: W ₹39,50,738.27 / D ₹39,39,660.38 / net ₹11,077.89`);

  console.log(`\n=== First 15 extracted rows ===`);
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const r = rows[i];
    console.log(`${(i + 1).toString().padStart(3)}  ${(r.date ?? '?').padEnd(11)}  amt=${(r.amount ?? 0).toFixed(2).padStart(12)}  bal=${String(r.balance ?? '').padStart(13)}  ${(r.narration ?? '').slice(0, 50)}`);
  }

  const perDate = new Map<string, number>();
  for (const r of rows) {
    if (!r.date) continue;
    perDate.set(r.date, (perDate.get(r.date) ?? 0) + 1);
  }
  const lines = [...perDate.entries()].sort().map(([d,c]) => `${d.split('-').reverse().join('-')} ${c}`).join('\n');
  fs.writeFileSync('C:/Users/Prattush/AppData/Local/Temp/extr_per_date.txt', lines);

  console.log(`\n=== Top 30 amount outliers ===`);
  const sorted = [...rows].filter(r => r.amount != null).sort((a, b) => Math.abs(b.amount!) - Math.abs(a.amount!));
  for (const r of sorted.slice(0, 30)) {
    console.log(`  ${r.date ?? '?'}  amt=${r.amount}  bal=${r.balance}  ${(r.narration ?? '').slice(0, 80)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
