/** Unit checks for the post-extraction tagging fixes:
 *    1. ruleTextMatches — separator-robust auto-tagging rule matching
 *
 *  ruleTextMatches is a private helper inside the heavy route module, so
 *  it's mirrored here verbatim — keep the two in sync.
 *
 *  (The numeric-condition checks were dropped when the bank-statement
 *  "conditions" feature was removed — custom download filters replace it.)
 *
 *  Run: npx tsx scripts/debug-tagging-fixes.mts
 */

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
