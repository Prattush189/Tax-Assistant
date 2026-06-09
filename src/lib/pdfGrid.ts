/**
 * Client-side PDF → 2D grid extractor.
 *
 * Reads each page's text layer with pdfjs-dist (already a transitive
 * dep via react-pdf), keeps every text item's x/y coordinate, then
 * clusters items by y to form rows and by x to form columns. Output
 * is a deterministic grid the user can map to semantic roles
 * (Date / Narration / Debit / Credit / Balance / ...) via the wizard.
 *
 * Why coords vs the existing extractPdfTextClient: that function
 * concatenates every text item with a space, losing the column
 * structure. Once flattened, the AI has to re-infer credit-vs-debit
 * from narration semantics — which is where sign flips creep in.
 * Preserving the x-coordinate lets us push the credit/debit decision
 * out of the model entirely (the user maps it once, then signs are
 * derived deterministically).
 */

import { pdfjs } from 'react-pdf';

if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
}

export interface PdfGrid {
  /** Rows of cells, ordered top-to-bottom across all pages. */
  rows: string[][];
  /** Number of columns (every row is padded to this length with ''). */
  columnCount: number;
  /** Median x-position of each column — used by the wizard preview. */
  columnXs: number[];
  /** The header word that defined each column (e.g. "Withdrawal Amt.").
   *  null for columns built from the gap-clustering fallback (no header
   *  row found). Used by suggestMapping to auto-assign roles. */
  columnHeaders: (string | null)[];
  /** Indices in `rows` where a new page starts, for visual hints. */
  pageBreaks: number[];
  /** Total pages parsed. */
  pageCount: number;
}

interface RawItem {
  text: string;
  x: number;       // left edge in PDF user-space
  y: number;       // baseline (we negate so smaller = higher on the page)
  width: number;
}

const Y_TOLERANCE = 2.5;       // PDF user-space units. Items within this
                               // y-distance belong to the same row.
// Max GAP between consecutive sorted x-positions for two items to be
// in the same column. This is single-linkage clustering — a column can
// span any width as long as items within it are densely packed. Set
// to 12 units because:
//   - intra-column gaps are typically <1 unit (right-aligned numeric
//     columns have many rows piling at similar x-positions; left-aligned
//     text columns share an exact x for every row),
//   - inter-column gaps are typically 30-100 units,
//   - 12 sits comfortably in the middle.
// An earlier "max cluster width" formulation collapsed close-but-distinct
// columns (e.g. Canara's Withdrawal/Deposit pair) because right-aligned
// amounts in a single column can span 30+ units of leftmost-x due to
// varying digit widths.
const X_GAP_TOLERANCE = 12;

/**
 * Thrown when extractPdfGrid hits an encrypted PDF. The uploader
 * catches this, prompts the user for the password, and retries.
 *
 * `wrongPassword` is true when a password was supplied but pdfjs
 * rejected it (pdfjs's PasswordException code 2 = INCORRECT_PASSWORD);
 * the dialog uses this to show "wrong password, try again" rather
 * than treating it as a fresh request.
 */
export class PdfPasswordError extends Error {
  wrongPassword: boolean;
  constructor(wrongPassword: boolean) {
    super(wrongPassword ? 'Incorrect PDF password' : 'PDF is password-protected');
    this.name = 'PdfPasswordError';
    this.wrongPassword = wrongPassword;
  }
}

/**
 * Post-process a freshly-extracted grid: merge adjacent column pairs
 * where one is a header-only column ("Debit" / "Credit" / "Balance"
 * text, almost no data underneath because the data is right-aligned)
 * and the next is a data-only column (right-aligned numerics, empty
 * header). Busy ledgers split EVERY numeric column this way, which
 * left the wizard with 8 columns for a logical 5-column table —
 * three of them dead Skip / Ignore dropdowns the user couldn't get
 * rid of. After merge the user sees exactly the columns they need.
 *
 * Detection per adjacent pair (cL, cR):
 *   - cL has a non-empty header AND ≥85% of its cells are empty.
 *   - cR has an empty (or null) header AND ≥30% of its cells contain
 *     numeric-looking text.
 * On match: combine cR's data with cL's header. Drop cR. The shift
 * preserves the user's column-anchor positions for the wizard
 * preview (cL keeps its leftX, just gains the data).
 *
 * Idempotent: if a grid has no phantom pairs, it's returned
 * unchanged. Safe to call on every extraction.
 */
function mergeHeaderDataColumnPairs(grid: PdfGrid): PdfGrid {
  if (grid.columnCount < 2) return grid;
  const rowsToScan = Math.min(grid.rows.length, 200);
  if (rowsToScan === 0) return grid;
  const NUMERIC_RE = /\d/;
  const fillRate = (col: number, predicate: (s: string) => boolean): number => {
    let hits = 0;
    let scanned = 0;
    for (let r = 0; r < rowsToScan; r++) {
      const cell = (grid.rows[r][col] ?? '').trim();
      if (cell.length > 0) scanned += 1;
      if (cell.length > 0 && predicate(cell)) hits += 1;
    }
    return scanned > 0 ? hits / rowsToScan : 0;
  };
  const totalDataRate = (col: number): number => {
    let nonEmpty = 0;
    for (let r = 0; r < rowsToScan; r++) {
      if ((grid.rows[r][col] ?? '').trim().length > 0) nonEmpty += 1;
    }
    return nonEmpty / rowsToScan;
  };
  const dropCols = new Set<number>();
  for (let cL = 0; cL < grid.columnCount - 1; cL++) {
    if (dropCols.has(cL)) continue;
    let cR = cL + 1;
    while (cR < grid.columnCount && dropCols.has(cR)) cR += 1;
    if (cR >= grid.columnCount) break;
    const headerL = (grid.columnHeaders?.[cL] ?? '').trim();
    const headerR = (grid.columnHeaders?.[cR] ?? '').trim();
    const dataRateL = totalDataRate(cL);
    const dataRateR = fillRate(cR, s => NUMERIC_RE.test(s));
    // cL is header-only: has header text, almost no data underneath.
    // cR is data-only: empty header, ≥30% of cells are numeric.
    if (headerL && !headerR && dataRateL <= 0.15 && dataRateR >= 0.3) {
      // Merge: pull header from cL onto cR, drop cL.
      const newHeaders = [...(grid.columnHeaders ?? [])];
      newHeaders[cR] = headerL;
      grid = { ...grid, columnHeaders: newHeaders };
      dropCols.add(cL);
    }
  }
  // Second pass: drop "void" columns — no header AND truly empty
  // across EVERY row in the document. These are pure extractor
  // noise (column anchors detected at gap positions where right-
  // aligned numerics from neighbouring columns sometimes spilled).
  // Canara epassbook produces 2-3 of these between Deposits /
  // Withdrawals / Balance, showing up as Skip / Ignore dropdowns
  // in the wizard with nothing under them.
  //
  // SAFETY — only drop when the column is provably empty across the
  // ENTIRE document, not just the first N sampled rows. A sparse
  // real column (e.g. a sub-total appearing only on row 1500) would
  // trip a sampling threshold but is not actually safe to drop.
  // We scan all grid.rows and require zero non-empty cells before
  // tagging the column for removal.
  for (let c = 0; c < grid.columnCount; c++) {
    if (dropCols.has(c)) continue;
    const header = (grid.columnHeaders?.[c] ?? '').trim();
    if (header) continue; // surviving header → keep, even with empty data
    let nonEmptyCount = 0;
    for (let r = 0; r < grid.rows.length; r++) {
      if ((grid.rows[r][c] ?? '').trim().length > 0) {
        nonEmptyCount += 1;
        break; // any single non-empty cell disqualifies the drop
      }
    }
    if (nonEmptyCount === 0) {
      dropCols.add(c);
    }
  }

  if (dropCols.size === 0) return grid;
  // Re-build columnXs / columnHeaders / rows without the dropped
  // columns. Walking left-to-right preserves the surviving columns'
  // relative order, which is the only thing the wizard cares about.
  const survive: number[] = [];
  for (let c = 0; c < grid.columnCount; c++) {
    if (!dropCols.has(c)) survive.push(c);
  }
  const newRows = grid.rows.map(row => survive.map(c => row[c] ?? ''));
  const newHeaders = survive.map(c => grid.columnHeaders?.[c] ?? null);
  const newXs = survive.map(c => grid.columnXs[c]);
  console.log(`[pdfGrid] dropped ${dropCols.size} phantom column(s) (header-only + data-only merges, void columns) — ${grid.columnCount} → ${survive.length} columns`);
  return {
    ...grid,
    rows: newRows,
    columnCount: survive.length,
    columnXs: newXs,
    columnHeaders: newHeaders,
  };
}

/**
 * Extract a 2D grid from a digital PDF. Returns null when the PDF
 * has no extractable text layer (scanned image) — caller should
 * fall back to the vision pipeline in that case. Throws
 * PdfPasswordError when the PDF is encrypted; pass `password` on
 * the retry call to unlock it.
 */
