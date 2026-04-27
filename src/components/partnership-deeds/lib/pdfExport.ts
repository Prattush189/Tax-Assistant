/**
 * Partnership-deed PDF export.
 *
 * Wraps the AI-generated Markdown body with a stamp-paper banner at the
 * top and a notary / witness / Section 58 registration block at the
 * bottom. Reuses the shared Markdown→jsPDF renderer at src/lib/markdownPdf.
 */
import { jsPDF } from 'jspdf';
import { renderMarkdownToPdf } from '../../../lib/markdownPdf';
import type { PartnershipDeedDraft } from './uiModel';
import { TEMPLATE_TITLES } from './uiModel';

const MARGIN = 18;
const PAGE_W = 210;
const PAGE_H = 297;
const LINE = 5.5;

function formatIstDate(): string {
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_H - MARGIN) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

/** Top stamp-paper banner. Returns the new Y position after rendering.
 *
 * Layout (top → bottom):
 *   1. Compact banner box stating the stamp-act requirement.
 *   2. A blank "Affix stamp paper here" area large enough to physically
 *      paste a state stamp paper onto the printout.
 *   3. The deed title, with breathing room above and below.
 *   4. A divider line, with extra space before the markdown body starts. */
function paintStampBanner(doc: jsPDF, state: string | undefined, templateLabel: string): number {
  const stateLabel = state ?? '_____';
  const bannerText = `[ STAMP PAPER OF Rs. _____ AS PER ${stateLabel.toUpperCase()} STAMP ACT ]`;
  const titleText = templateLabel.toUpperCase();

  let y = MARGIN;

  // 1. Compact banner box with the stamp-act notice.
  const bannerH = 18;
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.4);
  doc.rect(MARGIN, y, PAGE_W - MARGIN * 2, bannerH);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  doc.text(bannerText, PAGE_W / 2, y + 7, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('To be executed on appropriate stamp paper as per the prevailing State Stamp Act', PAGE_W / 2, y + 13, {
    align: 'center',
  });

  y += bannerH + 8;

  // 2. Stamp affix area — a clearly-bordered blank space for the user to
  //    physically paste their state stamp paper onto the printed deed.
  //    Sized to comfortably hold a standard non-judicial stamp paper.
  const stampW = 90;
  const stampH = 50;
  const stampX = (PAGE_W - stampW) / 2;
  doc.setDrawColor(140, 140, 140);
  doc.setLineWidth(0.3);
  // Dashed border so it visually reads as a placeholder area, not part of
  // the deed body. Fall back to a solid border if the jsPDF build doesn't
  // expose setLineDashPattern (older 4.x bundles).
  type DashableDoc = jsPDF & { setLineDashPattern?: (pattern: number[], phase: number) => jsPDF };
  const dashable = doc as DashableDoc;
  if (typeof dashable.setLineDashPattern === 'function') {
    dashable.setLineDashPattern([2, 2], 0);
  }
  doc.rect(stampX, y, stampW, stampH);
  if (typeof dashable.setLineDashPattern === 'function') {
    dashable.setLineDashPattern([], 0);
  }
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(130, 130, 130);
  doc.text('Affix stamp paper here', PAGE_W / 2, y + stampH / 2 + 1, { align: 'center' });

  y += stampH + 14;

  // 3. Document title with generous spacing on both sides.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(30, 58, 138);
  doc.text(titleText, PAGE_W / 2, y, { align: 'center' });
  y += 11;

  // 4. Divider line + extra padding before the body.
  doc.setDrawColor(30, 58, 138);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);

  return y + 12;
}

