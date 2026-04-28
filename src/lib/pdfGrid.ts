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
const X_CLUSTER_TOLERANCE = 8; // Items within this x-distance share a column.

/**
 * Extract a 2D grid from a digital PDF. Returns null when the PDF
 * has no extractable text layer (scanned image) — caller should
 * fall back to the vision pipeline in that case.
 */
export async function extractPdfGrid(file: File): Promise<PdfGrid | null> {
  if (file.type !== 'application/pdf') return null;
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;

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

    // Phase 3 — discover canonical column x-positions. Pool every item's
    // x across every row, cluster by X_CLUSTER_TOLERANCE, take cluster
    // centers as column anchors. Banks tend to right-align numeric
    // columns and left-align text, so cluster on the LEFT edge — that's
    // what stays stable across rows of different widths.
    const xs = allItems.map(i => i.x).sort((a, b) => a - b);
    const columnXs: number[] = [];
    let clusterStart = xs[0];
    let clusterSum = xs[0];
    let clusterCount = 1;
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] - clusterStart <= X_CLUSTER_TOLERANCE) {
        clusterSum += xs[i];
        clusterCount++;
      } else {
        // Only keep clusters with enough density to be a real column —
        // single-stray items (page numbers, watermarks) shouldn't get
        // their own column. Threshold at 5% of row count.
        if (clusterCount >= Math.max(3, Math.floor(rowBuckets.length * 0.05))) {
          columnXs.push(clusterSum / clusterCount);
        }
        clusterStart = xs[i];
        clusterSum = xs[i];
        clusterCount = 1;
      }
    }
    if (clusterCount >= Math.max(3, Math.floor(rowBuckets.length * 0.05))) {
      columnXs.push(clusterSum / clusterCount);
    }

    if (columnXs.length < 2) return null; // not enough column structure

    // Phase 4 — assign each row's items to the nearest column anchor,
    // concatenate text within a column with a space. Preserve original
    // reading order within a column by sorting items by x.
    const rows: string[][] = [];
    for (const bucket of rowBuckets) {
      bucket.sort((a, b) => a.x - b.x);
      const cells: string[] = new Array(columnXs.length).fill('');
      for (const it of bucket) {
        let bestCol = 0;
        let bestDist = Math.abs(it.x - columnXs[0]);
        for (let c = 1; c < columnXs.length; c++) {
          const d = Math.abs(it.x - columnXs[c]);
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
      pageBreaks,
      pageCount: pdf.numPages,
    };
  } catch (err) {
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
 */
export function applyMapping(grid: PdfGrid, mapping: ColumnMapping): MappedRow[] {
  const out: MappedRow[] = [];
  const colByRole = new Map<ColumnRole, number>();
  mapping.roles.forEach((r, i) => {
    if (r !== 'skip' && !colByRole.has(r)) colByRole.set(r, i);
  });

  let lastAccount: string | null = null;
  for (const row of grid.rows) {
    const cell = (role: ColumnRole) => {
      const i = colByRole.get(role);
      return i === undefined ? '' : (row[i] ?? '').trim();
    };

    // Track the most recent "Account: X" header — applies to all
    // subsequent rows until the next header. Common in Tally / Busy
    // ledger exports where multiple accounts share one PDF.
    const accountCell = cell('account');
    if (accountCell) lastAccount = accountCell;

    const dateRaw = cell('date');
    const date = parseDate(dateRaw);
    if (!date) {
      // Possibly a multi-line narration continuing the previous row.
      // If date is empty AND previous out row exists AND there's text
      // in the narration column, append to previous narration.
      const narr = cell('narration');
      if (narr && out.length > 0) {
        out[out.length - 1].narration = `${out[out.length - 1].narration} ${narr}`.trim();
      }
      continue;
    }

    const debit = parseNumber(cell('debit'));
    const credit = parseNumber(cell('credit'));
    let amount: number | null = null;
    if (debit != null && debit !== 0) {
      amount = -Math.abs(debit);
    } else if (credit != null && credit !== 0) {
      amount = Math.abs(credit);
    } else {
      const amt = parseNumber(cell('amount'));
      if (amt != null) {
        const marker = cell('drCrMarker').toLowerCase();
        if (marker.includes('dr') || marker.includes('debit') || marker.includes('-')) {
          amount = -Math.abs(amt);
        } else if (marker.includes('cr') || marker.includes('credit')) {
          amount = Math.abs(amt);
        } else {
          amount = amt; // trust pre-signed
        }
      }
    }

    if (amount == null || !Number.isFinite(amount)) continue;

    out.push({
      date,
      narration: cell('narration'),
      voucher: cell('voucher') || null,
      reference: cell('reference') || null,
      amount,
      balance: parseNumber(cell('balance')),
      account: lastAccount,
    });
  }

  return out;
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
    let totalDebit = 0;
    let totalCredit = 0;
    for (const t of txs) {
      if (t.amount < 0) totalDebit += Math.abs(t.amount);
      else totalCredit += t.amount;
    }
    const closing = txs.length > 0 ? (txs[txs.length - 1].balance ?? 0) : 0;
    return {
      name,
      accountType: null,
      opening: 0,
      closing,
      totalDebit,
      totalCredit,
      transactions: txs.map(t => ({
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

/** Heuristic — guess each column's role from the first 3 rows and
 *  the column's median content. The wizard pre-fills with this and
 *  the user adjusts. Mandatory confirm step still applies — we never
 *  auto-submit. */
export function suggestMapping(grid: PdfGrid): ColumnMapping {
  const roles: ColumnRole[] = new Array(grid.columnCount).fill('skip');
  const sample = grid.rows.slice(0, Math.min(20, grid.rows.length));

  const colTexts: string[][] = Array.from({ length: grid.columnCount }, (_, c) =>
    sample.map(r => r[c] ?? ''),
  );
  const headerRow = grid.rows.find(r =>
    r.some(c => /date|particulars|narration|debit|credit|balance|withdraw|deposit|voucher/i.test(c)),
  );

  for (let c = 0; c < grid.columnCount; c++) {
    const header = (headerRow?.[c] ?? '').toLowerCase();
    if (/date/.test(header)) { roles[c] = 'date'; continue; }
    if (/particulars|narration|description|chq|cheque|details/.test(header)) { roles[c] = 'narration'; continue; }
    if (/voucher|vch|type/.test(header)) { roles[c] = 'voucher'; continue; }
    if (/withdraw|debit|dr\b/.test(header)) { roles[c] = 'debit'; continue; }
    if (/deposit|credit|cr\b/.test(header)) { roles[c] = 'credit'; continue; }
    if (/balance|closing/.test(header)) { roles[c] = 'balance'; continue; }
    if (/ref|utr|chq/.test(header)) { roles[c] = 'reference'; continue; }

    // Header didn't help. Look at content.
    const texts = colTexts[c];
    const dateHits = texts.filter(t => DATE_LIKE_RE.test(t)).length;
    const numHits = texts.filter(t => NUMBER_RE.test(t) && !DATE_LIKE_RE.test(t)).length;
    if (dateHits >= sample.length * 0.4) { roles[c] = 'date'; continue; }
    if (numHits >= sample.length * 0.4) {
      // ambiguous numeric column — leave as skip; user picks.
      roles[c] = 'skip';
      continue;
    }
    // Long-text-heavy column → narration candidate.
    const avgLen = texts.reduce((s, t) => s + t.length, 0) / Math.max(1, texts.length);
    if (avgLen >= 12) roles[c] = 'narration';
  }

  return { roles };
}
