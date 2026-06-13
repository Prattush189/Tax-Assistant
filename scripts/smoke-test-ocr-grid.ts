/**
 * Locks the server-side OCR→grid entry contract: buildGridFromItems +
 * applyMapping must load and run in plain Node (no DOMMatrix stub, no
 * pdfjs) and turn positioned OCR-style tokens into correctly-signed
 * transaction rows. This is the path the scanned-PDF route uses to skip
 * the LLM structurer for known-bank statements.
 *
 * The grid ENGINE's accuracy on real coordinates is already covered by
 * the digital-PDF fixtures (cc204, amitT) — extractPdfGrid now delegates
 * to buildGridFromItems, so those exercise the same code. This test
 * guards the two things those don't: (1) the module imports cleanly in a
 * Node/server context after the dynamic-pdfjs refactor, and (2) the
 * {text,x,y,width} item contract the OCR worker emits maps as expected.
 *
 * Run: npx tsx scripts/smoke-test-ocr-grid.ts
 */

// Intentionally NO DOMMatrix / Path2D / ImageData stubs — proves the
// dynamic pdfjs import keeps the module Node-safe.
const { buildGridFromItems, applyMapping } = await import('../src/lib/pdfGrid.js');

let pass = 0, fail = 0;
const expect = (label: string, cond: boolean) => {
  if (cond) pass++;
  else { fail++; console.error(`FAIL: ${label}`); }
};

// Synthetic savings-statement tokens: Date | Particulars | Withdrawals |
// Deposits | Balance. Five clean columns at distinct x bands.
const COL_X = { date: 10, narr: 90, wd: 300, dep: 400, bal: 480 };
function row(y: number, cells: { date?: string; narr?: string; wd?: string; dep?: string; bal?: string }) {
  const items: Array<{ text: string; x: number; y: number; width: number }> = [];
  if (cells.date) items.push({ text: cells.date, x: COL_X.date, y, width: 60 });
  if (cells.narr) items.push({ text: cells.narr, x: COL_X.narr, y, width: 90 });
  if (cells.wd) items.push({ text: cells.wd, x: COL_X.wd, y, width: 45 });
  if (cells.dep) items.push({ text: cells.dep, x: COL_X.dep, y, width: 45 });
  if (cells.bal) items.push({ text: cells.bal, x: COL_X.bal, y, width: 55 });
  return items;
}

const items = [
  ...row(10, { date: 'Date', narr: 'Particulars', wd: 'Withdrawals', dep: 'Deposits', bal: 'Balance' }),
  ...row(30, { date: '01-04-2025', narr: 'UPI/payee1/PAY', wd: '200.00', bal: '9800.00' }),
  ...row(50, { date: '02-04-2025', narr: 'NEFT/payee2', dep: '500.00', bal: '10300.00' }),
  ...row(70, { date: '03-04-2025', narr: 'UPI/payee3/PAY', wd: '150.00', bal: '10150.00' }),
  ...row(90, { date: '04-04-2025', narr: 'IMPS/payee4', dep: '1000.00', bal: '11150.00' }),
  ...row(110, { date: '05-04-2025', narr: 'ATM/CASH', wd: '2000.00', bal: '9150.00' }),
];

const grid = buildGridFromItems(items, { pageBoundaries: [0], pageCount: 1 });
expect('grid built', grid !== null);
expect('5 columns detected', grid?.columnCount === 5);
expect('headers detected', JSON.stringify(grid?.columnHeaders) === JSON.stringify(['Date', 'Particulars', 'Withdrawals', 'Deposits', 'Balance']));

// Map deterministically (mirrors what a fired per-bank rule yields).
const mapping = { roles: ['date', 'narration', 'debit', 'credit', 'balance'] as const };
const { rows } = applyMapping(grid!, { roles: [...mapping.roles] }, 'bank');
expect('5 transaction rows', rows.length === 5);
const credits = rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
const debits = rows.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0);
expect('deposits → credits (1500)', Math.abs(credits - 1500) < 0.01);
expect('withdrawals → debits (2350)', Math.abs(debits - 2350) < 0.01);
expect('first row is a 200 debit', rows[0] && Math.abs(rows[0].amount + 200) < 0.01);
expect('balances carried', rows[0]?.balance === 9800 && rows[4]?.balance === 9150);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
