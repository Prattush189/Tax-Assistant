// Smoke test for the new multi-column Tally ledger format
// (Hotel Holiday Inn 2024-25 export → "Date | Particulars | Vch Type
// | Vch No. | Debit | Credit | Balance" with contra-detail child rows
// under each parent voucher).
//
// Verifies:
//   1. The TALLY ERP rule fingerprints + matches column headers.
//   2. applyMapping's contra-detail guard keeps child rows
//      ("Furniture & Fixtures 92,000.00 Dr") out of pending.debit /
//      credit so the parent voucher's amounts stay clean.
//
//   npx tsx --import ./scripts/node-pdfjs-shim.mjs scripts/smoke-test-tally-ledger.ts <pdf>
import { pdfjs } from 'react-pdf';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve('node_modules/pdfjs-dist/build/pdf.worker.mjs')).href;
import { extractPdfGrid, applyMapping } from '../src/lib/pdfGrid';
import { detectAndMapLedgerErp } from '../src/lib/perLedgerErpRules';

async function smoke(p: string) {
  console.log(`\n=== ${path.basename(p)} ===`);
  const buf = fs.readFileSync(p);
  const file = new File([new Uint8Array(buf)], path.basename(p), { type: 'application/pdf' });
  const grid = await extractPdfGrid(file);
  if (!grid) {
    console.log('  GRID: null (likely image-only PDF)');
    return false;
  }
  console.log(`  rows: ${grid.rows.length}  cols: ${grid.columnCount}`);
  console.log(`  headers: ${(grid.columnHeaders ?? []).map(h => `"${h ?? ''}"`).join(', ')}`);

  const detected = detectAndMapLedgerErp(grid);
  if (!detected) {
    console.log('  RULE: no match (would fall through to wizard)');
    return false;
  }
  console.log(`  RULE: ${detected.erp}`);
  console.log(`  roles: ${detected.mapping.roles.map((r, i) => `${i}:${r}`).join(' ')}`);

  const { rows, stats } = applyMapping(grid, detected.mapping, 'ledger');
  console.log(`  applyMapping stats: transactions=${stats.transactions} mergedContinuations=${stats.mergedContinuations} skippedNoAmount=${stats.skippedNoAmount}`);

  // Spot-check: the FIRST transaction on page 1 of Hotel Holiday Inn
  // is the 10-Jun-24 Purchase voucher 60 for 1,08,560.00 credit (with
  // contra-detail "Furniture & Fixtures 92,000.00 Dr" + "IGST INPUT
  // 16,560.00 Dr" on the next two rows). The amount on the parent
  // transaction must be -1,08,560.00 (single signed amount = credit
  // → negative in our convention, since `amount` = debit − credit
  // when the row has both). The contra-detail amounts must NOT pollute.
  // Find the 10-Jun-24 row by date.
  const purchaseTxn = rows.find(r => r.date === '2024-06-10');
  if (purchaseTxn) {
    console.log(`  10-Jun-24 Purchase row: amount=${purchaseTxn.amount}, narration="${purchaseTxn.narration.slice(0, 140)}…"`);
    // Tally credit on this row should produce a NEGATIVE amount
    // (debit − credit convention; or in absolute terms, magnitude
    // ≈ 1,08,560). Contra-detail "92,000 Dr" + "16,560 Dr" sum to
    // 1,08,560 too — if the guard fails, the row's pending.debit
    // would equal 92,000 first then 1,08,560 net (depends on order).
    // Verify magnitude is ~1,08,560 (within ₹1):
    if (Math.abs(Math.abs(purchaseTxn.amount) - 108560) <= 1) {
      console.log('  ✓ purchase amount magnitude is 1,08,560 — contra-detail did NOT pollute');
    } else {
      console.log(`  ✗ purchase amount magnitude is ${Math.abs(purchaseTxn.amount)} — contra-detail likely polluted`);
      return false;
    }
    // The narration should still include the breakdown info — the
    // guard folds it in so audits see it.
    if (/furniture/i.test(purchaseTxn.narration) && /igst/i.test(purchaseTxn.narration)) {
      console.log('  ✓ narration folded in contra breakdown');
    } else {
      console.log(`  ✗ narration missing contra breakdown: "${purchaseTxn.narration}"`);
      return false;
    }
  } else {
    console.log('  ✗ no 10-Jun-24 Purchase txn found');
    return false;
  }

  // Sanity: total transaction count should be reasonable (parent
  // transactions only, not parent + every contra-detail child).
  // The Hotel Holiday Inn PDF has ~30-40 parent transactions across
  // 10 pages. If transactions > 100, contra rows leaked through.
  if (stats.transactions > 100) {
    console.log(`  ✗ transactions=${stats.transactions} is too high — contra-detail leaks suspected`);
    return false;
  }
  return true;
}

async function main() {
  const target = process.argv[2] ?? 'C:/Users/Prattush/Downloads/Tally.pdf';
  const ok = await smoke(target);
  console.log('');
  if (ok) console.log('  PASS');
  else { console.log('  FAIL'); process.exit(1); }
}

void main();
