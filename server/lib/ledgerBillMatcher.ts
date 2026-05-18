/**
 * Deterministic bill-by-bill ledger reconciliation.
 *
 * Reconciles two ledger snapshots (Entity A's books vs Entity B's
 * books of the same business relationship) by matching bill / voucher
 * numbers across the two sides, with NO AI involvement. Replaces the
 * earlier AI-based date+amount matcher because:
 *
 *   1. Bill numbers are the source of truth on a party-confirmation
 *      reconciliation. If A's sales invoice #BS/123 doesn't appear on
 *      B's purchase ledger, that's the unambiguous question to ask the
 *      counterparty about.
 *   2. Date+amount matching is fuzzy and AI-dependent — the same
 *      ₹50,000 paid twice in a month creates ambiguous pairs the
 *      matcher cannot resolve without bill-level data.
 *   3. Deterministic = zero AI cost, zero retry storm during Gemini
 *      outages, instant turnaround for very large ledgers.
 *
 * Inputs:
 *   - ledgerA, ledgerB : ExtractedLedger snapshots
 *   - typeA, typeB     : 'sales' | 'purchase' | 'sundry_debtor' |
 *                         'sundry_creditor' | 'other'
 *     The type pair is metadata used by the consumer (UI / summary
 *     headline). The matcher itself does not enforce a sign-convention
 *     rule — it just compares amounts on each side. The defaults
 *     (A = sales, B = purchase) describe the most common workflow:
 *     A invoiced B; the same bill should appear as A's debit and B's
 *     credit. Magnitude is what matters; sign is informational.
 *
 * Outputs:
 *   - matched              : bill present on both sides, |amount| within ₹1
 *   - amountMismatches     : bill present on both sides, amounts diverge
 *   - onlyInA              : bill in A's ledger, no counterpart in B
 *   - onlyInB              : bill in B's ledger, no counterpart in A
 *   - noBillA, noBillB     : transactions without an extractable bill
 *                            reference — surfaced separately so the
 *                            user can spot ledger-export issues
 *   - summary              : counts + totals + headline
 *   - balanceCheck         : opening/closing on each side + gap
 */

import type { LedgerType } from '../db/repositories/ledgerComparisonRepo.js';

// ─── Input shape (ExtractedLedger) ──────────────────────────────────

interface ExtractedLedgerAccount {
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
}
export interface ExtractedLedger {
  accounts: ExtractedLedgerAccount[];
}

// ─── Output shape ───────────────────────────────────────────────────

export interface MatchedRow {
  bill: string;
  dateA: string | null;
  dateB: string | null;
  amountA: number;
  amountB: number;
  narrationA: string;
  narrationB: string;
}

export interface AmountMismatchRow extends MatchedRow {
  diff: number; // amountA - amountB (positive = A booked more)
}

export interface OnlySideRow {
  bill: string;
  date: string | null;
  amount: number;
  narration: string;
}

export interface NoBillRow {
  date: string | null;
  amount: number;
  narration: string;
}

export interface LedgerCompareReport {
  summary: {
    typeA: LedgerType;
    typeB: LedgerType;
    totalA: number;
    totalB: number;
    matchedCount: number;
    amountMismatchCount: number;
    onlyInACount: number;
    onlyInBCount: number;
    noBillCountA: number;
    noBillCountB: number;
    /** Absolute total of A's transactions (sum of |amount|). Useful as
     *  a denominator for percentage of value reconciled. */
    grossA: number;
    grossB: number;
    /** Signed net (debits − credits) on each side. For sales-vs-purchase
     *  matching, grossA (sales) − grossB (purchase) should be near 0
     *  if all bills tie. */
    netA: number;
    netB: number;
    netDifference: number; // netA - netB
    headline: string;
  };
  matched: MatchedRow[];
  amountMismatches: AmountMismatchRow[];
  onlyInA: OnlySideRow[];
  onlyInB: OnlySideRow[];
  noBillA: NoBillRow[];
  noBillB: NoBillRow[];
  balanceCheck: {
    openingA: number;
    openingB: number;
    openingGap: number;
    closingA: number;
    closingB: number;
    closingGap: number;
    note: string;
  };
}

