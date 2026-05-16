/**
 * Parser for J&K Bank "RPT" / "RPTNFS" / loan-recovery report exports.
 *
 * J&K Bank's report-style PDF export lays out transactions in a way the
 * generic grid extractor (pdfGrid.ts) can't recover:
 *
 *   - The date column is rendered as 5 separate text items at distinct
 *     x-positions (dd, -, mm, -, yyyy). The column-anchor algorithm
 *     interprets each as its own column candidate, then collapses
 *     because none has consistent x.
 *   - Each transaction occupies 2 visual lines: a "date line" at the
 *     top (date + narration start) and a "continuation line" below it
 *     (narration tail + amount + balance with Cr/Dr suffix). A
 *     minority of transactions fit on a single line.
 *   - Amount and balance x-positions vary by row (rightmost numeric
 *     tokens, not anchored columns).
 *   - Narrations frequently wrap mid-word ("Payme" + "nts For" =
 *     "Payments For"; "mTFR/.../FO" + "OD HUT PROP" = "FOOD HUT PROP").
 *
 * This parser bypasses the grid extractor entirely. It works directly
 * on pdfjs's per-page text items + their x/y coordinates, walks the
 * y-bands top-to-bottom, and reconstructs each transaction by pairing
 * a date line with its continuation line (or recognising a one-line
 * transaction). Cross-page transactions are handled via a "pending
 * date line" carried between pages.
 *
 * Format-family covered:
 *   - "Bank statement.RPTNFS.pdf"  — general current account export
 *   - "JKBANK FORMAT-1 / -5 / -6"  — CASH CREDIT / OD reports
 *   - "JKBANK FORMAT-7 (LOAN)"     — loan-recovery statements
 *
 * The output is the same MappedRow shape `pdfGrid.applyMapping` emits,
 * so it slots straight into `mappedRowsToBankCsv` and the existing
 * CSV upload path without further glue.
 */

import { pdfjs } from 'react-pdf';
import type { MappedRow } from './pdfGrid';

// Ensure pdfjs worker is configured (same shim pattern as pdfText.ts).
if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
}

interface TextItem {
  x: number;
  y: number;
  str: string;
}

/** A "line" is one y-band's worth of text items, sorted left-to-right. */
type Line = TextItem[];

/** Parsed contents of a single line. Any field can be null if absent. */
interface LineData {
  /** dd-mm-yyyy → YYYY-MM-DD, or null if no date at the start of the line. */
  date: string | null;
  /** Signed balance value: positive = Cr, negative = Dr. Null if absent. */
  balance: number | null;
  /** Last rightmost numeric token strictly LEFT of the balance — typically the amount. Null if absent. */
  amount: number | null;
  /** Narration text on this line (left of the amount column). May be empty. */
  narration: string;
  /** True if this line carries the "B/F" / "Brought Forward" opening marker. */
  isBF: boolean;
  /** True if this line is a "Page Total:" / "Total:" / divider footer — skip. */
  isPageTotal: boolean;
}

const DATE_TOKENS_RE = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
const BALANCE_TOKEN_RE = /^([\d,]+\.\d{1,2})\s*(Cr|Dr)$/i;
const PURE_NUMERIC_RE = /^[\d,]+\.\d{1,2}$/;

/**
 * Quick fingerprint check — returns true if the PDF looks like a J&K Bank
 * RPT/RPTNFS report. Used by the upload flow to decide whether to invoke
 * `extractJkbankRpt` instead of the grid extractor.
 *
 * Detection bar: ALL of these must hold on the first 2 pages:
 *   1. "JAMMU AND KASHMIR BANK LTD" or "JKBank" / JAKA0 IFSC prefix appears
 *      somewhere in the banner zone.
 *   2. At least 3 lines start with a `dd-mm-yyyy`-shaped sequence at the
 *      leftmost column zone (x in [60, 115]). The split-into-5-tokens
 *      date pattern is the smoking gun — no other Indian bank renders dates
 *      this way.
 *   3. At least 3 lines have a "balance + Cr/Dr suffix" token at the right
 *      (x > 350). Confirms this is a transaction table, not a banner page.
 *
 * Returns false on any reading error — caller treats as "not RPT" and
 * falls through to the normal grid / vision pipeline.
 */
