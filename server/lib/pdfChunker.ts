/**
 * PDF page-chunker for vision extraction.
 *
 * Background: Gemini's per-call output cap is 64K tokens. A typical
 * Indian bank statement row in our slim schema emits ~50 tokens, so a
 * single call can return ~1,200 rows before MAX_TOKENS hits. The user's
 * 154-page ICICI dump tripped this — the model truncated mid-array or
 * threw MAX_TOKENS, and the fallback tier hit the same wall because the
 * cap is model-family-wide, not 2.5-specific.
 *
 * The right fix is to chunk the PDF by page range BEFORE we send it to
 * Gemini. Each chunk fits under the 64K cap; the caller merges the
 * per-chunk transaction arrays back together.
 *
 * We deliberately split by page count (cheap, deterministic, no AI),
 * not by row density (would require a first pass to read the PDF). The
 * threshold is conservative enough that even dense statements (~40
 * rows/page) stay under the cap.
 */

import { PDFDocument } from 'pdf-lib';

/**
 * 2026-06: rolled BACK aggressive chunking after empirical evidence
 * that smaller chunks made extraction WORSE on the user's 21-page
 * ICICI statement:
 *
 *   v3 (single-pass, 21 pages)  → 363 rows, closing matched PDF cover
 *   v5 (chunked at 10 pages)    → 268 rows, closing off by ₹10.81
 *
 * Each chunk reconciles within itself (balance continuity passes),
 * but the union is missing rows. The hypothesis: when the model only
 * sees a 7-10 page slice, it produces fewer rows per page than when
 * it sees the full statement (less context, harder to anchor row
 * detection against opening/closing balances printed on cover).
 *
 * New strategy (simplest possible):
 *   - Threshold 50 pages: anything ≤ 50 goes through single-pass.
 *     A typical 25-row-per-page dense statement → 1,250 rows → ~62K
 *     output tokens, right at the 64K cap. 50 is the largest pdf
 *     size that fits in one 3.1 Flash-Lite call without truncation.
 *   - Chunk size 30 pages: when we DO chunk (>50 page PDFs), each
 *     chunk has enough cross-row context that the under-extraction
 *     pattern doesn't trigger.
 *
 * This matches the v3 extraction shape that actually reconciled to
 * the bank's printed closing balance, and keeps the rare >50-page
 * case from blowing past the output cap.
 */
export const PDF_VISION_CHUNK_PAGES = 30;
export const PDF_VISION_CHUNK_THRESHOLD = 50;

/**
 * Count the number of pages in a PDF buffer. Wraps pdf-lib's load +
 * count so the caller can decide whether chunking is worthwhile
 * without pulling pdf-lib in itself.
 *
 * Returns null on a malformed / encrypted PDF — caller should fall
 * back to single-pass vision (which will surface a clearer error).
 */
export async function getPdfPageCount(buffer: Buffer): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch (err) {
    console.warn('[pdfChunker] page-count load failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Split a PDF into N-page chunks. Returns an array of `{ buffer,
 * startPage, endPage }` triples in page order. The page indices are
 * 1-based and inclusive on both ends so they read naturally in logs
 * ("pages 1-30", "pages 31-60", ...).
 */
export async function splitPdfByPages(
  buffer: Buffer,
  chunkSize = PDF_VISION_CHUNK_PAGES,
): Promise<Array<{ buffer: Buffer; startPage: number; endPage: number }>> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = src.getPageCount();
  const chunks: Array<{ buffer: Buffer; startPage: number; endPage: number }> = [];
  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(start + chunkSize, total);
    const chunk = await PDFDocument.create();
    // copyPages takes 0-based indices; build the range for this slice.
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const copied = await chunk.copyPages(src, indices);
    copied.forEach((p) => chunk.addPage(p));
    const bytes = await chunk.save();
    chunks.push({
      buffer: Buffer.from(bytes),
      startPage: start + 1,
      endPage: end,
    });
  }
  return chunks;
}