/** Bottom block: witnesses, partner signature lines, notary, §58 registration placeholder. */
function paintFooter(doc: jsPDF, draft: PartnershipDeedDraft, startY: number): number {
  let y = startY;

  // Page break to keep the footer block together if it doesn't fit cleanly.
  const partners = draft.partners ?? [];
  // Need: heading (4) + partner block (16 per partner) + witness block (~30) + notary (~20) + §58 (~10).
  const estimated = 14 + partners.length * 16 + 30 + 20 + 10;
  if (y + estimated > PAGE_H - MARGIN) {
    doc.addPage();
    y = MARGIN;
  }

  // Section heading
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(30, 58, 138);
  doc.text('IN WITNESS WHEREOF', MARGIN, y);
  y += 5;
  doc.setFont('times', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  doc.text(
    `executed on this ${formatIstDate()} at ${draft.firm?.principalPlace ?? '_______________'}`,
    MARGIN,
    y,
  );
  y += 7;

  // Partner signature lines — one per partner
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 58, 138);
  doc.text('SIGNATURES OF THE PARTNERS', MARGIN, y);
  y += 5;

  partners.forEach((p, idx) => {
    y = ensureSpace(doc, y, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    const name = p.name?.trim() || `Partner #${idx + 1}`;
    doc.text(`${idx + 1}. ${name}`, MARGIN, y);
    y += LINE;
    doc.setDrawColor(120, 120, 120);
    doc.setLineWidth(0.3);
    doc.line(MARGIN + 3, y, MARGIN + 70, y);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text('Signature', MARGIN + 3, y + 3);
    doc.text('Date: ____________', MARGIN + 80, y + 3);
    doc.text('Place: ____________', MARGIN + 130, y + 3);
    y += 8;
  });

  if (partners.length === 0) {
    y = ensureSpace(doc, y, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    doc.text('(no partners listed)', MARGIN, y);
    y += 8;
  }

  y += 4;

  // Witness block (2 witnesses)
  y = ensureSpace(doc, y, 26);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 58, 138);
  doc.text('WITNESSES', MARGIN, y);
  y += 5;
  for (let i = 1; i <= 2; i++) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text(`${i}.`, MARGIN, y);
    doc.setDrawColor(120, 120, 120);
    doc.setLineWidth(0.3);
    doc.line(MARGIN + 6, y, MARGIN + 80, y);
    doc.line(MARGIN + 90, y, PAGE_W - MARGIN, y);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text('Name & Signature', MARGIN + 6, y + 3);
    doc.text('Address', MARGIN + 90, y + 3);
    y += 8;
  }

  y += 4;

  // Notary block
  y = ensureSpace(doc, y, 22);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 58, 138);
  doc.text('NOTARY ATTESTATION', MARGIN, y);
  y += 5;
  doc.setFont('times', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  const notaryLines = [
    'Attested before me on this _____ day of __________, ________.',
    'The contents of this deed have been read over to and explained to the executants',
    'who have admitted the same to be true and have signed in my presence.',
    '',
    'Notary Public Seal & Signature: ______________________________',
    'Registration No.: ____________   Place: ____________',
  ];
  for (const line of notaryLines) {
    if (line.length > 0) {
      doc.text(line, MARGIN, y);
    }
    y += 4.5;
  }

  y += 4;

  // §58 registration placeholder
  y = ensureSpace(doc, y, 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(30, 58, 138);
  doc.text('REGISTRATION (Section 58, Indian Partnership Act, 1932)', MARGIN, y);
  y += 4.5;
  doc.setFont('times', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(
    'Registration No.: ______________   Registrar of Firms: ______________   Date: __________',
    MARGIN,
    y,
  );
  y += 4.5;

  return y;
}

export async function renderPartnershipDeedPdf(
  draft: PartnershipDeedDraft,
  markdownBody: string,
): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // Stamp banner + title
  let y = paintStampBanner(doc, draft.firm?.state, TEMPLATE_TITLES[draft.templateId]);

  // Markdown body via the shared renderer
  await renderMarkdownToPdf(doc, markdownBody, {
    margin: MARGIN,
    pageWidthMm: PAGE_W,
    pageHeightMm: PAGE_H,
    startY: y,
    onPageBreak: async () => MARGIN,
  });

  // Footer block (witnesses, signatures, notary, §58)
  // Use the current cursor Y from the doc — jsPDF tracks it internally only
  // for some methods, so we rely on the renderer leaving a sensible state.
  // We compute conservatively: start a fresh page for the footer.
  doc.addPage();
  y = MARGIN;
  paintFooter(doc, draft, y);

  const filename = `partnership-deed-${draft.templateId}-${Date.now()}.pdf`;
  doc.save(filename);
}
