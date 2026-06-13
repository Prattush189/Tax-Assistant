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

// ── Balance-delta + spike-repair (mirrors deriveAmountsFromBalance) ──
// Inline re-implementation so the test doesn't import the route module
// (which pulls in the DB + Gemini at import time). Mirrors server/
// routes/bankStatements.ts deriveAmountsFromBalance: PURE deltas (exact
// net via telescoping; sign from the trajectory, not the structurer)
// + an OCR spike-repair pass that fixes gross inflation from misread
// balances WITHOUT disturbing the net.
function deriveAmounts(
  rows: Array<{ amount: number; balance: number | null }>,
  opening: number | null,
  printedReliable: boolean,
): { amounts: number[]; reconciled: number } {
  const out: number[] = [];
  const printedMag: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i];
    const prev = i === 0 ? opening : rows[i - 1].balance;
    const pMag = printedReliable ? Math.abs(cur.amount) : 0;
    if (prev != null && cur.balance != null) {
      const delta = cur.balance - prev;
      if (Math.abs(delta) < 0.005 && pMag < 0.005) { out.push(0); printedMag.push(0); continue; }
      out.push(delta); printedMag.push(pMag);
      continue;
    }
    out.push(cur.amount); printedMag.push(pMag);
  }
  let reconciled = 0;
  if (printedReliable && out.length >= 2) {
    for (let i = 0; i < out.length - 1; i++) {
      const pIn = printedMag[i], pOut = printedMag[i + 1];
      if (pIn < 0.005 || pOut < 0.005) continue;
      if (Math.abs(out[i]) <= Math.max(10_000, pIn * 3)) continue;
      const pairSum = out[i] + out[i + 1];
      if (Math.abs(pairSum) > Math.abs(out[i]) * 0.5) continue;
      let bestS = 1, bestErr = Infinity;
      for (const s of [1, -1]) {
        const err = Math.abs(Math.abs(pairSum - s * pIn) - pOut);
        if (err < bestErr) { bestErr = err; bestS = s; }
      }
      const outMag = Math.abs(pairSum - bestS * pIn);
      if (Math.abs(outMag - pOut) <= Math.max(1, pOut * 0.02)) {
        out[i] = bestS * pIn;
        out[i + 1] = pairSum - bestS * pIn;
        reconciled++;
      }
    }
  }
  return { amounts: out, reconciled };
}

const sumAbsIn = (a: number[]) => a.filter(x => x > 0).reduce((s, x) => s + x, 0);
const sumAbsOut = (a: number[]) => a.filter(x => x < 0).reduce((s, x) => s - x, 0);
const net = (a: number[]) => a.reduce((s, x) => s + x, 0);

// Misread-balance case: 3 debits -200,-210,-500. Opening 1000, true
// balances 800,590,90. OCR misreads the MIDDLE balance 590 → 590000.
// Pure delta gives -200,+589200,-589910: gross spikes ~5.9L but the NET
// telescopes to exactly closing-opening = -910. Spike-repair fixes the
// gross using printed magnitudes, net untouched.
const misread = [
  { amount: -200, balance: 800 },
  { amount: -210, balance: 590000 },
  { amount: -500, balance: 90 },
];
const pure = deriveAmounts(misread, 1000, false);
const repaired = deriveAmounts(misread, 1000, true);
expect('pure delta: net is EXACT (-910) despite misread', Math.abs(net(pure.amounts) - (-910)) < 0.01);
expect('pure delta: gross inflated on misread', sumAbsIn(pure.amounts) > 500000);
expect('spike-repair: net still EXACT (-910)', Math.abs(net(repaired.amounts) - (-910)) < 0.01);
expect('spike-repair: gross fixed (inflow ~0)', sumAbsIn(repaired.amounts) < 1);
expect('spike-repair: outflow = 910', Math.abs(sumAbsOut(repaired.amounts) - 910) < 0.01);
expect('spike-repair: repaired 1 pair', repaired.reconciled === 1);

// Clean case: balances all correct → no spike → amounts = deltas.
const clean = [
  { amount: -200, balance: 800 },
  { amount: -210, balance: 590 },
  { amount: -500, balance: 90 },
];
const cleanOut = deriveAmounts(clean, 1000, true);
expect('clean: 0 repaired', cleanOut.reconciled === 0);
expect('clean: outflow = 910, net -910', Math.abs(sumAbsOut(cleanOut.amounts) - 910) < 0.01 && Math.abs(net(cleanOut.amounts) + 910) < 0.01);

// Wrong-direction case: the structurer mis-signs two withdrawals as
// credits (+200,+500), but the BALANCES are correct. Pure delta ignores
// the structurer's sign entirely → all three come out as debits.
const wrongDir = [
  { amount: +200, balance: 800 },
  { amount: -210, balance: 590 },
  { amount: +500, balance: 90 },
];
const fixed = deriveAmounts(wrongDir, 1000, true);
expect('wrong-direction: all debits via trajectory (outflow 910)', Math.abs(sumAbsOut(fixed.amounts) - 910) < 0.01);
expect('wrong-direction: zero inflow', sumAbsIn(fixed.amounts) < 0.01);
expect('wrong-direction: net -910', Math.abs(net(fixed.amounts) + 910) < 0.01);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
