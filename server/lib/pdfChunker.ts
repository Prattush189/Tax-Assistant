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
 * Threshold and chunk size are tuned for what Gemini 2.5 Flash-Lite
 * RELIABLY parses without truncation, not just what fits under the
 * raw 64K output cap. 2.5 emits malformed JSON well before it hits
 * MAX_TOKENS — production log on 2026-06-04 showed "Failed to parse
 * AI response" on a 21-page ICICI dump that should have fit (~400
 * rows × 50 tokens ≈ 20K output tokens). The model's structured-
 * output reliability degrades long before the hard token limit.
 *
 * Tightening to 10-page chunks (~250 rows ≈ 12K output tokens)
 * keeps 2.5 well inside its reliable parsing window. Cost impact is
 * minimal — each chunk pays the prompt-cache hit on the static
 * STATIC_PREFIX, and 2.5 at $0.10/$0.40 per 1M is 3.75× cheaper than
 * 3.1 fallback. Proactively splitting means every chunk attempts 2.5
 * first; only the rare hard chunk pays the 3.1 premium.
 *
 * Threshold of 12 pages means single-call still wins on small
 * statements (5-10 pages — typical SB/CA) where there's no parse risk.
 */
export const PDF_VISION_CHUNK_PAGES = 10;
export const PDF_VISION_CHUNK_THRESHOLD = 12;

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