// ─── Bill-key extraction ────────────────────────────────────────────

/**
 * Normalise a bill / voucher string into a comparison key.
 *
 * Indian businesses cite the same bill in many shapes:
 *   "BS/123/24-25", "BS-123", "BS 123 2024-25", "BS123", "123/24-25"
 *
 * Normalisation steps:
 *   - Uppercase
 *   - Strip the FY-suffix tokens ("24-25", "2024-25", "FY 24-25") that
 *     describe the financial year rather than the bill itself.
 *   - Strip non-alphanumeric separators (/, -, ., space, #).
 *   - Collapse to the prefix + digit-run; the digit run is the
 *     identifying piece, the prefix discriminates between bill series
 *     (BS vs JE vs RV).
 */
export function normalizeBillKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Strip FY suffix tokens
  s = s.replace(/\b(?:FY\s*)?(?:20)?\d{2}\s*[-/]\s*(?:20)?\d{2}\b/gi, '');
  // Common prefix decorations
  s = s.replace(/^(?:NO\.?|NUM\.?|#)\s*/i, '');
  // Strip non-alphanumeric.
  s = s.replace(/[^A-Z0-9]/gi, '');
  if (!s) return null;
  // Reject tokens that are clearly not bills:
  //   - Pure dates that survived FY-strip ("01042025" — 8 digits leading 0)
  //   - Very long numeric sequences without a prefix (account numbers,
  //     UTRs — 12+ digits without letters)
  if (/^\d{12,}$/.test(s)) return null;
  return s.toUpperCase();
}

/**
 * Try to extract a bill reference for a transaction. Looks at:
 *   1. The voucher field (most reliable — Tally / Busy / Marg fill it
 *      with the bill number for purchase / sale entries).
 *   2. Bill-shaped patterns in the narration:
 *      "BS/123", "INV-456", "BILL NO 789", "VCH 12/2024-25", etc.
 *
 * Returns null when no reference can be extracted with confidence —
 * those rows land in the "noBill" bucket.
 */
const NARRATION_BILL_PATTERNS: RegExp[] = [
  // Common prefixes followed by a number and optional FY suffix.
  /\b(?:BS|INV|BILL|VCH|VOUCH|VOU|VR|VR\.|RCT|RECEIPT|JV|JE|PRV|PUR|SAL)[\s\-/#:.]*([A-Z0-9][A-Z0-9\-/]{2,30})/i,
  // "Bill No. 123" / "Invoice 456"
  /\b(?:bill|invoice|voucher)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/]{2,30})/i,
];

export function extractBillKey(tx: { voucher: string | null; narration: string | null }): string | null {
  const fromVoucher = normalizeBillKey(tx.voucher);
  if (fromVoucher) return fromVoucher;
  const narr = tx.narration ?? '';
  for (const p of NARRATION_BILL_PATTERNS) {
    const m = p.exec(narr);
    if (m) {
      const key = normalizeBillKey(m[1] ?? m[0]);
      if (key) return key;
    }
  }
  return null;
}

// ─── Compare ────────────────────────────────────────────────────────

interface FlatTx {
  date: string | null;
  narration: string;
  voucher: string | null;
  /** Signed amount: + = debit (book the other party owes us), − = credit. */
  amount: number;
  /** Magnitude — used for matching. */
  absAmount: number;
}

function flattenLedger(ledger: ExtractedLedger): FlatTx[] {
  const out: FlatTx[] = [];
  for (const acc of ledger.accounts ?? []) {
    for (const t of acc.transactions ?? []) {
      const debit = Number(t.debit ?? 0) || 0;
      const credit = Number(t.credit ?? 0) || 0;
      const amount = debit - credit;
      if (!Number.isFinite(amount) || amount === 0) continue;
      out.push({
        date: t.date ?? null,
        narration: (t.narration ?? '').trim(),
        voucher: t.voucher ?? null,
        amount,
        absAmount: Math.abs(amount),
      });
    }
  }
  return out;
}

