/** Debit/Credit repair for AI-read ledgers (server/lib/ledgerSideRepair):
 *  flipped sides are corrected from the running balance, and nothing is
 *  touched without balances to prove it. Synthetic, no API calls.
 *  Run: npx tsx scripts/smoke-ledger-side-repair.mts
 */
const { repairSidesFromBalances } = await import('../server/lib/ledgerSideRepair');

let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, x = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${x ? '  ' + x : ''}`); };
type Tx = { debit: number; credit: number; balance: number | null };
// A Dr-natured account: debits raise the balance.
const clean = (): Tx[] => {
  const amounts: Array<[number, 'dr' | 'cr']> = [[1000, 'dr'], [200, 'cr'], [50, 'cr'], [500, 'dr'], [250, 'cr'], [20, 'dr'], [300, 'dr'], [75, 'cr']];
  let bal = 5000;
  return amounts.map(([a, s]) => {
    bal += s === 'dr' ? a : -a;
    return { debit: s === 'dr' ? a : 0, credit: s === 'cr' ? a : 0, balance: bal };
  });
};
const ledger = (txs: Tx[]) => ({ accounts: [{ totalDebit: 0, totalCredit: 0, transactions: txs }] });
const swap = (t: Tx) => { [t.debit, t.credit] = [t.credit, t.debit]; };

console.log('clean ledger');
const c = clean();
ck('nothing flipped', repairSidesFromBalances(ledger(c)) === 0);

console.log('three rows on the wrong side');
const bad = clean(); swap(bad[2]); swap(bad[4]); swap(bad[6]);
const n = repairSidesFromBalances(ledger(bad));
ck('three flipped back', n === 3, `(${n})`);
ck('matches the clean ledger', JSON.stringify(bad) === JSON.stringify(clean()));

console.log('every row swapped (indistinguishable from a Cr-natured account)');
const all = clean(); all.forEach(swap);
ck('left alone', repairSidesFromBalances(ledger(all)) === 0);

console.log('a flipped row with no balance');
const nob = clean(); swap(nob[3]); nob[3].balance = null;
ck('left alone (nothing proves it)', repairSidesFromBalances(ledger(nob)) === 0 && nob[3].credit === 500);

console.log('no running balances');
const none = clean().map(t => ({ ...t, balance: null })); swap(none[1]);
ck('left alone', repairSidesFromBalances(ledger(none)) === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
