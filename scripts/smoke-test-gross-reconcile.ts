/**
 * Smoke test for the gross-turnover cross-check
 * (server/lib/bankGrossReconcile.ts). Locks in the ICICI scanned-PDF
 * case where the chain reconciles to the paise but a ₹1,700 charge +
 * reversal wash pair was dropped, leaving both gross sides short by 1,700.
 *
 * Run: npx tsx scripts/smoke-test-gross-reconcile.ts
 */

import { parsePrintedTotals, grossTotalNote } from '../server/lib/bankGrossReconcile.js';

let pass = 0, fail = 0;
const expect = (label: string, cond: boolean) => {
  if (cond) { pass++; } else { fail++; console.error(`FAIL: ${label}`); }
};

// ── parsePrintedTotals ──────────────────────────────────────────────────
// The bank prints DEPOSITS WITHDRAWALS BALANCE; the TOTAL row carries all
// three. Both raw and column-aligned (pipe) shapes must parse.
const rawTotals = parsePrintedTotals([
  'DATE PARTICULARS DEPOSITS WITHDRAWALS BALANCE',
  '01-04-2025 UPI/payee 200.00 480.44',
  'TOTAL 73,46,161.00 73,46,841.42 0.02',
]);
expect('parses 3 figures off the TOTAL row', rawTotals.length === 3);
expect('captures printed deposits', rawTotals.includes(7346161));
expect('captures printed withdrawals', rawTotals.includes(7346841.42));

const aligned = parsePrintedTotals(['TOTAL |  | 73,46,161.00 | 73,46,841.42 | 0.02']);
expect('parses pipe-aligned TOTAL row', aligned.includes(7346161) && aligned.includes(7346841.42));

// A dated row whose narration contains "total" must NOT be mistaken for
// the totals row.
expect('ignores "total" inside a dated transaction line',
  parsePrintedTotals(['05-04-2025 UPI/TOTAL MART/payment 500.00 1200.00']).length === 0);
expect('empty when no totals row', parsePrintedTotals(['just text', 'no totals here']).length === 0);

// ── grossTotalNote: the ICICI ₹1,700 wash case ──────────────────────────
const note = grossTotalNote(7344461.00, 7345141.42, [7346161, 7346841.42, 0.02]);
expect('emits a note when gross is short on both sides', note !== null);
expect('identifies the ₹1,700 self-cancelling pair', !!note && note.includes('1,700.00') && note.toLowerCase().includes('reversal'));
expect('reassures it does not affect balances/net', !!note && note.includes('does not affect'));

// Exact reconciliation (gross == printed) → no note.
expect('no note when gross matches printed total',
  grossTotalNote(7346161, 7346841.42, [7346161, 7346841.42, 0.02]) === null);

// No printed totals → no note (can't cross-check).
expect('no note without printed totals', grossTotalNote(100, 50, null) === null);
expect('no note with a single figure', grossTotalNote(100, 50, [7346161]) === null);

// Uneven gap (one side short, other not) → cautious "differs" note, not
// the reversal-pair claim.
const uneven = grossTotalNote(7340000, 7345141.42, [7346161, 7346841.42]);
expect('uneven gap → differs note, not reversal claim',
  !!uneven && uneven.includes('differs') && !uneven.toLowerCase().includes('reversal'));

// Printed total SMALLER than computed (we never over-count) → no false
// match on that side, so no reversal note.
expect('printed < computed on a side → no even-wash note',
  (grossTotalNote(7346161, 7345141.42, [7346161, 7346841.42, 0.02]) ?? '').includes('reversal') === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
