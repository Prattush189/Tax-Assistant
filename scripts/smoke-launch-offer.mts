// Launch offer ("50% off every feature except chat", 12 Nov - 12 Dec 2026):
// inside the window a non-chat call weighs half, and a Claude call is
// priced as Gemini 3.1 Flash-Lite Flex before the discount; chat rows are
// never discounted; outside the window everything is normal; the offer
// can end early (Claude credits used up); IST strings parse at the edges.
// Run: npx tsx scripts/smoke-launch-offer.mts
const { computeWeightedTokens } = await import('../server/lib/modelWeights.js');
const { launchOfferActive, launchOfferApplies, launchOfferEndsAt, setLaunchOfferEarlyEnd, LAUNCH_OFFER, LAUNCH_OFFER_FACTOR, CLAUDE_PRICED_AS } =
  await import('../server/lib/launchOffer.js');

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };

const INSIDE = '2026-11-20 10:00:00';   // api_usage.created_at shape (IST wall-clock)
const BEFORE = '2026-11-11 23:59:59';
const AFTER = '2026-12-13 00:00:00';

ok(LAUNCH_OFFER.discountPct === 50 && LAUNCH_OFFER_FACTOR === 0.5, 'offer is 50% off');
ok(CLAUDE_PRICED_AS === 'gemini-3.1-flash-lite-flex', 'Claude priced as 3.1 Flash-Lite Flex inside the offer');
ok(LAUNCH_OFFER.excludes.includes('chat'), 'chat is excluded');

// Claude notice row from the 2026-11-13 Sonnet bake-off (14,000 in / 3,600 out).
// Outside: Sonnet's own weights (20 / 100) = 640,000.
// Inside, non-chat: Flash-Lite Flex (1.25 / 7.5) = 44,500, halved = 22,250.
ok(computeWeightedTokens('claude-sonnet-5-5', 14_000, 3_600, 0, BEFORE, 'notice') === 640_000, 'Sonnet notice before the offer = Sonnet weight (640,000 = 64 credits)');
ok(computeWeightedTokens('claude-sonnet-5-5', 14_000, 3_600, 0, INSIDE, 'notice') === 22_250, 'Sonnet notice inside = Gemini price, halved (22,250 = 2.2 credits)');
ok(computeWeightedTokens('claude-sonnet-5-5', 14_000, 3_600, 0, AFTER, 'notice') === 640_000, 'Sonnet notice after the offer = Sonnet weight');
ok(computeWeightedTokens('claude-opus-5-5', 1_000, 1_000, 0, INSIDE, 'document') === Math.ceil((1_000 * 1.25 + 1_000 * 7.5) * 0.5), 'Opus inside is priced the same way (any Claude model)');
ok(computeWeightedTokens('claude-sonnet-5-5', 10_000, 1_000, 4_000, INSIDE, 'ledger_scrutiny') === Math.ceil((6_000 * 1.25 + 4_000 * 0.3125 + 1_000 * 7.5) * 0.5), 'cached Claude tokens at the Flex cache rate, halved');
// A missing category (pre-flight estimators) counts as a non-chat feature.
ok(computeWeightedTokens('claude-sonnet-5-5', 14_000, 3_600, 0, INSIDE) === 22_250, 'no category inside = discounted like a feature');

// Gemini fallback inside the offer: its own weights, halved.
ok(computeWeightedTokens('gemini-3.1-flash-lite', 5_152, 1_104, 0, BEFORE, 'notice') === Math.ceil(5_152 * 2.5 + 1_104 * 15), 'Gemini notice before = full');
ok(computeWeightedTokens('gemini-3.1-flash-lite', 5_152, 1_104, 0, INSIDE, 'notice') === Math.ceil((5_152 * 2.5 + 1_104 * 15) * 0.5), 'Gemini notice inside = half');

