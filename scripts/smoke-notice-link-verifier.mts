// Link verification for notice drafts: offline checks of the claim
// matching and the sanitizer's verified mode, then live checks against
// real pages (needs network). Run: npx tsx scripts/smoke-notice-link-verifier.mts
import { claimNear, pageMatches, verifyNoticeLinks, yearConflict } from '../server/lib/noticeLinkVerifier.js';
import { sanitizeNoticeCitations } from '../server/lib/noticeCitationSanitizer.js';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };

// ── Claims: the name before the link, not the principle around it ──
const c1 = claimNear('Adjustment without intimation is invalid: Rushi Sanskruti Vividoddeshagal Sahakara Sangha v. DCIT, CPC, (2023) (ITAT Bangalore) — [Source](https://indiankanoon.org/doc/128852480/)', 'https://indiankanoon.org/doc/128852480/');
ok(c1.kind === 'parties' && c1.words.includes('rushi') && !c1.words.includes('adjustment') && !c1.words.includes('intimation'),
  'parties come from the name only: ' + JSON.stringify(c1));
const c2 = claimNear('> Section 143(1)(a): "the total income shall be computed after making the following adjustments"\nSource: https://indiankanoon.org/doc/184741818/');
ok(c2.kind === 'numbers' && c2.numbers.includes('143'), 'section number claim: ' + JSON.stringify(c2));
ok(claimNear('See the portal (https://www.gst.gov.in/).').kind === 'none', 'no claim when nothing is cited');

ok(pageMatches(c1, 'M/S. Rushi Sanskruti Vividoddeshagal ... vs The Dcit, Cpc, Bangalore on 27 January, 2023'), 'right judgment title matches');
ok(!pageMatches(c1, 'Mustafa Khaleel, Bangalore vs The Assistant Director Of Income Tax on 7 June, 2022 — adjustment intimation'), 'other judgment on the same point does not');
ok(pageMatches(c2, 'Section 143(1) in The Income Tax Act, 1961'), 'section page matches its number');
ok(!pageMatches(c2, 'Section 1431 something'), 'number match is whole-number only');

// A report cannot predate the decision (from a real Haiku draft, 2026-11-05).
const HA = 'https://indiankanoon.org/doc/711565/';
const wrongYear = claimNear(`Harbanslal Aurora v. Joint CIT, [2000] 82 ITD 1 (Pune) — [Source](${HA})`, HA);
const rightYear = claimNear(`Harbanslal Aurora v. Joint CIT, [2002] 82 ITD 1 (Pune) — [Source](${HA})`, HA);
const title = 'Harbanslal Aurora vs Joint Cit on 31 January, 2002';
ok(yearConflict(wrongYear, title) === 'cited as 2000 but decided in 2002', 'year before the decision flagged');
ok(yearConflict(rightYear, title) === null, 'matching year passes');
ok(yearConflict(claimNear(`Foo Bar v. ITO, ITA No. 5541/Mum/2024 — [Source](${HA})`, HA), title) === null, 'no bracketed year, no check');

// ── Sanitizer, verified mode ──
const NL = String.fromCharCode(10);
const doc = [
  '## 3. LEGAL SUBMISSIONS',
  'The proviso requires prior intimation (see [Section 143](https://indiankanoon.org/doc/184741818/)).',
  '',
  '## 4. SUPPORTING CASE LAWS / LEGAL PRECEDENTS',
  '**(i)** Prior intimation: Real Party v. ITO — [Source](https://indiankanoon.org/doc/111/)',
  '',
  '**(ii)** Invented: Made Up Traders v. ACIT — [Source](https://indiankanoon.org/doc/999/)',
  '',
  '## 5. RELIEF SOUGHT',
  'Withdraw the demand.',
].join(NL);
const verified = new Set(['https://indiankanoon.org/doc/111', 'https://indiankanoon.org/doc/184741818']);
const s1 = sanitizeNoticeCitations(doc, u => verified.has(u.replace(/^<|>$/g, '').replace(/\/+$/, '').toLowerCase()));
ok(s1.text.includes('doc/111') && s1.text.includes('Real Party'), 'entry with a verified link kept');
ok(!s1.text.includes('Made Up Traders') && s1.report.droppedEntries === 1, 'entry with an unverified link dropped');
ok(s1.text.includes('doc/184741818'), 'verified statutory link kept');
const s2 = sanitizeNoticeCitations(doc, () => false);
ok(!s2.text.includes('SUPPORTING CASE LAWS') && !s2.text.includes('indiankanoon'), 'nothing verified: case-law section and links removed');
ok(s2.text.includes('see Section 143'), 'link text kept when its URL goes: ' + JSON.stringify(s2.text.split(NL)[1]));
const s3 = sanitizeNoticeCitations('Para (see [Act](<https://www.incometaxindia.gov.in/income-tax-act>)).', () => false);
ok(s3.text.includes('income-tax-act>'), 'angle-bracket link to the reference list kept');

