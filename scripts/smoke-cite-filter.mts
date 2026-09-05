/** Cite-marker filter smoke test — every marker shape seen in production
 *  plus chunk-boundary splits, and proof that legitimate brackets survive.
 *  Run: npx tsx scripts/smoke-cite-filter.mts */
import { stripCiteMarkers, CiteMarkerStreamFilter } from '../server/lib/citeMarkerFilter.js';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const norm = (s: string) => s.replace(/[ \t]+([.,;:)\]])/g, '$1').replace(/[ \t]{2,}/g, ' ');

/** Stream `text` through the filter in the given chunk sizes and return
 *  everything emitted (push outputs + flush). */
function stream(text: string, sizes: number[]): string {
  const f = new CiteMarkerStreamFilter();
  let out = '', i = 0, k = 0;
  while (i < text.length) {
    const n = sizes[k++ % sizes.length];
    out += f.push(text.slice(i, i + n));
    i += n;
  }
  return out + f.flush();
}

// ── full-pass strip: the exact production shapes ──
const prod = 'Rule 29C [cite: 1.2.2] applies. Mandatory PAN [cite: 1.2.7]. See [cite: Section 139(8A) of the Income Tax Act, 1961] and [cite: WhatsApp Image 2026-06-13 at 19.38.32 (1).jpeg] and [cite: Document].';
const cleaned = stripCiteMarkers(prod);
ok(!cleaned.includes('[cite:'), 'all marker shapes removed');
ok(cleaned === 'Rule 29C applies. Mandatory PAN. See and and.', 'whitespace tidied: ' + JSON.stringify(cleaned));

// ── legitimate brackets must survive ──
const legit = 'See [Source](https://x.gov.in/a) and [[PDF:Reply letter]]body[[/PDF]] and a [note] here [cite: 1.3.5].';
const legitOut = stripCiteMarkers(legit);
ok(legitOut.includes('[Source](https://x.gov.in/a)'), 'markdown link untouched');
ok(legitOut.includes('[[PDF:Reply letter]]') && legitOut.includes('[[/PDF]]'), 'PDF tokens untouched');
ok(legitOut.includes('[note]'), 'plain bracket text untouched');
ok(!legitOut.includes('[cite:'), 'marker still removed alongside them');
ok(stripCiteMarkers('no markers here') === 'no markers here', 'fast path: unchanged when absent');

// ── streaming: every split position of a marker must produce the same text ──
const sample = 'Dividends [cite: 1.3.5] are covered. Renewal yearly [cite: 1.3.3]. Done.';
const expected = norm(stripCiteMarkers(sample));
let allSplitsOk = true;
for (let n = 1; n <= 12; n++) {
  const got = norm(stream(sample, [n]));
  if (got !== expected) { allSplitsOk = false; console.log('   split ' + n + ' -> ' + JSON.stringify(got)); }
}
ok(allSplitsOk, 'identical output for chunk sizes 1..12 (marker straddles boundaries)');
ok(norm(stream(sample, [3, 7, 2, 11])) === expected, 'mixed chunk sizes');

// ── holdback releases non-marker brackets promptly ──
ok(stream('a [Source](u) b', [3]) === 'a [Source](u) b', '"[Source" is not held hostage');
ok(stream('trailing bracket [', [5]) === 'trailing bracket [', 'lone trailing "[" is flushed, not dropped');
ok(stream('cut off [cite: 1.2', [4]) === 'cut off ', 'unterminated marker at end of stream is dropped');
ok(stream('[[PDF:T]]x[[/PDF]]', [2]) === '[[PDF:T]]x[[/PDF]]', 'PDF tokens survive streaming');

console.log(fails === 0 ? '\nALL PASSED' : '\n' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);
