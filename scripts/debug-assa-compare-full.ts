/** End-to-end comparison: extract both ledgers, run the matcher,
 *  show the matched / mismatch / only-in-X buckets. Used to verify
 *  the digit-tail fallback recovers the AAGIN25004485 ↔ 25004485 pairs. */
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

async function extractSide(p: string) {
  const buf = fs.readFileSync(p);
  const file = new File([new Uint8Array(buf)], path.basename(p), { type: 'application/pdf' });
  const grid = await extractPdfGrid(file);
  if (!grid) throw new Error(`no grid for ${p}`);
  const detected = detectAndMapLedgerErp(grid);
  if (!detected) throw new Error(`no rule for ${p}`);
  const { rows } = applyMapping(detected.grid, detected.mapping, 'ledger');
  return mappedRowsToExtractedLedger(rows, { defaultAccountName: path.basename(p) });
}

async function main() {
  const tally = await extractSide('C:/Users/Prattush/Downloads/ASSA TALLY.pdf');
  const dynamics = await extractSide('C:/Users/Prattush/Downloads/1I0032_InternalAccStatement.PDF');
  const report = compareLedgersByBill(tally, 'sundry_creditor', dynamics, 'sundry_debtor');
  console.log('\n=== summary ===');
  console.log(`  matched: ${report.summary.matchedCount}`);
  console.log(`  amountMismatches: ${report.summary.amountMismatchCount}`);
  console.log(`  onlyInA: ${report.summary.onlyInACount}`);
  console.log(`  onlyInB: ${report.summary.onlyInBCount}`);
  console.log(`  paymentMatches: ${report.summary.paymentMatchedCount}`);
  console.log(`  noBillA: ${report.summary.noBillCountA}`);
  console.log(`  noBillB: ${report.summary.noBillCountB}`);
  console.log('\n=== matched (digit-tail-paired bills will have "↔" in the bill column) ===');
  for (const m of report.matched) {
    console.log(`  ${m.bill}  A=${m.amountA} B=${m.amountB} (${m.dateA} ↔ ${m.dateB})`);
  }
  console.log('\n=== amountMismatches ===');
  for (const m of report.amountMismatches) {
    console.log(`  ${m.bill}  A=${m.amountA} B=${m.amountB} diff=${m.diff}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
