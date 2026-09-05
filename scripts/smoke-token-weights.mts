/** Token-accounting smoke test.
 *
 *  Pins the three things that were wrong before 2026-09:
 *    1. thinking tokens were dropped from output (candidatesTokenCount
 *       alone), so Deep calls under-counted by roughly half;
 *    2. cached prompt tokens were weighted/costed at full input rate;
 *    3. vision cost was hardcoded at T2 rates regardless of model.
 *  Numbers below are taken from Google's pricing sheet for 3.8 / 3.7
 *  Flash (promo, through 2026-12-31) and 2.5 Flash-Lite.
 *
 *  Run: npx tsx scripts/smoke-token-weights.mts
 */
const { billableGeminiUsage } = await import('../server/lib/geminiChat.js');
const { computeWeightedTokens, getWeightFor } = await import('../server/lib/modelWeights.js');
const { costForModel } = await import('../server/lib/gemini.js');

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const M = 1_000_000;

// ── 1. billable usage: thinking counts as output, cached is split out ──
const b = billableGeminiUsage({ promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 1500, cachedContentTokenCount: 800 });
ok(b.inputTokens === 1000, 'input = promptTokenCount (' + b.inputTokens + ')');
ok(b.outputTokens === 1700, 'output = candidates + thoughts = 1700 (' + b.outputTokens + ')');
ok(b.cachedInputTokens === 800, 'cached split out (' + b.cachedInputTokens + ')');
const z = billableGeminiUsage(undefined);
ok(z.inputTokens === 0 && z.outputTokens === 0 && z.cachedInputTokens === 0, 'missing usageMetadata -> zeros');
ok(billableGeminiUsage({ promptTokenCount: 1000, cachedContentTokenCount: 5000 }).cachedInputTokens === 1000, 'cached clamped to prompt');
ok(billableGeminiUsage({ promptTokenCount: 10, candidatesTokenCount: 5 }).outputTokens === 5, 'no thoughts field -> output unchanged');

// ── 2. weights match the pricing sheet (anchor: 2.5 Flash-Lite input $0.10 = 1x) ──
const w38 = getWeightFor('gemini-3.8-flash');
ok(w38.wIn === 7.5 && w38.wOut === 37.5 && w38.wCached === 0.75, '3.8 Std weights 7.5 / 37.5 / cached 0.75');
const w38f = getWeightFor('gemini-3.8-flash-flex');
ok(w38f.wIn === 3.75 && w38f.wOut === 18.75 && w38f.wCached === 0.375, '3.8 Flex weights 3.75 / 18.75 / cached 0.375');
const w37 = getWeightFor('gemini-3.7-flash');
ok(w37.wIn === w38.wIn && w37.wOut === w38.wOut, '3.7 == 3.8 (identically priced)');
const w25 = getWeightFor('gemini-2.5-flash-lite');
ok(w25.wIn === 1 && w25.wOut === 4 && w25.wCached === 0.25, '2.5 Flash-Lite anchor 1 / 4 / cached 0.25');

// ── 3. weighted tokens: the Deep-call scenario from (1) on 3.8 Flex ──
const weighted = computeWeightedTokens('gemini-3.8-flash-flex', 1000, 1700, 800);
// fresh 200*3.75 = 750; cached 800*0.375 = 300; output 1700*18.75 = 31875
ok(weighted === 32925, 'weighted(3.8 flex, in 1000, out 1700, cached 800) = 32925 (' + weighted + ')');
const oldWay = computeWeightedTokens('gemini-3.8-flash-flex', 1000, 200, 0);
ok(oldWay === 7500, 'same call the OLD way (no thoughts, no cache split) = 7500 (' + oldWay + ')');
console.log('      -> old accounting reported ' + (100 * oldWay / weighted).toFixed(0) + '% of the real weighted cost for this call');
ok(computeWeightedTokens('gemini-2.5-flash-lite', 1000, 400) === 2600, 'weighted(2.5, 1000/400) = 2600');
ok(computeWeightedTokens('gemini-3.8-flash', 100, 0, 500) === 75, 'cached clamped to input in weights (100*0.75 = 75)');
ok(computeWeightedTokens(undefined, 100, 100) === 500, 'unknown model -> T2 fallback (100 + 400)');

// ── 4. USD cost matches the sheet ──
ok(near(costForModel('gemini-3.8-flash', M, 0), 0.75), '3.8 Std input $0.75/M');
ok(near(costForModel('gemini-3.8-flash', 0, M), 3.75), '3.8 Std output $3.75/M');
ok(near(costForModel('gemini-3.8-flash-flex', M, 0), 0.375), '3.8 Flex input $0.375/M');
ok(near(costForModel('gemini-3.8-flash-flex', 0, M), 1.875), '3.8 Flex output $1.875/M');
ok(near(costForModel('gemini-3.8-flash', M, 0, M), 0.075), '3.8 Std fully-cached input $0.075/M');
ok(near(costForModel('gemini-3.8-flash-flex', M, 0, M), 0.0375), '3.8 Flex fully-cached input $0.0375/M');
ok(near(costForModel('gemini-3.7-flash', M, M), costForModel('gemini-3.8-flash', M, M)), '3.7 cost == 3.8 cost');
ok(near(costForModel('gemini-2.5-flash-lite', M, 0, M), 0.025), '2.5 Flash-Lite cached $0.025/M');
ok(near(costForModel('gemini-2.5-flash-lite', M, M), 0.5), '2.5 Flash-Lite $0.10 + $0.40');
ok(near(costForModel('gemini-3.6-flash', M, M), 9.0), 'retired 3.6 still prices historic rows ($1.50 + $7.50)');
// vision on 3.7 was previously billed at T2 rates:
const visionReal = costForModel('gemini-3.7-flash', 50_000, 2_000);
const visionOld = costForModel('gemini-2.5-flash-lite', 50_000, 2_000);
ok(visionReal > visionOld * 5, 'vision cost at real model is >5x the old hardcoded T2 figure (' + visionReal.toFixed(4) + ' vs ' + visionOld.toFixed(4) + ')');

console.log(fails === 0 ? '\nALL PASSED' : '\n' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);
