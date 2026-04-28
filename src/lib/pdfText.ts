/**
 * Client-side PDF text extraction for the bank statement analyzer.
 *
 * Most Indian bank statements (HDFC, ICICI, SBI, Axis, Kotak, etc.) are
 * digitally generated — the text layer is already embedded in the PDF.
 * Extracting it in the browser takes <1 second and lets the server skip
 * the expensive Gemini vision pass (30-60 s → 10-15 s end-to-end).
 *
 * Scanned / image-only PDFs have no text layer; `extractPdfTextClient`
 * returns null for those and the caller falls back to sending the raw
 * file to the vision pipeline.
 */

import { pdfjs } from 'react-pdf';

if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
}

/** Minimum character count to consider the extraction "text-rich". Below
 *  this, the PDF is likely scanned and we should fall back to vision. */
const TEXT_RICH_THRESHOLD = 300;

/**
 * Lightweight page-count probe — opens the PDF metadata only, no
 * text extraction. Used by features that gate uploads on page count
 * (notice drafter at the moment) without paying the full text-pull
 * cost. Returns null if the file isn't a valid PDF.
 */
export async function countPdfPagesClient(file: File): Promise<number | null> {
  if (file.type !== 'application/pdf') return null;
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    return pdf.numPages;
  } catch (err) {
    console.warn('[pdfText] page count failed:', err);
    return null;
  }
}

/**
 * Extract concatenated text from every page of a PDF file. Returns null
 * if the PDF has less than ~300 characters of extractable text (almost
 * always means it's a scanned image) or if parsing fails outright.
 */
export async function extractPdfTextClient(file: File): Promise<string | null> {
  if (file.type !== 'application/pdf') return null;
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Each text item has a `str` property. Join with spaces; insert a page
      // break so the LLM can tell rows that wrap across pages apart.
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter(Boolean)
        .join(' ');
      pages.push(pageText);
    }
    const combined = pages.join('\n\n--- PAGE BREAK ---\n\n').trim();
    if (combined.length < TEXT_RICH_THRESHOLD) return null;
    return combined;
  } catch (err) {
    console.warn('[pdfText] extraction failed:', err);
    return null;
  }
}
