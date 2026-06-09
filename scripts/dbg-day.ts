class DOMMatrixStub { a=1; b=0; c=0; d=1; e=0; f=0; constructor(_?: unknown){}; multiply(){return this;} translate(){return this;} scale(){return this;} rotate(){return this;} invertSelf(){return this;} }
class Path2DStub { constructor(_?:unknown){} addPath(){} moveTo(){} lineTo(){} closePath(){} }
class ImageDataStub { width:number; height:number; data:Uint8ClampedArray; constructor(w:number,h:number){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);} }
(globalThis as Record<string, unknown>).DOMMatrix = DOMMatrixStub;
(globalThis as Record<string, unknown>).Path2D = Path2DStub;
(globalThis as Record<string, unknown>).ImageData = ImageDataStub;
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { pdfjs } = await import('react-pdf');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve(__dirname, '../node_modules/pdfjs-dist/build/pdf.worker.mjs')).href;
const { extractPdfGrid, applyMapping } = await import('../src/lib/pdfGrid');
const { detectAndMapBank } = await import('../src/lib/perBankRules');
const buf = fs.readFileSync('C:/Users/Prattush/Downloads/cc204.pdf');
const file = new File([new Uint8Array(buf)], 'cc204.pdf', { type: 'application/pdf' });
const grid = await extractPdfGrid(file);
if (!grid) throw new Error('no grid');
const detected = detectAndMapBank(grid)!;
const result = applyMapping(detected.grid, detected.mapping, 'bank');
const target = process.argv[2] ?? '2025-04-02';
for (const r of result.rows) {
  if (r.date === target) console.log(r.amount, r.balance, (r.narration ?? '').slice(0, 80));
}