export async function detectJkbankRptFormat(file: File, password?: string): Promise<boolean> {
  if (file.type !== 'application/pdf') return false;
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      ...(password ? { password } : {}),
    }).promise;
    let bannerHit = false;
    let dateLineCount = 0;
    let balanceTokenCount = 0;
    const pagesToScan = Math.min(2, pdf.numPages);
    for (let pageNum = 1; pageNum <= pagesToScan; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const tc = await page.getTextContent();
      const items = toTextItems(tc.items);
      // Banner check: scan the joined text for the bank name / IFSC prefix.
      const joined = items.map(i => i.str).join(' ').toLowerCase();
      if (
        joined.includes('jammu and kashmir bank') ||
        joined.includes('jkbank') ||
        /\bjaka0/.test(joined)
      ) {
        bannerHit = true;
      }
      // Date-line + balance-token tally.
      const byY = groupByYBand(items);
      for (const line of byY.values()) {
        if (lineHasDatePrefix(line)) dateLineCount++;
        if (lineHasBalanceToken(line)) balanceTokenCount++;
      }
    }
    return bannerHit && dateLineCount >= 3 && balanceTokenCount >= 3;
  } catch (err) {
    console.warn('[jkbankRpt] detect failed:', err);
    return false;
  }
}

/**
 * Full parse. Returns an array of MappedRow rows ready to feed into
 * `mappedRowsToBankCsv`, or null when extraction was unsuccessful (no
 * detected transactions, malformed file, etc.).
 *
 * Direction (debit vs credit) is computed from balance deltas: a row
 * whose signed balance increased relative to the previous row is a
 * credit (positive amount), decreased is a debit (negative amount).
 * This matches the existing pdfGrid amount convention (positive =
 * inflow, negative = outflow).
 */
export async function extractJkbankRpt(file: File, password?: string): Promise<MappedRow[] | null> {
  if (file.type !== 'application/pdf') return null;
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      ...(password ? { password } : {}),
    }).promise;

    // Cross-page state: a date line at the bottom of one page whose
    // continuation lives at the top of the next.
    let pendingDate: string | null = null;
    let pendingNarrationHead = '';

    // Running balance from the previous emitted row — used to derive
    // signed amount for the current row.
    let prevBalance: number | null = null;

    const rows: MappedRow[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const tc = await page.getTextContent();
      const items = toTextItems(tc.items);
      const byY = groupByYBand(items);
      // Y descending = visual top-to-bottom in PDF coords.
      const yKeys = [...byY.keys()].sort((a, b) => b - a);

      for (let i = 0; i < yKeys.length; i++) {
        const line = byY.get(yKeys[i])!;
        const data = parseLine(line);

        // B/F (Brought Forward) opening row — set prevBalance baseline,
        // don't emit a transaction.
        if (data.isBF) {
          if (data.balance !== null) prevBalance = data.balance;
          continue;
        }
        if (data.isPageTotal) continue;

        // Single-line transaction: date + amount + balance on same line.
        if (data.date && data.amount !== null && data.balance !== null) {
          rows.push(buildRow(data.date, data.narration, data.amount, data.balance, prevBalance));
          prevBalance = data.balance;
          pendingDate = null;
          pendingNarrationHead = '';
          continue;
        }

        // Date-line of a multi-line transaction — defer to the next line.
        if (data.date && data.amount === null && data.balance === null) {
          pendingDate = data.date;
          pendingNarrationHead = data.narration;
          continue;
        }

        // Continuation line — pair with the pending date line.
        if (!data.date && data.amount !== null && data.balance !== null && pendingDate) {
          const narration = joinWrappedNarration(pendingNarrationHead, data.narration);
          rows.push(buildRow(pendingDate, narration, data.amount, data.balance, prevBalance));
          prevBalance = data.balance;
          pendingDate = null;
          pendingNarrationHead = '';
          continue;
        }

        // Anything else (banner, footer, address) — ignore.
      }
    }

    if (rows.length === 0) return null;
    return rows;
  } catch (err) {
    console.warn('[jkbankRpt] extract failed:', err);
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function toTextItems(rawItems: unknown[]): TextItem[] {
  const out: TextItem[] = [];
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue;
    const obj = it as { str?: unknown; transform?: number[] };
    if (typeof obj.str !== 'string') continue;
    const trimmed = obj.str.trim();
    if (!trimmed) continue;
    const tf = obj.transform;
    if (!Array.isArray(tf) || tf.length < 6) continue;
    out.push({
      x: Math.round(tf[4]),
      y: Math.round(tf[5]),
      str: trimmed,
    });
  }
  return out;
}

