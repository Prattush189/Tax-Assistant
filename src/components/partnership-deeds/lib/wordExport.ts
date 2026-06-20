/**
 * Word (.doc) export for partnership deeds / LLP agreements / rent
 * agreements — the same content the PDF export produces, as an editable
 * document the user can tweak before printing on stamp paper.
 *
 * Approach: emit a Word-compatible HTML document and download it with a
 * .doc extension + application/msword MIME. Word (and Google Docs /
 * LibreOffice) open HTML-flavoured .doc natively, so this needs no extra
 * dependency — the deed body is mostly headings + paragraphs + clause
 * lists, which HTML expresses cleanly.
 *
 * The AI-generated body is Markdown; a small converter turns the subset
 * our prompt emits (#/##/### headings, **bold**, *italic*, --- rules,
 * bullet / numbered lists, paragraphs) into HTML. The execution block
 * (witness / signature / notary / registration) mirrors the PDF footer
 * in pdfExport.ts so both formats carry the same legal scaffolding.
 */
import { PartnershipDeedDraft, TEMPLATE_TITLES } from './uiModel';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Inline markdown → HTML. Bold first (consumes the `**` pairs), then
 *  whatever single `*` / `_` remains is italic. */
function inline(s: string): string {
  let t = escapeHtml(s);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/__([^_]+)__/g, '<b>$1</b>');
  t = t.replace(/\*([^*\n]+)\*/g, '<i>$1</i>');
  return t;
}

function mdToHtml(md: string): string {
  const lines = (md ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      closeList();
      const lvl = Math.min(m[1].length + 1, 4); // map md # → h2.. so the doc <h1> title stays unique
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { closeList(); out.push('<hr/>'); continue; }
    if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

function istDate(): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'long', year: 'numeric',
  }).format(new Date());
}

function sigBlock(role: string, name?: string): string {
  return `<p class="sig-role">${escapeHtml(role)}</p>
<p>${escapeHtml(name?.trim() || '____________________')}</p>
<div class="sig-line"></div>
<p class="muted">Signature &nbsp;&nbsp;&nbsp; Date: ____________ &nbsp;&nbsp;&nbsp; Place: ____________</p>`;
}

const WITNESS_HTML = `<p class="sec">WITNESSES</p>
<p>1.&nbsp; ______________________________&nbsp;&nbsp;&nbsp; Address: ______________________</p>
<p>2.&nbsp; ______________________________&nbsp;&nbsp;&nbsp; Address: ______________________</p>`;

function footerHtml(draft: PartnershipDeedDraft): string {
  const isRent = draft.templateId === 'rent_agreement';
  const place = isRent ? (draft.rentAgreement?.state ?? '_______________') : (draft.firm?.principalPlace ?? '_______________');
  const parts: string[] = [];
  parts.push('<hr/>');
  parts.push('<p class="sec">IN WITNESS WHEREOF</p>');
  parts.push(`<p>executed on this ${escapeHtml(istDate())} at ${escapeHtml(place)}.</p>`);

  if (isRent) {
    parts.push(sigBlock('LANDLORD / LESSOR', draft.rentAgreement?.landlordName));
    parts.push(sigBlock('TENANT / LESSEE', draft.rentAgreement?.tenantName));
    parts.push(WITNESS_HTML);
    parts.push('<p class="sec">REGISTRATION (Registration Act, 1908)</p>');
    parts.push('<p class="muted">A lease for a term of 12 months or more requires compulsory registration at the office of the Sub-Registrar.</p>');
    parts.push('<p class="muted">Document No.: ______________ &nbsp; Sub-Registrar: ______________ &nbsp; Date: __________</p>');
  } else {
    const partners = draft.partners ?? [];
    parts.push('<p class="sec">SIGNATURES OF THE PARTNERS</p>');
    if (partners.length === 0) {
      parts.push('<p class="muted">(no partners listed)</p>');
    } else {
      partners.forEach((p, i) => parts.push(sigBlock(`${i + 1}. ${p.name?.trim() || `Partner #${i + 1}`}`, '')));
    }
    parts.push(WITNESS_HTML);
    parts.push('<p class="sec">NOTARY ATTESTATION</p>');
    parts.push('<p class="muted">Attested before me on this _____ day of __________, ________. The contents of this deed have been read over to and explained to the executants who have admitted the same to be true and have signed in my presence.</p>');
    parts.push('<p class="muted">Notary Public Seal &amp; Signature: ______________________________</p>');
    parts.push('<p class="muted">Registration No.: ____________ &nbsp; Place: ____________</p>');
    parts.push('<p class="sec">REGISTRATION (Section 58, Indian Partnership Act, 1932)</p>');
    parts.push('<p class="muted">Registration No.: ______________ &nbsp; Registrar of Firms: ______________ &nbsp; Date: __________</p>');
  }
  return parts.join('\n');
}

function buildDocHtml(draft: PartnershipDeedDraft, markdownBody: string): string {
  const title = TEMPLATE_TITLES[draft.templateId];
  const state = draft.templateId === 'rent_agreement' ? draft.rentAgreement?.state : draft.firm?.state;
  const stampNote = `To be executed on appropriate stamp paper as per the prevailing State Stamp Act${state ? ` (${escapeHtml(state)})` : ''}.`;
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
@page { size: A4; margin: 2cm; }
body { font-family: "Times New Roman", serif; font-size: 11pt; color: #1a1a1a; line-height: 1.5; }
h1 { font-size: 16pt; text-align: center; color: #1e3a8a; margin: 0 0 6pt; }
h2 { font-size: 13pt; color: #1e3a8a; margin: 12pt 0 4pt; }
h3, h4 { font-size: 11.5pt; color: #1e3a8a; margin: 10pt 0 3pt; }
p { margin: 4pt 0; text-align: justify; }
ul, ol { margin: 4pt 0 4pt 18pt; }
hr { border: none; border-top: 1px solid #ccc; margin: 14pt 0; }
.stamp { text-align: center; border: 1px solid #999; padding: 8px; margin-bottom: 14pt; font-size: 9.5pt; color: #444; }
.sec { font-weight: bold; color: #1e3a8a; margin-top: 12pt; }
.sig-role { font-weight: bold; color: #1e3a8a; margin-top: 12pt; margin-bottom: 0; }
.sig-line { border-bottom: 1px solid #555; width: 55%; margin: 14pt 0 2pt; }
.muted { color: #555; font-size: 9pt; }
</style>
</head>
<body>
<div class="stamp">${stampNote}</div>
<h1>${escapeHtml(title)}</h1>
${mdToHtml(markdownBody)}
${footerHtml(draft)}
</body>
</html>`;
}

/** Build the .doc HTML (no download) — separated so it's unit-testable. */
export function buildPartnershipDeedDocHtml(draft: PartnershipDeedDraft, markdownBody: string): string {
  return buildDocHtml(draft, markdownBody);
}

export function downloadPartnershipDeedWord(draft: PartnershipDeedDraft, markdownBody: string): void {
  const html = buildDocHtml(draft, markdownBody);
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = (TEMPLATE_TITLES[draft.templateId] || 'deed').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'deed';
  a.download = `${safe}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
