import { sanitizeNoticeCitations, stripUnverifiableUrls } from '../server/lib/noticeCitationSanitizer.js';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c?'PASS':'FAIL')+'  '+m); if(!c) fails++; };

// The exact line from the user's filed GST reply. gst.gov.in IS an
// allowlisted host, but this deep path 404s.
const real = 'Source: Section 61, Central Goods and Services Tax Act, 2017 (https://www.gst.gov.in/acts/central-goods-and-services-tax-act-2017)';
const r1 = stripUnverifiableUrls(real);
ok(r1.dropped === 1, 'fabricated deep path dropped (dropped=' + r1.dropped + ')');
ok(!r1.text.includes('http'), 'no URL survives: ' + JSON.stringify(r1.text));
ok(r1.text.includes('Section 61, Central Goods and Services Tax Act, 2017'), 'citation TEXT preserved');

// A known-live reference must survive untouched.
const good = 'See the CBDT page (https://www.incometaxindia.gov.in/what-s-new) for details.';
const r2 = stripUnverifiableUrls(good);
ok(r2.dropped === 0, 'allowlisted URL kept (dropped=' + r2.dropped + ')');
ok(r2.text === good, 'allowlisted text unchanged');

// Markdown-link form.
const md = 'Refer ' + String.fromCharCode(91) + 'CGST s.16' + String.fromCharCode(93) + '(https://www.gst.gov.in/made/up/path) today.';
const r3 = stripUnverifiableUrls(md);
ok(r3.dropped === 1, 'markdown link dropped');
ok(r3.text.includes('CGST s.16') && !r3.text.includes('http'), 'label kept, url gone: ' + JSON.stringify(r3.text));

// Case-law section must NOT be touched (search-grounded links).
const doc = [
  '## 3. LEGAL SUBMISSIONS',
  'Source: Section 61, CGST Act, 2017 (https://www.gst.gov.in/acts/fake-path)',
  '',
  '## 4. SUPPORTING CASE LAWS',
  '(i) Acme v. CIT (https://indiankanoon.org/doc/123456/) — principle.',
  '',
  '## 5. PRAYER',
  'Kindly drop the proceedings.',
].join(String.fromCharCode(10));
const r4 = sanitizeNoticeCitations(doc);
ok(r4.report.droppedUrls === 1, 'one statutory URL dropped (got ' + r4.report.droppedUrls + ')');
ok(r4.text.includes('indiankanoon.org/doc/123456'), 'case-law URL preserved');
ok(!r4.text.includes('fake-path'), 'fabricated statutory URL removed');
ok(r4.report.changed === true, 'report.changed set');

console.log(fails === 0 ? String.fromCharCode(10)+'ALL PASSED' : String.fromCharCode(10)+fails+' FAILED');
process.exit(fails === 0 ? 0 : 1);