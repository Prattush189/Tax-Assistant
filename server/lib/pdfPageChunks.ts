// server/lib/pdfPageChunks.ts
//
// Split a multi-page PDF buffer into smaller per-batch buffers so
// dense statements can be sent to Gemini vision in chunks small
// enough that the model doesn't drop rows on long pages.
//
// Why this exists: a single vision call on a 17-page dense bank
// statement loses ~13/149 rows in production — the model runs out of
// attention on the long tail and silently emits a truncated
// transactions array. The arithmetic-against-balance reconciliation
// catches that we lost VOLUME but can't recover the missing rows.
// Chunking forces the model to be exhaustive on each small batch,
// and lets us validate per-batch balance integrity before merging.
//
// Uses pdf-lib (already a dep — no new install). pdf-lib doesn't
// render to images; it just rewrites a subset of pages into a new
// PDF, which is exactly what we want — Gemini vision handles each
// subset PDF natively.

import { PDFDocument } from 'pdf-lib';

export interface PdfPageBatch {
  /** New PDF buffer containing only this batch's pages. */
  buffer: Buffer;
  /** 0-indexed page range in the original PDF, [startPage, endPage). */
  startPage: number;
  endPage: number;
  /** 1-indexed page range for human-readable logging ("pages 1-3"). */
  label: string;
}

export interface ChunkOptions {
  /** Max pages per batch. Default 3 — small enough that a dense
   *  statement page (~30 transactions) fits comfortably under
   *  Gemini's effective output ceiling, large enough to give the
   *  model multi-row context for sign / counterparty rules. */
  pagesPerBatch?: number;
  /** Skip splitting if the PDF has at most this many pages — a
   *  3-page statement doesn't benefit from chunking, just extra
   *  overhead. Default 4. */
  splitThreshold?: number;
}

/**
 * Split a PDF buffer into per-batch buffers. Returns a SINGLE-element
 * array containing the original buffer when the PDF is small enough
 * that chunking would just add overhead.
 */
export async function splitPdfIntoBatches(
  buffer: Buffer,
  opts: ChunkOptions = {},
): Promise<PdfPageBatch[]> {
  const pagesPerBatch = opts.pagesPerBatch ?? 3;
  const splitThreshold = opts.splitThreshold ?? 4;

  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const totalPages = src.getPageCount();

  if (totalPages <= splitThreshold) {
    return [{
      buffer,
      startPage: 0,
      endPage: totalPages,
      label: `pages 1-${totalPages}`,
    }];
  }

  const batches: PdfPageBatch[] = [];
  for (let start = 0; start < totalPages; start += pagesPerBatch) {
    const end = Math.min(start + pagesPerBatch, totalPages);
    const subset = await PDFDocument.create();
    const indices: number[] = [];
    for (let p = start; p < end; p++) indices.push(p);
    const copied = await subset.copyPages(src, indices);
    copied.forEach(p => subset.addPage(p));
    const bytes = await subset.save();
    batches.push({
      buffer: Buffer.from(bytes),
      startPage: start,
      endPage: end,
      label: `pages ${start + 1}-${end}`,
    });
  }
  return batches;
}

/**
 * Run an async task on each batch with bounded concurrency. Vision
 * calls are I/O bound but each one consumes Gemini per-key rate
 * limits, so unbounded parallelism on a 6-batch statement was
 * tripping 429s and burning fallback retries. 2 in flight is the
 * sweet spot — fast enough that a 17-page statement finishes in
 * ~half the wall time of sequential, slow enough that we don't see
 * compounding 429s.
 */
export async function runBatchesWithConcurrency<T, R>(
  batches: T[],
  concurrency: number,
  task: (batch: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(batches.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= batches.length) return;
      results[i] = await task(batches[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}
