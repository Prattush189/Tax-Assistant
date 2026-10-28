/** Marg ERP multi-account ledger: every account must reconcile
 *  (opening + Dr − Cr = closing).
 *
 *  Before the Marg preprocess, Ledger_Account.PDF (387 pages, 365
 *  accounts) reconciled 1 account in 89 detected: "Balance c/f/b/f"
 *  carry rows (label in the Debit cell) were summed as transactions,
 *  account names printed in the Debit column were missed after page
 *  breaks, cancelled bills were posted, each account's "Opening Balance
 *  0.00 NIL" took the previous account's closing via the balance-delta
 *  fallback, and two parties named "SHREE JI EXIM" were merged.
 *
 *  Runs on the real exports in the sample folder; each file is skipped
 *  when it isn't there.
 *  Run: npx tsx scripts/smoke-marg-multi-account.mts
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
const { applyMapping, mappedRowsToExtractedLedger, extractPdfGrid } = await import('../src/lib/pdfGrid');
const { detectAndMapLedgerErp } = await import('../src/lib/perLedgerErpRules');

let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, x = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${x ? '  ' + x : ''}`); };

const DIR = 'C:/Users/Prattush/Downloads/Smart AI/Ledgers';
const cases = [
  { file: 'Ledger_Account.PDF', accounts: 365 },
  { file: 'Ledger_Account_short.pdf', accounts: 41 },
  { file: 'Ledger_Account_only_first_5_pages.pdf', accounts: 1 },
];
for (const { file, accounts } of cases) {
  const p = path.join(DIR, file);
  console.log(file);
  if (!fs.existsSync(p)) { console.log('  – skipped: sample not found'); continue; }
  const g = await extractPdfGrid(new File([new Uint8Array(fs.readFileSync(p))], file, { type: 'application/pdf' }));
  const det = detectAndMapLedgerErp(g);
  ck('detected Marg ERP', det?.erp === 'Marg ERP', `(got ${det?.erp})`);
  if (!det) continue;
  const { rows } = applyMapping(det.grid, det.mapping, 'ledger');
  const led = mappedRowsToExtractedLedger(rows, 'X');
  ck(`${accounts} account(s) found`, led.accounts.length === accounts, `(got ${led.accounts.length})`);
  const bad = led.accounts.filter(a => {
    const dr = a.transactions.reduce((s, t) => s + t.debit, 0);
    const cr = a.transactions.reduce((s, t) => s + t.credit, 0);
    return Math.abs(a.opening + dr - cr - a.closing) > 1.01;
  });
  ck('every account reconciles', bad.length === 0, bad.length ? `(${bad.length} don't: ${bad.slice(0, 3).map(a => a.name).join(', ')})` : '');
  ck('no carry / cancelled rows posted', !led.accounts.some(a => a.transactions.some(t => /balance\s+[cb]\/f:|\bcancelled\b/i.test(t.narration ?? ''))));
  if (file === 'Ledger_Account.PDF') {
    ck('two "SHREE JI EXIM" parties kept apart', led.accounts.some(a => a.name === 'SHREE JI EXIM') && led.accounts.some(a => a.name === 'SHREE JI EXIM (2)'));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
