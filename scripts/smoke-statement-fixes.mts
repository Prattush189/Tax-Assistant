/** Bank-statement fixes, 2026-10-28 — each checked against the bank's own
 *  printed balances / Grand Total.
 *
 *   - ICICI "Account statement" current-account variant resolves to 6
 *     columns (extra Cheque No) — the 5-column rule silently skipped it.
 *   - J&K General Saving (amitT.pdf) now resolves to 5 columns with an
 *     empty col 1 — the 4-column rule silently skipped all 95 pages.
 *   - J&K e-statement "Total" row (label in the Date column) was merged
 *     into the last transaction as a withdrawal.
 *   - ICICI: a wrapped NEFT fragment "27006465-" in the Withdrawal column
 *     was read as a ₹2.7 crore debit (amount cells must look like amounts).
 *
 *  Real files are skipped when missing. Run: npx tsx scripts/smoke-statement-fixes.mts
 */
// pdfGrid pulls in pdfjs, which touches these browser globals at import.
class DM { a=1;b=0;c=0;d=1;e=0;f=0; constructor(_?:unknown){} multiply(){return this;} translate(){return this;} scale(){return this;} rotate(){return this;} invertSelf(){return this;} }
(globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = DM;
class P2 { constructor(_?:unknown){} addPath(){} moveTo(){} lineTo(){} closePath(){} }
(globalThis as unknown as { Path2D: unknown }).Path2D = P2;
class ID { width:number;height:number;data:Uint8ClampedArray; constructor(w:number,h:number){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);} }
(globalThis as unknown as { ImageData: unknown }).ImageData = ID;

const fs = await import('node:fs');
const path = await import('node:path');
const { pathToFileURL } = await import('node:url');
const { pdfjs } = await import('react-pdf');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve('node_modules/pdfjs-dist/build/pdf.worker.mjs')).href;
const { applyMapping, extractPdfGrid } = await import('../src/lib/pdfGrid');
const { detectAndMapBank } = await import('../src/lib/perBankRules');

let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, x = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${x ? '  ' + x : ''}`); };
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Amount-cell parsing (synthetic) ──────────────────────────────────
console.log('amount cells');
const amountOf = (cell: string) => {
  const grid = { rows: [['01-04-2025', 'x', cell, '', '100.00']], columnCount: 5, columnXs: [0, 1, 2, 3, 4], columnHeaders: ['Date', 'N', 'Debit', 'Credit', 'Balance'], pageBreaks: [], pageCount: 1 };
  return applyMapping(grid as never, { roles: ['date', 'narration', 'debit', 'credit', 'balance'] } as never, 'bank').rows[0]?.amount ?? null;
};
for (const [cell, want] of [['1,234.00', -1234], ['₹ 1,234.00', -1234], ['1,234.00-', -1234], ['124,688.00 5/23/2025 INR', -124688]] as const) ck(`accepts ${JSON.stringify(cell)}`, amountOf(cell) === want, `(got ${amountOf(cell)})`);
for (const cell of ['27006465-', '35 1,06,672.00', 'Cash']) ck(`rejects ${JSON.stringify(cell)}`, amountOf(cell) === null, `(got ${amountOf(cell)})`);

// ── Real statements ──────────────────────────────────────────────────
const ST = 'C:/Users/Prattush/Downloads/Smart AI/Statements';
const cases = [
  { file: 'C:/Users/Prattush/Downloads/Statement_1792667418949915.pdf', bank: 'ICICI Bank (Account Statement)', rows: 67 },
  { file: `${ST}/amitT.pdf`, bank: 'J&K Bank (Savings)', rows: 1631, withdrawals: 1316104.39, deposits: 1264425.60 },
  { file: `${ST}/JKBANK FORMAT-2.pdf`, bank: 'J&K Bank', rows: 10, withdrawals: 78755.5, deposits: 94153.0 },
  { file: `${ST}/OpTransactionHistory08-05-2026.pdf-11-38-32.pdf`, bank: 'ICICI Bank', rows: 10 },
];
for (const c of cases) {
  console.log(path.basename(c.file));
  if (!fs.existsSync(c.file)) { console.log('  – skipped: sample not found'); continue; }
  const g = await extractPdfGrid(new File([new Uint8Array(fs.readFileSync(c.file))], path.basename(c.file), { type: 'application/pdf' }));
  const det = detectAndMapBank(g);
  ck(`detected ${c.bank}`, det?.bank === c.bank, `(got ${det?.bank})`);
  if (!det) continue;
  const { rows } = applyMapping(det.grid, det.mapping, 'bank');
  ck(`${c.rows} transactions`, rows.length === c.rows, `(got ${rows.length})`);
  let prev: number | null = null, acc = 0, checks = 0, ok = 0;
  for (const r of rows) { acc += r.amount; if (r.balance == null) continue; if (prev != null) { checks++; if (Math.abs(r.balance - prev - acc) < 1.01) ok++; } prev = r.balance; acc = 0; }
  ck('every printed balance reconciles', checks > 0 && ok === checks, `(${ok}/${checks})`);
  if (c.withdrawals != null) {
    const wd = r2(rows.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0));
    const dp = r2(rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0));
    // ≤10 paise: J&K's e-statement prints its Total to one decimal ("78,755.5" for 78,755.46).
    ck('totals match the printed (Grand) Total', Math.abs(wd - c.withdrawals) < 0.1 && Math.abs(dp - c.deposits!) < 0.1, `(withdrawals ${wd}, deposits ${dp})`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
