/**
 * Smoke test for the deterministic parts of the chunked OCR
 * structurer (server/lib/paddleStructurer.ts). The Gemini call
 * itself can't run here (no API key on dev machines), but the
 * row-count estimator and the chunking math are what guard against
 * the silent row-dropping this redesign fixes — lock them in.
 *
 * Run: npx tsx scripts/smoke-test-paddle-structurer.ts
 */

import { estimateTxnRows } from '../server/lib/paddleStructurer.js';

let pass = 0, fail = 0;
const expect = (label: string, cond: boolean) => {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${label}`); }
};

// ICICI-style OCR text: date-prefixed rows + wrapped narration lines
// that must NOT count + headers/footers that must NOT count.
const icipage = `DATE MODE PARTICULARS DEPOSITS WITHDRAWALS BALANCE
01-04-2025 B/F 680.44
01-04-2025 UPI/ahlamfarooq36-2/UPI/AXIS BANK/545722638994/ICI7357b 200.00 480.44
c588678/
03-04-2025 UPI/jio@citibank/JIO20BR000BZKVG/CITIBANK 349.00 131.44
03-04-2025 MOBILE BANKING MMT/IMPS/600219807282/irham shaf/JAKA0HKADAL 100.00 31.44
Page 2 of 21
TOTAL 73,46,161.00 73,46,841.42 0.02`;
expect('counts only date-prefixed lines (4)', estimateTxnRows(icipage) === 4);

// J&K-style dd-mm-yyyy and Kotak-style dd MMM... (slash + 3-letter month)
expect('dd/mm/yyyy counts', estimateTxnRows('01/04/2025 UPI/X 100') === 1);
expect('dd-MMM-yy counts', estimateTxnRows('01-Apr-25 NEFT IN 5000') === 1);
expect('wrapped narration does not count', estimateTxnRows('UPI/something/long\nc588678/') === 0);
expect('empty page counts 0', estimateTxnRows('') === 0);

// Chunk partitioning math (mirrors PAGES_PER_CHUNK=4 in the module):
// 21 real pages → 6 chunks (4+4+4+4+4+1).
const PAGES_PER_CHUNK = 4;
const chunksFor = (n: number) => Math.ceil(n / PAGES_PER_CHUNK);
expect('21 pages → 6 chunks', chunksFor(21) === 6);
expect('4 pages → 1 chunk', chunksFor(4) === 1);
expect('1 page → 1 chunk', chunksFor(1) === 1);

// ── Trust-the-column derive (mirrors deriveAmountsFromBalance) ──────
// Inline re-implementation so the test doesn't import the route module
// (which pulls in the DB + Gemini at import time). OCR text is now
// column-aligned, so the structurer reads each amount's Deposit /
// Withdrawal column directly — the route TRUSTS that signed printed
// amount and does NOT flip signs from the balance trajectory. Balance
// is used only for phantom detection + a disagreement flag. The vision
// path (no printed amount) still derives from the balance delta.
function deriveAmounts(
  rows: Array<{ amount: number; balance: number | null }>,
  opening: number | null,
  printedReliable: boolean,
): { amounts: number[]; reconciled: number } {
  const out: number[] = [];
  let reconciled = 0;
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i];
    const prev = i === 0 ? opening : rows[i - 1].balance;
    const delta = prev != null && cur.balance != null ? cur.balance - prev : null;
    if (printedReliable) {
      const printed = cur.amount; // signed by the column the structurer read
      if (Math.abs(printed) < 0.005) {
        if (delta == null || Math.abs(delta) < 0.005) continue; // phantom dropped
        out.push(delta); // OCR missed the amount cell → recover from delta
        continue;
      }
      if (delta != null && Math.abs(Math.abs(delta) - Math.abs(printed)) > Math.max(1, Math.abs(printed) * 0.02)) {
        reconciled++; // magnitude disagrees with balance → flag (still trust column sign)
      }
      out.push(printed);
      continue;
    }
    // Vision path: derive from balance delta.
    if (delta != null) {
      if (Math.abs(delta) < 0.005) { if (Math.abs(cur.amount) < 0.005) out.push(0); continue; }
      out.push(delta);
      continue;
    }
    out.push(cur.amount);
  }
  return { amounts: out, reconciled };
}

const sumAbsIn = (a: number[]) => a.filter(x => x > 0).reduce((s, x) => s + x, 0);
const sumAbsOut = (a: number[]) => a.filter(x => x < 0).reduce((s, x) => s - x, 0);
const net = (a: number[]) => a.reduce((s, x) => s + x, 0);

// Trust-the-column: amounts come from the printed Deposit/Withdrawal
// column (signed by type), NOT from the balance trajectory. A misread
// MIDDLE balance (590 → 590000) is therefore IGNORED — the column
// amounts give the correct -200/-210/-500 with no gross inflation,
// where a balance-delta approach would spike ~5.9L. The misread rows
// are flagged (their printed magnitude disagrees with the bad delta).
const misreadBalance = [
  { amount: -200, balance: 800 },
  { amount: -210, balance: 590000 },  // balance misread; column amount still -210
  { amount: -500, balance: 90 },
];
const col = deriveAmounts(misreadBalance, 1000, true);
expect('trust-column: misread balance ignored, outflow = 910', Math.abs(sumAbsOut(col.amounts) - 910) < 0.01);
expect('trust-column: no gross inflation (inflow 0)', sumAbsIn(col.amounts) < 0.01);
expect('trust-column: net -910', Math.abs(net(col.amounts) + 910) < 0.01);
expect('trust-column: flagged 2 disagreeing rows', col.reconciled === 2);

// Direction comes from the COLUMN, not the value. Here the bank's
// columns say row0 is a DEPOSIT (+1000) and row1 a WITHDRAWAL (-200),
// and we trust that even though the balance numbers would tell a
// different story if misread.
const directions = [
  { amount: +1000, balance: 2000 }, // deposit per column
  { amount: -200, balance: 1800 },  // withdrawal per column
  { amount: -300, balance: 1500 },
];
const dir = deriveAmounts(directions, 1000, true);
expect('trust-column: deposit stays credit (+1000)', dir.amounts[0] === 1000);
expect('trust-column: withdrawals stay debit', dir.amounts[1] === -200 && dir.amounts[2] === -300);
expect('trust-column: inflow 1000 / outflow 500', sumAbsIn(dir.amounts) === 1000 && sumAbsOut(dir.amounts) === 500);

// Vision path (no reliable printed amount) still uses balance deltas.
const vision = [
  { amount: 0, balance: 800 },
  { amount: 0, balance: 590 },
  { amount: 0, balance: 90 },
];
const vis = deriveAmounts(vision, 1000, false);
expect('vision: derives from delta (outflow 910, net -910)',
  Math.abs(sumAbsOut(vis.amounts) - 910) < 0.01 && Math.abs(net(vis.amounts) + 910) < 0.01);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