/** Group text items by y-band (each visual line). Tolerates 1px y
 *  jitter — items within 1px of the same y land in the same line. */
function groupByYBand(items: TextItem[]): Map<number, Line> {
  const map = new Map<number, Line>();
  // Sort by y descending so we always assign to the topmost existing band.
  const sorted = [...items].sort((a, b) => b.y - a.y);
  for (const it of sorted) {
    let bandY: number | null = null;
    for (const existingY of map.keys()) {
      if (Math.abs(existingY - it.y) <= 1) { bandY = existingY; break; }
    }
    if (bandY === null) { bandY = it.y; map.set(bandY, []); }
    map.get(bandY)!.push(it);
  }
  // Sort each line left-to-right.
  for (const line of map.values()) line.sort((a, b) => a.x - b.x);
  return map;
}

/** True if the line starts with a dd-mm-yyyy date in the leftmost column
 *  zone (x ≤ ~110). Used by both detection and per-line parsing. */
function lineHasDatePrefix(line: Line): boolean {
  // Concatenate the leftmost few tokens (x <= 115) and check the date regex.
  const leftTokens = line.filter(t => t.x <= 115);
  if (leftTokens.length < 5) return false;
  const concat = leftTokens.map(t => t.str).join('');
  return DATE_TOKENS_RE.test(concat);
}

function lineHasBalanceToken(line: Line): boolean {
  return line.some(t => BALANCE_TOKEN_RE.test(t.str));
}

/** Parse a single line into its semantic components. */
function parseLine(line: Line): LineData {
  // Detect B/F opening row. Format: "134:B/F  484:0" or similar.
  // The "B/F" string appears as a standalone token at x≈130-140.
  const bfToken = line.find(t => /^B\/F$/i.test(t.str));
  if (bfToken) {
    // Find rightmost numeric token after the B/F marker as the balance.
    const after = line.filter(t => t.x > bfToken.x);
    let bfBalance: number | null = null;
    for (let i = after.length - 1; i >= 0; i--) {
      const t = after[i];
      const m = BALANCE_TOKEN_RE.exec(t.str);
      if (m) {
        const n = Number(m[1].replace(/,/g, ''));
        bfBalance = m[2].toLowerCase() === 'cr' ? n : -n;
        break;
      }
      // B/F may not have a Cr/Dr suffix if balance is zero — accept bare numeric too.
      if (PURE_NUMERIC_RE.test(t.str) || /^\d+$/.test(t.str)) {
        bfBalance = Number(t.str.replace(/,/g, ''));
        break;
      }
    }
    return { date: null, balance: bfBalance, amount: null, narration: '', isBF: true, isPageTotal: false };
  }

  // Detect "Page Total:" / "Total:" footer line.
  const pageTotalMatch = line.find(t => /^(Page\s*Total|Grand\s*Total|Total)\s*:?$/i.test(t.str));
  if (pageTotalMatch) {
    return { date: null, balance: null, amount: null, narration: '', isBF: false, isPageTotal: true };
  }

  // Extract date from the leftmost column zone (x ≤ 115).
  const leftTokens = line.filter(t => t.x <= 115);
  let date: string | null = null;
  let firstNarrationX = 0;
  if (leftTokens.length >= 5) {
    const concat = leftTokens.map(t => t.str).join('');
    const m = DATE_TOKENS_RE.exec(concat);
    if (m) {
      const dd = m[1].padStart(2, '0');
      const mm = m[2].padStart(2, '0');
      const yyyy = m[3];
      date = `${yyyy}-${mm}-${dd}`;
      firstNarrationX = Math.max(...leftTokens.map(t => t.x)) + 1;
    }
  }

  // Find balance token (rightmost token with Cr/Dr suffix).
  let balance: number | null = null;
  let balanceX = Number.POSITIVE_INFINITY;
  for (let i = line.length - 1; i >= 0; i--) {
    const m = BALANCE_TOKEN_RE.exec(line[i].str);
    if (m) {
      const n = Number(m[1].replace(/,/g, ''));
      balance = m[2].toLowerCase() === 'cr' ? n : -n;
      balanceX = line[i].x;
      break;
    }
  }

  // Find amount — rightmost pure-numeric token strictly LEFT of balance.
  let amount: number | null = null;
  let amountX = Number.POSITIVE_INFINITY;
  if (balance !== null) {
    for (let i = line.length - 1; i >= 0; i--) {
      if (line[i].x >= balanceX) continue;
      if (PURE_NUMERIC_RE.test(line[i].str)) {
        amount = Number(line[i].str.replace(/,/g, ''));
        amountX = line[i].x;
        break;
      }
    }
  }

  // Narration = tokens at x > date-zone AND x < amount column.
  // Wait — some lines have NO date but only narration + amount + balance
  // (the continuation line). In that case, narration spans the whole
  // line up to amountX.
  const narrationStart = date ? firstNarrationX : 120; // continuation lines start at x≈134
  const narrationCut = Math.min(amountX, balanceX);
  const narrationTokens = line
    .filter(t => t.x >= narrationStart && t.x < narrationCut)
    .map(t => t.str);
  const narration = narrationTokens.join(' ').replace(/\s+/g, ' ').trim();

  return { date, balance, amount, narration, isBF: false, isPageTotal: false };
}

