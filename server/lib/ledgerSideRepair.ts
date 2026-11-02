/**
 * Debit/Credit repair for an AI-read ledger, from its own running
 * balances. The reader's commonest mistake is putting an amount on the
 * wrong side (36 of 49 misses in the 2026-10-28 bake-off; 18 of 56 rows
 * on a Tally sample whose text had lost its columns). Where a row's
 * balance moved by exactly its amount since the previous balance, the
 * direction of that move says which side the amount belongs on.
 *
 * Per account: which way a debit moves the balance (Dr-natured accounts
 * up, Cr-natured down, and AI-read balances are often unsigned) is the
 * majority vote of the rows whose move matches their amount; the rows
 * that disagree with a clear majority are flipped. Rows whose move
 * doesn't equal their amount (several entries between balances, a
 * balance crossing Dr↔Cr, a misread amount) are left alone.
 */
export interface SideRepairLedger {
  accounts: Array<{
    totalDebit: number;
    totalCredit: number;
    transactions: Array<{ debit: number; credit: number; balance: number | null }>;
  }>;
}

/** A side is only corrected when this share of the account's checkable
 *  rows agree on the direction — below it, the vote can't be trusted. */
const MAJORITY = 0.55;
const MIN_VOTES = 4;

export function repairSidesFromBalances(ledger: SideRepairLedger): number {
  let flipped = 0;
  for (const a of ledger.accounts) {
    // (row, sign of its balance move) for rows whose move equals the amount.
    const checkable: Array<{ t: SideRepairLedger['accounts'][number]['transactions'][number]; move: 1 | -1 }> = [];
    let prev: number | null = null;
    for (const t of a.transactions) {
      if (t.balance == null || !Number.isFinite(t.balance)) { prev = null; continue; }
      const amount = t.debit || t.credit;
      if (prev != null && amount > 0 && (t.debit > 0) !== (t.credit > 0)) {
        const delta = t.balance - prev;
        if (Math.abs(Math.abs(delta) - amount) < 1.01 && Math.abs(delta) >= 0.01) checkable.push({ t, move: delta > 0 ? 1 : -1 });
      }
      prev = t.balance;
    }
    if (checkable.length < MIN_VOTES) continue;
    // +1: a debit raises the balance.
    const debitUp = checkable.filter(c => (c.t.debit > 0 ? c.move : -c.move) === 1).length;
    const orientation = debitUp >= checkable.length * MAJORITY ? 1 : checkable.length - debitUp >= checkable.length * MAJORITY ? -1 : 0;
    if (!orientation) continue;
    let here = 0;
    for (const c of checkable) {
      const side = c.t.debit > 0 ? 1 : -1;
      if (side * orientation !== c.move) {
        [c.t.debit, c.t.credit] = [c.t.credit, c.t.debit];
        here++;
      }
    }
    flipped += here;
    if (here) {
      a.totalDebit = a.transactions.reduce((s, t) => s + t.debit, 0);
      a.totalCredit = a.transactions.reduce((s, t) => s + t.credit, 0);
    }
  }
  return flipped;
}
