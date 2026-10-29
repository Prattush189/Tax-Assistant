/** Balance check that gates the Claude PDF statement reader
 *  (server/lib/claudeStatementReader.ts). Its output is only used when
 *  the running balance re-walks cleanly; otherwise the upload falls back
 *  to PaddleOCR. Synthetic rows, no API calls.
 *  Run: npx tsx scripts/smoke-claude-statement-check.mts
 */
const { checkAndRepairBalances } = await import('../server/lib/claudeStatementReader');

let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, x = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${x ? '  ' + x : ''}`); };
type Row = { date: string; narration: string; type: 'credit' | 'debit'; amount: number; balance: number | null };
const row = (type: 'credit' | 'debit', amount: number, balance: number | null): Row => ({ date: '2025-04-01', narration: 'x', type, amount, balance });
const clean = (): Row[] => [
  row('credit', 1000, 1000), row('debit', 200, 800), row('debit', 50, 750),
  row('credit', 500, 1250), row('debit', 250, 1000), row('credit', 20, 1020),
];

console.log('clean statement');
const c = checkAndRepairBalances(clean());
ck('passes', c.passed, c.reason);
ck('no repairs', c.repaired === 0);

console.log('every debit/credit swapped (J&K format-3 read)');
const swapped = clean().map(r => ({ ...r, type: r.type === 'credit' ? 'debit' : 'credit' } as Row));
const s = checkAndRepairBalances(swapped);
ck('fails — never accepted as an "inverted" statement', !s.passed, s.reason);

console.log('one misread balance digit (PNB scan: 38,084.88 read as 38,064.88)');
const misread = clean(); misread[2].balance = 730; // true 750
const m = checkAndRepairBalances(misread);
ck('passes after repair', m.passed, m.reason);
ck('one balance repaired back to 750', m.repaired === 1 && misread[2].balance === 750, `(repaired ${m.repaired}, balance ${misread[2].balance})`);

console.log('a wrong amount (not a balance misread)');
const badAmt = clean(); badAmt[1].amount = 2000; badAmt[3].amount = 5000;
const b = checkAndRepairBalances(badAmt);
ck('fails', !b.passed, b.reason);

console.log('short statement (SBI scan: 2 rows)');
const short = [row('credit', 100, 5100), row('debit', 100, 5000)];
const sh = checkAndRepairBalances(short);
ck('passes when its one checkpoint reconciles', sh.passed, sh.reason);
const shortBad = [row('credit', 100, 5100), row('debit', 100, 5050)];
ck('fails when it does not', !checkAndRepairBalances(shortBad).passed);

console.log('no balances at all');
const none = clean().map(r => ({ ...r, balance: null }));
ck('fails — cannot verify, OCR decides', !checkAndRepairBalances(none).passed);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
