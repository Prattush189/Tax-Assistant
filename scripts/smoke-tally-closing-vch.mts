/** Tally ledger: two silent losses that broke opening + Dr − Cr = closing.
 *
 *  1. A date-less "To / By Closing Balance" row that carries the closing
 *     as an AMOUNT (not a balance) was dropped by applyMapping, so
 *     mappedRowsToExtractedLedger reported closing = 0 and the audit
 *     raised a phantom RECON_BREAK.
 *  2. An alphanumeric voucher with digits straight after the letters
 *     ("GINJA25003725 9,109.60" in the merged Vch No./Debit cell) wasn't
 *     recognised by the Tally split, so the ₹9,109.60 debit vanished.
 *
 *  Runs end-to-end on ASSA TALLY.pdf from the sample folder (skipped when
 *  the file isn't there). A synthetic grid didn't reproduce (1): on ASSA
 *  the closing row arrives with no transaction pending, which a hand-built
 *  grid doesn't recreate — so the real export is the regression check.
 *  Run: npx tsx scripts/smoke-tally-closing-vch.mts
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
const net = (a: { opening: number; closing: number; transactions: Array<{ debit: number; credit: number }> }) =>
  +(a.opening + a.transactions.reduce((s, t) => s + t.debit, 0) - a.transactions.reduce((s, t) => s + t.credit, 0)).toFixed(2);

// ── Part 2: ASSA TALLY.pdf end-to-end ────────────────────────────────
const ASSA = 'C:/Users/Prattush/Downloads/Smart AI/Ledgers/ASSA TALLY.pdf';
console.log('\nASSA TALLY.pdf (real export)');
if (!fs.existsSync(ASSA)) {
  console.log('  – skipped: sample not found');
} else {
  const g = await extractPdfGrid(new File([new Uint8Array(fs.readFileSync(ASSA))], 'ASSA TALLY.pdf', { type: 'application/pdf' }));
  const det = detectAndMapLedgerErp(g);
  ck('detected Tally', det?.erp === 'Tally', `(got ${det?.erp})`);
  if (det) {
    const { rows: r2 } = applyMapping(det.grid, det.mapping, 'ledger');
    const acc = mappedRowsToExtractedLedger(r2, 'ASSA').accounts[0];
    const dn = acc.transactions.find(t => /PURCHASE ISS @ 18%/.test(t.narration ?? '') && t.date === '2025-06-23');
    ck('Debit Note behind voucher GINJA25003725 keeps its ₹9,109.60', dn?.debit === 9109.6, `(debit ${dn?.debit})`);
    ck('closing = printed To Closing Balance (−40,19,592.03)', acc.closing === -4019592.03, `(closing ${acc.closing})`);
    ck('opening + Dr − Cr = closing', net(acc) === acc.closing, `(${net(acc)} vs ${acc.closing})`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