export async function extractPdfGrid(file: File, password?: string): Promise<PdfGrid | null> {
  const looksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!looksLikePdf) return null;
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      ...(password ? { password } : {}),
    }).promise;

    // Phase 1 — pull every text item with its coords. Across all pages.
    // We carry a page-relative y plus a global page offset so a 50-page
    // ledger sorts as one continuous y-axis (pdfjs gives per-page coords).
    const allItems: RawItem[] = [];
    const pageBoundaries: number[] = [];
    let yOffset = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pageBoundaries.push(allItems.length);
      for (const item of content.items) {
        if (!('str' in item) || !item.str || !item.str.trim()) continue;
        // pdfjs transform: [a, b, c, d, e, f] — translate is e (x), f (y).
        // y is bottom-up in PDF space; flip so smaller = higher.
        const t = (item as { transform: number[] }).transform;
        const x = t[4];
        const yPage = viewport.height - t[5];
        allItems.push({
          text: item.str,
          x,
          y: yOffset + yPage,
          width: ('width' in item ? (item.width as number) : 0) ?? 0,
        });
      }
      yOffset += viewport.height + 20; // small page gap
    }

    if (allItems.length < 5) return null;

    // Phase 2 — cluster items by y to form rows. Items are roughly in
    // reading order from pdfjs but we don't rely on that — sort by y
    // ascending, then group into bands within Y_TOLERANCE.
    allItems.sort((a, b) => a.y - b.y);
    const rowBuckets: RawItem[][] = [];
    let currentRow: RawItem[] = [];
    let currentY = -Infinity;
    for (const it of allItems) {
      if (currentRow.length === 0 || Math.abs(it.y - currentY) <= Y_TOLERANCE) {
        currentRow.push(it);
        currentY = currentRow.length === 1 ? it.y : (currentY + it.y) / 2;
      } else {
        rowBuckets.push(currentRow);
        currentRow = [it];
        currentY = it.y;
      }
    }
    if (currentRow.length) rowBuckets.push(currentRow);

    // Phase 2.5 — truncate at the statement-summary footer block.
    // Banks (HDFC, ICICI, Axis) print a "STATEMENT SUMMARY" panel
    // below the transaction table that includes its own data row
    // with totals: opening balance / debit count / credit count /
    // total debits / total credits / closing balance. Without this
    // truncation, the summary's data row gets bucketed into the
    // transaction list as a phantom row whose Withdrawal/Deposit/
    // Balance values are the period totals — inflating credit
    // totals by 2× (real credits + summary-block "Credits" total)
    // and adding a row whose balance equals the previous balance
    // unchanged, which is impossible for a real transaction. Cut
    // everything from the marker row onward.
    const SUMMARY_MARKER = /\b(statement\s+summary|account\s+summary|period\s+summary|summary\s+of\s+account|legends?\s*:)\b/i;
    let summaryCutAt = rowBuckets.length;
    for (let i = 0; i < rowBuckets.length; i++) {
      const rowText = rowBuckets[i].map(it => it.text).join(' ');
      if (SUMMARY_MARKER.test(rowText)) {
        summaryCutAt = i;
        break;
      }
    }
    if (summaryCutAt < rowBuckets.length) {
      rowBuckets.length = summaryCutAt;
    }

    // Phase 3 — discover canonical column x-positions.
    //
    // First-choice strategy: find the table's header row in the raw
    // row buckets (the row containing "Date" / "Narration" / "Debit"
    // / "Credit" / "Balance" / "Particulars" / "Withdrawal" / etc.)
    // and use its words' x-positions as column anchors. This is far
    // more reliable than statistical clustering because:
    //   - the header is short, distinct words at consistent x
    //     positions (no character-overlap noise),
    //   - we already know semantically that these ARE the columns,
    //   - we don't have to guess gap thresholds that vary per bank.
    //
    // Fallback: if no header row matches (rare — table starts on
    // page 2, scanned-then-OCR'd PDFs, non-standard layouts), we
    // fall back to single-linkage gap clustering on all items'
    // left edges, which handles right-aligned numeric columns
    // because items inside one column pack densely while inter-
    // column gaps are 30-100 units.
    // Prefix match (no trailing $) so a single text item carrying a
    // multi-word header like "Withdrawal Amt." or "Chq./Ref.No." still
    // matches by its leading word. HDFC, ICICI, and a few SBI templates
    // emit those compound headers as one pdfjs text item; the older
    // anchored ^...$ form silently dropped them and starved the
    // header-row matcher below the >= 3 threshold, sending us into
    // the gap-clustering fallback that produced a degenerate grid.
    // "closing" / "value" are added so "Closing Balance" and "Value Dt"
    // (when split into sub-tokens below) anchor to their own column.
    const HEADER_WORD = /^(date|narration|particulars|description|details|remarks|withdraw\w*|deposit\w*|debit|credit|balance|closing|chq|cheque|voucher|amount|reference|ref|utr|type|value)/i;
    // Numeric headers correspond to right-aligned data columns. Indian
    // bank statements (and most accounting exports) right-align rupee
    // values with the header word's RIGHT edge; the LEFT edge drifts
    // by ~1 unit per digit, so a narrow ₹9.42 in a column populated
    // mostly by ₹50,000 values has a left-edge ~25 units to the right
    // of where it "should" be — close enough to the next column's
    // left anchor that nearest-by-left-edge mis-clusters it. Anchoring
    // numeric columns by RIGHT edge eliminates the digit-width drift.
    const NUMERIC_HEADER = /^(withdraw\w*|deposit\w*|debit|credit|balance|amount)$/i;
    interface ColumnAnchor {
      // x used for matching: header's RIGHT edge for numeric columns,
      // LEFT edge for text columns.
      x: number;
      align: 'right' | 'left';
      // Always the header word's LEFT edge — for dedup and for the
      // public columnXs visual-sort key.
      leftX: number;
      // The original header word that defined this column (e.g.
      // "Withdrawal", "Closing Balance"). Carried through to the
      // public PdfGrid so suggestMapping can auto-assign roles
      // without re-finding the header row downstream.
      headerText: string | null;
      // Right edge of the most recently appended header token in this
      // column. Used to measure the whitespace GAP to the next token
      // when deciding whether to merge it as a continuation suffix.
      _lastTokenRight?: number;
    }
    // Some PDF templates (HDFC, ICICI) emit a multi-word header label
    // ("Withdrawal Amt.", "Closing Balance", "Value Dt") as a SINGLE
    // pdfjs text item. Split such items on whitespace and distribute
    // the original width proportionally so each sub-token has a
    // plausible x-position the matcher below can use. Without this,
    // the leading word would still match (after the prefix-regex fix)
    // but a continuation like "Amt." would never appear as a separate
    // token, so the anchor would carry only "Withdrawal" and the data
    // tokens would land in a slightly off-anchor column.
    type ExpandedItem = RawItem & { _parentX?: number };
    const expandHeaderItem = (it: RawItem): ExpandedItem[] => {
      const text = it.text;
      if (!/\s/.test(text.trim())) return [it];
      const totalLen = text.length || 1;
      const out: ExpandedItem[] = [];
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const tok = m[0];
        const offset = m.index;
        out.push({
          text: tok,
          x: it.x + (offset / totalLen) * it.width,
          y: it.y,
          width: (tok.length / totalLen) * it.width,
          // Carry the parent item's leftX. When a non-leading sub-token
          // is the only HEADER_WORD match (e.g. "Transaction Remarks" —
          // "Transaction" doesn't match, "Remarks" does), the column
          // visually starts where the parent label starts, not where
          // the matching word sits. Using parentX as the anchor's leftX
          // pulls the anchor leftward so it captures data items that
          // align with the visual column edge.
          _parentX: it.x,
        });
      }
      return out.length > 0 ? out : [it];
    };

    // Continuations include short suffix tokens that pdfjs may emit
    // as separate items OR as the trailing word of a multi-word header
    // that was split above (e.g. "Value Dt" → Value + Dt; "Closing
    // Balance" → Closing + Balance). Adding "dt" / "date" / "no" lets
    // the wizard render "Value Dt" and similar as a single column
    // labelled correctly, which suggestMapping then routes to its
    // right role (Value Dt → skip, etc.).
    //
    // Hoisted to function scope so the row-iteration filter can include
    // continuation-only tokens — without that, "Amt." gets dropped
    // before the merge loop sees it and "Withdrawal" carries the wrong
    // headerText.
    const CONTINUATION = /^(amt\.?|amount|balance|bal\.?|paid|received|recd\.?|dt\.?|date|no\.?)$/i;
    const MAX_INTRA_LABEL_GAP = 8;

    // Some banks (Axis "OpTransactionHistory") stack the header across
    // 2-3 y-bands — "Transaction" sits on row y=223, "Date" on y=233,
    // "S No." / "Cheque Number" on y=228 — so each band individually
    // has fewer than 3 header words. Merge adjacent buckets when the
    // y-gap is below HEADER_BAND_MERGE; the next data row sits well
    // beyond this gap (20+ units) so we won't accidentally pull in
    // narration text. The merged item set is what we run header
    // detection over; the original buckets remain untouched for cell
    // assignment downstream.
    const HEADER_BAND_MERGE = 12;
    const bucketY = (b: RawItem[]): number => b.length ? b[0].y : 0;

    let columnAnchors: ColumnAnchor[] = [];
    for (let bi = 0; bi < rowBuckets.length; bi++) {
      const merged: RawItem[] = [...rowBuckets[bi]];
      const startY = bucketY(rowBuckets[bi]);
      let bj = bi + 1;
      while (bj < rowBuckets.length && Math.abs(bucketY(rowBuckets[bj]) - startY) <= HEADER_BAND_MERGE) {
        merged.push(...rowBuckets[bj]);
        bj++;
      }
      const expanded = merged.flatMap(expandHeaderItem);
      // Gate the header-row decision on REAL header words only — a row
      // that just happens to contain "Amt." or "No." in narration text
      // shouldn't trigger the matcher.
      const headerWordHits = expanded.filter(it => HEADER_WORD.test(it.text.trim()));
      if (headerWordHits.length >= 3) {
        // But INCLUDE continuation tokens in the iteration so multi-
        // word headers like "Withdrawal Amt." or "Value Dt" can merge
        // into one anchor with the correct combined headerText.
        const headerOrCont = expanded.filter(it => {
          const t = it.text.trim();
          return HEADER_WORD.test(t) || CONTINUATION.test(t);
        });
        const sorted = [...headerOrCont].sort((a, b) => a.x - b.x);
        for (const it of sorted) {
          const trimmed = it.text.trim();
          const isNumeric = NUMERIC_HEADER.test(trimmed);
          const parentX = (it as ExpandedItem)._parentX;
          // For LEFT-aligned anchors, prefer the parent item's leftX
          // when this sub-token isn't at offset 0 — see expandHeaderItem
          // for the "Transaction Remarks" rationale. For numeric (right-
          // aligned) anchors, the right edge is what matters; leftX is
          // only used for visual sort, so still safe to pull leftward.
          const useLeftX = parentX !== undefined && parentX < it.x ? parentX : it.x;
          const anchor: ColumnAnchor = isNumeric
            ? { x: it.x + it.width, align: 'right', leftX: useLeftX, headerText: trimmed }
            : { x: useLeftX, align: 'left', leftX: useLeftX, headerText: trimmed };
          // Dedup using the header word's left edge so a "Withdrawal"
          // header that pdfjs split into "Withdrawal" + "Amt." across
          // two adjacent text items collapses to one column. Append
          // the second token's text to the existing header so we
          // capture "Withdrawal Amt." as one label, not just
          // "Withdrawal".
          // Distinct columns even when tightly packed (e.g. Type next
          // to Debit) keep their own anchor — we measure the WHITESPACE
          // GAP between the previous token's right edge and this
          // token's left edge, not left-to-left distance. A real
          // within-label space is ~3-6 PDF units; a column boundary is
          // 15+ units even in dense Tally exports.
          const lastAnchor = columnAnchors.length === 0 ? null : columnAnchors[columnAnchors.length - 1];
          // lastAnchor.x is the right edge for numeric anchors and the
          // left edge for text anchors — but we always need the right
          // edge of the most-recent token to measure the gap. Track it
          // separately on the anchor.
          const lastRight = lastAnchor?._lastTokenRight ?? lastAnchor?.leftX ?? -Infinity;
          const gap = it.x - lastRight;
          const isContinuation = !!lastAnchor && CONTINUATION.test(trimmed) && gap >= 0 && gap <= MAX_INTRA_LABEL_GAP;
          // A continuation-only token (e.g. "Amt." that doesn't also
          // match HEADER_WORD) without a preceding anchor would create
          // a spurious column. Skip — the anchor it was meant to suffix
          // never showed up.
          const isContOnly = !HEADER_WORD.test(trimmed) && CONTINUATION.test(trimmed);
          if (!isContinuation && isContOnly) {
            continue;
          }
          if (!isContinuation) {
            (anchor as ColumnAnchor & { _lastTokenRight: number })._lastTokenRight = it.x + it.width;
            columnAnchors.push(anchor);
          } else if (lastAnchor) {
            if (lastAnchor.headerText) lastAnchor.headerText = `${lastAnchor.headerText} ${trimmed}`;
            // Numeric anchor's right-edge tracks the rightmost token.
            if (lastAnchor.align === 'right') lastAnchor.x = Math.max(lastAnchor.x, it.x + it.width);
            // If the continuation token is itself numeric-flavoured
            // ("Amount", "Balance"), upgrade the anchor to right-aligned
            // so cells (numbers) match by right edge regardless of
            // whether the original header word was the numeric one.
            if (NUMERIC_HEADER.test(trimmed)) {
              lastAnchor.align = 'right';
              lastAnchor.x = it.x + it.width;
            }
            (lastAnchor as ColumnAnchor & { _lastTokenRight: number })._lastTokenRight = it.x + it.width;
          }
        }
        break;
      }
    }

    // Dedup near-duplicate anchors that came from a multi-line header.
    // Axis OpTransactionHistory stacks "Withdrawal" on the top band
    // and "Amount (INR)" on the bottom band at almost the same x —
    // when we merge bands for detection, both become anchors. Collapse
    // any pair within MAX_INTRA_LABEL_GAP, preferring the more specific
    // (non-continuation) NUMERIC_HEADER as the canonical text.
    if (columnAnchors.length > 1) {
      // Sort by leftX for the dedup pass — right-edges drift apart
      // when the longer header word ("Withdrawal") and the shorter
      // one ("Amount") share a left edge but differ in width.
      columnAnchors.sort((a, b) => a.leftX - b.leftX);
      const dedup: ColumnAnchor[] = [];
      // When one of the candidates is a generic continuation-eligible
      // word ("Amount", "Balance" alone), allow a wider dedup window —
      // the lower band's "Amount (INR)" can sit 10-15 units left of
      // "Deposit" because headers are centered above their column.
      const looksGeneric = (t: string | null): boolean => {
        const w = t?.trim().split(/\s+/)[0] ?? '';
        return CONTINUATION.test(w);
      };
      for (const a of columnAnchors) {
        const prev = dedup[dedup.length - 1];
        const threshold = prev && (looksGeneric(prev.headerText) || looksGeneric(a.headerText))
          ? 18
          : MAX_INTRA_LABEL_GAP;
        if (prev && Math.abs(a.leftX - prev.leftX) <= threshold) {
          // Pick the better headerText. NUMERIC_HEADER tokens that are
          // not also CONTINUATION (Withdrawal / Deposit / Debit / Credit)
          // are the most specific; "Amount" / "Balance" are generic.
          const score = (t: string | null): number => {
            if (!t) return 0;
            const w = t.trim().split(/\s+/)[0] ?? '';
            if (NUMERIC_HEADER.test(w) && !CONTINUATION.test(w)) return 3;
            if (HEADER_WORD.test(w) && !CONTINUATION.test(w)) return 2;
            if (HEADER_WORD.test(w)) return 1;
            return 0;
          };
          if (score(a.headerText) > score(prev.headerText)) {
            prev.headerText = a.headerText;
          }
          if (a.align === 'right') {
            prev.align = 'right';
            prev.x = Math.max(prev.x, a.x);
          }
          continue;
        }
        dedup.push(a);
      }
      columnAnchors = dedup;
    }

    // ── Numeric-column augmentation pass ──────────────────────────────
    // Header geometry alone fails on dense Tally exports (OSPL Future
    // Energy etc.) where Type / Debit / Amount / Credit / Balance are
    // packed within 4-6 PDF units of each other in the header row, but
    // the ACTUAL data values below them are still right-aligned at
    // distinct, well-separated x-coordinates. Cluster the right-edges
    // of all numeric tokens across every data row; any cluster that
    // doesn't already correspond to one of the header anchors becomes
    // an additional right-aligned numeric column.
    {
      const numericRights: number[] = [];
      // Skip header rows when sampling — headers contain words, not
      // numbers, so they wouldn't pollute, but starting from the row
      // AFTER the header makes intent clearer.
      const headerWasFound = columnAnchors.some(a => a.headerText !== null);
      const sampleStart = headerWasFound ? Math.min(rowBuckets.length, 4) : 0;
      for (let bi = sampleStart; bi < rowBuckets.length; bi++) {
        for (const it of rowBuckets[bi]) {
          // Conservative: only consider tokens that look like a
          // formatted Indian-style number (>= 4 digits with grouping
          // commas, or any number with decimals). Excludes voucher
          // numbers like "000021" and short codes like "U-02".
          const t = it.text.trim();
          if (!/^-?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?(?:\s*[CD]r\.?)?$|^-?\d+\.\d{2}(?:\s*[CD]r\.?)?$/.test(t)) continue;
          numericRights.push(it.x + it.width);
        }
      }
      if (numericRights.length >= 30) {
        // Cluster right-edges with a 6-unit tolerance — numeric values
        // in a single column right-align to within 1-2 units; 6 covers
        // jitter from variable-width digits without bridging adjacent
        // columns (which sit 30+ units apart).
        const sorted = [...numericRights].sort((a, b) => a - b);
        const clusters: { right: number; count: number }[] = [];
        let csum = sorted[0], ccount = 1, cprev = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] - cprev <= 6) {
            csum += sorted[i]; ccount++;
          } else {
            clusters.push({ right: csum / ccount, count: ccount });
            csum = sorted[i]; ccount = 1;
          }
          cprev = sorted[i];
        }
        clusters.push({ right: csum / ccount, count: ccount });
        // Drop weak clusters — a real column has at least 5% of the
        // numeric-token sample landing in it. Filters out one-off
        // page totals or headers misclassified as numbers.
        const minDensity = Math.max(5, Math.floor(numericRights.length * 0.05));
        const dataNumericColumns = clusters
          .filter(c => c.count >= minDensity)
          .map(c => c.right);

        // Fold each data-derived numeric column into the header-derived
        // anchors. Pick the NEAREST right-aligned anchor within 16
        // units — bumped from 8 because a right-aligned header word
        // can sit up to ~12 units left of where the data column visually
        // ends (HDFC's "Deposit Amt." header right-edge is at 535.9 but
        // deposits right-align at 548.2). 8 was tight enough to leave
        // those clusters orphaned, producing a phantom null-header
        // column wedged between Deposit and Balance.
        for (const dataRight of dataNumericColumns) {
          let matchIdx = -1;
          let matchDist = 16;
          for (let i = 0; i < columnAnchors.length; i++) {
            const a = columnAnchors[i];
            if (a.align !== 'right') continue;
            const d = Math.abs(a.x - dataRight);
            if (d < matchDist) { matchDist = d; matchIdx = i; }
          }
          if (matchIdx === -1) {
            // New numeric column the header missed. Mark it with no
            // header text — suggestMapping will leave it as 'skip'
            // so the user picks Debit / Credit / Balance manually.
            columnAnchors.push({
              x: dataRight,
              align: 'right',
              leftX: dataRight,
              headerText: null,
            });
          } else {
            // Anchor matched — refine its right edge with the more
            // precise data-cell average so cell-to-anchor matching
            // stays tight.
            columnAnchors[matchIdx].x = dataRight;
          }
        }
        // Re-sort anchors left-to-right so downstream cell assignment
        // sees them in visual order. Use leftX for text columns and x
        // (right edge) for numeric columns; both work as sort keys.
        columnAnchors.sort((a, b) => (a.align === 'right' ? a.x : a.leftX) - (b.align === 'right' ? b.x : b.leftX));
      }
    }

    if (columnAnchors.length < 2) {
      // Fallback: gap-based clustering of all items' left-edges.
      // Without a header row we can't tell numeric from text columns,
      // so fall back to LEFT-edge anchoring for everything (the
      // legacy behavior). Banks that hit this path usually have a
      // table starting on page 2 or non-standard layouts.
      const xs = allItems.map(i => i.x).sort((a, b) => a - b);
      const minDensity = Math.max(3, Math.floor(rowBuckets.length * 0.05));
      let clusterSum = xs[0];
      let clusterCount = 1;
      let prevX = xs[0];
      const fallbackXs: number[] = [];
      for (let i = 1; i < xs.length; i++) {
        if (xs[i] - prevX <= X_GAP_TOLERANCE) {
          clusterSum += xs[i];
          clusterCount++;
        } else {
          if (clusterCount >= minDensity) {
            fallbackXs.push(clusterSum / clusterCount);
          }
          clusterSum = xs[i];
          clusterCount = 1;
        }
        prevX = xs[i];
      }
      if (clusterCount >= minDensity) {
        fallbackXs.push(clusterSum / clusterCount);
      }
      columnAnchors = fallbackXs.map(x => ({
        x, align: 'left' as const, leftX: x, headerText: null as string | null,
      }));
    }

    if (columnAnchors.length < 2) return null; // not enough column structure

    // Re-anchor text columns to the minimum left-edge of the data they
    // actually contain. Header words are often CENTERED in the visual
    // column ("Particulars" centered above narration that left-aligns
    // 80+ units to the left of the header's leftX), so using the
    // header word's leftX as the column boundary glues left-aligned
    // narration cells onto whichever neighbour anchor sits further
    // left. Fix: do a quick first-pass assignment, then for each
    // left-aligned column take the min left-edge of items that landed
    // in it, snap the anchor's leftX there, and let the real cell
    // assignment loop downstream pick that up.
    {
      const provisional: number[][] = columnAnchors.map(() => []);
      const dataStart = columnAnchors.some(a => a.headerText !== null) ? Math.min(rowBuckets.length, 4) : 0;
      for (let bi = dataStart; bi < rowBuckets.length; bi++) {
        for (const it of rowBuckets[bi]) {
          let bestCol = 0;
          let bestDist = Math.abs(
            (columnAnchors[0].align === 'right' ? it.x + it.width : it.x) - columnAnchors[0].x,
          );
          for (let c = 1; c < columnAnchors.length; c++) {
            const ref = columnAnchors[c].align === 'right' ? it.x + it.width : it.x;
            const d = Math.abs(ref - columnAnchors[c].x);
            if (d < bestDist) { bestDist = d; bestCol = c; }
          }
          provisional[bestCol].push(it.x);
        }
      }

      // Diagnostic — emits once per file so you can see exactly what the
      // detector saw without instrumenting locally. Toggle off by
      // unsetting localStorage.pdfGridDebug = '1' in the browser.
      const debug = typeof localStorage !== 'undefined' && localStorage.getItem('pdfGridDebug') === '1';
      if (debug) {
        console.group('[pdfGrid] anchors before re-anchor passes');
        columnAnchors.forEach((a, i) => {
          const xs = provisional[i];
          const minX = xs.length > 0 ? Math.min(...xs) : null;
          const maxX = xs.length > 0 ? Math.max(...xs) : null;
          console.log(`col ${i}: ${a.align}, leftX=${a.leftX.toFixed(1)}, x=${a.x.toFixed(1)}, header="${a.headerText ?? '(none)'}", items=${xs.length}, x-range=[${minX?.toFixed(1) ?? '-'}, ${maxX?.toFixed(1) ?? '-'}]`);
        });
        console.groupEnd();
      }

      // Pass A — shift left-aligned anchors that ended up RIGHT of the
      // data they own. Centered headers are the typical offender
      // ("Particulars" word centered while narration left-aligns
      // far to the left).
      for (let c = 0; c < columnAnchors.length; c++) {
        const anchor = columnAnchors[c];
        if (anchor.align !== 'left') continue;
        const xs = provisional[c];
        if (xs.length < 5) continue;
        const minLeft = Math.min(...xs);
        if (minLeft < anchor.leftX - 4) {
          anchor.leftX = minLeft;
          anchor.x = minLeft;
        }
      }

      // Pass B — split a donor column that captures BOTH its own data
      // AND data that visually belongs to the next column. The HDFC
      // case: Date anchor at x=39.9 owns "01/04/25" tokens (x≈33) AND
      // narration starts at x≈68 because Narration's anchor sits 76
      // units further right at x=144 — so x=68 lands in Date by
      // nearest-anchor proximity. Date's provisional set is bimodal
      // (33,68) with a clean 34-unit gap; snap Narration's leftX from
      // 144 to 68 and the next round of cell assignment redistributes
      // correctly.
      //
      // Earlier this only ran when cur had near-zero items, but in
      // long statements a few stray narration items DO land in cur
      // (e.g. centered narration aligned near the original header x),
      // so cur.length crosses the >=3 threshold and Pass B was
      // skipped. Now we always run when the donor is bimodal AND
      // moving cur leftward to the upper cluster would actually take
      // items off the donor (upperStart < cur.leftX - 4).
      for (let c = 1; c < columnAnchors.length; c++) {
        const cur = columnAnchors[c];
        if (cur.align !== 'left') continue;
        // Walk left to the nearest left-aligned, populated sibling.
        let donorIdx = -1;
        for (let p = c - 1; p >= 0; p--) {
          const cand = columnAnchors[p];
          if (cand.align === 'left' && provisional[p].length >= 30) { donorIdx = p; break; }
        }
        if (donorIdx === -1) continue;
        const prev = columnAnchors[donorIdx];
        const prevXs = provisional[donorIdx];
        const sorted = [...prevXs].sort((a, b) => a - b);
        let bestGap = 0;
        let bestSplitAt = -1;
        for (let i = 1; i < sorted.length; i++) {
          const gap = sorted[i] - sorted[i - 1];
          if (gap > bestGap) { bestGap = gap; bestSplitAt = i; }
        }
        // Lowered thresholds — gap of 12+ is a clear column boundary
        // in dense Tally exports. Minimum cluster size of 3 catches
        // small ledgers without false-firing on jitter.
        if (bestGap >= 12 && bestSplitAt > 0) {
          const upperStart = sorted[bestSplitAt];
          const upperCount = sorted.length - bestSplitAt;
          const lowerCount = bestSplitAt;
          // Two guards beyond the geometric ones:
          // (a) upper cluster sits meaningfully LEFT of cur (no rightward
          //     snap; no shrink when cur is already at the cluster).
          // (b) the upper cluster is large RELATIVE to what cur already
          //     captured. Without this, a long statement where cur
          //     legitimately has its own data triggers a false snap on
          //     a small bimodal blip in the donor (HDFC: Chq./Ref.No.
          //     has 700+ ref-number items, but a 3-item tail in
          //     Narration's data can otherwise drag Chq./Ref.No.
          //     leftward and steal its items). For a populated cur we
          //     require upper cluster ≥ 2× cur's current count; for a
          //     near-empty cur we require upper cluster to be in cur's
          //     half of the donor-cur span (a simple midpoint test) —
          //     otherwise the upper cluster more likely belongs to a
          //     MISSING column adjacent to the donor (Axis: S.No.
          //     items got bucketed into Date because no S.No. anchor
          //     exists; the upper cluster there are dates, not Cheque
          //     data).
          const curCount = provisional[c].length;
          const ratioOk = curCount >= 5
            ? upperCount >= 2 * curCount
            : upperStart > (prev.leftX + cur.leftX) / 2;
          if (upperCount >= 3 && lowerCount >= 3 && upperStart > prev.leftX + 6 && upperStart < cur.leftX - 4 && ratioOk) {
            if (debug) {
              console.log(`[pdfGrid] Pass B split: col ${donorIdx} (header="${prev.headerText}") had bimodal x-distribution; gap=${bestGap.toFixed(1)} at upperStart=${upperStart.toFixed(1)} (lowerCount=${lowerCount}, upperCount=${upperCount}). Snapping col ${c} (header="${cur.headerText}") leftX from ${cur.leftX.toFixed(1)} to ${upperStart.toFixed(1)}.`);
            }
            cur.leftX = upperStart;
            cur.x = upperStart;
          } else if (debug) {
            console.log(`[pdfGrid] Pass B did not commit split for col ${c}: upperCount=${upperCount}, lowerCount=${lowerCount}, upperStart=${upperStart.toFixed(1)}, prev.leftX+6=${(prev.leftX + 6).toFixed(1)}`);
          }
        } else if (debug) {
          console.log(`[pdfGrid] Pass B no-op for col ${c}: bestGap=${bestGap.toFixed(1)} (need >= 12), bestSplitAt=${bestSplitAt}`);
        }
      }

      columnAnchors.sort((a, b) => (a.align === 'right' ? a.x : a.leftX) - (b.align === 'right' ? b.x : b.leftX));

      if (debug) {
        console.group('[pdfGrid] anchors AFTER re-anchor passes');
        columnAnchors.forEach((a, i) => {
          console.log(`col ${i}: ${a.align}, leftX=${a.leftX.toFixed(1)}, x=${a.x.toFixed(1)}, header="${a.headerText ?? '(none)'}"`);
        });
        console.groupEnd();
      }
    }

    // Public columnXs is the LEFT edge of each column header — used by
    // the wizard preview as a visual sort key. Internally we still
    // match items against `anchor.x` (right edge for numeric columns).
    const columnXs: number[] = columnAnchors.map(a => a.leftX);

    // Phase 4 — assign each row's items to the column whose anchor is
    // closest *in the column's alignment frame*. Numeric columns
    // compare item.right-edge to header.right-edge; text columns
    // compare item.left-edge to header.left-edge. This is what fixes
    // the narrow-number swap (₹9.42 vs ₹90.58 mis-classified between
    // Withdrawal and Balance columns).
    const rows: string[][] = [];
    for (const bucket of rowBuckets) {
      bucket.sort((a, b) => a.x - b.x);
      const cells: string[] = new Array(columnAnchors.length).fill('');
      for (const it of bucket) {
        const itLeft = it.x;
        const itRight = it.x + it.width;
        let bestCol = 0;
        let bestDist = Math.abs(
          (columnAnchors[0].align === 'right' ? itRight : itLeft) - columnAnchors[0].x,
        );
        for (let c = 1; c < columnAnchors.length; c++) {
          const ref = columnAnchors[c].align === 'right' ? itRight : itLeft;
          const d = Math.abs(ref - columnAnchors[c].x);
          if (d < bestDist) { bestDist = d; bestCol = c; }
        }
        cells[bestCol] = cells[bestCol] ? `${cells[bestCol]} ${it.text}`.trim() : it.text.trim();
      }
      rows.push(cells);
    }

    // Page breaks for the wizard preview — translate item indices to
    // row indices. Approximate: each page boundary maps to roughly
    // boundaryItemIndex / itemsPerRow, but we want exact, so we search.
    // Simpler: rebuild page boundaries from y jumps.
    const pageBreaks: number[] = [];
    if (rows.length > 0 && pageBoundaries.length > 1) {
      // Map each page boundary item to the row it ended up in. Since
      // items were re-sorted, look up by the y of the first item of
      // each page.
      // Skipped: visual hint only, costs more than it earns in v1.
    }

    return mergeHeaderDataColumnPairs({
      rows,
      columnCount: columnXs.length,
      columnXs,
      columnHeaders: columnAnchors.map(a => a.headerText),
      pageBreaks,
      pageCount: pdf.numPages,
    });
  } catch (err) {
    // Surface password-protected PDFs as a typed error so the uploader
    // can prompt the user. pdfjs's PasswordException uses code 1 for
    // "need password" and code 2 for "incorrect password" — both end
    // up here when getDocument().promise rejects.
    const e = err as { name?: string; code?: number } | null;
    if (e && e.name === 'PasswordException') {
      throw new PdfPasswordError(e.code === 2);
    }
    console.warn('[pdfGrid] extraction failed:', err);
    return null;
  }
}

