/** Verify the partnership-deed Word (.doc) HTML builder: markdown→HTML
 *  body, escaping, and the execution footer for both deed and rent
 *  variants. Pure (no DOM). Run: npx tsx scripts/smoke-deed-word.mts
 */
import { buildPartnershipDeedDocHtml } from '../src/components/partnership-deeds/lib/wordExport.ts';
import type { PartnershipDeedDraft } from '../src/components/partnership-deeds/lib/uiModel.ts';

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`); };

const MD = `# PARTNERSHIP DEED

## 1. Name & Constitution

This deed is made between the partners **whose names** appear below. Tax rate is 30% & profit is shared as *agreed*.

- Capital is contributed in cash.
- Profit shared per Clause 4.

---

## 2. Capital

1. Partner #1 contributes Rs. 5,00,000.
2. Partner #2 contributes Rs. 5,00,000.`;

console.log('Partnership deed:');
{
  const draft = {
    templateId: 'partnership_deed',
    firm: { principalPlace: 'Ludhiana, Punjab', state: 'Punjab' },
    partners: [{ name: 'Ramesh Kumar' }, { name: 'Suresh Singh' }],
  } as unknown as PartnershipDeedDraft;
  const html = buildPartnershipDeedDocHtml(draft, MD);
  check('is a Word-flavoured HTML doc', html.includes('xmlns:w="urn:schemas-microsoft-com:office:word"') && html.includes('application/msword') === false /* mime is on the blob, not html */ && html.startsWith('<!DOCTYPE html>'));
  check('has the deed title <h1>', /<h1>Partnership Deed<\/h1>/.test(html));
  check('stamp note present', html.includes('appropriate stamp paper') && html.includes('Punjab'));
  check('markdown ## → <h3> heading', html.includes('<h3>1. Name &amp; Constitution</h3>'));
  check('**bold** → <b>', html.includes('<b>whose names</b>'));
  check('*italic* → <i>', html.includes('<i>agreed</i>'));
  check('--- → <hr/>', html.includes('<hr/>'));
  check('bullet list rendered', html.includes('<ul>') && html.includes('<li>Capital is contributed in cash.</li>'));
  check('numbered list rendered', html.includes('<ol>') && html.includes('<li>Partner #1 contributes Rs. 5,00,000.</li>'));
  check('ampersand escaped (no raw &)', html.includes('30% &amp; profit'));
  check('partner signature blocks', html.includes('SIGNATURES OF THE PARTNERS') && html.includes('1. Ramesh Kumar') && html.includes('2. Suresh Singh'));
  check('witnesses + notary + §58 registration', html.includes('WITNESSES') && html.includes('NOTARY ATTESTATION') && html.includes('Section 58, Indian Partnership Act, 1932'));
  check('executed-at place from firm', html.includes('Ludhiana, Punjab'));
  check('every <ul>/<ol> closed', (html.match(/<ul>/g) || []).length === (html.match(/<\/ul>/g) || []).length && (html.match(/<ol>/g) || []).length === (html.match(/<\/ol>/g) || []).length);
}

console.log('\nRent agreement (lessor/lessee footer, no notary):');
{
  const draft = {
    templateId: 'rent_agreement',
    rentAgreement: { landlordName: 'Anita Verma', tenantName: 'XYZ Pvt Ltd', state: 'Delhi' },
  } as unknown as PartnershipDeedDraft;
  const html = buildPartnershipDeedDocHtml(draft, '# RENT AGREEMENT\n\nThis agreement...');
  check('title is Rent Agreement', /<h1>Rent Agreement<\/h1>/.test(html));
  check('landlord + tenant signature blocks', html.includes('LANDLORD / LESSOR') && html.includes('Anita Verma') && html.includes('TENANT / LESSEE') && html.includes('XYZ Pvt Ltd'));
  check('registration block (Registration Act 1908)', html.includes('Registration Act, 1908'));
  check('no partner/notary block on a rent agreement', !html.includes('SIGNATURES OF THE PARTNERS') && !html.includes('NOTARY ATTESTATION'));
}

console.log('\nEdge cases:');
{
  const draft = { templateId: 'partnership_deed', partners: [] } as unknown as PartnershipDeedDraft;
  const html = buildPartnershipDeedDocHtml(draft, '');
  check('empty body + no partners → still valid doc', html.startsWith('<!DOCTYPE html>') && html.includes('(no partners listed)'));
  // HTML injection in a partner name is escaped.
  const inj = { templateId: 'partnership_deed', partners: [{ name: '<script>x</script>' }] } as unknown as PartnershipDeedDraft;
  const h2 = buildPartnershipDeedDocHtml(inj, 'body');
  check('partner name HTML-escaped (no raw <script>)', !h2.includes('<script>') && h2.includes('&lt;script&gt;'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
