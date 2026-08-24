/** ICICI "Account Statement" positional rule — verified on a synthetic
 *  grid that mimics the narrow-column export where "S.no Transaction ID
 *  Transaction date" collapse into one cell and the year wraps onto its
 *  own physical row below (VAID SONS PHARMACEUTICAL was the real
 *  fixture that surfaced this). Proves date reconstruction, narration-
 *  fragment stitching, and balance-chain correctness without shipping
 *  the real statement. Also proves the rule stays OUT of the way of a
 *  normal, properly-headered ICICI export (the original header-based
 *  ICICI rule must win there, per RULES declaration order).
 *
 *  Amounts/balances below are deliberately self-consistent (each
 *  balance = previous balance +/- that row's signed amount) — pdfGrid's
 *  balance-delta reconciliation derives the amount from the balance
 *  column whenever the naive debit/credit reading doesn't match the
 *  printed balance delta, so an inconsistent fixture would silently
 *  get "corrected" and mask a real regression.
 *  Run: npx tsx scripts/smoke-icici-account-statement-rule.mts
 */
class DM { a=1;b=0;c=0;d=1;e=0;f=0; constructor(_?:unknown){} multiply(){return this;} translate(){return this;} scale(){return this;} rotate(){return this;} invertSelf(){return this;} }
(globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = DM;
class P2 { constructor(_?:unknown){} addPath(){} moveTo(){} lineTo(){} closePath(){} }
(globalThis as unknown as { Path2D: unknown }).Path2D = P2;
class ID { width:number;height:number;data:Uint8ClampedArray; constructor(w:number,h:number){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);} }
(globalThis as unknown as { ImageData: unknown }).ImageData = ID;

