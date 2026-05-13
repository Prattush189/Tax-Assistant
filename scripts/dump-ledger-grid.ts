// Cross-ERP recon health check
import { pdfjs } from 'react-pdf';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve('node_modules/pdfjs-dist/build/pdf.worker.mjs')).href;
import { extractPdfGrid, applyMapping, mappedRowsToExtractedLedger } from '../src/lib/pdfGrid';
import { detectAndMapLedgerErp } from '../src/lib/perLedgerErpRules';

const FILES = [
  ['Marg      ', 'C:/Users/Prattush/Downloads/Ledgers/Ledger_Account_only_first_5_pages.pdf'],
  ['Busy      ', 'C:/Users/Prattush/Downloads/Ledgers/LEDGER JASBIR SIR_only_first_5_pages.pdf'],
  ['Finsys    ', 'C:/Users/Prattush/Downloads/Ledgers/OSPL Ledger_Future Energy_17_04_2026 18_20_31__only_first_5_pages.pdf'],
  ['Tally OSPL', 'C:/Users/Prattush/Downloads/Ledgers/OSPL FUTURE MARG_only_first_5_pages.pdf'],
];

async function check(label: string, p: string) {
  console.log(`\n=== ${label} ===`);
  const buf = fs.readFileSync(p);
  const file = new File([new Uint8Array(buf)], path.basename(p), { type: 'application/pdf' });
  const grid = await extractPdfGrid(file);
  if (!grid) { console.log('  null'); return; }
  const detected = detectAndMapLedgerErp(grid);
  if (!detected) { console.log(`  NO RULE`); return; }
  console.log(`  detected: ${detected.erp}`);
  const { rows, stats } = applyMapping(detected.grid, detected.mapping, 'ledger');
  console.log(`  txns=${stats.transactions} mergedCont=${stats.mergedContinuations}`);
  const extracted = mappedRowsToExtractedLedger(rows);
  const TOL = 1;
  let ok = 0;
  const fails: Array<{ name: string; opening: number; dr: number; cr: number; closing: number; gap: number }> = [];
  for (const a of extracted.accounts) {
    const computed = a.opening + a.totalDebit - a.totalCredit;
    const gap = computed - a.closing;
    if (Math.abs(gap) < TOL) ok++;
    else fails.push({ name: a.name, opening: a.opening, dr: a.totalDebit, cr: a.totalCredit, closing: a.closing, gap });
  }
  console.log(`  reconciles: ${ok}/${extracted.accounts.length}`);
  for (const f of fails.slice(0, 3)) {
    console.log(`    GAP ${f.name}: open=${(f.opening/1e7).toFixed(2)}cr Dr=${(f.dr/1e7).toFixed(2)}cr Cr=${(f.cr/1e7).toFixed(2)}cr closing=${(f.closing/1e7).toFixed(2)}cr gap=${(f.gap/1e7).toFixed(2)}cr`);
  }
  const a = extracted.accounts[0];
  if (a) console.log(`  first: ${a.name} opening=${(a.opening/1e7).toFixed(2)}cr Dr=${(a.totalDebit/1e7).toFixed(2)}cr Cr=${(a.totalCredit/1e7).toFixed(2)}cr closing=${(a.closing/1e7).toFixed(2)}cr`);
}

async function main() {
  for (const [label, p] of FILES) {
    try { await check(label, p); } catch (e) { console.log(`  ERROR: ${(e as Error).message}`); }
  }
}
void main();
