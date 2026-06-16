/** Unit checks for the post-extraction tagging fixes:
 *    1. ruleTextMatches  — separator-robust auto-tagging rule matching
 *    2. parseDeterministicCondition — numeric-threshold conditions in code
 *
 *  parseDeterministicCondition is imported from the real module (DB_PATH
 *  points at a throwaway file so the repo import doesn't touch prod data).
 *  ruleTextMatches is a private helper inside the heavy route module, so
 *  it's mirrored here verbatim — keep the two in sync.
 *
 *  Run: npx tsx scripts/debug-tagging-fixes.mts
 */
import os from 'node:os';
import path from 'node:path';

// Point at a COPY of the dev DB (already fully migrated) so importing the
// repo layer doesn't hit the fresh-DB migration-ordering bug, and never
// touches the real file.
process.env.DB_PATH = path.join(os.tmpdir(), 'tagging-test-seed.db');

const { parseDeterministicCondition } = await import('../server/lib/bankConditionFilter.ts');

// ── mirror of server/routes/bankStatements.ts ruleTextMatches ──
function ruleTextMatches(narration: string, matchText: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const hay = norm(narration);
  const needle = norm(matchText);
  if (!needle) return false;
  if (hay.includes(needle)) return true;
  return hay.replace(/ /g, '').includes(needle.replace(/ /g, ''));
}

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
}

const EN = '–'; // en-dash, as SBI prints it

console.log('ruleTextMatches (auto-tagging rules):');
check('en-dash name', ruleTextMatches(`0043988908532 OF Mr. AVINASH ${EN} MEHRA AT 0313`, 'AVINASH MEHRA'), true);
check('hyphen+spaces name', ruleTextMatches('NEFT OF Mr. AVINASH - MEHRA AT', 'AVINASH MEHRA'), true);
check('double space name', ruleTextMatches('UPI SHEILA  DEVI 9988', 'SHEILA DEVI'), true);
check('jammed token (spaceless fallback)', ruleTextMatches('UPI/HDFCHL0001234/EMI', 'HDFC HL'), true);
check('plain substring still works', ruleTextMatches('ZOMATO LTD BANGALORE', 'ZOMATO'), true);
check('non-match stays false', ruleTextMatches('RANDOM PAYEE 1234', 'AVINASH MEHRA'), false);
check('case-insensitive', ruleTextMatches('payment to avinash mehra', 'AVINASH MEHRA'), true);

console.log('\nparseDeterministicCondition (numeric conditions):');
// helper: parse then evaluate against a signed amount
function evalCond(text: string, amount: number): boolean | null {
  const p = parseDeterministicCondition(text);
  if (!p) return null;
  return p({ narration: '', amount });
}
// "under 500" — the user's exact condition (worded "statements", and the
// transactions variant)
check('under 500 hides 300 debit', evalCond('Ignore statements under 500', -300), true);
check('under 500 hides 499 credit', evalCond('Ignore transactions under 500', 499), true);
check('under 500 keeps 500 (strict <)', evalCond('Ignore transactions under 500', 500), false);
check('under 500 keeps 600', evalCond('Ignore transactions under 500', -600), false);
check('below ₹100', evalCond('hide anything below ₹100', 50), true);
check('up to 50 is inclusive', evalCond('exclude up to 50', -50), true);
check('at least 1000', evalCond('hide at least 1000', 1000), true);
check('above 1 lakh', evalCond('ignore transactions above 1 lakh', 150000), true);
check('above 1 lakh keeps 90k', evalCond('ignore transactions above 1 lakh', 90000), false);
check('debit-only over 1 lakh hides debit', evalCond('exclude debits over 1 lakh', -150000), true);
check('debit-only over 1 lakh keeps credit', evalCond('exclude debits over 1 lakh', 150000), false);
check('50k magnitude', evalCond('hide credits above 50k', 60000), true);
// semantic conditions → null (fall back to AI)
check('semantic: ATM withdrawals → AI', parseDeterministicCondition('exclude ATM withdrawals'), null);
check('semantic: zomato → AI', parseDeterministicCondition('treat all ZOMATO as personal'), null);
check('semantic: salary credits → AI', parseDeterministicCondition('hide salary credits'), null);
check('safety gate: under 500 from zomato → AI', parseDeterministicCondition('ignore transactions under 500 from zomato'), null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
