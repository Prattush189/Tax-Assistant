/** Sweep every available bank-statement PDF and report the extracted
 *  column shape + which per-bank rule fires. Used to diff pdfGrid
 *  behaviour before/after a change to the column-merge heuristic.
 *
 *  Run: npx tsx scripts/sweep-grid-regression.mts
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
const { extractPdfGrid } = await import('../src/lib/pdfGrid');
const { detectAndMapBank } = await import('../src/lib/perBankRules');

const ROOTS = ['C:/Users/Prattush/Downloads/AI STUFF', 'C:/Users/Prattush/Downloads/AI STUFF/Statements'];
const targets: string[] = [];
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const name of fs.readdirSync(root)) {
    if (/\.pdf$/i.test(name)) targets.push(path.join(root, name));
  }
}
targets.push('C:/Users/Prattush/Downloads/Account_Statement_20250331_20260331_Sun Jul 05 2026 145650 GMT+0530 (India Standard Time).pdf');

// Silence pdfGrid's own chatter so the report diffs cleanly.
const origLog = console.log;
console.log = () => {};

const lines: string[] = [];
for (const t of targets.sort()) {
  let out = `${path.basename(t).slice(0, 52).padEnd(54)}`;
  try {
    const buf = fs.readFileSync(t);
    const grid = await extractPdfGrid(new File([new Uint8Array(buf)], path.basename(t), { type: 'application/pdf' }));
    if (!grid) { lines.push(out + 'NO GRID'); continue; }
    const det = detectAndMapBank(grid);
    out += `cols=${String(grid.columnCount).padStart(2)} rows=${String(grid.rows.length).padStart(5)}  `;
    out += `hdrs=[${(grid.columnHeaders ?? []).map(h => (h ?? '·')).join('|')}]`.slice(0, 96).padEnd(98);
    out += det ? `→ ${det.bank}` : '→ (wizard)';
    lines.push(out);
  } catch (e) {
    lines.push(out + `ERROR ${(e as Error).message.slice(0, 60)}`);
  }
}
console.log = origLog;
console.log(lines.join('\n'));