export type ColumnRole =
  | 'skip'
  | 'date'
  | 'valueDate'     // bank-internal posting date — kept distinct from
                    // the transaction date so users can see it
                    // labelled correctly in the wizard. Treated as
                    // skip by applyMapping (no signed amount derived).
  | 'narration'
  | 'voucher'
  | 'reference'
  | 'debit'
  | 'credit'
  | 'amount'        // single signed/marker amount column
  | 'drCrMarker'    // separate Dr/Cr column accompanying 'amount'
  | 'balance'
  | 'account';      // ledger only — name of the GL account this row belongs to

export interface ColumnMapping {
  /** roles[i] = the role assigned to grid column i. */
  roles: ColumnRole[];
}

export interface MappedRow {
  date: string | null;
  narration: string;
  voucher: string | null;
  reference: string | null;
  /** Signed amount: positive = credit/inflow, negative = debit/outflow. */
  amount: number;
  balance: number | null;
  account: string | null;
}

const NUMBER_RE = /-?\d[\d,]*(?:\.\d+)?/;
const DR_CR_RE = /\b(dr|cr|debit|credit)\b/i;
const DATE_LIKE_RE = /\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?(?:\s+\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{1,2}\b)/i;

function parseNumber(raw: string): number | null {
  if (!raw) return null;
  const m = raw.match(NUMBER_RE);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Normalize various Indian date formats to YYYY-MM-DD. Returns null
 *  when the cell isn't a parseable date — caller treats those rows
 *  as headers / footers / continuation lines and skips them. */
export function parseDate(raw: string, defaultYear?: number): string | null {
  if (!raw) return null;
  let cleaned = raw.trim();
  if (!cleaned) return null;
  // Strip a leading row-number prefix when the grid extractor merged
  // a narrow S.No. column into the date cell. ICICI's compact
  // statement layout collapses "S No." into "Transaction Date" so
  // cells arrive as "1 30.04.2026", "2 02.05.2026", … We only strip
  // when the prefix is 1-4 digits + whitespace AND the next token
  // looks like a date (digits + a date separator) — that avoids
  // accidentally clobbering legitimate text where a number happens
  // to lead the cell.
  const sNoPrefix = cleaned.match(/^\d{1,4}\s+(?=\d{1,2}[\/.\-])/);
  if (sNoPrefix) cleaned = cleaned.slice(sNoPrefix[0].length);
  // ISO already?
  const iso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmy = cleaned.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    let yyyy = dmy[3];
    if (yyyy.length === 2) yyyy = (Number(yyyy) > 50 ? '19' : '20') + yyyy;
    return `${yyyy}-${mm}-${dd}`;
  }
  // 28-Feb-2025 / 28 Feb 2025
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const named = cleaned.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3})[A-Za-z]*\.?[\s\-]+(\d{2,4})/);
  if (named) {
    const dd = named[1].padStart(2, '0');
    const mm = months[named[2].toLowerCase()];
    if (!mm) return null;
    let yyyy = named[3];
    if (yyyy.length === 2) yyyy = (Number(yyyy) > 50 ? '19' : '20') + yyyy;
    return `${yyyy}-${mm}-${dd}`;
  }
  // "Apr 1" / "Apr 30" / "Apr-1" — month first, day, no year. Tally/Busy
  // emit this when "Compact format" is enabled. Caller must supply a
  // defaultYear (extracted from the period header elsewhere in the doc).
  // The Indian FY runs Apr→Mar, so months Jan/Feb/Mar fall in the FY+1
  // calendar year — auto-bump when the inferred year is the FY-start.
  const monthDay = cleaned.match(/^([A-Za-z]{3})[A-Za-z]*\.?[\s\-]+(\d{1,2})\b/);
  if (monthDay && defaultYear !== undefined) {
    const mm = months[monthDay[1].toLowerCase()];
    if (!mm) return null;
    const dd = monthDay[2].padStart(2, '0');
    const monthNum = Number(mm);
    // FY runs Apr (04) → Mar (03 of next year). If the period start year
    // is e.g. 2025 (FY 25-26), then Apr–Dec → 2025, Jan–Mar → 2026.
    const yyyy = monthNum >= 4 ? defaultYear : defaultYear + 1;
    return `${yyyy}-${mm}-${dd}`;
  }
  // "1 Apr" — day first, no year (rare but seen in some exports).
  const dayMonth = cleaned.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3})[A-Za-z]*\.?\s*$/);
  if (dayMonth && defaultYear !== undefined) {
    const dd = dayMonth[1].padStart(2, '0');
    const mm = months[dayMonth[2].toLowerCase()];
    if (!mm) return null;
    const monthNum = Number(mm);
    const yyyy = monthNum >= 4 ? defaultYear : defaultYear + 1;
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

/**
 * Scan a grid for a date-bearing string (period header, opening-balance
 * row, etc.) and return the FY-start year (e.g. 2025 for "FY 2025-26").
 * Used to fill in the year on yearless "Apr 1" / "Mar 31" cells. Returns
 * null if no year-bearing date is found anywhere.
 *
 * Heuristics, in order:
 *   1. Look for "DD-MMM-YYYY" / "DD/MM/YYYY" anywhere in any cell.
 *   2. Take the MIN year seen — period headers always cite the FY-start.
 *   3. If only one year is found and the earliest visible month is
 *      Jan/Feb/Mar, treat that year as the FY-end and return year-1.
 */
export function inferFiscalYearStart(rows: string[][]): number | null {
  const yearsSeen: number[] = [];
  let earliestMonth: number | null = null;
  for (const row of rows) {
    for (const cell of row) {
      if (!cell) continue;
      // DD-MMM-YYYY or DD/MM/YYYY
      const m1 = cell.match(/\b(\d{1,2})[\s\-\/.](?:\d{1,2}|[A-Za-z]{3,9})[\s\-\/.](\d{4})\b/);
      if (m1) yearsSeen.push(Number(m1[2]));
      // ISO YYYY-MM-DD
      const m2 = cell.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
      if (m2) {
        yearsSeen.push(Number(m2[1]));
        const mo = Number(m2[2]);
        if (earliestMonth === null || mo < earliestMonth) earliestMonth = mo;
      }
      const monthDay = cell.match(/^([A-Za-z]{3})[A-Za-z]*\.?[\s\-]+(\d{1,2})/);
      if (monthDay) {
        const months: Record<string, number> = {
          jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
          jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
        };
        const mo = months[monthDay[1].toLowerCase()];
        if (mo && (earliestMonth === null || mo < earliestMonth)) earliestMonth = mo;
      }
    }
  }
  if (yearsSeen.length === 0) return null;
  const minYear = Math.min(...yearsSeen);
  // If the only years seen are FY-end (e.g. 2026 in "31-Mar-2026") and
  // earliest data month is Jan-Mar, the FY-start is minYear-1.
  if (earliestMonth !== null && earliestMonth >= 1 && earliestMonth <= 3 && yearsSeen.every(y => y === minYear)) {
    return minYear - 1;
  }
  return minYear;
}

/**
 * Detect whether a row is an "account separator" — a Tally / Busy
 * ledger book-style header that introduces a new GL account between
 * transaction blocks. These rows have substantial text but ZERO
 * transaction data: no parseable date, no debit/credit/balance/amount.
 *
 * Examples in the wild:
 *   "-HDFC BANK LTD."
 *   "-VARROC ENGINEERING LIMITED"
 *   "Account: Sales"
 *   "  CHETAN ENTERPRISES  "
 *
 * The detection is conservative — it requires every numeric column
 * (debit/credit/balance/amount) to be empty AND the date column to
 * not parse. That's enough to exclude page totals (which have numbers)
 * and column-header rows (which contain words like "Date" / "Debit"
 * that we explicitly reject).
 *
 * Returns the cleaned account name, or null if this isn't a header.
 *
 * Without this, the wizard collapses every transaction in a 365-account
 * Tally book into a single "Default" bucket — an external auditor
 * pointed out that opening / closing / total-debit / total-credit
 * become meaningless aggregates and reconciliation flags fire
 * spuriously across unrelated accounts.
 */
/** Words that, when they appear as the leading token of a cell,
 *  flag the row as a column-header row rather than an account
 *  separator. ALL Busy / Tally / Marg column headers are covered. */
const COLUMN_HEADER_KEYWORD = /\b(date|narration|particulars|description|debit|credit|balance|chq|cheque|voucher|vch\.?\s*no|amount|reference|ref|utr|type|^b$)\b/i;

/** Build a Set of recurring page-banner texts. Texts that appear ≥3
 *  times across the first 200 grid rows are treated as banners
 *  (company name, address, "Ledger" title, period header, column
 *  headers) — they're rejected as account-name candidates by
 *  detectAccountHeader regardless of whether they pass other
 *  filters. Catches the failure mode where the assessee's own
 *  business name + address recur on every page-break and bucket
 *  thousands of transactions under "<COMPANY> — <ADDRESS>" as a
 *  phantom account (e.g. "H A OVERSEAS — 8A/125, KAROL BAGH, DELHI"
 *  with 7,137 transactions on a real Busy ledger). 200-row scan is
 *  enough to cover ~3 page-breaks on a typical export. */
function buildBannerTextSet(rows: string[][]): Set<string> {
  const counts = new Map<string, number>();
  const SCAN_LIMIT = Math.min(200, rows.length);
  for (let i = 0; i < SCAN_LIMIT; i++) {
    for (const cell of rows[i]) {
      const t = (cell ?? '').trim().toLowerCase();
      if (t.length >= 3) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const banner = new Set<string>();
  for (const [text, count] of counts) {
    if (count >= 3) banner.add(text);
  }
  return banner;
}

function detectAccountHeader(
  row: string[],
  colByRole: Map<ColumnRole, number>,
  defaultYear?: number,
  bannerTexts?: Set<string>,
): string | null {
  const cell = (role: ColumnRole): string => {
    const i = colByRole.get(role);
    return i === undefined ? '' : (row[i] ?? '').trim();
  };

  // Reject anything carrying transaction data.
  if (parseDate(cell('date'), defaultYear)) return null;
  if (parseNumber(cell('debit')) || parseNumber(cell('credit'))) return null;
  if (parseNumber(cell('amount')) || parseNumber(cell('balance'))) return null;

  // Pull all non-empty cells; pick the longest as the account-name
  // candidate. (In Tally PDFs the account name usually lands in the
  // narration / particulars column when extracted, but we don't
  // assume that — different banks lay it out differently.)
  const nonEmpty = row
    .map(c => (c ?? '').trim())
    .filter(c => c.length > 0);
  if (nonEmpty.length === 0) return null;

  // Pre-filter cells that obviously aren't account names BEFORE
  // picking the longest. The Tally Hotel Holiday Inn 2024-25 export
  // surfaces multi-cell banner rows on continuation pages where the
  // cells are { "Accounting Fee", "Ledger Account",
  // ": 1-Apr-24 to 31-Mar-25", "Page 6" }. Plain longest-cell picks
  // the date-range string and turns it into a phantom account.
  // Reject:
  //   - Tally page-rollover footers ("continued..N" / "continued...")
  //   - Date-range strings (": 1-Apr-24 to 31-Mar-25" or
  //     "1-Apr-24 to 31-Mar-25")
  //   - "Page N" / "Page No. N" cells
  //   - "Ledger Account" label
  //   - Bare "Carried Over" / "Brought Forward" markers
  const NON_ACCOUNT_CELL = /^(?:continued\b|carried\s+over|brought\s+forward|page\s+\S+|ledger(?:\s+account)?$|[:\s]*\d{1,2}[-/.][a-z]{3,9}[-/.]\d{2,4}\s+to\s+)/i;
  const filtered = nonEmpty.filter(c => !NON_ACCOUNT_CELL.test(c));
  if (filtered.length === 0) return null;

  const candidate = filtered.sort((a, b) => b.length - a.length)[0];

  // Reject column-header rows defensively (findTableStart already
  // skips these but this function might be called on the raw grid).
  // Two checks:
  //   1. The candidate itself starts with a header keyword.
  //   2. TWO OR MORE cells contain header keywords — catches rows
  //      where the extractor merged narrow header columns ("B
  //      Narration" when the 1-char "B" column collapsed into the
  //      wider "Narration" column produces a single cell that no
  //      longer starts with "narration"). Without this, the column
  //      header row at the top of every Busy page became a phantom
  //      account that swallowed thousands of transactions.
  if (COLUMN_HEADER_KEYWORD.test(candidate)) return null;
  const headerLikeCells = nonEmpty.filter(c => COLUMN_HEADER_KEYWORD.test(c)).length;
  if (headerLikeCells >= 2) return null;

  // Reject "( Contd. )" continuation page markers. Busy ledgers print
  // "A R ENTERPRISES ( Contd. )" at the top of every page that
  // continues an account from the previous page — same account, not
  // a new one. Note: applyMapping ALSO has continuation-block
  // suppression so the city line below the marker doesn't become
  // a standalone phantom account.
  if (/\(\s*contd\.?\s*\)/i.test(candidate)) return null;

  // Reject candidates that are themselves parseable dates. Busy bill
  // narrations sometimes wrap onto a continuation row that contains
  // ONLY the bill date ("25-03-2026" alone) — when that row lands
  // after a Totals flush has cleared `pending`, the date string
  // would otherwise become a phantom account.
  if (parseDate(candidate, defaultYear)) return null;

  // Reject candidates that look like bill / voucher / D-Note numbers
  // — same fall-through as above. Patterns:
  //   BS/25-26/41, RE/25-26/26, JME/003, GST/25-26/449, PDN/25-26/447
  //   "Bill No.", "D/Note", "Cheque No.", etc. as a leading prefix.
  if (/^(?:bill\s*no|d\/?note|cheque\s*no|chq\s*no|inv|invoice\s*no|voucher\s*no|ref\s*no|rtgs|neft|imps|upi|tds)\b/i.test(candidate)) return null;
  if (/^[A-Z]{2,5}\/[\dA-Z\-/]+$/i.test(candidate)) return null;

  // Reject page-banner rows that recur on every page of a multi-page
  // export. Two checks:
  //   1. LEDGER_BANNER: catches keyword-anchored banner text like
  //      "GSTIN: ...", "Period : ...", bare "Ledger", "Page No.",
  //      "Statement of Account".
  //   2. bannerTexts (built per-document by buildBannerTextSet):
  //      catches FREE-FORM banner text — the assessee's company name
  //      and address — that appears on every page-break and would
  //      otherwise be picked up as an account name. The first time
  //      these appear becomes the initial lastAccount, swallowing
  //      every transaction before the first real account header
  //      ("A R ENTERPRISES" etc.). Catches the H A OVERSEAS / 8A/125
  //      KAROL BAGH DELHI phantom account that logged 7,137 txns.
  const LEDGER_BANNER = /^(?:gstin\s*[:.]|period\s*[:.]|ledger(?:\s+account)?$|page\s+no\.?|statement\s+of\s+account|generated\s+by|printed\s+on)/i;
  if (LEDGER_BANNER.test(candidate)) return null;
  if (bannerTexts && bannerTexts.has(candidate.toLowerCase())) return null;

  // Strip Tally's leading dash and trim.
  let name = candidate.replace(/^[\s\-•]+/, '').trim();
  // "Account: HDFC Bank" → "HDFC Bank"
  name = name.replace(/^Account\s*[:.]\s*/i, '').trim();
  // Strip the "( Contd. )" suffix if it slipped past the candidate
  // check — sometimes the longest-cell heuristic picks a different
  // cell on the same row.
  name = name.replace(/\s*\(\s*contd\.?\s*\)\s*$/i, '').trim();

  // Need a meaningful length.
  if (name.length < 3) return null;
  return name;
}

/** Marker for ledger-side page subtotal / carry-forward rows. Catches
 *  "Totals C/F" / "Totals B/F" / "Totals" (Busy), "Balance c/f:" /
 *  "Balance b/f:" (Marg), "Carried Over" / "Brought Forward" /
 *  "Continued.." (Tally), bare "C/F" / "B/F". Deliberately does NOT
 *  match "Opening Balance" / "Closing Balance" — those rows carry
 *  meaningful data that mappedRowsToExtractedLedger reads to populate
 *  accounts[].opening / accounts[].closing. Bank statements use a
 *  separate, broader marker (SUBTOTAL_MARKER inside applyMapping)
 *  that DOES include opening/closing because banks don't use those
 *  rows the same way. */
const LEDGER_SUBTOTAL_MARKER = /\b(?:totals?\s*[bc]\s*\/\s*f|^totals?\s*$|totals?\s*&\s*balance|page\s+total|carried\s+over|brought\s+forward|carried\s+forward|balance\s+[bc]\s*\/\s*f|continued\.\.|^[bc]\s*\/\s*f$)/i;

/**
 * Apply a column mapping to a raw grid → array of normalized rows.
 *
 * Skips rows where the date column doesn't parse to a real date —
 * those are the page headers, totals, "Brought Forward" labels and
 * other non-transaction noise that any bank statement carries.
 *
 * If the mapping uses (debit, credit) the signed amount comes from
 * whichever side is populated. If it uses (amount, drCrMarker), the
 * sign comes from the marker. If it uses (amount) alone, we keep
 * whatever sign is in the cell (some statements pre-sign withdrawals
 * with a minus).
 *
 * For ledger PDFs that bundle multiple GL accounts in one file
 * (Tally / Busy party-wise ledger book), account-separator rows
 * between transaction blocks update lastAccount so each transaction
 * carries the right account name into mappedRowsToExtractedLedger.
 *
 * Bank statements should pass kind='bank' to disable the account-
 * header detection — bank statements don't have account separators,
 * and any date-less rows are multi-line narration continuations
 * that need to be appended to the previous transaction (e.g.
 * Canara's UPI references that wrap onto a second display line).
 * Without this gate, those continuations were being misread as
 * "account headers" and silently dropped, costing transaction count
 * and data fidelity on multi-line bank narrations.
 */
export interface MappingStats {
  /** Raw grid rows seen by applyMapping (everything pdfjs extracted
   *  before any filtering). */
  totalGridRows: number;
  /** Rows that became real transactions in the output. */
  transactions: number;
  /** Date-less rows whose narration was merged into the previous
   *  transaction (multi-line UPI references / wrapped counterparty
   *  names). NOT lost — text is appended to the prior row. */
  mergedContinuations: number;
  /** Rows with a parseable date but no debit / credit / amount.
   *  Almost always opening / closing balance markers, page totals,
   *  "Brought Forward" labels — non-transaction noise that bank
   *  statements legitimately include in their row count but aren't
   *  meaningful txns. */
  skippedNoAmount: number;
  /** Ledger-only: rows detected as Tally / Busy account-separator
   *  headers (e.g. "-HDFC BANK LTD.") — used to update the account
   *  context for following transactions. Always 0 for kind='bank'. */
  accountHeaders: number;
  /** Detected Cash Credit / Overdraft / Loan account — balance is a
   *  DEBIT balance (95%+ of suffixed balance values carry "Dr"). The
   *  caller passes this through to the upload payload as
   *  `accountKind: 'liability'` so the server's balance-delta
   *  reconciler doesn't flip every deposit's sign. Defaults to false
   *  when balance suffixes are mixed or absent (regular savings). */
  isCashCredit: boolean;
}

/**
 * Apply a column mapping to a raw grid → array of normalized rows.
 *
 * Returns both the mapped transactions AND a stats breakdown so the
 * caller can surface "we saw 337 rows but only 327 were real
 * transactions — 8 wrapped narrations got merged, 2 were opening/
 * closing balance markers." Without that visibility users see a
 * lower-than-expected count and can't tell whether something was
 * silently dropped.
 *
 * Skips rows where the date column doesn't parse to a real date —
 * those are the page headers, totals, "Brought Forward" labels and
 * other non-transaction noise that any bank statement carries.
 *
 * If the mapping uses (debit, credit) the signed amount comes from
 * whichever side is populated. If it uses (amount, drCrMarker), the
 * sign comes from the marker. If it uses (amount) alone, we keep
 * whatever sign is in the cell (some statements pre-sign withdrawals
 * with a minus).
 *
 * For ledger PDFs that bundle multiple GL accounts in one file
 * (Tally / Busy party-wise ledger book), account-separator rows
 * between transaction blocks update lastAccount so each transaction
 * carries the right account name into mappedRowsToExtractedLedger.
 *
 * Bank statements should pass kind='bank' to disable the account-
 * header detection — bank statements don't have account separators,
 * and any date-less rows are multi-line narration continuations
 * that need to be appended to the previous transaction.
 */
export function applyMapping(
  grid: PdfGrid,
  mapping: ColumnMapping,
  kind: 'bank' | 'ledger' = 'bank',
): { rows: MappedRow[]; stats: MappingStats } {
  const out: MappedRow[] = [];
  const stats: MappingStats = {
    totalGridRows: grid.rows.length,
    transactions: 0,
    mergedContinuations: 0,
    skippedNoAmount: 0,
    accountHeaders: 0,
    // Filled in once the balance-suffix scan runs (a few lines below).
    isCashCredit: false,
  };
  const colByRole = new Map<ColumnRole, number>();
  mapping.roles.forEach((r, i) => {
    if (r !== 'skip' && !colByRole.has(r)) colByRole.set(r, i);
  });

  // Some Tally / Busy exports drop the year on the date column ("Apr 1",
  // "May 9", "Mar 31"). Scan the whole grid once for any year-bearing
  // date string (period header, opening balance, footer date, etc.) and
  // use it as the FY-start year for downstream parseDate calls.
  const inferredYear = inferFiscalYearStart(grid.rows);

  // Block-based parser: one logical transaction can span multiple
  // grid rows (pdfjs splits visual lines whenever the y-coord shifts,
  // so a date row + an amount row + a narration tail-line is THREE
  // grid rows for ONE transaction). We accumulate fragments into a
  // pending block and flush when the next dated row appears.
  //
  // This fixes a row-drop bug where dates were on one grid row and
  // amounts on the next: the old code dropped both halves (date row
  // had amount=null → skipped; amount row had no date → treated as
  // narration continuation, amount lost).
  interface PendingBlock {
    date: string;
    narration: string;
    voucher: string | null;
    reference: string | null;
    debit: number | null;
    credit: number | null;
    amountSingle: number | null; // 'amount' single-column path
    drCrMarker: string;
    balance: number | null;
    account: string | null;
  }
  let pending: PendingBlock | null = null;
  let lastAccount: string | null = null;
  // Tracks whether the immediately-previous row was an account-header
  // row. Busy ledgers print account headers across two consecutive
  // rows — company name on one ("A R ENTERPRISES") and city/branch
  // on the next ("KAPURTHALA"). Without this flag the second row
  // overwrites lastAccount and every transaction gets labelled with
  // the city instead of the company. When the flag is set, the next
  // header row appends to the previous name with " — " instead of
  // replacing it.
  let prevRowWasAccountHeader = false;
  // Set when an incomplete pending block (date+narration only, no
  // amount yet) survives a Page Total / page-banner marker row. The
  // transaction's real continuation row sits on the NEXT page after
  // the banner; until we find it, every intervening row is page-
  // header noise (bank address, pincode, "Printed By..."), which
  // would corrupt pending if merged. While this flag is set, only
  // rows that look like a legitimate continuation (no date, has a
  // valid Dr/Cr-suffixed balance, has a non-zero amount) are allowed
  // to merge into pending. Everything else is skipped silently. The
  // flag clears once a continuation lands, a new date row arrives
  // (abandoning pending), or pending is otherwise flushed.
  let pendingAwaitingCrossPage = false;
  // Set when we see a Busy / Tally "( Contd. )" page-continuation
  // marker. Suppresses account-header detection on every subsequent
  // date-less row UNTIL we hit a real dated transaction. Without
  // this, the city line that follows ("KAPURTHALA" in
  // "A R ENTERPRISES ( Contd. ) / KAPURTHALA") was being recognized
  // as a fresh standalone account, producing the city-name phantom
  // accounts (KPT, DELHI, ZIRA, PATTI, BIHAR, ...) the audit kept
  // surfacing on multi-page exports.
  let inContinuationBlock = false;
  // Per-document set of recurring banner-row texts (assessee's
  // company name + address + recurring page-header content).
  // Computed once before the main loop; consulted inside
  // detectAccountHeader to reject those texts as account-name
  // candidates. Bank-side doesn't use account headers so this scan
  // is ledger-only.
  const bannerTexts = kind === 'ledger' ? buildBannerTextSet(grid.rows) : undefined;
  // Last successfully-emitted balance — used as the fallback source
  // for an amount when the row's debit/credit cells lost the value
  // to pdfjs column-clustering (small charges like ₹0.03 / ₹5 / ₹7
  // get misplaced when their text-item x-positions don't match the
  // column anchor). Bank running balance is ground truth: amount =
  // balance(N) − balance(N-1). Only fires when no other amount
  // source is available.
  let lastBalance: number | null = null;
  // Cash Credit account detection. CC statements (J&K Bank, etc.)
  // print every running balance with a "Dr" suffix because the
  // customer owes the bank. On these accounts a DEPOSIT reduces the
  // outstanding Dr-balance — the inverse of a savings account, where
  // a deposit grows the balance. The balance-equation sanity check
  // below (`lastBalance + amount = newBalance`) assumes the savings
  // convention, so on a CC statement it flips the sign of every
  // correctly-mapped deposit. Detect CC by scanning the balance
  // column for the Dr/Cr suffix mix: when 95%+ of suffixed balance
  // values carry "Dr" with effectively zero "Cr", we're on a CC
  // statement and must skip the savings-convention sanity check.
  const balanceColIdx = mapping.roles.findIndex(r => r === 'balance');
  let drCount = 0, crCount = 0;
  if (balanceColIdx >= 0) {
    for (const r of grid.rows) {
      const raw = (r[balanceColIdx] ?? '').trim();
      if (/cr\.?\s*$/i.test(raw)) crCount += 1;
      else if (/dr\.?\s*$/i.test(raw)) drCount += 1;
    }
  }
  const isCashCredit = drCount >= 20 && crCount * 20 < drCount;
  stats.isCashCredit = isCashCredit;


  const flushPending = () => {
    if (!pending) return;
    // Resolve final amount(s). Three cases:
    //   - debit AND credit BOTH non-zero: emit TWO transactions (e.g.
    //     UPI mandate auth + immediate reversal — Apple Media pair
    //     pattern flagged by review). Otherwise we'd silently pick
    //     debit and the credit half flips to a debit.
    //   - one of debit/credit non-zero: standard signed amount.
    //   - amountSingle path: signed by drCrMarker.
    const debit = pending.debit ?? 0;
    const credit = pending.credit ?? 0;
    const hasBoth = debit !== 0 && credit !== 0;
    if (hasBoth) {
      out.push({
        date: pending.date,
        narration: pending.narration || '',
        voucher: pending.voucher,
        reference: pending.reference,
        amount: -Math.abs(debit),
        balance: pending.balance,
        account: pending.account,
      });
      out.push({
        date: pending.date,
        narration: pending.narration || '',
        voucher: pending.voucher,
        reference: pending.reference,
        amount: Math.abs(credit),
        balance: pending.balance,
        account: pending.account,
      });
      if (pending.balance != null) lastBalance = pending.balance;
      pending = null;
      return;
    }
    let amount: number | null = null;
    if (debit !== 0) {
      amount = -Math.abs(debit);
    } else if (credit !== 0) {
      amount = Math.abs(credit);
    } else if (pending.amountSingle != null) {
      const marker = pending.drCrMarker.toLowerCase();
      if (marker.includes('dr') || marker.includes('debit') || marker.includes('-')) {
        amount = -Math.abs(pending.amountSingle);
      } else if (marker.includes('cr') || marker.includes('credit')) {
        amount = Math.abs(pending.amountSingle);
      } else {
        amount = pending.amountSingle;
      }
    }

    // Last-resort fallback: derive amount from the printed running
    // balance delta. Triggers when pdfjs's column clustering
    // misplaced the amount value into a column we didn't read
    // (typical for tiny charges like ₹0.03 / ₹5 / ₹7 where the
    // narrow text rendered at an unusual x-coord). The bank's
    // printed balance is authoritative — if it moved by X, the
    // transaction was X. Recovers rows that would otherwise be
    // silently dropped as "no amount".
    if (amount == null && pending.balance != null && lastBalance != null) {
      const delta = pending.balance - lastBalance;
      if (Math.abs(delta) > 0.005) {
        amount = delta;
      }
    }

    // Opening / closing balance marker rows. Some Tally exports (OSPL
    // Future Energy variant) put the opening balance ONLY in the
    // balance column with a Dr/Cr suffix — debit/credit are empty.
    // Without rescuing this row, flushPending skips it (amount=null),
    // and mappedRowsToExtractedLedger never sees the opening balance
    // so it defaults to 0 — every audit then reports an opening of 0
    // and a recon gap equal to the actual carried-forward balance.
    //
    // Emit as a placeholder transaction with amount=0; the downstream
    // opening-detection in mappedRowsToExtractedLedger keys off
    // narration AND consults t.balance when t.amount is 0 to pick up
    // the signed opening directly. Same trick covers closing-balance
    // rows that lack a debit/credit value.
    if (
      amount == null
      && kind === 'ledger'
      && pending.balance != null
      && /(?:^|\s)(?:opening|closing)\s+balance\b/i.test(pending.narration ?? '')
    ) {
      amount = 0;
    }

    // Sanity-check amount/balance against the bank's running balance.
    // For narrow-text rows pdfjs sometimes drops the amount value at
    // a column boundary and ends up putting the *running balance* into
    // our debit cell and the *actual fee* into our balance cell — or
    // mis-clusters a credit value into the debit anchor. The printed
    // running balance is ground truth: if `lastBalance + amount` does
    // not equal `pending.balance`, but flipping the sign / swapping
    // amount<->balance / both makes the equation hold within a paisa,
    // adopt the corrected pair. Tight gates (>1₹ as-is error AND
    // <5p corrected error) so this only fires on genuinely-wrong rows
    // and never "fixes" a correct one.
    //
    // Skip when amount came from the balance-delta fallback above —
    // by construction that path already satisfies the equation, and
    // re-checking would just compare floating point against itself.
    //
    // Bank-only. The check assumes a savings-account convention where
    // balance is signed (overdraft negative, credit positive) and
    // amount = balance(N) − balance(N-1) holds. Tally ledger balances
    // are UNSIGNED magnitudes printed with a separate "Dr" / "Cr"
    // suffix (parseNumber strips the suffix → balance is always
    // positive), AND the Dr/Cr orientation is account-type-specific
    // (Dr-side accounts grow with debits, Cr-side accounts grow with
    // credits). Applying the bank-convention check to a Dr-side
    // ledger account flips the sign of every transaction past the
    // first — exactly the Accounting Fee / Adm. Charges symptom where
    // "amt=-1500 then +1500 +1500 +1500…" surfaced even though every
    // source row was structurally identical "To (as per details) Dr"
    // entry.
    if (
      kind === 'bank'
      && amount != null && Number.isFinite(amount)
      && lastBalance != null && pending.balance != null
      // The balance-delta fallback path produces an exact match by
      // construction; only sanity-check rows where amount came from
      // the explicit cells (debit/credit/amountSingle).
      && !(pending.debit === 0 && pending.credit === 0 && pending.amountSingle == null)
      // CC accounts invert the balance-equation convention (deposits
      // reduce the Dr-balance). On a CC statement this check would
      // flip the sign of every correctly-mapped deposit. Skip it.
      && !isCashCredit
    ) {
      const sign = amount < 0 ? -1 : 1;
      const m = Math.abs(amount);
      const b = Math.abs(pending.balance);
      const errFor = (newAmt: number, newBal: number) =>
        Math.abs((lastBalance! + newAmt) - newBal);

      type Candidate = { amount: number; balance: number; err: number; kind: string };
      const asIs: Candidate = {
        amount, balance: pending.balance,
        err: errFor(amount, pending.balance), kind: 'as-is',
      };
      const candidates: Candidate[] = [
        asIs,
        // Sign flip (credit mis-clustered as debit, or vice versa).
        { amount: -amount, balance: pending.balance,
          err: errFor(-amount, pending.balance), kind: 'flip' },
        // Swap (amount and balance values landed in each other's
        // columns), keeping original sign.
        { amount: sign * b, balance: m,
          err: errFor(sign * b, m), kind: 'swap' },
        // Swap + flip.
        { amount: -sign * b, balance: m,
          err: errFor(-sign * b, m), kind: 'swap+flip' },
        // 2026-06: Balance-delta candidate. Catches the case where the
        // printed amount cell is fundamentally wrong — not a column
        // swap or sign flip but a different value entirely. Observed
        // on J&K Bank wrapped-narration rows where the next/previous
        // row's amount cell drifts onto the current row's y-band.
        //
        // Reproducible locally (scripts/jkbank-find-source.mts):
        //   Row 19 (MASHOOQ) — pdfjs cluster gives D=2,000 but the
        //   balance trajectory says the row is W=53,610. flip/swap
        //   candidates can't close the err; only the delta candidate
        //   does.
        //
        // Delta-derived amount = balance(N) − balance(N-1). Always
        // err=0 by construction when both balances are correct.
        // Strict gate (`asIs.err > 1`) prevents this from over-
        // correcting rows where the printed amount agrees with delta
        // within paisa rounding noise — paisa-level interest calcs
        // would otherwise get silently rewritten.
        { amount: pending.balance - lastBalance!, balance: pending.balance,
          err: 0, kind: 'delta' },
      ];
      let best = asIs;
      for (const c of candidates) if (c.err < best.err) best = c;
      if (asIs.err > 1 && best.err < 0.05 && best !== asIs) {
        amount = best.amount;
        pending.balance = best.balance;
      }
    }

    if (amount == null || !Number.isFinite(amount)) {
      stats.skippedNoAmount += 1;
      pending = null;
      return;
    }

    out.push({
      date: pending.date,
      narration: pending.narration || '',
      voucher: pending.voucher,
      reference: pending.reference,
      amount,
      balance: pending.balance,
      account: pending.account,
    });
    if (pending.balance != null) lastBalance = pending.balance;
    pending = null;
  };

  for (const row of grid.rows) {
    const cell = (role: ColumnRole) => {
      const i = colByRole.get(role);
      return i === undefined ? '' : (row[i] ?? '').trim();
    };

    const accountCell = cell('account');
    if (accountCell) lastAccount = accountCell;

    if (kind === 'ledger') {
      // Ledger-side page subtotal / carry-forward rows. Busy prints
      // "Totals C/F" / "Totals B/F" with aggregate values that look
      // structurally like a transaction — without flushing here, the
      // continuation-merge below absorbs those aggregates into the
      // previous transaction's pending block, doubling its amount or
      // overwriting its balance. Marg's "Balance c/f:" and Tally's
      // "Carried Over" / "Continued.." do the same. Treat as
      // non-transaction noise: flush whatever was pending so we don't
      // pollute it, then skip the row.
      const ledgerSubtotalHaystack = `${cell('narration')} ${cell('voucher')} ${cell('reference')}`.trim();
      if (!parseDate(cell('date'), inferredYear ?? undefined) && LEDGER_SUBTOTAL_MARKER.test(ledgerSubtotalHaystack)) {
        flushPending();
        prevRowWasAccountHeader = false;
        stats.skippedNoAmount += 1;
        continue;
      }

      // Tally page-total rows: date-less, narration-less, voucher-less
      // rows where debit AND credit (or amount) are both populated
      // with currency-shape values. These are the per-page subtotal
      // rows printed at the bottom of every Tally account-page (e.g.
      // r15 = "debit=1,09,098.00 credit=1,09,098.00" everything else
      // empty). LEDGER_SUBTOTAL_MARKER doesn't catch them because the
      // marker word ("Totals" / "Carried Over") sits in cells that
      // the columnHeaders didn't classify as narration/voucher/ref —
      // these rows have NO marker word at all, just the totals.
      //
      // Without this guard the continuation-merge below absorbs the
      // page-total numbers into the previous transaction's pending,
      // and worse, the row stays date-less so the account-header gate
      // (pending===null below) never fires on the NEXT page's banner
      // — every account after the first ends up swallowed under the
      // running lastAccount or the next phantom name detected (Tally's
      // "continued ..." page footer).
      const dateParsedForPageTotal = parseDate(cell('date'), inferredYear ?? undefined);
      if (!dateParsedForPageTotal && !cell('narration') && !cell('voucher') && !cell('reference')) {
        const pageDebit = parseNumber(cell('debit'));
        const pageCredit = parseNumber(cell('credit'));
        if (pageDebit && pageCredit) {
          flushPending();
          prevRowWasAccountHeader = false;
          stats.skippedNoAmount += 1;
          continue;
        }
      }

      // Page-continuation marker detection. When we see a date-less
      // row containing "( Contd. )" OR Tally's "continued..N" /
      // "continued ..." footer anywhere in its text, set the
      // continuation flag — every subsequent date-less row is part
      // of the same page-continuation block (city, banner, repeated
      // column header, Totals B/F) and must NOT create a new
      // account. The flag clears when we see a real dated
      // transaction, signalling the block is over and we're back
      // in the previous account's data.
      const dateRawForContd = cell('date');
      const dateParsedForContd = parseDate(dateRawForContd, inferredYear ?? undefined);
      const allRowText = row.map(c => (c ?? '').trim()).filter(Boolean).join(' ');
      if (!dateParsedForContd && (/\(\s*contd\.?\s*\)/i.test(allRowText) || /\bcontinued\s*(?:\.{2,}|\d+)/i.test(allRowText))) {
        flushPending();
        inContinuationBlock = true;
        prevRowWasAccountHeader = false;
        stats.accountHeaders += 1;
        continue;
      }
      if (inContinuationBlock) {
        if (dateParsedForContd) {
          // Block is over — fall through to normal transaction
          // processing on this row. lastAccount stays unchanged
          // (continuation page belongs to the same account).
          inContinuationBlock = false;
        } else {
          // Still inside the block — skip city / banner / column
          // header / Totals B/F rows without touching lastAccount.
          continue;
        }
      }

      // Account-header detection ONLY when there's no in-flight
      // transaction. A row with no date, no debit/credit, and a
      // string of text matches both the "wrapped continuation of the
      // previous narration" AND the "new account header" patterns —
      // we can only tell them apart by context. Inside a transaction
      // (pending != null), every date-less row should be treated as
      // a continuation; account headers only appear AFTER the prior
      // transaction has been flushed (which happens on a new dated
      // row, on a totals row above, or at the end of the loop).
      // Without this gate, every "BS/25-26/41 dt. 02-02-2026"
      // continuation row in a Busy bill-narration produced a phantom
      // account, ballooning the audit's account count from ~30 real
      // accounts to "677 accounts" of which most were bill numbers.
      if (pending === null) {
        const headerName = detectAccountHeader(row, colByRole, inferredYear ?? undefined, bannerTexts);
        if (headerName) {
          // If the previous row was also an account header, this is
          // the second line of a multi-line Busy header (city /
          // branch under the company name) — concatenate so we keep
          // both.
          lastAccount = prevRowWasAccountHeader && lastAccount
            ? `${lastAccount} — ${headerName}`
            : headerName;
          prevRowWasAccountHeader = true;
          stats.accountHeaders += 1;
          continue;
        }
      }
      prevRowWasAccountHeader = false;
    }

    const dateRaw = cell('date');
    const date = parseDate(dateRaw, inferredYear ?? undefined);
    const narr = cell('narration');
    const debit = parseNumber(cell('debit'));
    const credit = parseNumber(cell('credit'));
    const amountSingle = parseNumber(cell('amount'));
    const drCrMarker = cell('drCrMarker');
    // Tally prints the running balance as an unsigned magnitude with
    // a "Dr" or "Cr" suffix, e.g. "1,08,560.00 Cr" or "19,500.00 Dr".
    // parseNumber strips the suffix and returns just the magnitude
    // — which loses the direction. For a Cr-side account (liability,
    // income, payable) that means the closing fallback in
    // mappedRowsToExtractedLedger reads `+24,46,194` when the
    // running balance is "24,46,194.00 Cr" (audit convention is
    // negative for a Cr balance). Result: 20+ phantom RECON_BREAK
    // observations on the user's 196-account ledger, every one with
    // a "magnitudes match but signs opposite" gap (Make My Trip,
    // Virendra Kesar, ANK HOTEL, Trishul Traders, etc.).
    //
    // Sign the balance using the suffix on the raw cell text. Bank
    // statements don't use this convention (they emit signed amounts
    // or rely on a separate drCrMarker column), so gate to ledgers.
    const balanceRaw = cell('balance');
    let balance = parseNumber(balanceRaw);
    if (kind === 'ledger' && balance != null) {
      if (/\bcr\.?\s*$/i.test(balanceRaw)) balance = -Math.abs(balance);
      else if (/\bdr\.?\s*$/i.test(balanceRaw)) balance = Math.abs(balance);
      // No suffix → keep parseNumber's value as-is. Edge case for
      // Tally exports where the suffix didn't render; rare enough
      // not to matter, and the closing-balance marker path
      // (closingFromMarker in mappedRowsToExtractedLedger) is the
      // authoritative source when an explicit closing row exists.
    }
    const voucher = cell('voucher') || null;
    const reference = cell('reference') || null;

    // Bank-statement subtotal / running-total / carry-forward rows.
    // Banks print rows like "Page Total", "Grand Total", "Carried
    // Forward", "B/F", "Opening Balance", "Closing Balance" inside
    // the transaction table — they look structurally identical to
    // a real transaction (often with aggregate amounts in the
    // debit/credit/balance columns) but aren't txns. Without this
    // guard, the continuation-merge logic below absorbs their
    // numbers into the previous transaction's pending block,
    // inflating its amount or balance.
    //
    // Match against narration + voucher + reference (whichever cell
    // the bank put the label in) but only when the row has NO
    // parseable date — a real transaction with "Total" in the
    // counterparty name (e.g. "TOTAL ENERGIES PVT LTD") still has
    // a date and passes through.
    //
    // Bank-only because mappedRowsToExtractedLedger relies on the
    // Tally "Opening Balance" row staying in the mapped output to
    // populate accounts[].opening; skipping it here would zero out
    // every ledger's opening and re-introduce the false-positive
    // §269SS / RECON_BREAK observations that fix targeted.
    if (kind === 'bank') {
      // 2026-06: Expanded marker to cover J&K Bank CC statement (cc204
      // case) footer + banner phrases. The bank prints a per-page
      // footer block (`Effective Available Amount`, `Funds in
      // clearing`, `Total available Amount`, `FFD Contribution`,
      // `Unless the constituent notifies the bank...`) AND a page
      // header banner (`Transaction Details`, `Page X of Y`,
      // `TYPE: CASH CREDIT SCHEME`, `STATEMENT OF ACCOUNT FOR THE
      // PERIOD`, `Printed By NNNN (NNNN)`). Without filtering each of
      // these gets parsed as a date-less transaction row, the wizard
      // then runs the balance-delta fallback on it, and a ~₹15-Lakh
      // phantom amount lands on each one (the row's "balance" cell
      // captures a partial number from the surrounding text — often
      // just "6" or "0" — and the delta vs the previous real
      // balance becomes the phantom amount).
      //
      // Observed effect on cc204.pdf (167 pages): inflated INFLOW &
      // OUTFLOW each by ~₹6.7 Cr vs the bank's printed Grand Total
      // of ₹39.5 L / ₹39.4 L.
      const SUBTOTAL_MARKER = /\b(grand\s+total|sub[- ]?total|page\s+total|carr(?:y|ied)\s+forward|brought\s+forward|opening\s+balance|closing\s+balance|c\.?\s*\/\.?\s*f\.?|b\.?\s*\/\.?\s*f\.?|^\s*total\b|effective\s+available\s+amount|total\s+available\s+amount|funds\s+in\s+clearing|ffd\s+contribution|unless\s+the\s+constituent|transaction\s+details|statement\s+of\s+account\s+for\s+the\s+period|printed\s+by\s+\d|^page\s+\d+\s+of\s+\d|type\s*:\s*cash\s+credit|cash\s+credit\s+scheme|interest\s+rate\s*:|no\s+nomination|^a\/c\s+no|^ifsc\s+code|^micr\s+code|^phone\s+code)/i;
      // Strictly unambiguous markers — fire even when a date is
      // present (because pdfjs's y-band clustering on J&K Bank CC
      // pages fuses the "Page Total:" footer row with the next
      // page's first transaction date, producing a grid row that has
      // a date AND the Page Total values). These tokens never appear
      // in legitimate transaction narrations.
      const UNAMBIGUOUS_MARKER = /\b(?:page\s+total|grand\s+total|effective\s+available\s+amount|total\s+available\s+amount|funds\s+in\s+clearing|ffd\s+contribution|unless\s+the\s+constituent|type\s*:\s*cash\s+credit|cash\s+credit\s+scheme|statement\s+of\s+account\s+for\s+the\s+period|transaction\s+details|printed\s+by\s+\d|page\s+\d+\s+of\s+\d|ifsc\s+code|micr\s+code|phone\s+code|a\/c\s+no|no\s+nomination\s+available|interest\s+rate|jammu\s+and\s+kashmir\s+bank|ckyc\s+id|cKYC|chand\s+nagar)|https?:\/\/|\.jsp\b|\.jkb\.com/i;
      const haystack = `${narr} ${voucher ?? ''} ${reference ?? ''}`.trim();
      // J&K Bank CC pages split "Page Total :" across two adjacent
      // pdfjs cells ("Page" in the narration column, "Total:" in the
      // skip column), so the marker isn't visible in the narration-
      // alone haystack. Build a wider haystack from every cell of
      // the raw row so the marker fires regardless of column split.
      const rowHaystack = row.map(c => (c ?? '').trim()).filter(Boolean).join(' ');
      if ((!date && SUBTOTAL_MARKER.test(haystack)) || UNAMBIGUOUS_MARKER.test(haystack) || UNAMBIGUOUS_MARKER.test(rowHaystack)) {
        // Only flush pending if it already has an amount. J&K Bank CC
        // statements split a single transaction across a page boundary:
        // the date row sits at the bottom of page N (so pending gets
        // date+narration only), then the Page Total + page banner rows
        // intervene, then the continuation row (with amount + balance)
        // appears on page N+1. If we flush here unconditionally, the
        // incomplete pending gets emitted as skippedNoAmount and the
        // continuation row on the next page has nothing to attach to —
        // the entire transaction is lost. Preserving incomplete pending
        // across the marker block lets the continuation finish the
        // transaction normally.
        if (pending && pending.debit == null && pending.credit == null && pending.amountSingle == null && pending.balance == null) {
          // incomplete — keep alive across the page boundary, but
          // gate subsequent merges so page-banner noise (addresses,
          // pincodes, "Printed By...") can't pollute pending.
          pendingAwaitingCrossPage = true;
        } else {
          flushPending();
        }
        stats.skippedNoAmount += 1;
        continue;
      }
      // Implausible-balance guard. On J&K Bank CC pages, the
      // balance-column value picked up from a footer fragment is
      // often a 1-2 digit residue ("6", "10"). Real CC balances on
      // this account are ₹15-Lakh-scale (the customer's credit
      // line). Any balance value below ₹100 on a date-less row is
      // almost certainly extracted noise — drop the row before the
      // balance-delta fallback can turn it into a ₹15L phantom.
      if (!date && balance != null && Math.abs(balance) < 100) {
        flushPending();
        stats.skippedNoAmount += 1;
        continue;
      }
    }

    // Date-less Opening / Closing Balance row with no prior pending.
    // Finsys exports print "Balance B/f" at the top of each page with
    // no date column populated and only the running balance in col 5.
    // After the Finsys preprocess these come through as
    //   date='', narration='Opening Balance', balance=<signed>,
    //   debit=null, credit=null
    // and the "date && pending" branches both fall through, dropping
    // the row silently. Synthesise a FY-start date so it becomes a
    // proper transaction; flushPending's opening-balance rescue then
    // emits it with amount=0 and mappedRowsToExtractedLedger picks
    // it up as the account's opening via balance.
    if (
      !date
      && !pending
      && kind === 'ledger'
      && balance != null
      && /^\s*(?:-\s*)?(?:to\s+|by\s+)?(?:opening|closing)\s+balance\s*$/i.test(narr ?? '')
      && inferredYear != null
    ) {
      pending = {
        // Indian FY runs Apr → Mar. Opening Balance lands on day 1
        // of the FY start year; closing on day 1 of FY+1. The exact
        // day doesn't affect totals, only date sorting.
        date: /closing/i.test(narr) ? `${inferredYear + 1}-03-31` : `${inferredYear}-04-01`,
        narration: narr,
        voucher,
        reference,
        debit,
        credit,
        amountSingle,
        drCrMarker,
        balance,
        account: lastAccount,
      };
      continue;
    }

    if (date) {
      // New transaction starts. Flush whatever was pending. Clear
      // the cross-page guard — if the awaited continuation never
      // arrived (page banner is unusually long, or the bank skipped
      // a continuation row entirely), abandoning pending here means
      // the previous transaction is lost as `skippedNoAmount`, which
      // is the correct outcome (better than corrupting it with
      // banner noise).
      pendingAwaitingCrossPage = false;
      flushPending();
      pending = {
        date,
        narration: narr,
        voucher,
        reference,
        debit,
        credit,
        amountSingle,
        drCrMarker,
        balance,
        account: lastAccount,
      };
    } else if (pending) {
      // Cross-page-boundary guard. When the previous page ended with
      // an incomplete pending block (date+narration but no amount)
      // the next page's banner — bank address, pincode, "Printed
      // By...", account-no echo — sits between us and the real
      // continuation row. Those banner rows don't match the marker
      // regex but they DO have stray numeric noise that would
      // corrupt pending if merged. While the awaiting flag is set,
      // only accept rows that look like a real continuation: no
      // date, a Dr/Cr-suffixed balance >= ₹1,000, and a non-zero
      // amount in either debit or credit. Otherwise skip silently.
      if (pendingAwaitingCrossPage) {
        // The Dr/Cr suffix is often rendered in a separate styled
        // text run on bank PDFs, so pdfjs sometimes hands us the
        // balance number WITHOUT the suffix even when the visual PDF
        // shows it attached. Accept any balance ≥ ₹1,000 with a
        // non-zero amount as evidence of a real continuation.
        const hasValidBalance = balance != null && Math.abs(balance) >= 1000;
        const hasAmount =
          (debit != null && debit !== 0) || (credit != null && credit !== 0);
        if (!hasValidBalance || !hasAmount) {
          stats.skippedNoAmount += 1;
          continue;
        }
        // legitimate continuation found — clear the guard so normal
        // merging proceeds.
        pendingAwaitingCrossPage = false;
      }
      // Continuation row — fill in any missing fields on the
      // pending transaction. Narration concatenates; numeric fields
      // take the first non-null/non-zero value (so a separately-
      // rendered amount row supplies the amount the date row was
      // missing).
      //
      // CONTRA-DETAIL guard (Tally-style multi-row vouchers).
      // Some Tally exports list each voucher's contra-account
      // breakdown on the lines immediately below the parent row:
      //   10-Jun-24  By (as per details)  Purchase  60        1,08,560.00  1,08,560.00 Cr
      //              Furniture & Fixtures                     92,000.00 Dr
      //              IGST INPUT                               16,560.00 Dr
      //              Metal Frames purchased for…
      // Rows 2-3 are NOT separate transactions — they're the
      // contra-account split of the same voucher, shown for
      // information only. The amounts there carry a "Dr" / "Cr"
      // suffix to indicate which side of the contra account they
      // posted to. The legit transaction amount on the parent row
      // does NOT carry a suffix in debit/credit columns (only the
      // balance column does — that's a separate Tally convention).
      //
      // Without this guard, parseNumber strips the "Dr" suffix and
      // hands the continuation merge below "92,000.00", which then
      // overwrites the parent voucher's debit field — corrupting a
      // pure-credit purchase entry into a credit+debit pair. The
      // user described this as "balance is being considered in
      // rows": the contra-detail amounts were polluting the
      // pending block.
      //
      // Detection: the RAW cell text of debit or credit (NOT the
      // parsed number) ends with "Dr" / "Cr" — that's the contra-
      // detail suffix. When matched, fold the breakdown into the
      // narration (so the audit still sees "Furniture & Fixtures
      // 92,000.00 Dr") but do NOT update pending.debit / credit /
      // balance. Bank statements never produce this pattern, so
      // this is ledger-only.
      const rawDebitCell = cell('debit');
      const rawCreditCell = cell('credit');
      const SUFFIX_DR_CR_NUMERIC = /[\d.,]\s*(?:dr|cr)\.?$/i;
      const isContraDetail =
        kind === 'ledger' &&
        (SUFFIX_DR_CR_NUMERIC.test(rawDebitCell) || SUFFIX_DR_CR_NUMERIC.test(rawCreditCell));

      // New-voucher-same-date detection. Tally elides the date on a
      // row when it matches the previous row's date — so a second
      // journal entry on the same day comes through as a date-less
      // row with its own Vch No and its own debit/credit. Without
      // the check below, this gets folded into the previous voucher's
      // pending block: the two amounts merge, hasBoth fires in
      // flushPending, and the result is a phantom "two transactions
      // sharing the prior row's narration with opposite signs"
      // (Aagman r11+r13: By Repair Cr 538 / To Cash Dr 538 both
      // appeared at 2024-10-22 with the merged narration).
      //
      // Signal: the row has a fresh reference (Vch No) that differs
      // from pending.reference AND a real amount (debit/credit set).
      // Contra-detail rows don't have their own Vch No (Tally
      // suppresses it on the breakdown lines), so this only fires
      // on legitimate new vouchers. Inherit the date and account
      // from pending so the new voucher gets attributed to the right
      // day and ledger account.
      const isNewVoucherSameDate =
        kind === 'ledger' &&
        !isContraDetail &&
        !!reference &&
        !!pending.reference &&
        reference !== pending.reference &&
        (debit != null && debit !== 0 || credit != null && credit !== 0);

      // Closing-Balance pseudo-row. Tally writes "By Closing Balance"
      // / "To Closing Balance" at the END of each account to zero it
      // out for FY rollover — it's NOT a real transaction, it's the
      // contra-entry that closes the running balance. Like a new
      // voucher, it has its own narration + amount but no Vch No
      // (Tally suppresses the reference on closing rows). Without
      // the check below, it merges into the previous transaction's
      // pending block (Bug 3's new-voucher check doesn't fire
      // because there's no fresh reference), then hasBoth in
      // flushPending splits it into a duplicate pair.
      //
      // Emit it as its own pseudo-transaction so
      // mappedRowsToExtractedLedger can pull it out and use its
      // amount as the account's closing balance.
      const isClosingBalanceRow =
        kind === 'ledger' &&
        /^(?:to\s+|by\s+)?closing\s+balance\b/i.test(narr ?? '');

      // Conflicting-amount detection — covers Tally exports that
      // present multiple bills on the same date with NO Vch No.
      // column (OSPL Future Energy / Customer ledger variant). Each
      // "Bill No. xxx" row in the Jun 24 block has its own credit
      // amount but no Vch No. for Bug 3 to compare. Without this
      // check, the continuation-merge below silently drops every
      // bill after the first (because `pending.credit` is already
      // set, the `(pending.credit == null || === 0)` gate skips the
      // assignment), losing ~9 out of every 10 transactions on dense
      // days. Symptom: applyMapping reports 74 txns when the source
      // has 250+; recon gap of crores.
      //
      // Signal: pending has a non-zero debit OR credit AND this
      // row has a same-side non-zero amount AND its own narration.
      // The narration requirement is the key disambiguator from
      // Tally Hotel Holiday Inn-style debit-side subtotal rows that
      // print just a number with no narration / voucher / reference
      // (e.g. the bare "19,500.00" total row that sits between
      // r120 "To Accounting Fee Payable" and r124 "By Closing
      // Balance"). Bills always have a description; pure subtotal
      // rows never do, so requiring `narr` to be set keeps both
      // formats happy.
      const isConflictingAmount =
        kind === 'ledger' &&
        !isContraDetail &&
        !!narr &&
        (
          (debit != null && debit !== 0 && pending.debit != null && pending.debit !== 0) ||
          (credit != null && credit !== 0 && pending.credit != null && pending.credit !== 0)
        );

      // Opposite-side-amount detection — covers the OSPL Marg pattern
      // where a bill row (Credit only) is immediately followed on the
      // same date by a payment row (Debit only). Both rows have their
      // own narrations and amounts; they're TWO separate transactions
      // visually rendered without a date repeat on the payment row.
      //
      // Without this guard the continuation-merge below absorbs the
      // payment's debit + balance into the bill's pending block, then
      // `hasBoth` in flushPending splits the merged row into two
      // transactions that BOTH carry the merged narration. The bill
      // matcher then sees "OS64/25-26000708" in both narrations and
      // sums the amounts — producing a fake ₹40,00,000 mismatch on
      // every bill-followed-by-payment pair on the OSPL Marg ledger.
      //
      // Signal: pending has a Cr-only OR Dr-only amount AND the current
      // row has a non-zero amount on the OPPOSITE side AND its own
      // narration. The narration requirement disambiguates from
      // legitimate contra-detail breakdown rows that don't carry their
      // own description.
      const pendingOnlyCr = pending.credit != null && pending.credit !== 0
        && (pending.debit == null || pending.debit === 0);
      const pendingOnlyDr = pending.debit != null && pending.debit !== 0
        && (pending.credit == null || pending.credit === 0);
      const currentOnlyDr = debit != null && debit !== 0
        && (credit == null || credit === 0);
      const currentOnlyCr = credit != null && credit !== 0
        && (debit == null || debit === 0);
      const isOppositeSideAmount =
        kind === 'ledger' &&
        !isContraDetail &&
        !!narr &&
        ((pendingOnlyCr && currentOnlyDr) || (pendingOnlyDr && currentOnlyCr));

      if (isNewVoucherSameDate || isClosingBalanceRow || isConflictingAmount || isOppositeSideAmount) {
        const inheritedDate = pending.date;
        const inheritedAccount = pending.account;
        flushPending();
        pending = {
          date: inheritedDate,
          narration: narr,
          voucher: isClosingBalanceRow ? null : voucher,
          reference: isClosingBalanceRow ? null : reference,
          debit,
          credit,
          amountSingle,
          drCrMarker,
          balance,
          account: inheritedAccount,
        };
        continue;
      }

      if (narr) {
        // For contra-detail rows, fold the breakdown row into the
        // narration in a parseable form so downstream audits / GST
        // recon can read the contra split if they need to. The
        // suffix is preserved.
        const tail = isContraDetail
          ? [narr, rawDebitCell, rawCreditCell].filter(Boolean).join(' ').trim()
          : narr;
        pending.narration = pending.narration ? `${pending.narration} ${tail}`.trim() : tail;
        stats.mergedContinuations += 1;
      }
      if (!isContraDetail) {
        if ((pending.debit == null || pending.debit === 0) && debit != null && debit !== 0) {
          pending.debit = debit;
        }
        if ((pending.credit == null || pending.credit === 0) && credit != null && credit !== 0) {
          pending.credit = credit;
        }
        if (pending.amountSingle == null && amountSingle != null) pending.amountSingle = amountSingle;
        if (!pending.drCrMarker && drCrMarker) pending.drCrMarker = drCrMarker;
        if (pending.balance == null && balance != null) pending.balance = balance;
      }
      if (!pending.voucher && voucher) pending.voucher = voucher;
      if (!pending.reference && reference) pending.reference = reference;
    } else if (narr || debit != null || credit != null) {
      // Pre-first-transaction noise (header rows, page metadata).
      // Nothing pending to merge into; ignore.
      stats.mergedContinuations += narr ? 1 : 0;
    }
  }

  // Flush the last block.
  flushPending();

  stats.transactions = out.length;
  return { rows: out, stats };
}

export interface ExtractedLedgerLike {
  partyName: string | null;
  gstin: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  accounts: Array<{
    name: string;
    accountType: string | null;
    opening: number;
    closing: number;
    totalDebit: number;
    totalCredit: number;
    transactions: Array<{
      date: string | null;
      narration: string | null;
      voucher: string | null;
      debit: number;
      credit: number;
      balance: number | null;
    }>;
  }>;
}

/** Group mapped rows into the ExtractedLedger shape the ledger-scrutiny
 *  /upload endpoint accepts on its `preExtracted` body. Rows with no
 *  account (single-account ledger or rows before any "Account: X"
 *  header) are bucketed under "Default". Opening balance is left at 0
 *  — the audit prompt's reconciliation check tolerates a starting
 *  point of zero, and the precise opening can be recovered by the user
 *  from the source PDF if needed. */
export function mappedRowsToExtractedLedger(
  rows: MappedRow[],
  /** Used when applyMapping never set an account context — single-
   *  account exports (Tally / Finsys "Ledger Account : <NAME>"
   *  banners with one party) don't have account-separator rows
   *  because they don't need them; the party name lives in the
   *  banner. Caller passes that name here so the resulting
   *  accounts[0].name is meaningful instead of literal 'Default'. */
  defaultAccountName?: string,
): ExtractedLedgerLike {
  const byAccount = new Map<string, MappedRow[]>();
  for (const r of rows) {
    const key = r.account ?? defaultAccountName ?? 'Default';
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(r);
  }
  const accounts = Array.from(byAccount.entries()).map(([name, txs]) => {
    // Detect and pull out the Tally-style "Opening Balance" row.
    // Without this, the opening balance gets summed into totalDebit
    // (or totalCredit), and the audit prompt sees opening=0 — which
    // surfaces as phantom RECON_BREAK flags ("opening + debits −
    // credits ≠ closing") and worse, treats brought-forward
    // creditor balances as current-year acceptances under §269SS /
    // §68. Both classes of false-positive observations originate
    // from this one parser bug.
    //
    // Tally prints opening as a row whose narration is literally
    // "Opening Balance" (matching is case-insensitive, allows
    // optional dash prefix). The amount can be on the debit OR
    // credit side; we derive the SIGNED opening from t.amount.
    //
    // Sign convention: applyMapping emits amount = -|debit| for a
    // Dr row, +|credit| for a Cr row. The audit's "opening + debits
    // − credits = closing" formula expects opening to be POSITIVE
    // for a Dr-side opening (asset / expense balance carried
    // forward) and NEGATIVE for a Cr-side opening (liability /
    // income balance). Those are the opposite of applyMapping's
    // convention — so we negate.
    //
    // We don't fall back to t.balance: parseNumber strips Tally's
    // "Dr" / "Cr" suffix, leaving an unsigned magnitude that
    // can't distinguish a Dr balance from a Cr balance. t.amount
    // carries the Dr/Cr orientation correctly via its sign, so it's
    // the more reliable source.
    let opening = 0;
    let openingIdx = -1;
    // Anchored to "Opening Balance" exactly (no B/F suffix). The
    // Busy export uses "Opening Balance B/F" as a real Dr transaction
    // (double-entered with an offsetting "O/Bal TRF TO CAPITAL" Cr on
    // the same day) — pulling it out as the account's opening would
    // create a phantom Cr-only side that breaks recon. Tally writes
    // "Opening Balance" exactly, so the narrow regex catches the
    // Tally case without disturbing Busy.
    if (txs.length > 0 && /^\s*(?:-\s*)?(?:to\s+|by\s+)?opening\s+balance\s*$/i.test(txs[0].narration ?? '')) {
      const t = txs[0];
      // Two Tally source shapes:
      //   - Hotel Holiday Inn: opening as a Dr or Cr row.
      //     t.amount carries the value, signed as `credit - debit`
      //     in applyMapping's convention. Audit wants Dr-positive,
      //     so negate.
      //   - OSPL Future Energy: opening only in the balance column
      //     with a Dr/Cr suffix. applyMapping emits this with
      //     amount=0 (rescued from the null-amount skip), so we
      //     fall back to t.balance which carries the signed opening
      //     directly (Dr positive, Cr negative — see the Dr/Cr
      //     suffix preservation in applyMapping).
      opening = t.amount !== 0 ? -t.amount : (t.balance ?? 0);
      openingIdx = 0;
    }
    // Tally also emits a "To Closing Balance" / "By Closing Balance"
    // row at the END of each account to zero it out for FY rollover.
    // It's not a real transaction — it's the journal entry that
    // closes the account. Recognise it the same way as the opening:
    // pull it out of the txn list, and use the audit-convention
    // signed value as the closing balance.
    //
    // "By Closing Balance" Cr X (closes a Dr-side acct holding Dr X)
    //   → applyMapping amount = +X, audit closing = +X (Dr positive)
    // "To Closing Balance" Dr X (closes a Cr-side acct holding Cr X)
    //   → applyMapping amount = -X, audit closing = -X (Cr negative)
    // In both cases closing = t.amount (NO negation — opposite of
    // opening, because closing rows are the contra-entry that
    // matches the account's standing side, not the new-year carry).
    let closingFromMarker: number | null = null;
    const afterOpening = openingIdx === 0 ? txs.slice(1) : txs;
    if (afterOpening.length > 0) {
      const last = afterOpening[afterOpening.length - 1];
      if (/^\s*(?:to\s+|by\s+)?closing\s+balance\s*$/i.test(last.narration ?? '')) {
        closingFromMarker = last.amount;
      }
    }
    const realTxs = closingFromMarker != null
      ? afterOpening.slice(0, -1)
      : afterOpening;

    let totalDebit = 0;
    let totalCredit = 0;
    for (const t of realTxs) {
      if (t.amount < 0) totalDebit += Math.abs(t.amount);
      else totalCredit += t.amount;
    }
    const closing = closingFromMarker != null
      ? closingFromMarker
      : realTxs.length > 0
        ? (realTxs[realTxs.length - 1].balance ?? 0)
        : opening;
    return {
      name,
      accountType: null,
      opening,
      closing,
      totalDebit,
      totalCredit,
      transactions: realTxs.map(t => ({
        date: t.date,
        narration: t.narration,
        voucher: t.voucher,
        debit: t.amount < 0 ? Math.abs(t.amount) : 0,
        credit: t.amount > 0 ? t.amount : 0,
        balance: t.balance,
      })),
    };
  });
  const allDates = rows.map(r => r.date).filter((d): d is string => !!d).sort();
  return {
    partyName: null,
    gstin: null,
    periodFrom: allDates[0] ?? null,
    periodTo: allDates[allDates.length - 1] ?? null,
    accounts,
  };
}

/** Build a CSV string ready for the existing /api/bank-statements
 *  csvText path (separate debit/credit columns + balance). The server
 *  parses these column names verbatim, so the header line is fixed. */
export function mappedRowsToBankCsv(rows: MappedRow[]): string {
  const header = 'date,narration,debit,credit,balance';
  const escape = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map(r => {
    const debit = r.amount < 0 ? Math.abs(r.amount).toFixed(2) : '';
    const credit = r.amount > 0 ? r.amount.toFixed(2) : '';
    return [
      r.date ?? '',
      escape(r.narration),
      debit,
      credit,
      r.balance != null ? r.balance.toFixed(2) : '',
    ].join(',');
  });
  return [header, ...lines].join('\n');
}

/**
 * Find where the actual transaction table starts in the grid.
 *
 * Indian bank statements (and Tally / Busy ledger exports) print a
 * meta block before the data: customer name, address, IFSC code,
 * account type, statement period, etc. — typically 8-20 rows. The
 * wizard's preview is useless if it shows those rows instead of
 * actual transactions, and the user can't verify their column
 * mapping until they see real data.
 *
 * Strategy:
 *   1. Look for a row that contains 2+ recognisable column-header
 *      words ("Date", "Narration", "Particulars", "Withdrawal",
 *      "Deposit", "Debit", "Credit", "Balance", "Chq", "Voucher").
 *      That's the table header row.
 *   2. If a date column is mapped, the first transaction row is
 *      the first row after the header where that column parses
 *      as a date. Otherwise it's the row right after the header.
 *   3. If no header row matches (uncommon — usually means the table
 *      starts on page 2), fall back to the first row whose date
 *      column parses as a date.
 *
 * Returns null when neither approach finds a transaction table —
 * the caller renders a friendly "couldn't auto-detect" hint and
 * shows the raw grid.
 */
export function findTableStart(grid: PdfGrid, dateCol: number | null): {
  headerRowIndex: number | null;
  firstDataRowIndex: number;
  skippedCount: number;
} | null {
  const HEADER_TOKENS = /\b(date|narration|particulars|description|withdraw\w*|deposit\w*|debit|credit|balance|chq|cheque|voucher|amount)\b/i;
  let headerRowIndex: number | null = null;
  for (let i = 0; i < grid.rows.length; i++) {
    const matches = grid.rows[i].filter(c => c && HEADER_TOKENS.test(c)).length;
    if (matches >= 2) { headerRowIndex = i; break; }
  }

  let firstDataRowIndex = headerRowIndex !== null ? headerRowIndex + 1 : 0;
  if (dateCol !== null) {
    for (let i = firstDataRowIndex; i < grid.rows.length; i++) {
      if (parseDate(grid.rows[i][dateCol] ?? '')) {
        firstDataRowIndex = i;
        break;
      }
    }
  }

  if (firstDataRowIndex >= grid.rows.length) return null;
  return {
    headerRowIndex,
    firstDataRowIndex,
    skippedCount: firstDataRowIndex,
  };
}

/** Wrap a parsed CSV into the same PdfGrid shape the wizard expects.
 *  We don't have x/y coordinates but the wizard only uses .rows for
 *  preview and .columnCount for the dropdown count, so synthesizing
 *  the rest with placeholder values is fine. Caller is responsible
 *  for parsing CSV text into rows (e.g. via Papa.parse without
 *  header: true, since the wizard treats the first matching row as
 *  the header). */
export function rowsToFakeGrid(rows: string[][]): PdfGrid | null {
  const filtered = rows.filter(r => Array.isArray(r) && r.some(c => (c ?? '').trim()));
  if (filtered.length < 2) return null;
  const columnCount = Math.max(...filtered.map(r => r.length));
  const padded = filtered.map(r => {
    const out = [...r];
    while (out.length < columnCount) out.push('');
    return out;
  });
  // The first row of a CSV is almost always the header — promote it
  // to columnHeaders so suggestMapping can auto-assign roles the same
  // way it does for digital PDFs.
  const firstRow = padded[0];
  const looksLikeHeader = firstRow.some(c => /date|narration|particulars|debit|credit|balance|withdraw|deposit|amount|reference/i.test(c));
  return {
    rows: padded,
    columnCount,
    columnXs: Array.from({ length: columnCount }, (_, i) => i * 100),
    columnHeaders: looksLikeHeader
      ? firstRow.map(c => (c ?? '').trim() || null)
      : Array.from({ length: columnCount }, () => null as string | null),
    pageBreaks: [],
    pageCount: 1,
  };
}

/** Heuristic — guess each column's role from the first 3 rows and
 *  the column's median content. The wizard pre-fills with this and
 *  the user adjusts. Mandatory confirm step still applies — we never
 *  auto-submit. */
/**
 * Map a single header word to its semantic role. Returns null when
 * the header is too ambiguous to assign confidently.
 *
 * Order matters: more-specific patterns are checked first so
 * "Value Dt" doesn't match `/date/` and become the transaction Date,
 * "Closing Balance" doesn't match `/closing/` only, etc.
 */
function roleFromHeader(header: string): ColumnRole | null {
  const h = header.toLowerCase().trim();
  if (!h) return null;
  // "Value Date" / "Value Dt" / "Val Dt" — bank-internal posting date,
  // not the transaction date the user wants to report on. Skip so the
  // real Date column wins.
  if (/\bvalue\s*(?:date|dt)\b|\bval\.?\s*dt\b|\bposting\s*date\b/.test(h)) return 'valueDate';
  // "Closing Balance" / "Running Balance" / "Balance"
  if (/\b(closing|running)\s*bal\w*\b|^bal\w*$|^balance\b/.test(h)) return 'balance';
  // Withdrawal / Debit / Dr Amount
  if (/\b(withdraw\w*|debits?|dr\.?\s*amount|debit\s*amt)\b/.test(h)) return 'debit';
  // Deposit / Credit / Cr Amount
  if (/\b(deposit\w*|credits?|cr\.?\s*amount|credit\s*amt)\b/.test(h)) return 'credit';
  // Single signed amount column (when there's no separate dr/cr)
  if (/^amount$|^amt\.?$|\btxn\s*amount\b/.test(h)) return 'amount';
  if (/\bdr\s*\/\s*cr|type\s*\(dr\/cr\)|dr\/cr/.test(h)) return 'drCrMarker';
  // Cheque / Reference / UTR / Bill-No / Voucher-No / Invoice-No.
  // Distinct from narration so search/filter works on the long narration
  // text without matching reference numbers. Indian ledgers (Tally /
  // Busy / Marg) often have a "Vch No." or "Bill No." column right
  // after the Voucher Type — we want this column tagged as `reference`
  // so it isn't mis-detected as a numeric Debit column.
  if (/\b(chq\.?\s*(no|number|ref)?|cheque|ref\.?\s*no\.?|reference|utr|bill\.?\s*no\.?|invoice\s*no\.?|inv\.?\s*no\.?|vch\.?\s*no\.?|voucher\s*no\.?)\b/.test(h)) return 'reference';
  // Voucher type (Tally) — ledger only but harmless if assigned for bank.
  // Anchored without a number-suffix so "Vch No." goes to reference above.
  if (/\bvoucher\s*type|^vch\s*type$|\bvch\s*type\b|^type$|\bvoucher$/.test(h)) return 'voucher';
  // Account / ledger name (Tally party-wise book)
  if (/\baccount\b|^ledger$|party\s*name/.test(h)) return 'account';
  // Date — checked AFTER value-date so the real Date column wins
  if (/^date$|\btxn\s*date\b|\btransaction\s*date\b|^dt$/.test(h)) return 'date';
  if (/^narration|^particulars|^description|^details|^narrative$|remarks?$|transaction\s*remarks?/.test(h)) return 'narration';
  return null;
}

export function suggestMapping(grid: PdfGrid): ColumnMapping {
  const roles: ColumnRole[] = new Array(grid.columnCount).fill('skip');
  const sample = grid.rows.slice(0, Math.min(20, grid.rows.length));

  const colTexts: string[][] = Array.from({ length: grid.columnCount }, (_, c) =>
    sample.map(r => r[c] ?? ''),
  );

  // Track which roles have been assigned so we don't double-assign
  // (e.g. two columns both guessed as 'balance'). First-wins —
  // header order is left-to-right, which mirrors how every Indian
  // bank statement and Tally ledger lays out its table.
  const taken = new Set<ColumnRole>();

  for (let c = 0; c < grid.columnCount; c++) {
    // Prefer the per-column header captured at extraction time —
    // it's the actual header word that defined this column's
    // x-position, so it can't drift the way grid.rows.find()-based
    // detection can.
    const header = grid.columnHeaders?.[c] ?? '';
    const fromHeader = roleFromHeader(header);
    if (fromHeader && fromHeader !== 'skip' && !taken.has(fromHeader)) {
      roles[c] = fromHeader;
      taken.add(fromHeader);
      continue;
    }
    if (fromHeader === 'skip') {
      roles[c] = 'skip';
      continue;
    }

    // Fallback: look at the column's content.
    const texts = colTexts[c];
    const dateHits = texts.filter(t => DATE_LIKE_RE.test(t)).length;
    const numHits = texts.filter(t => NUMBER_RE.test(t) && !DATE_LIKE_RE.test(t)).length;
    if (dateHits >= sample.length * 0.4 && !taken.has('date')) {
      roles[c] = 'date';
      taken.add('date');
      continue;
    }
    // 2026-06: voucher/bill-number-shaped content. Indian ledgers
    // (Busy "PURCHASE" register, Tally daybook) emit a column like
    // "BBL/2025-26/21" or "IP-00291" or "INV-12345" right after
    // Voucher Type. Without this guard the column gets numHits=0
    // (it has dashes/slashes, fails the NUMBER_RE) and falls through
    // to skip — making the user re-tag it manually. Tag as `reference`
    // so the wizard pre-fills the right role.
    const refLike = texts.filter(t => /^[A-Z][A-Z0-9]{0,4}[\/\-]\d/.test(t.trim())).length;
    if (refLike >= sample.length * 0.4 && !taken.has('reference')) {
      roles[c] = 'reference';
      taken.add('reference');
      continue;
    }
    if (numHits >= sample.length * 0.4) {
      // Ambiguous numeric column — leave as skip; user picks.
      roles[c] = 'skip';
      continue;
    }
    const avgLen = texts.reduce((s, t) => s + t.length, 0) / Math.max(1, texts.length);
    if (avgLen >= 12 && !taken.has('narration')) {
      roles[c] = 'narration';
      taken.add('narration');
    }
  }

  return { roles };
}
