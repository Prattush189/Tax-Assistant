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

// ── Balance-misread reconciliation (the ICICI scanned-PDF bug) ──
// Inline re-implementation of deriveAmountsFromBalance's reconciliation
// rule so the test doesn't need to import the route module (which pulls
// in the DB + Gemini at import time). Mirrors server/routes/
// bankStatements.ts deriveAmountsFromBalance exactly.
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
    const printed = (printedReliable && Math.abs(cur.amount) >= 0.005) ? cur.amount : null;
    if (prev != null && cur.balance != null) {
      const delta = cur.balance - prev;
      const tol = Math.max(1, Math.abs(delta) * 0.005);
      if (Math.abs(delta) < 0.005 && printed === null) { out.push(0); continue; }
      if (printed !== null) {
        if (Math.abs(delta - printed) <= tol) out.push(delta);
        else { out.push(printed); reconciled++; }
        continue;
      }
      out.push(delta);
      continue;
    }
    out.push(printed !== null ? printed : cur.amount);
  }
  return { amounts: out, reconciled };
}

// Scenario: 3 debits of -200, -210, -500. Opening 1000. True balances
// 800, 590, 90. OCR misreads the MIDDLE balance 590 → 5,90,000.
// Pure balance-delta would give: -200, +5,89,200, -5,89,910 — inflow
// AND outflow both spike by ~5.9L, net preserved. With printed amounts
// the misread is bypassed.
const misread = [
  { amount: -200, balance: 800 },
  { amount: -210, balance: 590000 },   // balance misread (true 590)
  { amount: -500, balance: 90 },
];
const pure = deriveAmounts(misread, 1000, false);
const withPrinted = deriveAmounts(misread, 1000, true);
const sumAbsIn = (a: number[]) => a.filter(x => x > 0).reduce((s, x) => s + x, 0);
const sumAbsOut = (a: number[]) => a.filter(x => x < 0).reduce((s, x) => s - x, 0);
expect('pure-delta inflates inflow on misread', sumAbsIn(pure.amounts) > 500000);
expect('printed-amount keeps inflow ~0', sumAbsIn(withPrinted.amounts) < 1);
expect('printed-amount outflow = 910 (200+210+500)', Math.abs(sumAbsOut(withPrinted.amounts) - 910) < 0.01);
expect('reconciled 2 rows on misread', withPrinted.reconciled === 2);

// Agreement case: printed amounts match balance deltas → no reconcile,
// amounts = deltas exactly.
const clean = [
  { amount: -200, balance: 800 },
  { amount: -210, balance: 590 },
  { amount: -500, balance: 90 },
];
const cleanOut = deriveAmounts(clean, 1000, true);
expect('clean: 0 reconciled', cleanOut.reconciled === 0);
expect('clean: outflow = 910', Math.abs(sumAbsOut(cleanOut.amounts) - 910) < 0.01);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
