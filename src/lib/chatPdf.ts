/**
 * Client-side "PDF skill" for the chat assistant.
 *
 * When a user asks the assistant for a downloadable document, the model
 * wraps the content in `[[PDF:Title]] … [[/PDF]]` markers (see the chat
 * system instruction). MessageBubble detects that block and surfaces a
 * "Download PDF" button which calls this to render the markdown into a
 * branded A4 PDF via the shared renderMarkdownToPdf engine (the same one
 * the Notice/Deed exports use).
 */
import { renderMarkdownToPdf } from './markdownPdf';

/** Turn a document title into a safe `.pdf` filename. */
export function sanitizePdfFilename(title: string): string {
  const base = (title || 'document')
    .trim()
    .replace(/[^a-z0-9\-_ ]/gi, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${base || 'document'}.pdf`;
}

/**
 * Render a markdown document to a clean, UNBRANDED PDF and trigger a
 * download. Runs entirely in the browser (jsPDF is lazy-imported so it
 * stays out of the main bundle).
 */
export async function downloadChatPdf(markdown: string, title: string): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const margin = 18;
  const pageWidthMm = 210;
  const pageHeightMm = 297;
  const docTitle = (title || 'Document').trim();

  // jsPDF's standard fonts are WinAnsi — the ₹ glyph renders as garbage.
  // Swap it for "Rs." before layout. (Em dash / bullets are in WinAnsi.)
  const safeMarkdown = markdown.replace(/₹\s?/g, 'Rs. ');

  // Header — document title + rule (unbranded). Painted on page 1 and after
  // each page break; returns the Y at which body content should start.
  const paintHeader = (): number => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(30, 41, 59);
    const titleLines = doc.splitTextToSize(docTitle, pageWidthMm - margin * 2);
    let ty = margin + 2;
    for (const line of titleLines) {
      doc.text(line, margin, ty);
      ty += 6;
    }

    const ruleY = ty - 1;
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.3);
    doc.line(margin, ruleY, pageWidthMm - margin, ruleY);
    doc.setTextColor(20, 20, 20);
    return ruleY + 4;
  };

  const startY = paintHeader();
  await renderMarkdownToPdf(doc, safeMarkdown, {
    margin,
    pageWidthMm,
    pageHeightMm,
    startY,
    onPageBreak: async () => paintHeader(),
  });

  // Footer (disclaimer + page numbers) on every page, after layout knows
  // the final page count.
  const total = doc.getNumberOfPages();
  const stamp = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(140, 140, 140);
    doc.text(
      `Generated on ${stamp} - AI-generated, please verify with a qualified professional.`,
      margin,
      pageHeightMm - 8,
    );
    doc.text(`Page ${p} of ${total}`, pageWidthMm - margin, pageHeightMm - 8, { align: 'right' });
  }

  doc.save(sanitizePdfFilename(docTitle));
}
