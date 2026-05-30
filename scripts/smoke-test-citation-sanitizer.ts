/**
 * Smoke test the loosened entry-marker regex in noticeCitationSanitizer.
 * The canonical failure (notice reply 2026-05): the model emitted
 * `(i)` and `(ii)` PLAIN (no bold) and citation (ii) had no URL but
 * stayed in the final PDF because the original strict-bold splitter
 * saw zero entries and skipped the per-entry URL check.
 *
 * Verifies:
 *   1. Plain `(i)` / `(ii)` markers are now recognised and split into
 *      entries.
 *   2. An entry without a trusted URL gets dropped.
 *   3. The remaining entry is renumbered to canonical `**(i)**`.
 *   4. Bold-marker drafts still work (no regression).
 *   5. False-positive guard: an inline `(i)` mid-paragraph (e.g. inside
 *      "see Section 4(i) of the Act") does NOT register as an entry.
 */
import { sanitizeNoticeCitations } from '../server/lib/noticeCitationSanitizer.js';

let passed = 0;
let failed = 0;
const expect = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected
    || (typeof actual === 'string' && typeof expected === 'string' && actual === expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}\n      actual:   ${JSON.stringify(actual)}\n      expected: ${JSON.stringify(expected)}`);
  }
};

// ── Test 1: plain (i) / (ii) — the user's failure mode ─────────
console.log('\nTest 1: plain (i)/(ii) markers (the real ASSA failure)');
const plainMarkers = `## 1. SUBJECT
Reply re some matter.

## 4. SUPPORTING CASE LAWS / LEGAL PRECEDENTS

(i) Mistake Apparent from Record: The Hon'ble Supreme Court in T.S. Balaram, Income Tax Officer vs. Volkart Brothers, 82 ITR 50 (SC), held that a mistake is apparent from the record if obvious. ([Source](https://indiankanoon.org/doc/12345/))

(ii) Mahalaxmi Infrastructure: The Hon'ble Bombay High Court in Mahalaxmi Infrastructure Pvt. Ltd. vs. Commissioner of Income Tax, 447 ITR 1 (Bombay), held that legitimate options should be honoured. (No URL provided here.)

## 5. RELIEF SOUGHT
Stuff.
`;
const result1 = sanitizeNoticeCitations(plainMarkers);
expect('total entries detected', result1.report.totalEntries, 2);
expect('kept entries', result1.report.keptEntries, 1);
expect('dropped entries', result1.report.droppedEntries, 1);
expect('Volkart kept', /Volkart\s+Brothers/.test(result1.text), true);
expect('Mahalaxmi dropped', /Mahalaxmi\s+Infrastructure/.test(result1.text), false);
expect('renumbered to canonical bold (i)', /\*\*\(i\)\*\*\s*Mistake/.test(result1.text), true);

// ── Test 2: bold (**(i)**) markers still work (no regression) ──
console.log('\nTest 2: bold **(i)** / **(ii)** markers (existing behaviour)');
const boldMarkers = `## 4. SUPPORTING CASE LAWS / LEGAL PRECEDENTS

**(i)** Volkart: ([Source](https://indiankanoon.org/doc/1/))

**(ii)** Fake case with no URL.

## 5. RELIEF
Done.
`;
const result2 = sanitizeNoticeCitations(boldMarkers);
expect('bold: total entries detected', result2.report.totalEntries, 2);
expect('bold: kept entries', result2.report.keptEntries, 1);
expect('bold: dropped entries', result2.report.droppedEntries, 1);

// ── Test 3: inline (i) must NOT register as an entry ───────────
// Real risk: prose like "see Section 4(i) of the Act" should not
// trigger entry splitting. The line-anchor + lookahead in the regex
// rules this out.
console.log('\nTest 3: inline (i) inside prose (false-positive guard)');
const inlineRoman = `## 4. SUPPORTING CASE LAWS / LEGAL PRECEDENTS

**(i)** Volkart: see [Source](https://indiankanoon.org/doc/1/) and refer to Section 4(i) of the Act for context.

## 5. RELIEF
Done.
`;
const result3 = sanitizeNoticeCitations(inlineRoman);
// The "4(i)" inline reference should NOT be parsed as a second entry.
// Only the leading **(i)** marker counts. So we expect totalEntries=1.
expect('inline (i) ignored — only 1 entry detected', result3.report.totalEntries, 1);
expect('inline (i) — entry kept (has URL)', result3.report.keptEntries, 1);

// ── Test 4: all entries without URL → whole section stripped ──
// Uses sequential 1..5 numbering (matches the prompt's spec) so the
// renumber after strip produces 1, 2, 3, 4 (the 5 → 4 shift described
// in the sanitizer's main comment). Bad numbering (3, 4, 5) would
// renumber to 1, 2 — correct behaviour but confusing as a test.
console.log('\nTest 4: all entries unverified → strip whole section');
const allBogus = `## 1. SUBJECT
Subject text.

## 2. FACTS
Facts text.

## 3. SUBMISSIONS
Subs text.

## 4. SUPPORTING CASE LAWS / LEGAL PRECEDENTS

(i) Fabricated case 1.

(ii) Fabricated case 2.

## 5. RELIEF
Done.
`;
const result4 = sanitizeNoticeCitations(allBogus);
expect('all-bogus: dropped', result4.report.droppedEntries, 2);
expect('all-bogus: kept', result4.report.keptEntries, 0);
expect('all-bogus: section stripped', /SUPPORTING\s+CASE\s+LAWS/.test(result4.text), false);
expect('all-bogus: section 5 renumbered to 4', /## 4\. RELIEF/.test(result4.text), true);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
