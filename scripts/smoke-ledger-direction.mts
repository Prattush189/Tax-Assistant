/** Verify the Tally To/By → Dr/Cr direction helper and the signed-amount
 *  convention used by the ledger-compare tables / CSV / Excel export.
 *  Run: npx tsx scripts/smoke-ledger-direction.mts
 */
import { ledgerEntryDirection, signedByDirection, resolveDir } from '../src/components/ledger-scrutiny/lib/ledgerDirection.ts';

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

console.log('\nMirror fallback (matched pair, one side has no narration):');
// Own marker wins.
check('own "By PURCHASE" → Cr (ignores other)', resolveDir('By PURCHASE ISS @ 18%', '') === 'Cr');
check('own "To HDFC BANK" → Dr (ignores other)', resolveDir('To HDFC BANK', 'By PURCHASE') === 'Dr');
// Silent side mirrors the other.
check('Entity B silent, A is Cr → B mirrors to Dr', resolveDir('', 'By PURCHASE ISS @ 18%') === 'Dr');
check('Entity B silent, A is Dr → B mirrors to Cr', resolveDir(null, 'To HDFC BANK') === 'Cr');
check('both silent → null', resolveDir('', '') === null);

console.log('\nThe exact screenshot rows (A has To/By, B narration empty):');
const pair = (amtA: number, narrA: string, amtB: number, narrB: string) => ({
  a: signedByDirection(amtA, resolveDir(narrA, narrB)),
  b: signedByDirection(amtB, resolveDir(narrB, narrA)),
});
{
  const { a, b } = pair(13452, 'By PURCHASE ISS @ 18%', 13452, '');
  check('"By PURCHASE": A=+13452 (Cr), B=−13452 (Dr mirror)', a === 13452 && b === -13452, `(A=${a} B=${b})`);
}
{
  const { a, b } = pair(106672, 'To HDFC BANK(2735) ...SHREE BANKE', 106672, '');
  check('"To HDFC BANK": A=−106672 (Dr), B=+106672 (Cr mirror)', a === -106672 && b === 106672, `(A=${a} B=${b})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
