// Recruitment / exam notices are dropped from the tax-notifications feed;
// real tax notices (including ones that mention registration, verification
// or approval) are kept. Headings are from the 13 Nov 2026 refresh.
// Run: npx tsx scripts/smoke-notification-filter.mts
const { isNonTaxAdminNotice } = await import('../server/lib/notificationFetcher.js');

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };

const drop = [
  'Draft Recruitment (Amendment) Rules of ITI, 2026',
  'Candidates selected in CBDT through Stenographer Grade C & D, Examination, 2025 – Click here',
  'Submission of Region preferences by the candidates selected for appointment in CBDT to the post of Tax Assistant',
  'Response Sheet/Answers keys for Departmental Examination - 2026 for Income Tax Inspectors',
  'Cancellation of Skill Test held on 29.08.2026 & 30.08.2026 and Re-scheduling of Fresh Skill Test',
  'List of short-listed candidates of Young Professional Scheme, 2023',
  'Filling up of vacancies of Inspector of Income Tax on deputation basis',
];
const keep = [
  'CBDT has notified that no tax shall be deducted on dividend income paid by an International Financial Services Centre unit',
  'Exemption of TDS from any income in nature of dividend paid by unit of IFSC to a company',
  'Verification of claim of Deduction/Exemptions under various sections by CPC with respect to ITRs filed for AY 2026-27',
  'Registration as Valuer under section 514 of the Income-tax Act, 2025, read with Rule 24',
  'List of cases approved u/s 35(1)(ii)/(iii) of the Income Tax Act, 1961 for the period from 01.04.2026',
  'CBDT has notified the Income-tax (Eighth Amendment) Rules, 2026, vide Notification No. 140/2026',
  'Notification of Rule 281A and Form No. 173A in respect of exemptions provided under Sl. No. 26',
  'Press Release Regarding Recommendations of the 57th Meeting of the GST Council',
  'FAQs on recommendations of GST Council made in its 57th meeting on 08.10.2026.',
  'Notification u/s 45(3)(a)(i) r.w.s 45(4)(b) of the Income Tax Act, 2025 in the case of a Regulatory Commission',
  'As per Circular No.07/2026 dated 28th September,2026, the due dates for ITR and Audit Reports are extended',
  'Amendment of the Income tax Form No. 161 in consequence to Finance Act, 2026',
  'Corrigendum in the case of Andhra Pradesh Electricity Regulatory Commission Hyderabad',
];
for (const h of drop) ok(isNonTaxAdminNotice(h), `drop: ${h.slice(0, 70)}`);
for (const h of keep) ok(!isNonTaxAdminNotice(h), `keep: ${h.slice(0, 70)}`);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
