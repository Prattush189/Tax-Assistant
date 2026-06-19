/** End-to-end: the real legacy-.xls path. Reads the Bank of Baroda
 *  OverDraft .xls (BIFF8) the way excelToRows now does (SheetJS,
 *  raw:false), builds the wizard grid, and runs bank auto-detect.
 *  Proves the "Excel appears empty" bug is gone.
 *  Run: npx tsx scripts/smoke-xls-bob.mts "<path-to.xls>"
 */
import fs from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// pdfGrid pulls in pdfjs which touches these browser globals at import.
class DOMMatrixStub { a=1;b=0;c=0;d=1;e=0;f=0; constructor(_?:unknown){} multiply(){return this;} translate(){return this;} scale(){return this;} rotate(){return this;} invertSelf(){return this;} }
(globalThis as { DOMMatrix?: typeof DOMMatrixStub }).DOMMatrix = DOMMatrixStub;
class Path2DStub { constructor(_?:unknown){} addPath(){} moveTo(){} lineTo(){} closePath(){} }
(globalThis as { Path2D?: typeof Path2DStub }).Path2D = Path2DStub;
class ImageDataStub { width:number;height:number;data:Uint8ClampedArray; constructor(w:number,h:number){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);} }
(globalThis as { ImageData?: typeof ImageDataStub }).ImageData = ImageDataStub;

const target = process.argv[2] ?? 'C:/Users/Prattush/Downloads/OpTransactionHistoryUX519-04-2026.xls';

// Replicate xlsViaSheetJs(buf) from src/lib/excelToRows.ts exactly.
async function xlsToRows(buf: ArrayBuffer): Promise<string[][] | null> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false });
  const all: string[][] = [];
  const multi = wb.SheetNames.length > 1;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '', raw: false });
    if (!rows.length) continue;
    if (multi) all.push([`-- Sheet: ${name} --`]);
    for (const r of rows) {
      const cells = (r as unknown[]).map(c => (c == null ? '' : String(c).trim()));
      if (cells.some(c => c !== '')) all.push(cells);
    }
  }
  return all.length ? all : null;
}

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`); };

const buf = fs.readFileSync(path.resolve(target));
// Confirm it really is a legacy OLE2 .xls, not OOXML.
const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
check('file is legacy .xls (not a PK/zip .xlsx)', !isZip);

const rows = await xlsToRows(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
check('excelToRows returns rows (was null → "empty")', !!rows && rows.length > 0, `(rows=${rows?.length ?? 0})`);
if (!rows) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }

const { rowsToFakeGrid, suggestMapping, applyMapping } = await import('../src/lib/pdfGrid');
const grid = rowsToFakeGrid(rows);
check('rowsToFakeGrid builds a grid', !!grid, `(cols=${grid?.columnCount}, rows=${grid?.rows.length})`);
if (!grid) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }

// Empty spacer columns are dropped: the 35-cell raw layout compacts to
// the 7 populated columns, so the wizard isn't a wall of blank dropdowns.
check('empty spacer columns dropped (35 → 7)', grid.columnCount === 7, `(cols=${grid.columnCount})`);

// The header row sits BEHIND a metadata block — verify rowsToFakeGrid
// found it (not row 0) and promoted it to columnHeaders. After
// compaction the populated headers are contiguous, indices 0..6.
const headers = grid.columnHeaders ?? [];
check('TRAN DATE header captured', /tran date/i.test(headers[0] ?? ''), `(col0="${headers[0]}")`);
check('NARRATION header captured', /narration/i.test(headers[2] ?? ''));
check('WITHDRAWAL(DR) header captured', /withdraw/i.test(headers[4] ?? ''));
check('DEPOSIT(CR) header captured', /deposit/i.test(headers[5] ?? ''));
check('BALANCE header captured', /balance/i.test(headers[6] ?? ''));
check('no blank header gaps between real columns', headers.every(h => (h ?? '').trim() !== ''), `(headers=${JSON.stringify(headers)})`);

// And that suggestMapping turns those into the right roles.
const m = suggestMapping(grid);
const roleAt = (i: number) => (m.roles ? m.roles[i] : (m as { columns?: string[] }).columns?.[i]);
check('col0 → date', roleAt(0) === 'date', `(got ${roleAt(0)})`);
check('col1 → valueDate', roleAt(1) === 'valueDate', `(got ${roleAt(1)})`);
check('col2 → narration', roleAt(2) === 'narration', `(got ${roleAt(2)})`);
check('col3 → reference (CHQ.NO.)', roleAt(3) === 'reference', `(got ${roleAt(3)})`);
check('col4 → debit', roleAt(4) === 'debit', `(got ${roleAt(4)})`);
check('col5 → credit', roleAt(5) === 'credit', `(got ${roleAt(5)})`);
check('col6 → balance', roleAt(6) === 'balance', `(got ${roleAt(6)})`);

// Full pipeline: applyMapping must NOT emit the page-footer row
// ("4/19/26 13:20 … Page 2 of 2") as a phantom ₹58-lakh transaction.
console.log('\nFooter-row rejection (applyMapping):');
const { rows: txns } = applyMapping(grid, m, 'bank');
const phantom = txns.find(r => !r.narration.trim() && Math.abs(r.amount) > 1_000_000);
check('no contentless phantom transaction emitted', !phantom, phantom ? `(date=${phantom.date} amount=${phantom.amount} bal=${phantom.balance})` : '');
check('exactly 41 real transactions', txns.length === 41, `(got ${txns.length})`);
check('every emitted txn has a narration', txns.every(r => r.narration.trim() !== ''));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
