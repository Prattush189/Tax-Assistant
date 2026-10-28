/** Tally "Account : X" layout (Shakti Sanitary) and the compact "Ledger
 *  Report" (PURCHASE.pdf): every account must reconcile
 *  (opening + Dr − Cr = closing).
 *
 *  Before: Shakti 747/769 and 899/916 accounts, Sales read ₹9,078 crore
 *  of credits; PURCHASE 0/1. Causes, each fixed:
 *   - per-account footers ("Total …", "Debit Balance", "Grand Total …")
 *     with the label in an amount cell were posted as transactions;
 *   - amounts fused into the Balance cell ("27,872.00 12,68,331.30 Dr");
 *   - the balance-delta fallback used the bank sign convention, booking
 *     every derived ledger row on the wrong side;
 *   - narration fused into the Debit cell ("S-079-25-26 21,500.00" → 79);
 *   - "Account : X" headers in the Debit cell rejected when the name had
 *     a digit, or was two letters ("Account : OM");
 *   - a date-less "Opening Balance" labelled in the Type column with its
 *     value in Debit was dropped (PURCHASE off by ₹1,06,672.32).
 *
 *  Runs on the real exports in the sample folder; each file is skipped
 *  when it isn't there. Shakti is ~10 MB per file — expect a few minutes.
 *  Run: npx tsx scripts/smoke-tally-account-layout.mts
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
  { file: 'PURCHASE.pdf', erp: 'Tally Compact', accounts: 1 },
  { file: 'SHAKTI SANITARY LEDGER 2025-2026-1.pdf', erp: 'Tally', accounts: 776 },
  { file: 'SHAKTI SANITARY LEDGER 2025-2026-2.pdf', erp: 'Tally', accounts: 923 },
];
for (const { file, erp, accounts } of cases) {
  const p = path.join(DIR, file);
  console.log(file);
  if (!fs.existsSync(p)) { console.log('  – skipped: sample not found'); continue; }
  const g = await extractPdfGrid(new File([new Uint8Array(fs.readFileSync(p))], file, { type: 'application/pdf' }));
  const det = detectAndMapLedgerErp(g);
  ck(`detected ${erp}`, det?.erp === erp, `(got ${det?.erp})`);
  if (!det) continue;
  const { rows } = applyMapping(det.grid, det.mapping, 'ledger');
  const led = mappedRowsToExtractedLedger(rows, 'Ledger Report');
  ck(`${accounts} account(s) found`, led.accounts.length === accounts, `(got ${led.accounts.length})`);
  const bad = led.accounts.filter(a => {
    const dr = a.transactions.reduce((s, t) => s + t.debit, 0);
    const cr = a.transactions.reduce((s, t) => s + t.credit, 0);
    return Math.abs(a.opening + dr - cr - a.closing) > 1.01;
  });
  ck('every account reconciles', bad.length === 0, bad.length ? `(${bad.length} don't: ${bad.slice(0, 3).map(a => a.name).join(', ')})` : '');
  ck('no footer rows posted', !led.accounts.some(a => a.transactions.some(t => /^(?:grand\s+total|total\b|debit\s+balance|credit\s+balance)/i.test(t.narration ?? ''))));
  if (file === 'PURCHASE.pdf') {
    ck('opening ₹1,06,672.32 Dr picked up', led.accounts[0]?.opening === 106672.32, `(got ${led.accounts[0]?.opening})`);
  }
  if (file.endsWith('-2.pdf')) {
    ck('two-letter account "OM" kept separate', led.accounts.some(a => a.name === 'OM'));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
