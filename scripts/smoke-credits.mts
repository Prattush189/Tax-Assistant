/** Credits display-layer smoke test.
 *  Run: npx tsx scripts/smoke-credits.mts */
const { CREDIT_UNIT, toCredits, creditsCeil, creditsToWeighted, summarizeCredits, CREDIT_ESTIMATES } = await import('../server/lib/credits.js');
const { PLAN_DEFAULTS } = await import('../server/lib/planLimits.js');
const { computeWeightedTokens } = await import('../server/lib/modelWeights.js');

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };

ok(CREDIT_UNIT === 10_000, '1 credit = 10,000 weighted tokens');
ok(toCredits(PLAN_DEFAULTS.free.monthlyTokenBudget) === 25, 'Free 250K -> 25 credits');
ok(toCredits(PLAN_DEFAULTS.pro.monthlyTokenBudget) === 2000, 'Pro 20M -> 2,000 credits');
ok(toCredits(PLAN_DEFAULTS.enterprise.monthlyTokenBudget) === 6000, 'Enterprise 60M -> 6,000 credits');
ok(creditsToWeighted(toCredits(PLAN_DEFAULTS.pro.monthlyTokenBudget)) === PLAN_DEFAULTS.pro.monthlyTokenBudget, 'round-trips exactly for plan budgets');
ok(toCredits(4_999) === 0 && toCredits(5_000) === 1 && creditsCeil(1) === 1, 'rounding: display rounds, gate ceils');

const s = summarizeCredits({ used: 123_456, budget: 250_000, remaining: 126_544 });
ok(s.used === 12 && s.budget === 25 && s.remaining === 13, 'summary maps used/budget/remaining (' + s.used + '/' + s.budget + '/' + s.remaining + ')');
ok(Object.keys(s.estimates).length >= 6, 'estimates exposed');

// The promise the UI makes: a Fast chat message ("hi" on 3.1 Flash-Lite Flex)
// costs about one credit with the ~4.2K-token prompt+history we send.
const fastHi = computeWeightedTokens('gemini-3.1-flash-lite-flex', 4_200, 400, 0);
ok(creditsCeil(fastHi) === CREDIT_ESTIMATES.chat_fast, 'Fast "hi" on 3.1 Lite Flex ~= ' + fastHi + ' weighted -> ' + creditsCeil(fastHi) + ' credit');
const fastHiStd37 = computeWeightedTokens('gemini-3.7-flash', 4_200, 400, 0);
ok(creditsCeil(fastHiStd37) >= 4, 'same "hi" on 3.7 Standard would be ' + creditsCeil(fastHiStd37) + ' credits (why Fast moved off it)');
const deep = computeWeightedTokens('gemini-3.8-flash', 4_200, 1_200, 0);
ok(Math.abs(creditsCeil(deep) - CREDIT_ESTIMATES.chat_deep) <= 1, 'Deep reply on 3.8 Standard ~= ' + creditsCeil(deep) + ' credits (estimate ' + CREDIT_ESTIMATES.chat_deep + ')');

console.log(fails === 0 ? '\nALL PASSED' : '\n' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);