// Chat is never discounted (Gemini only).
ok(computeWeightedTokens('gemini-3.8-flash', 4_200, 1_200, 0, INSIDE, 'chat') === 76_500, 'chat inside the offer = full weight (76,500)');
ok(computeWeightedTokens('gemini-3.1-flash-lite-flex', 4_200, 400, 0, INSIDE, 'chat') === Math.ceil(4_200 * 1.25 + 400 * 7.5), 'Fast chat inside = full weight');
ok(!launchOfferApplies('chat', INSIDE) && launchOfferApplies('notice', INSIDE), 'applies to notice, not to chat');

// Window edges in IST, as stored strings and as instants.
ok(!launchOfferActive('2026-11-11 23:59:59'), 'IST 11 Nov 23:59:59 is before the offer');
ok(launchOfferActive('2026-11-12 00:00:00'), 'IST 12 Nov 00:00:00 starts the offer');
ok(launchOfferActive('2026-12-12 23:59:59'), 'IST 12 Dec 23:59:59 is the last second');
ok(!launchOfferActive('2026-12-13 00:00:00'), 'IST 13 Dec 00:00:00 is after the offer');
ok(launchOfferActive(new Date('2026-11-11T18:30:00Z')), 'UTC 11 Nov 18:30 = IST midnight 12 Nov: inside');
ok(!launchOfferActive(new Date('2026-11-11T18:29:59Z')), 'UTC 11 Nov 18:29:59: before');
ok(launchOfferActive('2026-12-12T18:29:59Z'), 'zoned ISO string honoured (UTC 12 Dec 18:29:59 inside)');

// Early end (Claude credits used up): rows from then on are full price,
// rows before it keep the discount (a recompute stays fair).
setLaunchOfferEarlyEnd('2026-11-25 15:00:00');
try {
  ok(launchOfferEndsAt() === new Date('2026-11-25T15:00:00+05:30').toISOString(), 'early end moves endsAt');
  ok(launchOfferActive('2026-11-25 14:59:59') && !launchOfferActive('2026-11-25 15:00:00'), 'offer ends at the early-end moment');
  ok(computeWeightedTokens('gemini-3.1-flash-lite', 5_152, 1_104, 0, '2026-11-26 10:00:00', 'notice') === Math.ceil(5_152 * 2.5 + 1_104 * 15), 'Gemini row after an early end = full price');
  ok(computeWeightedTokens('claude-sonnet-5-5', 14_000, 3_600, 0, '2026-11-20 10:00:00', 'notice') === 22_250, 'row before the early end keeps the discount');
  setLaunchOfferEarlyEnd('2027-01-31 00:00:00');
  ok(launchOfferEndsAt() === new Date(LAUNCH_OFFER.endsAt).toISOString(), 'an "early end" after 13 Dec cannot extend the offer');
} finally {
  setLaunchOfferEarlyEnd(null);
}
ok(launchOfferEndsAt() === new Date(LAUNCH_OFFER.endsAt).toISOString(), 'cleared early end restores 13 Dec');

// The offer switches itself off with no redeploy.
const realNow = Date.now;
const atClock = (iso: string) => { Date.now = () => Date.parse(iso); };
try {
  atClock('2026-12-12T23:59:59+05:30');
  ok(launchOfferActive() && computeWeightedTokens('claude-sonnet-5-5', 14_000, 3_600, 0, undefined, 'notice') === 22_250, 'clock on 12 Dec 23:59:59 IST: offer on');
  atClock('2026-12-13T00:00:00+05:30');
  ok(!launchOfferActive(), 'clock on 13 Dec 00:00 IST: offer off (pop-up route reports active=false)');
  ok(computeWeightedTokens('gemini-3.1-flash-lite', 5_152, 1_104, 0, undefined, 'notice') === Math.ceil(5_152 * 2.5 + 1_104 * 15), 'clock on 13 Dec: new Gemini row full price');
} finally {
  Date.now = realNow;
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