const { applyMapping } = await import('../src/lib/pdfGrid');
const { detectAndMapBank } = await import('../src/lib/perBankRules');
import type { PdfGrid } from '../src/lib/pdfGrid';

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`); };

const mkGrid = (rows: string[][]): PdfGrid => ({
  columnCount: 5,
  columnXs: [],
  columnHeaders: ['Cheque No', 'Description', 'Withdrawal', 'Deposit', null],
  rows,
  pageBreaks: [],
  pageCount: 1,
});

// ── 1. The narrow-column "Account statement" export ──────────────────
// Running balance: 0 -> +50000 -> -20000 -> +5000 -> -1000 -> +100 -> +200 -> +300
const rows = [
  ['Account statement', '', '', '', ''],
  ['Account name: VAID SONS PHARMACEUTICAL', 'Account type:', '', 'Current Account', ''],
  ['Communication 0,NAZUK MOHALLA,', 'IFSC code:', 'ICIC0001846', '', ''],
  ['Statement of transactions from', '', '', '', ''],
  ['S.no Transaction Transaction', 'Cheque No Description', 'Withdrawal', 'Deposit', 'Available'],
  ['ID', 'date', '(Dr)', '(Cr)', 'Balance'],
  // Txn 1: credit +50000, split date (year wraps to next row).
  ['1 S6938527 23-Apr-', 'NEFT-', '', '50000.00', '50000.00'],
  ['2025', 'HDFCN52025', '', '', ''],
  ['', '0423933-VAID SONS', '', '', ''],
  // Txn 2: debit -20000, split date, balance 50000 -> 30000.
  ['2 S2264674 09-May-', 'INF/INFT/0402', '20000.00', '', '30000.00'],
  ['2025', '1731747 1/Vaidsons', '', '', ''],
  // Txn 3: credit +5000, single-line date (short txn id — year fits, no wrap), balance 30000 -> 35000.
  ['3 M341970 23-May-2025', 'BY CASH - ANANTNAG SHEEZAN', '', '5000.00', '35000.00'],
  // Page footer noise between txns — must not corrupt the chain.
  ["Generated on : 21 Aug'26 (11:02 AM)", '', '', '', 'Page 1 of 23'],
  // Txn 4: debit -1000, split date, multi-row wrapped narration, balance 35000 -> 34000.
  ['4 S9004542 27-May-', 'UPI/551390', '1000.00', '', '34000.00'],
  ['2025', '879488/UPI/', '', '', ''],
  ['', 'smartcreations2', '', '', ''],
  // Txns 5-7: more split-date credits, to clear the preprocess gate's
  // and verify()'s minimum-hit-count thresholds (both require >= 5) —
  // the real 23-page statement clears these easily; a small synthetic
  // fixture needs a few more rows to reach the same statistical bar.
  ['5 S9111111 28-May-', 'UPI/551391', '', '100.00', '34100.00'],
  ['2025', '111111/UPI/somebody', '', '', ''],
  ['6 S9222222 29-May-', 'UPI/551392', '', '200.00', '34300.00'],
  ['2025', '222222/UPI/someone', '', '', ''],
  ['7 S9333333 30-May-', 'RTGS-', '', '300.00', '34600.00'],
  ['2025', 'CLBLR920250530-CASH', '', '', ''],
];
const grid = mkGrid(rows);
const det = detectAndMapBank(grid);
check('narrow-column export detected', det?.bank === 'ICICI Bank (Account Statement)', `(got ${det?.bank ?? 'null'})`);

if (det) {
  const { rows: mapped, stats } = applyMapping(det.grid, det.mapping, 'bank');
  check('7 transactions reconstructed', mapped.length === 7, `(got ${mapped.length})`);
  check('txn1 date reconstructed from split year', mapped[0]?.date === '2025-04-23', `(got ${mapped[0]?.date})`);
  check('txn1 narration merges the wrapped year-row fragment', (mapped[0]?.narration ?? '').includes('HDFCN52025'));
  check('txn1 credit amount', mapped[0]?.amount === 50000, `(got ${mapped[0]?.amount})`);
  check('txn2 debit amount (negative)', mapped[1]?.amount === -20000, `(got ${mapped[1]?.amount})`);
  check('txn3 single-line date (no split needed)', mapped[2]?.date === '2025-05-23', `(got ${mapped[2]?.date})`);
  check('txn4 survives an intervening page-footer row', mapped[3]?.date === '2025-05-27', `(got ${mapped[3]?.date})`);
  check('txn4 narration unaffected by footer noise', !(mapped[3]?.narration ?? '').toLowerCase().includes('generated on'));
  check('running balances preserved', mapped.every((m, i) => m.balance === [50000, 30000, 35000, 34000, 34100, 34300, 34600][i]));
  check('stats: no dropped rows (all accounted for)', stats.transactions + stats.mergedContinuations + stats.skippedNoAmount === stats.totalGridRows);
}

// ── 2. A normal, properly-headered ICICI export must NOT be hijacked
// by this positional rule — the original header-based ICICI rule
// (earlier in RULES) must win instead. ────────────────────────────────
const normalGrid: PdfGrid = {
  columnCount: 5,
  columnXs: [],
  columnHeaders: ['Date', 'Narration', 'Withdrawal Amt', 'Deposit Amt', 'Closing Balance'],
  pageBreaks: [],
  pageCount: 1,
  rows: [
    ['ICICI Bank Limited', '', '', '', ''],
    ['IFSC code: ICIC0001846', '', '', '', ''],
    ['Date', 'Narration', 'Withdrawal Amt', 'Deposit Amt', 'Closing Balance'],
    ['01/04/2025', 'UPI/123456789012/Payment/vpa@icici', '', '5000.00', '5000.00'],
    ['02/04/2025', 'NEFT/OUTWARD/REF123', '2000.00', '', '3000.00'],
  ],
};
const detNormal = detectAndMapBank(normalGrid);
check('normal header-based ICICI export still wins on the ORIGINAL rule', detNormal?.bank === 'ICICI Bank', `(got ${detNormal?.bank ?? 'null'})`);

// ── 3. A grid that merely SHARES the ICIC0 fingerprint but has none of
// the split-date shape must fall through (preprocess gate must hold). ─
const unrelatedGrid: PdfGrid = {
  columnCount: 5,
  columnXs: [],
  columnHeaders: ['Cheque No', 'Description', 'Withdrawal', 'Deposit', null],
  pageBreaks: [],
  pageCount: 1,
  rows: [
    ['Some other export', '', '', '', ''],
    ['IFSC code: ICIC0009999', '', '', '', ''],
    ['random', 'noise', 'row', 'here', 'today'],
    ['more', 'random', 'noise', 'row', 'here'],
  ],
};
const detUnrelated = detectAndMapBank(unrelatedGrid);
check('unrelated 5-col ICICI-fingerprint grid falls through (preprocess gate)', detUnrelated === null, `(got ${detUnrelated?.bank ?? 'null'})`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
