/** Debug the two ledgers we're trying to reconcile so we can see
 *  what the bill extractor sees on each side. */
import fs from 'node:fs';
import path from 'node:path';
import { pdfjs } from 'react-pdf';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.resolve(__dirname, '../node_modules/pdfjs-dist/build/pdf.worker.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

import { extractPdfGrid, applyMapping } from '../src/lib/pdfGrid';
import { detectAndMapLedgerErp } from '../src/lib/perLedgerErpRules';
import { extractBillKey, normalizeBillKey } from '../server/lib/ledgerBillMatcher';

async function dumpSide(label: string, p: string) {
  console.log(`\n=== ${label}: ${path.basename(p)} ===`);
  const buf = fs.readFileSync(p);
  const file = new File([new Uint8Array(buf)], path.basename(p), { type: 'application/pdf' });
  const grid = await extractPdfGrid(file);
  if (!grid) { console.log('  no grid'); return; }
  const detected = detectAndMapLedgerErp(grid);
  if (!detected) { console.log('  no ERP rule matched'); return; }
  console.log(`  ERP: ${detected.erp}  roles: ${detected.mapping.roles.join('/')}`);
  const { rows: mapped, stats } = applyMapping(detected.grid, detected.mapping, 'ledger');
  console.log(`  applyMapping: txns=${stats.transactions} merged=${stats.mergedContinuations} skipped=${stats.skippedNoAmount}`);
  console.log(`  first 12 transactions (narration / voucher / extracted bill):`);
  for (let i = 0; i < Math.min(12, mapped.length); i++) {
    const r = mapped[i];
    const billKey = extractBillKey({ voucher: r.voucher, narration: r.narration });
    console.log(`    [${i}] date=${r.date} amt=${r.amount.toFixed(2)}`);
    console.log(`         voucher: ${JSON.stringify(r.voucher)}`);
    console.log(`         narr   : ${JSON.stringify((r.narration ?? '').slice(0, 120))}`);
    console.log(`         bill   : ${JSON.stringify(billKey)}`);
  }
}

async function main() {
  await dumpSide('TALLY (customer side)', 'C:/Users/Prattush/Downloads/ASSA TALLY.pdf');
  await dumpSide('DYNAMICS (seller side)', 'C:/Users/Prattush/Downloads/1I0032_InternalAccStatement.PDF');
}

main().catch(err => { console.error(err); process.exit(1); });
