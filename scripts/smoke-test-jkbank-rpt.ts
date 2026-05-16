/**
 * Smoke test for src/lib/jkbankRptParser.ts.
 *
 * Loads a J&K Bank RPT/RPTNFS-format PDF, runs detectJkbankRptFormat
 * and extractJkbankRpt, and reports counts + samples for manual
 * verification. Defaults to the user's "Bank statement.RPTNFS.pdf"
 * sample if no path is provided.
 *
 *   node --import ./scripts/node-pdfjs-shim.mjs --import tsx ./scripts/smoke-test-jkbank-rpt.ts
 *   ... ./scripts/smoke-test-jkbank-rpt.ts "C:/path/to/other.pdf"
 */

import fs from 'node:fs';
import path from 'node:path';
import { pdfjs } from 'react-pdf';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Wire pdfjs worker for Node (mirrors smoke-test-bank-rules.ts setup).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.resolve(__dirname, '../node_modules/pdfjs-dist/build/pdf.worker.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

import { detectJkbankRptFormat, extractJkbankRpt } from '../src/lib/jkbankRptParser';

async function fileFromPath(p: string): Promise<File> {
  const buf = fs.readFileSync(p);
  return new File([new Uint8Array(buf)], path.basename(p), { type: 'application/pdf' });
}

async function main() {
  const target = process.argv[2] ?? 'C:/Users/Prattush/Downloads/Bank statement.RPTNFS.pdf';
  if (!fs.existsSync(target)) {
    console.error('File not found:', target);
    process.exit(1);
  }
  console.log('Target:', target);
  const file = await fileFromPath(target);

  const t0 = Date.now();
  const detected = await detectJkbankRptFormat(file);
  console.log(`detectJkbankRptFormat → ${detected}  (${Date.now() - t0}ms)`);
  if (!detected) {
    console.error('Detection returned false — aborting parse.');
    process.exit(1);
  }

  const t1 = Date.now();
  const rows = await extractJkbankRpt(file);
  console.log(`extractJkbankRpt → ${rows ? rows.length : null} rows  (${Date.now() - t1}ms)`);
  if (!rows || rows.length === 0) {
    console.error('Parse returned no rows.');
    process.exit(1);
  }

  console.log('\n--- first 5 rows ---');
  for (const r of rows.slice(0, 5)) {
    const dir = r.amount >= 0 ? 'CR' : 'DR';
    console.log(`  ${r.date} | ${dir} ${Math.abs(r.amount).toFixed(2).padStart(10)} | bal=${r.balance?.toFixed(2)?.padStart(10) ?? 'null'} | ${r.narration.slice(0, 60)}`);
  }
  console.log('\n--- last 5 rows ---');
  for (const r of rows.slice(-5)) {
    const dir = r.amount >= 0 ? 'CR' : 'DR';
    console.log(`  ${r.date} | ${dir} ${Math.abs(r.amount).toFixed(2).padStart(10)} | bal=${r.balance?.toFixed(2)?.padStart(10) ?? 'null'} | ${r.narration.slice(0, 60)}`);
  }

  // Aggregate sanity check.
  const credits = rows.filter(r => r.amount > 0);
  const debits = rows.filter(r => r.amount < 0);
  const zero = rows.filter(r => r.amount === 0);
  const totalCr = credits.reduce((s, r) => s + r.amount, 0);
  const totalDr = debits.reduce((s, r) => s + Math.abs(r.amount), 0);
  console.log('\n--- summary ---');
  console.log(`  total rows         : ${rows.length}`);
  console.log(`  credits            : ${credits.length}  (sum ₹${totalCr.toFixed(2)})`);
  console.log(`  debits             : ${debits.length}  (sum ₹${totalDr.toFixed(2)})`);
  console.log(`  zero-amount        : ${zero.length}`);
  console.log(`  rows w/o balance   : ${rows.filter(r => r.balance === null).length}`);
  console.log(`  rows w/ narration  : ${rows.filter(r => r.narration.trim().length > 0).length}`);
  const firstBal = rows.find(r => r.balance !== null)?.balance ?? null;
  const lastBal = [...rows].reverse().find(r => r.balance !== null)?.balance ?? null;
  console.log(`  first balance      : ${firstBal?.toFixed(2)}`);
  console.log(`  last balance       : ${lastBal?.toFixed(2)}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