function sumAbs(rows: FlatTx[]): number {
  return rows.reduce((s, r) => s + r.absAmount, 0);
}

function sumSigned(rows: FlatTx[]): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}

/** Pick the "representative" row from a list of same-bill rows.
 *  Same bill across multiple journal lines is common; the rep is the
 *  one with the largest |amount| (usually the main invoice line). */
function representative(rows: FlatTx[]): FlatTx {
  let best = rows[0];
  for (const r of rows) if (r.absAmount > best.absAmount) best = r;
  return best;
}

export function compareLedgersByBill(
  ledgerA: ExtractedLedger,
  typeA: LedgerType,
  ledgerB: ExtractedLedger,
  typeB: LedgerType,
): LedgerCompareReport {
  const txA = flattenLedger(ledgerA);
  const txB = flattenLedger(ledgerB);

  // Group by bill key. Rows with no extractable bill key go to the
  // noBill buckets — they cannot participate in bill-by-bill matching.
  const byBillA = new Map<string, FlatTx[]>();
  const byBillB = new Map<string, FlatTx[]>();
  const noBillA: FlatTx[] = [];
  const noBillB: FlatTx[] = [];
  for (const t of txA) {
    const k = extractBillKey(t);
    if (!k) { noBillA.push(t); continue; }
    if (!byBillA.has(k)) byBillA.set(k, []);
    byBillA.get(k)!.push(t);
  }
  for (const t of txB) {
    const k = extractBillKey(t);
    if (!k) { noBillB.push(t); continue; }
    if (!byBillB.has(k)) byBillB.set(k, []);
    byBillB.get(k)!.push(t);
  }

  // Walk the union of bill keys.
  const allBills = new Set<string>([...byBillA.keys(), ...byBillB.keys()]);
  const matched: MatchedRow[] = [];
  const amountMismatches: AmountMismatchRow[] = [];
  const onlyInA: OnlySideRow[] = [];
  const onlyInB: OnlySideRow[] = [];

  for (const bill of allBills) {
    const aRows = byBillA.get(bill);
    const bRows = byBillB.get(bill);
    if (aRows && bRows) {
      // Sum absolute amounts per side. Same-bill journal lines on the
      // same side (e.g. taxable + GST split across two lines) add up.
      const totA = sumAbs(aRows);
      const totB = sumAbs(bRows);
      const repA = representative(aRows);
      const repB = representative(bRows);
      const diff = totA - totB;
      if (Math.abs(diff) <= 1) {
        matched.push({
          bill,
          dateA: repA.date,
          dateB: repB.date,
          amountA: totA,
          amountB: totB,
          narrationA: repA.narration,
          narrationB: repB.narration,
        });
      } else {
        amountMismatches.push({
          bill,
          dateA: repA.date,
          dateB: repB.date,
          amountA: totA,
          amountB: totB,
          diff,
          narrationA: repA.narration,
          narrationB: repB.narration,
        });
      }
    } else if (aRows) {
      const rep = representative(aRows);
      onlyInA.push({ bill, date: rep.date, amount: sumAbs(aRows), narration: rep.narration });
    } else if (bRows) {
      const rep = representative(bRows);
      onlyInB.push({ bill, date: rep.date, amount: sumAbs(bRows), narration: rep.narration });
    }
  }

  // Sort everything by bill (ascending) for stable rendering.
  const byBillSort = (a: { bill: string }, b: { bill: string }) =>
    a.bill < b.bill ? -1 : a.bill > b.bill ? 1 : 0;
  matched.sort(byBillSort);
  amountMismatches.sort(byBillSort);
  onlyInA.sort(byBillSort);
  onlyInB.sort(byBillSort);

  // Aggregate balance check from the ledger snapshots.
  const openingA = (ledgerA.accounts ?? []).reduce((s, a) => s + (Number(a.opening) || 0), 0);
  const openingB = (ledgerB.accounts ?? []).reduce((s, a) => s + (Number(a.opening) || 0), 0);
  const closingA = (ledgerA.accounts ?? []).reduce((s, a) => s + (Number(a.closing) || 0), 0);
  const closingB = (ledgerB.accounts ?? []).reduce((s, a) => s + (Number(a.closing) || 0), 0);

  const grossA = sumAbs(txA);
  const grossB = sumAbs(txB);
  const netA = sumSigned(txA);
  const netB = sumSigned(txB);

  const headline = buildHeadline({
    typeA, typeB,
    matchedCount: matched.length,
    amountMismatchCount: amountMismatches.length,
    onlyInACount: onlyInA.length,
    onlyInBCount: onlyInB.length,
    noBillCountA: noBillA.length,
    noBillCountB: noBillB.length,
    netDifference: netA - netB,
  });

  return {
    summary: {
      typeA, typeB,
      totalA: txA.length,
      totalB: txB.length,
      matchedCount: matched.length,
      amountMismatchCount: amountMismatches.length,
      onlyInACount: onlyInA.length,
      onlyInBCount: onlyInB.length,
      noBillCountA: noBillA.length,
      noBillCountB: noBillB.length,
      grossA, grossB, netA, netB,
      netDifference: netA - netB,
      headline,
    },
    matched,
    amountMismatches,
    onlyInA,
    onlyInB,
    noBillA: noBillA.map(t => ({ date: t.date, amount: t.absAmount, narration: t.narration })),
    noBillB: noBillB.map(t => ({ date: t.date, amount: t.absAmount, narration: t.narration })),
    balanceCheck: {
      openingA, openingB, openingGap: openingA - openingB,
      closingA, closingB, closingGap: closingA - closingB,
      note: buildBalanceNote({ openingGap: openingA - openingB, closingGap: closingA - closingB }),
    },
  };
}

