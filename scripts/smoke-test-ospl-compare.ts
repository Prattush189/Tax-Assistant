/**
 * End-to-end smoke for the OSPL case:
 *   - Side A: OSPL FUTURE MARG.pdf            (Future Energy's books, Marg ERP)
 *   - Side B: OSPL Ledger_Future Energy_*.pdf (OSPL's books, Finsys ERP)
 *
 * Extracts both via extractPdfGrid + the per-ERP rules, runs the
 * deterministic compareLedgersByBill, and prints the bucket counts +
 * a few sample matches / mismatches.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pdfjs } from 'react-pdf';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.resolve(__dirname, '../node_modules/pdfjs-dist/build/pdf.worker.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

import { extractPdfGrid, applyMapping, mappedRowsToExtractedLedger } from '../src/lib/pdfGrid';
import { detectAndMapLedgerErp } from '../src/lib/perLedgerErpRules';
import { compareLedgersByBill } from '../server/lib/ledgerBillMatcher';

async function fileFromPath(p: string): Promise<File> {
  const buf = fs.readFileSync(p);
  return new File([new Uint8Array(buf)], path.basename(p), { type: 'application/pdf' });
}

async function extract(label: string, pdfPath: string) {
  console.log(`\n--- ${label}: ${path.basename(pdfPath)} ---`);
  const file = await fileFromPath(pdfPath);
  const grid = await extractPdfGrid(file);
  if (!grid) {
    console.log('  grid: null (extraction failed)');
    return null;
  }
  console.log(`  grid: ${grid.rows.length} rows × ${grid.columnCount} cols, headers: ${(grid.columnHeaders ?? []).map(h => `"${h ?? ''}"`).join(', ')}`);
  const detected = detectAndMapLedgerErp(grid);
  if (!detected) {
    console.log('  ERP rule: no match');
    return null;
  }
  console.log(`  ERP rule: ${detected.erp}, mapping=${detected.mapping.roles.join('/')}`);
  // Some rules emit a preprocessed grid; honour it.
  const workingGrid = ('grid' in detected && detected.grid) ? detected.grid : grid;
  const mapped = applyMapping(workingGrid, detected.mapping, 'ledger');
  console.log(`  mapped rows: ${mapped.rows.length} (${mapped.stats.transactions} txns, ${mapped.stats.accountHeaders} account headers)`);
  const extracted = mappedRowsToExtractedLedger(mapped.rows);
  const txTotal = extracted.accounts.reduce((s, a) => s + a.transactions.length, 0);
  console.log(`  extracted: ${extracted.accounts.length} accounts, ${txTotal} txns total`);
  for (const a of extracted.accounts.slice(0, 3)) {
    console.log(`     · ${a.name} — ${a.transactions.length} txns, opening ₹${a.opening?.toFixed(2) ?? '?'}, closing ₹${a.closing?.toFixed(2) ?? '?'}`);
  }
  return extracted;
}

async function main() {
  const dir = 'C:/Users/Prattush/Downloads/Ledgers';
  const fileA = path.join(dir, 'OSPL FUTURE MARG.pdf');
  const fileB = path.join(dir, 'OSPL Ledger_Future Energy_17_04_2026 18_20_31.pdf');
  if (!fs.existsSync(fileA) || !fs.existsSync(fileB)) {
    console.error('One or both ledger PDFs missing:', fileA, fileB);
    process.exit(1);
  }

  const ledgerA = await extract('Side A (Marg, Future Energy)', fileA);
  const ledgerB = await extract('Side B (Finsys, OSPL)', fileB);
  if (!ledgerA || !ledgerB) {
    console.error('\nExtraction failed for at least one side — cannot run compare.');
    process.exit(1);
  }

  console.log('\n=== compareLedgersByBill(sales, purchase) ===');
  const report = compareLedgersByBill(
    ledgerA as Parameters<typeof compareLedgersByBill>[0],
    'sales',
    ledgerB as Parameters<typeof compareLedgersByBill>[2],
    'purchase',
  );
  console.log('\nHeadline:', report.summary.headline);
  console.log('Counts:');
  console.log(`  matched           : ${report.summary.matchedCount}`);
  console.log(`  amount mismatches : ${report.summary.amountMismatchCount}`);
  console.log(`  only in A (sales)    : ${report.summary.onlyInACount}`);
  console.log(`  only in B (purchase) : ${report.summary.onlyInBCount}`);
  console.log(`  payments matched  : ${report.summary.paymentMatchedCount}`);
  console.log(`  rows w/o bill A   : ${report.summary.noBillCountA}`);
  console.log(`  rows w/o bill B   : ${report.summary.noBillCountB}`);

  console.log('\nSample matched (first 5):');
  for (const m of report.matched.slice(0, 5)) {
    console.log(`  ${m.bill}  ${m.dateA} ↔ ${m.dateB}  ₹${m.amountA.toFixed(2)} ↔ ₹${m.amountB.toFixed(2)}`);
  }
  console.log('\nSample amount mismatches (first 5):');
  for (const m of report.amountMismatches.slice(0, 5)) {
    console.log(`  ${m.bill}  ₹${m.amountA.toFixed(2)} ↔ ₹${m.amountB.toFixed(2)}  diff ₹${m.diff.toFixed(2)}`);
  }
  console.log('\nSample only-in-A (first 5):');
  for (const m of report.onlyInA.slice(0, 5)) {
    console.log(`  ${m.bill}  ${m.date}  ₹${m.amount.toFixed(2)}  ${m.narration.slice(0, 50)}`);
  }
  console.log('\nSample only-in-B (first 5):');
  for (const m of report.onlyInB.slice(0, 5)) {
    console.log(`  ${m.bill}  ${m.date}  ₹${m.amount.toFixed(2)}  ${m.narration.slice(0, 50)}`);
  }
  console.log('\nSample payment matches (first 5):');
  for (const m of report.paymentMatches.slice(0, 5)) {
    const refs = [m.bankRefA, m.bankRefB].filter(Boolean).join(' / ') || '—';
    console.log(`  ${m.date}  ₹${m.amount.toFixed(2)}  ref:${refs}`);
    console.log(`    A: ${m.narrationA.slice(0, 80)}`);
    console.log(`    B: ${m.narrationB.slice(0, 80)}`);
  }

  console.log('\nSample no-bill A (first 3):');
  for (const m of report.noBillA.slice(0, 3)) {
    console.log(`  ${m.date}  ₹${m.amount.toFixed(2)}  ${m.narration.slice(0, 70)}`);
  }
  console.log('\nSample no-bill B (first 3):');
  for (const m of report.noBillB.slice(0, 3)) {
    console.log(`  ${m.date}  ₹${m.amount.toFixed(2)}  ${m.narration.slice(0, 70)}`);
  }
  console.log('\nBalance check:');
  console.log(`  opening A: ₹${report.balanceCheck.openingA.toFixed(2)}, opening B: ₹${report.balanceCheck.openingB.toFixed(2)}, gap: ₹${report.balanceCheck.openingGap.toFixed(2)}`);
  console.log(`  closing A: ₹${report.balanceCheck.closingA.toFixed(2)}, closing B: ₹${report.balanceCheck.closingB.toFixed(2)}, gap: ₹${report.balanceCheck.closingGap.toFixed(2)}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
