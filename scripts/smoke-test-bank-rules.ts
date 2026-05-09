/**
 * Smoke test for per-bank deterministic column rules.
 *
 * Loads each PDF in BANK STATEMENTS FORMATS/ (or any explicit paths
 * passed on the command line), runs them through extractPdfGrid +
 * detectAndMapBank, and prints the decision so we can verify the
 * existing rules still match without regressing after recent
 * pdfGrid changes.
 *
 * Usage:
 *   npx tsx scripts/smoke-test-bank-rules.ts
 *   npx tsx scripts/smoke-test-bank-rules.ts path/to/statement.pdf
 */
import fs from 'node:fs';
import path from 'node:path';
// react-pdf re-exports pdfjs; configure it BEFORE pdfGrid imports run.
// Setting workerPort = null forces the main-thread fake-worker path,
// which works fine in Node and avoids the dynamic worker import that
// fails outside a bundler.
import { pdfjs } from 'react-pdf';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Point pdfjs at the local worker file so its fake-worker path can
// resolve it via fs:// — pdfjs accepts a file: URL string as workerSrc.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.resolve(__dirname, '../node_modules/pdfjs-dist/build/pdf.worker.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
import { extractPdfGrid } from '../src/lib/pdfGrid';
import { detectAndMapBank } from '../src/lib/perBankRules';

async function fileFromPath(p: string): Promise<File> {
  const buf = fs.readFileSync(p);
  // Node 18+ has global File; we wrap the Buffer in a Blob-compatible
  // shape that extractPdfGrid's `await file.arrayBuffer()` understands.
  return new File([new Uint8Array(buf)], path.basename(p), { type: 'application/pdf' });
}

async function smoke(p: string) {
  console.log('\n=== ' + path.basename(p) + ' ===');
  let grid;
  try {
    const file = await fileFromPath(p);
    grid = await extractPdfGrid(file);
  } catch (e) {
    console.log('  EXTRACT FAILED:', (e as Error).message);
    return;
  }
  if (!grid) {
    console.log('  GRID: null (likely image-only PDF or password-protected)');
    return;
  }
  console.log('  rows:', grid.rows.length, 'cols:', grid.columnCount);
  console.log('  headers:', (grid.columnHeaders ?? []).map(h => `"${h ?? ''}"`).join(', '));
  if (process.env.DUMP === '1') {
    console.log('  --- first 12 non-header rows ---');
    grid.rows.slice(1, 13).forEach((r, i) => console.log('    ' + i + ':', r.map(c => `"${(c ?? '').slice(0, 40)}"`).join(' | ')));
  }
  if (process.env.DUMP_DATES === '1') {
    // Show every non-empty value in column 0 (the "Date" column) so
    // we can see what the rule is comparing against.
    console.log('  --- column 0 non-empty samples ---');
    let count = 0;
    for (const r of grid.rows.slice(1)) {
      const v = (r[0] ?? '').trim();
      if (!v) continue;
      console.log('    "' + v.slice(0, 80) + '"');
      if (++count >= 25) break;
    }
  }

  const detected = detectAndMapBank(grid);
  if (!detected) {
    console.log('  RULE: no match — would fall through to wizard');
    const fp = grid.rows.slice(0, 30).flat().join(' ').toLowerCase();
    const tells = ['hdfc', 'icici', 'canara', 'axis', 'sbi', 'state bank', 'kotak', 'yes bank'].filter(t => fp.includes(t));
    if (tells.length) console.log('  fingerprint hints in first 30 rows:', tells.join(', '));
    return;
  }
  console.log('  RULE: ' + detected.bank);
  console.log('  roles:', detected.mapping.roles.map((r, i) => `${i}:${r}`).join(' '));
}

async function main() {
  const explicit = process.argv.slice(2);
  const targets: string[] = [];
  if (explicit.length) {
    targets.push(...explicit);
  } else {
    const dir = path.resolve('BANK STATEMENTS FORMATS');
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        if (name.toLowerCase().endsWith('.pdf')) targets.push(path.join(dir, name));
      }
    }
  }
  if (!targets.length) {
    console.error('No PDFs found.');
    process.exit(1);
  }
  for (const t of targets) await smoke(t);
}

void main();