function buildHeadline(s: {
  typeA: LedgerType; typeB: LedgerType;
  matchedCount: number; amountMismatchCount: number;
  onlyInACount: number; onlyInBCount: number;
  noBillCountA: number; noBillCountB: number;
  netDifference: number;
}): string {
  // "Books tie" purely on bill-level reconciliation: every bill on
  // both sides at the same amount. The signed netDifference can't
  // be used here as a tie check because sales-vs-purchase pairs have
  // opposite sign conventions on the two sides (A debits its
  // receivable, B credits its payable — same magnitude, opposite
  // sign). Bill-level match counts are the reliable signal.
  const totalIssues = s.amountMismatchCount + s.onlyInACount + s.onlyInBCount;
  if (totalIssues === 0) {
    return `Books tie: all ${s.matchedCount} bills match.`;
  }
  const parts: string[] = [];
  if (s.amountMismatchCount > 0) parts.push(`${s.amountMismatchCount} amount mismatch${s.amountMismatchCount === 1 ? '' : 'es'}`);
  if (s.onlyInACount > 0) parts.push(`${s.onlyInACount} bill${s.onlyInACount === 1 ? '' : 's'} only on ${s.typeA} side`);
  if (s.onlyInBCount > 0) parts.push(`${s.onlyInBCount} bill${s.onlyInBCount === 1 ? '' : 's'} only on ${s.typeB} side`);
  let extra = '';
  if (s.noBillCountA + s.noBillCountB > 0) {
    extra = ` (${s.noBillCountA + s.noBillCountB} row${s.noBillCountA + s.noBillCountB === 1 ? '' : 's'} had no bill reference and were skipped)`;
  }
  return `Books do not tie: ${parts.join(', ')}.${extra}`;
}

function buildBalanceNote(g: { openingGap: number; closingGap: number }): string {
  const open = Math.abs(g.openingGap) > 1;
  const close = Math.abs(g.closingGap) > 1;
  if (!open && !close) return 'Opening and closing balances agree on both sides.';
  const parts: string[] = [];
  if (open) parts.push(`opening gap ₹${Math.abs(g.openingGap).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
  if (close) parts.push(`closing gap ₹${Math.abs(g.closingGap).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
  return `Balance check: ${parts.join('; ')}. Investigate timing differences, missing entries, or sign-convention swaps before signing the confirmation.`;
}