// ── Live: real pages, invented ones, real page on the wrong case ──
console.log(NL + '-- live checks (network) --');
const live = [
  '**(i)** Bank of America N.T. and S.A. v. DCIT — [Source](https://indiankanoon.org/doc/184003/)',
  '',
  '**(ii)** Invented: Shree Ganesh Exports v. ITO — [Source](https://indiankanoon.org/doc/98765432109/)',
  '',
  '**(iii)** Wrong page: Vodafone International Holdings v. Union of India — [Source](https://indiankanoon.org/doc/184003/#)',
  '',
  'Old Act link: [Act](https://www.incometaxindia.gov.in/Pages/acts/income-tax-act.aspx)',
  '',
  'Blog: [post](https://example-tax-blog.com/143-1)',
  '',
  'Reference list: [Act](https://www.incometaxindia.gov.in/income-tax-act)',
  '',
  '**(iv)** Misquoted: Harbanslal Aurora v. Joint CIT, [2000] 82 ITD 1 (Pune) — [Source](https://indiankanoon.org/doc/711565/)',
].join(NL);
const v = await verifyNoticeLinks(live);
for (const c of v.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.how.padEnd(16)} ${c.url}${c.reason ? `  — ${c.reason}` : ''}`);
const byUrl = (u: string) => v.checks.find(c => c.url === u);
ok(byUrl('https://indiankanoon.org/doc/184003/')?.ok === true, 'real judgment, right parties: verified');
ok(byUrl('https://indiankanoon.org/doc/98765432109/')?.ok === false, 'invented document number: rejected');
ok(byUrl('https://indiankanoon.org/doc/184003/#')?.ok === false, 'real page cited for the wrong case: rejected');
ok(byUrl('https://www.incometaxindia.gov.in/Pages/acts/income-tax-act.aspx')?.ok === false, 'old Act link: rejected');
ok(byUrl('https://example-tax-blog.com/143-1')?.ok === false, 'non-authoritative site: rejected');
ok(byUrl('https://www.incometaxindia.gov.in/income-tax-act')?.ok === true, 'reference-list link: verified');
ok(byUrl('https://indiankanoon.org/doc/711565/')?.reason === 'cited as 2000 but decided in 2002', 'right case, impossible citation year: rejected');

// Search evidence stands in for a fetch the site blocks.
const vs = await verifyNoticeLinks(
  'Prior intimation: Aashirvad Villa Limited v. ITO — [Source](https://itat.gov.in/public/files/upload/1745909212-E6AHUV-1-TO.pdf)',
  [{ url: 'https://itat.gov.in/public/files/upload/1745909212-E6AHUV-1-TO.pdf', title: 'IN THE INCOME TAX APPELLATE TRIBUNAL', citedText: ['Aashirvad Villa Limited, Kolkata vs Income Tax Officer, Ward 1'] }],
);
ok(vs.checks[0]?.ok === true && vs.checks[0].how === 'search result', 'itat PDF verified by the passage the search cited');

console.log(fails ? `${NL}${fails} FAILED` : `${NL}ALL PASSED`);
process.exit(fails ? 1 : 0);
