/** Debug: inspect the grid output for the Dynamics AX "Customer -
 *  internal account statement" PDF so we can author a matching ERP rule
 *  in perLedgerErpRules.ts. Dumps column count, headers, and the first
 *  ~30 rows verbatim. */
import fs from 'node:fs';
import path from 'node:path';
import { pdfjs } from 'react-pdf';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.resolve(__dirname, '../node_modules/pdfjs-dist/build/pdf.worker.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

import { extractPdfGrid } from '../src/lib/pdfGrid';
import { detectAndMapLedgerErp } from '../src/lib/perLedgerErpRules';

async function fileFromPath(p: string): Promise<File> {
  const buf = fs.readFileSync(p);
  return new File([new Uint8Array(buf)], path.basename(p), { type: 'application/pdf' });
}

async function main() {
  const target = process.argv[2] ?? 'C:/Users/Prattush/Downloads/1I0032_InternalAccStatement.PDF';
  const file = await fileFromPath(target);
  const grid = await extractPdfGrid(file);
  if (!grid) { console.error('no grid extracted'); return; }
  console.log('rows=' + grid.rows.length + '  cols=' + grid.columnCount);
  console.log('headers: ' + JSON.stringify(grid.columnHeaders));
  console.log('\n=== first 40 rows ===');
  for (let i = 0; i < Math.min(40, grid.rows.length); i++) {
    const cells = grid.rows[i].map(c => JSON.stringify((c ?? '').slice(0, 60)));
    console.log('  row[' + i + ']: ' + cells.join(' | '));
  }
  console.log('\n=== sample rows 80..100 ===');
  for (let i = 80; i < Math.min(100, grid.rows.length); i++) {
    const cells = grid.rows[i].map(c => JSON.stringify((c ?? '').slice(0, 60)));
    console.log('  row[' + i + ']: ' + cells.join(' | '));
  }
  const detected = detectAndMapLedgerErp(grid);
  console.log('\nRule:', detected ? detected.erp : 'no match');
  if (detected) {
    console.log('mapping roles:', detected.mapping.roles.join('/'));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
