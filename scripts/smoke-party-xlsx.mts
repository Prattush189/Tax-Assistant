/** Verify the party-merge normalisation + Bank Summary xlsx export.
 *  Builds a real workbook and reads it back cell-by-cell.
 *  Run: npx tsx scripts/smoke-party-xlsx.mts
 */
import ExcelJS from 'exceljs';
import { normalizePartyKey, displayPartyName } from '../src/lib/partyKey.ts';
import { buildBankSummaryWorkbook } from '../src/lib/partyLedgerXlsx.ts';
import type { BankTransaction } from '../src/services/api.ts';

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`); };

// ── 1. Party identity normalisation ──────────────────────────────────
check('AXIS + YES BANK variants share one key',
  normalizePartyKey('AMRIT PAL AXIS BANK') === normalizePartyKey('AMRIT PAL YES BANK')
  && normalizePartyKey('AMRIT PAL AXIS BANK') === normalizePartyKey('AMRIT PAL'),
  `(got "${normalizePartyKey('AMRIT PAL AXIS BANK')}" / "${normalizePartyKey('AMRIT PAL YES BANK')}")`);
check('display strips trailing bank suffix', displayPartyName('AMRIT PAL YES BANK') === 'AMRIT PAL');
check('IFSC token stripped', displayPartyName('RAM KUMAR UTIB0001234') === 'RAM KUMAR');
check('UPI handle stripped', displayPartyName('shlokparekh@okhdfcbank') === 'shlokparekh');
check('mid-name bank word untouched', displayPartyName('AXIS METALS PVT LTD') === 'AXIS METALS PVT LTD');
check('the bank itself stays intact', displayPartyName('YES BANK') === 'YES BANK');
check('pure-noise name kept as original', displayPartyName('SBI') === 'SBI');

// ── 2. Bank Summary workbook ─────────────────────────────────────────
const tx = (date: string, amount: number, balance: number | null = null): BankTransaction => ({
  id: 'x', date, narration: null, amount, balance,
  type: amount >= 0 ? 'credit' : 'debit',
  category: 'Other', subcategory: null, counterparty: null, reference: null,
} as unknown as BankTransaction);

const parties = [
  // multi-row receipts + one payment
  { name: 'AMRIT PAL', txns: [tx('2025-04-01', 3000, 13258.25), tx('2025-04-06', 2000), tx('2025-05-01', -500)] },
  // single-row receipt group
  { name: 'ANANYA S', txns: [tx('2025-04-02', 65)] },
];

const blob = await buildBankSummaryWorkbook(parties, {
  accountHolder: 'MS Test Holder',
  bankName: 'HDFC Bank - Pakhowal',
  accountLabel: 'XXXX1234',
  periodFrom: '2025-04-01',
  periodTo: '2026-03-31',
});
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(await blob.arrayBuffer());
const ws = wb.getWorksheet('Bank Summary')!;
check('sheet exists', !!ws);

const cellText = (addr: string) => {
  const v = ws.getCell(addr).value as unknown;
  if (v && typeof v === 'object' && 'formula' in (v as object)) return `=${(v as { formula: string }).formula}`;
  return v === null || v === undefined ? '' : String(v);
};

check('header holder', cellText('B1') === 'MS TEST HOLDER');
check('period header', cellText('B4').startsWith('PERIOD FROM 01.04.2025'));
check('column headers', cellText('B5') === 'DATE' && cellText('C5') === 'PARTICULARS' && cellText('F5') === 'TOTAL (in Rs.)');
// Opening derived from earliest balance-carrying txn: 13258.25 − 3000.
check('BAL B/F derived from running balance', cellText('C6') === 'BAL B/F' && Math.abs(Number(ws.getCell('F6').value) - 10258.25) < 0.01, `(got ${cellText('F6')})`);
check('ADD section marker', cellText('B7') === 'ADD' && cellText('C7') === 'RECEIPTS / DEPOSITS');

// Collect all formulas to verify structure without pinning exact rows.
const formulas: string[] = [];
ws.eachRow((row) => row.eachCell((c) => {
  const v = c.value as unknown;
  if (v && typeof v === 'object' && 'formula' in (v as object)) formulas.push((v as { formula: string }).formula);
}));
check('group subtotal =SUM(D..) present', formulas.some((f) => /^SUM\(D\d+:D\d+\)$/.test(f)));
check('section totals =SUM(E..) present (x2)', formulas.filter((f) => /^SUM\(E\d+:E\d+\)$/.test(f)).length === 2);
check('opening+receipts formula present', formulas.some((f) => /^F\d+\+F\d+$/.test(f)));
check('closing balance formula present', formulas.some((f) => /^F\d+-F\d+$/.test(f)));

// LESS section + closing label exist.
let sawLess = false, closingLabel = '';
ws.eachRow((row) => {
  const b = String(row.getCell(2).value ?? '');
  const c = String(row.getCell(3).value ?? '');
  if (b === 'LESS' && c === 'WITHDRAWALS / PAYMENTS') sawLess = true;
  if (c.startsWith('BALANCE AS PER')) closingLabel = c;
});
check('LESS section marker', sawLess);
check('closing row label', closingLabel === 'BALANCE AS PER STATEMENT');

// Single-party export: opening NOT carried, net label instead.
const blob2 = await buildBankSummaryWorkbook([parties[0]], {}, { includeOpening: false });
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.load(await blob2.arrayBuffer());
const ws2 = wb2.getWorksheet('Bank Summary')!;
let netLabel = '', bf2 = -1;
ws2.eachRow((row) => {
  const c = String(row.getCell(3).value ?? '');
  if (c === 'BAL B/F') bf2 = Number(row.getCell(6).value ?? NaN);
  if (c.startsWith('NET (')) netLabel = c;
});
check('party export: BAL B/F is 0', bf2 === 0, `(got ${bf2})`);
check('party export: NET label', netLabel === 'NET (RECEIPTS - PAYMENTS)');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
