// Launch offer ("all features 75% off"): every AI call inside the window
// weighs 25%, whichever model answered (Claude or Gemini); outside it
// 100%; IST created_at strings parse right at both edges.
// Run: npx tsx scripts/smoke-launch-offer.mts
const { computeWeightedTokens } = await import('../server/lib/modelWeights.js');
const { launchOfferActive, launchOfferMultiplier, LAUNCH_OFFER } = await import('../server/lib/launchOffer.js');

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };

const INSIDE = '2026-11-20 10:00:00';   // api_usage.created_at shape (IST wall-clock)
const BEFORE = '2026-11-11 23:59:59';
const AFTER = '2026-12-13 00:00:00';

// A real Haiku notice row (7,051 in / 7,801 out): 46,056 at full weight.
const full = computeWeightedTokens('claude-haiku-5-5', 7_051, 7_801, 0, BEFORE);
ok(full === 46_056, `Haiku row before the offer = full weight (${full})`);
ok(computeWeightedTokens('claude-haiku-5-5', 7_051, 7_801, 0, INSIDE) === 11_514, 'Haiku row inside the offer = 25% (11,514)');
ok(computeWeightedTokens('claude-haiku-5-5', 7_051, 7_801, 0, AFTER) === 46_056, 'Haiku row after the offer = full weight');

// Sonnet and Opus too; cached tokens discounted the same way.
const sonnetFull = computeWeightedTokens('claude-sonnet-5-5', 7_051, 2_888, 1_000, BEFORE);
const sonnetOffer = computeWeightedTokens('claude-sonnet-5-5', 7_051, 2_888, 1_000, INSIDE);
ok(sonnetOffer === Math.ceil((6_051 * 20 + 1_000 * 2 + 2_888 * 100) * 0.25), `Sonnet with cache inside = 25% (${sonnetOffer} of ${sonnetFull})`);
ok(computeWeightedTokens('claude-opus-5-5', 1_000, 1_000, 0, INSIDE) === 60_000, 'Opus inside = 25% of 240,000');

// Gemini too (primary or fallback): "all features" means every call.
ok(computeWeightedTokens('gemini-3.8-flash', 4_200, 1_200, 0, BEFORE) === 76_500, 'Gemini 3.8 before the offer = full weight (76,500)');
ok(computeWeightedTokens('gemini-3.8-flash', 4_200, 1_200, 0, INSIDE) === 19_125, 'Gemini 3.8 inside the offer = 25% (19,125)');
ok(computeWeightedTokens('gemini-3.8-flash', 4_200, 1_200, 0, AFTER) === 76_500, 'Gemini 3.8 after the offer = full weight');
ok(computeWeightedTokens(undefined, 100, 100, 0, INSIDE) === 125, 'unknown model inside the window = 25% (125 of 500)');
ok(computeWeightedTokens(undefined, 100, 100, 0, AFTER) === 500, 'unknown model after the window = full weight');

// Window edges in IST, as stored strings and as instants.
ok(!launchOfferActive('2026-11-11 23:59:59'), 'IST 11 Nov 23:59:59 is before the offer');
ok(launchOfferActive('2026-11-12 00:00:00'), 'IST 12 Nov 00:00:00 starts the offer');
ok(launchOfferActive('2026-12-12 23:59:59'), 'IST 12 Dec 23:59:59 is the last second');
ok(!launchOfferActive('2026-12-13 00:00:00'), 'IST 13 Dec 00:00:00 is after the offer');
ok(launchOfferActive(new Date('2026-11-11T18:30:00Z')), 'UTC 11 Nov 18:30 = IST midnight 12 Nov: inside');
ok(!launchOfferActive(new Date('2026-11-11T18:29:59Z')), 'UTC 11 Nov 18:29:59: before');
ok(launchOfferActive('2026-12-12T18:29:59Z'), 'zoned ISO string honoured (UTC 12 Dec 18:29:59 inside)');
ok(launchOfferMultiplier(INSIDE) === 0.25 && launchOfferMultiplier(AFTER) === 1, 'multiplier 0.25 inside, 1 outside');
ok(LAUNCH_OFFER.discountPct === 75, 'offer is 75% off');

// Default "now" follows the clock (this run's date decides the expected value).
const nowInside = Date.now() >= Date.parse(LAUNCH_OFFER.startsAt) && Date.now() < Date.parse(LAUNCH_OFFER.endsAt);
ok(launchOfferActive() === nowInside, `no time given uses now (offer ${nowInside ? 'on' : 'off'} today)`);

// The offer switches itself off with no redeploy: move the clock and new
// rows (logged with no time, i.e. "now") weigh full again, and the check
// the pop-up route makes (launchOfferActive()) turns false.
const realNow = Date.now;
const atClock = (iso: string) => { Date.now = () => Date.parse(iso); };
try {
  atClock('2026-12-12T23:59:59+05:30');
  ok(launchOfferActive() && computeWeightedTokens('claude-opus-5-5', 1_000, 1_000) === 60_000, 'clock on 12 Dec 23:59:59 IST: offer on, new Opus row 25%');
  ok(computeWeightedTokens('gemini-3.8-flash', 4_200, 1_200) === 19_125, 'clock on 12 Dec 23:59:59 IST: new Gemini row 25%');
  atClock('2026-12-13T00:00:00+05:30');
  ok(!launchOfferActive(), 'clock on 13 Dec 00:00 IST: offer off (pop-up route reports active=false)');
  ok(computeWeightedTokens('claude-opus-5-5', 1_000, 1_000) === 240_000, 'clock on 13 Dec 00:00 IST: new Opus row full weight');
  ok(computeWeightedTokens('claude-haiku-5-5', 7_051, 7_801) === 46_056, 'clock on 13 Dec 00:00 IST: new Haiku row full weight');
  ok(computeWeightedTokens('gemini-3.8-flash', 4_200, 1_200) === 76_500, 'clock on 13 Dec 00:00 IST: new Gemini row full weight');
  atClock('2027-03-01T12:00:00+05:30');
  ok(!launchOfferActive() && launchOfferMultiplier() === 1, 'months later: still off');
} finally {
  Date.now = realNow;
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
