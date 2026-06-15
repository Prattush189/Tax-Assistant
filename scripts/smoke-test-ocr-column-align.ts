/**
 * Proves renderColumnAlignedPage preserves the Withdrawal vs Deposit
 * column distinction that naive token-joining destroys — the fix for
 * the structurer mis-signing scanned-statement rows.
 *
 * Run: npx tsx scripts/smoke-test-ocr-column-align.ts
 */
import { renderColumnAlignedPage, type OcrItem } from '../server/lib/paddleOcr.js';

let pass = 0, fail = 0;
const expect = (label: string, cond: boolean) => {
  if (cond) pass++;
  else { fail++; console.error(`FAIL: ${label}`); }
};

// ICICI-like column x's: Date 10, Particulars 90, Withdrawals 300,
// Deposits 400, Balance 480. A withdrawal-only row leaves Deposits
// blank; a deposit-only row leaves Withdrawals blank.
const COL = { date: 10, narr: 90, wd: 300, dep: 400, bal: 480 };
let y = 0;
const items: OcrItem[] = [];
const push = (cells: Partial<Record<keyof typeof COL, string>>) => {
  y += 20;
  for (const k of Object.keys(cells) as (keyof typeof COL)[]) {
    items.push({ text: cells[k]!, x: COL[k], y, width: 40 });
  }
};
// Header row (gives the structurer the labels)
push({ date: 'DATE', narr: 'PARTICULARS', wd: 'WITHDRAWALS', dep: 'DEPOSITS', bal: 'BALANCE' });
push({ date: '01-04-2025', narr: 'UPI/payee1', wd: '200.00', bal: '9800.00' });   // withdrawal
push({ date: '02-04-2025', narr: 'NEFT/payee2', dep: '500.00', bal: '10300.00' }); // deposit
push({ date: '03-04-2025', narr: 'UPI/payee3', wd: '150.00', bal: '10150.00' });   // withdrawal
push({ date: '04-04-2025', narr: 'IMPS/payee4', dep: '1000.00', bal: '11150.00' });// deposit

const out = renderColumnAlignedPage(items);
const lines = out.split('\n');

// Withdrawal row: the 200.00 must land in an EARLIER numeric cell than
// where deposits land; deposit row's 500.00 in a LATER cell. Concretely
// they must occupy DIFFERENT pipe positions.
const wdLine = lines.find(l => l.includes('200.00'))!;
const depLine = lines.find(l => l.includes('500.00'))!;
const cellIndex = (line: string, val: string) =>
  line.split('|').findIndex(c => c.includes(val));

expect('renders pipe-separated cells', out.includes(' | '));
expect('withdrawal 200.00 and deposit 500.00 are in DIFFERENT columns',
  cellIndex(wdLine, '200.00') !== cellIndex(depLine, '500.00'));
expect('withdrawal column is left of deposit column',
  cellIndex(wdLine, '200.00') < cellIndex(depLine, '500.00'));
// Withdrawal row's Deposit cell is blank (empty cell preserved).
const wdCells = wdLine.split('|').map(c => c.trim());
const depColIdx = cellIndex(depLine, '500.00');
expect('withdrawal row keeps a blank deposit cell', wdCells[depColIdx] === '');
// Balance is the rightmost numeric on every transaction line.
expect('balance is rightmost on withdrawal row',
  cellIndex(wdLine, '9800.00') > cellIndex(wdLine, '200.00'));

// Sanity: a non-tabular page (no dates) falls back to naive join.
const banner: OcrItem[] = [
  { text: 'ICICI', x: 100, y: 10, width: 40 },
  { text: 'Bank', x: 150, y: 10, width: 40 },
  { text: 'Wealth', x: 100, y: 30, width: 40 },
];
expect('non-tabular page falls back to naive join (no pipes)',
  !renderColumnAlignedPage(banner).includes(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
