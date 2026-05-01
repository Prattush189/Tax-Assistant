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
    const HEADER_WORD = /^(date|narration|particulars|description|details|withdraw\w*|deposit\w*|debit|credit|balance|chq|cheque|voucher|amount|reference|ref|utr|type)$/i;
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
    }
    let columnAnchors: ColumnAnchor[] = [];
    for (const bucket of rowBuckets) {
      const headerItems = bucket.filter(it => HEADER_WORD.test(it.text.trim()));
      // Need at least 3 distinct header words to consider this a real
      // table-header row (filters out a stray "Balance" in narration).
      if (headerItems.length >= 3) {
        // Sort by x and dedup near-duplicates (some PDFs split a
        // header word like "Withdrawal Amt." across two text items).
        const sorted = [...headerItems].sort((a, b) => a.x - b.x);
        for (const it of sorted) {
          const trimmed = it.text.trim();
          const isNumeric = NUMERIC_HEADER.test(trimmed);
          const anchor: ColumnAnchor = isNumeric
            ? { x: it.x + it.width, align: 'right', leftX: it.x, headerText: trimmed }
            : { x: it.x, align: 'left', leftX: it.x, headerText: trimmed };
          // Dedup using the header word's left edge so a "Withdrawal"
          // header that pdfjs split into "Withdrawal" + "Amt." across
          // two adjacent text items collapses to one column. Append
          // the second token's text to the existing header so we
          // capture "Withdrawal Amt." as one label, not just
          // "Withdrawal".
          const lastLeft = columnAnchors.length === 0
            ? -Infinity
            : columnAnchors[columnAnchors.length - 1].leftX;
          if (it.x - lastLeft > 12) {
            columnAnchors.push(anchor);
          } else if (columnAnchors.length > 0) {
            const prev = columnAnchors[columnAnchors.length - 1];
            if (prev.headerText) prev.headerText = `${prev.headerText} ${trimmed}`;
            // Numeric anchor's right-edge tracks the rightmost token.
            if (prev.align === 'right') prev.x = Math.max(prev.x, it.x + it.width);
          }
        }
        break;
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

    return {
      rows,
      columnCount: columnXs.length,
      columnXs,
      columnHeaders: columnAnchors.map(a => a.headerText),
      pageBreaks,
      pageCount: pdf.numPages,
    };
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
const DATE_LIKE_RE = /\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{2,4})\b/i;

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
export function parseDate(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;
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
  return null;
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
function detectAccountHeader(
  row: string[],
  colByRole: Map<ColumnRole, number>,
): string | null {
  const cell = (role: ColumnRole): string => {
    const i = colByRole.get(role);
    return i === undefined ? '' : (row[i] ?? '').trim();
  };

  // Reject anything carrying transaction data.
  if (parseDate(cell('date'))) return null;
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

  const candidate = nonEmpty.sort((a, b) => b.length - a.length)[0];

  // Reject column-header rows defensively (findTableStart already
  // skips these but this function might be called on the raw grid).
  if (/^(date|narration|particulars|description|debit|credit|balance|chq|voucher|amount|reference|ref|utr|type)\b/i.test(candidate)) {
    return null;
  }

  // Strip Tally's leading dash and trim.
  let name = candidate.replace(/^[\s\-•]+/, '').trim();
  // "Account: HDFC Bank" → "HDFC Bank"
  name = name.replace(/^Account\s*[:.]\s*/i, '').trim();

  // Need a meaningful length.
  if (name.length < 3) return null;
  return name;
}

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
  };
  const colByRole = new Map<ColumnRole, number>();
  mapping.roles.forEach((r, i) => {
    if (r !== 'skip' && !colByRole.has(r)) colByRole.set(r, i);
  });

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
  // Last successfully-emitted balance — used as the fallback source
  // for an amount when the row's debit/credit cells lost the value
  // to pdfjs column-clustering (small charges like ₹0.03 / ₹5 / ₹7
  // get misplaced when their text-item x-positions don't match the
  // column anchor). Bank running balance is ground truth: amount =
  // balance(N) − balance(N-1). Only fires when no other amount
  // source is available.
  let lastBalance: number | null = null;

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
    if (
      amount != null && Number.isFinite(amount)
      && lastBalance != null && pending.balance != null
      // The balance-delta fallback path produces an exact match by
      // construction; only sanity-check rows where amount came from
      // the explicit cells (debit/credit/amountSingle).
      && !(pending.debit === 0 && pending.credit === 0 && pending.amountSingle == null)
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
      const headerName = detectAccountHeader(row, colByRole);
      if (headerName) {
        flushPending();
        lastAccount = headerName;
        stats.accountHeaders += 1;
        continue;
      }
    }

    const dateRaw = cell('date');
    const date = parseDate(dateRaw);
    const narr = cell('narration');
    const debit = parseNumber(cell('debit'));
    const credit = parseNumber(cell('credit'));
    const amountSingle = parseNumber(cell('amount'));
    const drCrMarker = cell('drCrMarker');
    const balance = parseNumber(cell('balance'));
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
      const SUBTOTAL_MARKER = /\b(grand\s+total|sub[- ]?total|page\s+total|carr(?:y|ied)\s+forward|brought\s+forward|opening\s+balance|closing\s+balance|c\.?\s*\/\.?\s*f\.?|b\.?\s*\/\.?\s*f\.?|^\s*total\b)/i;
      const haystack = `${narr} ${voucher ?? ''} ${reference ?? ''}`.trim();
      if (!date && SUBTOTAL_MARKER.test(haystack)) {
        // Flush whatever was pending so this row's stray numbers
        // don't bleed into the previous transaction's pending block.
        flushPending();
        stats.skippedNoAmount += 1;
        continue;
      }
    }

    if (date) {
      // New transaction starts. Flush whatever was pending.
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
      // Continuation row — fill in any missing fields on the
      // pending transaction. Narration concatenates; numeric fields
      // take the first non-null/non-zero value (so a separately-
      // rendered amount row supplies the amount the date row was
      // missing).
      if (narr) {
        pending.narration = pending.narration ? `${pending.narration} ${narr}`.trim() : narr;
        stats.mergedContinuations += 1;
      }
      if ((pending.debit == null || pending.debit === 0) && debit != null && debit !== 0) {
        pending.debit = debit;
      }
      if ((pending.credit == null || pending.credit === 0) && credit != null && credit !== 0) {
        pending.credit = credit;
      }
      if (pending.amountSingle == null && amountSingle != null) pending.amountSingle = amountSingle;
      if (!pending.drCrMarker && drCrMarker) pending.drCrMarker = drCrMarker;
      if (pending.balance == null && balance != null) pending.balance = balance;
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
export function mappedRowsToExtractedLedger(rows: MappedRow[]): ExtractedLedgerLike {
  const byAccount = new Map<string, MappedRow[]>();
  for (const r of rows) {
    const key = r.account ?? 'Default';
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
    // credit side; the running balance column on that row gives
    // the signed opening (the t.balance field carries it). We
    // prefer t.balance when it's set (most reliable since Tally
    // prints "<amount> Dr." / "<amount> Cr." in that column),
    // and fall back to t.amount otherwise.
    let opening = 0;
    let openingIdx = -1;
    if (txs.length > 0 && /^\s*(?:-\s*)?opening\s+balance\s*$/i.test(txs[0].narration ?? '')) {
      const t = txs[0];
      opening = t.balance != null ? t.balance : t.amount;
      openingIdx = 0;
    }
    const realTxs = openingIdx === 0 ? txs.slice(1) : txs;

    let totalDebit = 0;
    let totalCredit = 0;
    for (const t of realTxs) {
      if (t.amount < 0) totalDebit += Math.abs(t.amount);
      else totalCredit += t.amount;
    }
    const closing = realTxs.length > 0
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
  if (/\bvalue\s*(?:date|dt)\b|\bval\.?\s*dt\b|\bposting\s*date\b/.test(h)) return 'skip';
  // "Closing Balance" / "Running Balance" / "Balance"
  if (/\b(closing|running)\s*bal\w*\b|^bal\w*$|^balance\b/.test(h)) return 'balance';
  // Withdrawal / Debit / Dr Amount
  if (/\b(withdraw\w*|debits?|dr\.?\s*amount|debit\s*amt)\b/.test(h)) return 'debit';
  // Deposit / Credit / Cr Amount
  if (/\b(deposit\w*|credits?|cr\.?\s*amount|credit\s*amt)\b/.test(h)) return 'credit';
  // Single signed amount column (when there's no separate dr/cr)
  if (/^amount$|^amt\.?$|\btxn\s*amount\b/.test(h)) return 'amount';
  if (/\bdr\s*\/\s*cr|type\s*\(dr\/cr\)|dr\/cr/.test(h)) return 'drCrMarker';
  // Cheque / Reference / UTR — distinct from narration so search/filter
  // works on the long narration text without matching reference numbers.
  if (/\b(chq\.?\s*(no|number|ref)?|cheque|ref\.?\s*no\.?|reference|utr)\b/.test(h)) return 'reference';
  // Voucher type (Tally) — ledger only but harmless if assigned for bank
  if (/\bvoucher|\bvch\b|^type$/.test(h)) return 'voucher';
  // Account / ledger name (Tally party-wise book)
  if (/\baccount\b|^ledger$|party\s*name/.test(h)) return 'account';
  // Date — checked AFTER value-date so the real Date column wins
  if (/^date$|\btxn\s*date\b|\btransaction\s*date\b|^dt$/.test(h)) return 'date';
  if (/^narration|^particulars|^description|^details|^narrative$/.test(h)) return 'narration';
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
