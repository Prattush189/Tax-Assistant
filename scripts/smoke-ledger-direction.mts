/** Verify the Tally To/By → Dr/Cr direction helper and the signed-amount
 *  convention used by the ledger-compare tables / CSV / Excel export.
 *  Run: npx tsx scripts/smoke-ledger-direction.mts
 */
import { ledgerEntryDirection, signedByDirection } from '../src/components/ledger-scrutiny/lib/ledgerDirection.ts';

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`); };

console.log('Direction from narration (Tally To/By):');
const dir = ledgerEntryDirection;
check('"By PURCHASE ISS @ 18%" → Cr', dir('By PURCHASE ISS @ 18%') === 'Cr');
check('"To HDFC BANK(2735) …" → Dr', dir('To HDFC BANK(2735) 50200058867159-TPT-BILL') === 'Dr');
check('"To SALE A/C ISS @ 18%" → Dr', dir('To SALE A/C ISS @ 18%') === 'Dr');
check('leading whitespace tolerated', dir('   By Sales') === 'Cr');
check('lowercase tolerated', dir('to bank') === 'Dr');
check('"toll plaza" does NOT match To (word boundary)', dir('toll plaza fastag') === null, `(got ${dir('toll plaza fastag')})`);
check('"BILL PAYMENT-SHREE BANKE" (no marker) → null', dir('BILL PAYMENT-SHREE BANKE ENTERPRISES') === null);
check('empty/null → null', dir('') === null && dir(null) === null && dir(undefined) === null);

console.log('\nSigned amount (Credit +, Debit −):');
check('Cr keeps positive', signedByDirection(13452, 'Cr') === 13452);
check('Dr becomes negative', signedByDirection(13452, 'Dr') === -13452);
check('unknown stays magnitude', signedByDirection(13452, null) === 13452);
check('Dr on already-negative still negative magnitude', signedByDirection(-500, 'Dr') === -500);
check('Cr on negative input → positive magnitude', signedByDirection(-500, 'Cr') === 500);

console.log('\nEnd-to-end on the real screenshot rows:');
const rows = [
  { amt: 13452, narr: 'By PURCHASE ISS @ 18%', want: 13452 },
  { amt: 106672, narr: 'To HDFC BANK(2735) 50200058867159-TPT-BIL 382-SHREE BANKE ENTERPRISES', want: -106672 },
  { amt: 1062, narr: 'To SALE A/C ISS @ 18%', want: -1062 },
];
for (const r of rows) {
  const got = signedByDirection(r.amt, ledgerEntryDirection(r.narr));
  check(`"${r.narr.slice(0, 24)}…" → ${r.want}`, got === r.want, `(got ${got})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
