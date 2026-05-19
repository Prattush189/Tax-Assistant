/** Debug: show the grid + applyMapping output around bill 708. */
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

async function fileFromPath(p: string): Promise<File> {
  const buf = fs.readFileSync(p);
  return new File([new Uint8Array(buf)], path.basename(p), { type: 'application/pdf' });
}

async function main() {
  const file = await fileFromPath('C:/Users/Prattush/Downloads/Ledgers/OSPL FUTURE MARG.pdf');
  const grid = await extractPdfGrid(file);
  if (!grid) { console.error('no grid'); return; }
  console.log('grid: rows=' + grid.rows.length + ', cols=' + grid.columnCount + ', headers=' + JSON.stringify(grid.columnHeaders));

  // Find rows mentioning 000708
  console.log('\n=== GRID rows around 000708 ===');
  for (let i = 0; i < grid.rows.length; i++) {
    const text = grid.rows[i].join(' | ');
    if (text.includes('000708') || (i > 0 && grid.rows[i - 1].join(' | ').includes('000708'))) {
      console.log('  row[' + i + ']:', grid.rows[i].map(c => JSON.stringify(c)).join(' | '));
    }
  }
  // Show a window of rows around 000708
  const idx = grid.rows.findIndex(r => r.join(' ').includes('000708'));
  if (idx >= 0) {
    console.log('\n=== Window rows ' + Math.max(0, idx - 3) + ' to ' + Math.min(grid.rows.length, idx + 5) + ' ===');
    for (let i = Math.max(0, idx - 3); i < Math.min(grid.rows.length, idx + 5); i++) {
      console.log('  row[' + i + ']:', grid.rows[i].map(c => JSON.stringify(c.slice(0, 50))).join(' | '));
    }
  }

  // Now run applyMapping and check what came out
  const detected = detectAndMapLedgerErp(grid);
  if (!detected) { console.error('no rule'); return; }
  console.log('\nRule:', detected.erp, 'mapping=', detected.mapping.roles.join('/'));
  const workingGrid = ('grid' in detected && detected.grid) ? detected.grid : grid;
  const mapped = applyMapping(workingGrid, detected.mapping, 'ledger');
  console.log('\n=== MAPPED rows around 000708 ===');
  for (let i = 0; i < mapped.rows.length; i++) {
    const r = mapped.rows[i];
    if ((r.narration ?? '').includes('000708')) {
      console.log('  mapped[' + i + ']:', {
        date: r.date,
        narration: (r.narration ?? '').slice(0, 120),
        amount: r.amount,
        balance: r.balance,
        voucher: r.voucher,
      });
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