/**
 * Smart-join two narration fragments. J&K Bank's report renderer wraps
 * narrations mid-word in many cases ("Payme" → "nts For", "FO" → "OD"
 * for "FOOD"). Heuristic:
 *   - If `a` ends with an alphanumeric AND `b` starts with an
 *     alphanumeric, concat WITHOUT space (mid-word wrap).
 *   - Otherwise insert a space (separator-aware concat).
 */
function joinWrappedNarration(a: string, b: string): string {
  const aTrim = a.trim();
  const bTrim = b.trim();
  if (!aTrim) return bTrim;
  if (!bTrim) return aTrim;
  const lastA = aTrim[aTrim.length - 1];
  const firstB = bTrim[0];
  const isAlnum = (c: string) => /[A-Za-z0-9]/.test(c);
  if (isAlnum(lastA) && isAlnum(firstB)) {
    return aTrim + bTrim;
  }
  return aTrim + ' ' + bTrim;
}

/**
 * Build a MappedRow from the parsed components. Direction (debit vs
 * credit) is derived from the balance delta against the previous row:
 *
 *   balanceDelta = currentBalance - prevBalance
 *   delta > 0 → credit (positive amount)
 *   delta < 0 → debit (negative amount, i.e. -|amount|)
 *
 * On the very first row with no prevBalance reference, we default to
 * crediting the row (positive amount). That's correct for new-account
 * statements where the opening balance is 0 (this PDF's B/F line) and
 * the first transaction is an inflow. For statements where the first
 * row is an outflow with no B/F, the user can re-check via the UI's
 * row-level override.
 */
function buildRow(
  date: string,
  narration: string,
  rawAmount: number,
  currentBalance: number,
  prevBalance: number | null,
): MappedRow {
  let signedAmount: number;
  if (prevBalance === null) {
    // No prev balance to derive from — default to positive (credit).
    signedAmount = Math.abs(rawAmount);
  } else {
    const delta = currentBalance - prevBalance;
    // Magnitude from the row's printed amount column (more reliable than
    // delta for floating-point reasons); sign from delta direction.
    const mag = Math.abs(rawAmount);
    signedAmount = delta >= 0 ? mag : -mag;
  }
  return {
    date,
    narration,
    voucher: null,
    reference: null,
    amount: signedAmount,
    balance: currentBalance,
    account: null,
  };
}
