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

/**
 * A row pair matched by date + amount when neither side carried a
 * bill reference. Typical case: a payment booked on both sides where
 * A's books recorded it as a credit-note number ("CRN-0232-000655")
 * and B's books recorded it as a bank receipt ("Chq. No.300625 BANK
 * OF BARODA … BEING AMOUNT RECEIVED"). No shared bill number, but
 * same date and same amount → same payment.
 *
 * `bankRefA` / `bankRefB` carry whatever the narration's bank-side
 * reference looked like (cheque number, UTR, NEFT/IMPS/RTGS ref,
 * TPT code). Surfaced for visual confirmation; not used for matching
 * — many ledgers (Marg in particular) print one side without bank
 * info, so gating on bank-ref would miss real pairs.
 */
export interface PaymentMatchRow {
  date: string;
  /** Side A's amount (absolute). When `diff > 0`, A and B disagree by
   *  small rounding (typical ±₹1 between Marg-style truncation and
   *  Finsys-style round-up); show both so the user can see what was
   *  reconciled. */
  amountA: number;
  amountB: number;
  /** |amountA − amountB|, in rupees. 0 for exact ties; small (≤1) for
   *  rounding-tolerated pairs. */
  diff: number;
  narrationA: string;
  narrationB: string;
  bankRefA: string | null;
  bankRefB: string | null;
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
    /** Pairs from the tight date+amount(±₹1) no-bill matcher
     *  (PaymentMatchRow[]). High-confidence — same payment, same
     *  rounding ballpark. */
    paymentMatchedCount: number;
    /** Pairs from the looser unique-date-only matcher — same date but
     *  amounts disagree by more than ₹1. Surfaced as their own bucket
     *  because they need human review (could be a real discrepancy
     *  on the same underlying transaction). Only applied when the
     *  date is unique on BOTH sides among leftover no-bill rows;
     *  ambiguous days stay in no-bill. */
    paymentDateMatchedCount: number;
    /** Counts AFTER both payment-matcher passes consume pairs — i.e.
     *  rows that remain genuinely one-sided with no bill reference
     *  and no same-day counterpart. */
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
  paymentMatches: PaymentMatchRow[];
  paymentDateMatches: PaymentMatchRow[];
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
 * Strip a sequential financial-year pair (YY-YY+1) sitting INSIDE
 * a longer digit run — e.g. the "2526" in "OS642526000042". Word-
 * boundary FY-strip (the regex pass that runs before this in
 * normalizeBillKey) misses these because there's no boundary
 * between the FY end ("26") and the bill counter ("000042").
 *
 * Walks 4-digit windows left-to-right. A window is treated as an
 * FY when parseInt(window[0:2]) + 1 === parseInt(window[2:4]).
 * Strips at most ONE FY per call — the second-pass is a recovery
 * for the common case where exactly one FY got embedded; we don't
 * want to greedily strip multiple if a bill genuinely has digit
 * patterns that coincide.
 */
function stripInlineFY(s: string): string {
  for (let i = 0; i + 4 <= s.length; i++) {
    const chunk = s.substring(i, i + 4);
    if (!/^\d{4}$/.test(chunk)) continue;
    const yy1 = parseInt(chunk.substring(0, 2), 10);
    const yy2 = parseInt(chunk.substring(2, 4), 10);
    if (yy2 === yy1 + 1) {
      return s.substring(0, i) + s.substring(i + 4);
    }
  }
  return s;
}

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
  // Reject Finsys voucher TYPE codes — "SALE(40)", "RECE(11)",
  // "JOB(41)", "PURCH(7)", "PAYM(3)", etc. The Finsys ERP rule maps
  // its "Type" column to the voucher role, but the value there is a
  // voucher CLASS, not a bill number. Using it as a bill key
  // mis-routes Finsys-side payments (RECE) into only-in-B as fake
  // bills. The literal `(N)` syntax with all-caps prefix is unique
  // to Finsys's report renderer.
  if (/^[A-Z]+\(\d+\)$/i.test(s)) return null;
  // Strip FY suffix tokens at word boundaries — catches "BS/123/24-25"
  // / "BS-123 2024-25" / "FY 24-25" forms where the FY is bounded by
  // non-word chars on both sides.
  s = s.replace(/\b(?:FY\s*)?(?:20)?\d{2}\s*[-/]\s*(?:20)?\d{2}\b/gi, '');
  // Common prefix decorations
  s = s.replace(/^(?:NO\.?|NUM\.?|#)\s*/i, '');
  // Strip non-alphanumeric.
  s = s.replace(/[^A-Z0-9]/gi, '');
  if (!s) return null;
  // Second-pass FY strip: catches FY-shaped substrings INSIDE long
  // digit runs (no word boundary). Marg writes "OS64/25-26/00042" —
  // the word-bounded strip above catches that. Finsys writes the
  // same bill as "OS64/25-26000042" — after slash-strip the digits
  // run together: "25-26000042" — no boundary between "26" and the
  // bill counter "000042". Without this pass the two ledgers'
  // versions of the same bill normalise to different keys
  // ("OS6400042" vs "OS642526000042") and miss the match.
  //
  // Detection: scan 4-digit windows; strip when window[0:2] + 1 ==
  // window[2:4] (sequential year pair). This is a strong signal —
  // random digits rarely form sequential YY pairs.
  s = stripInlineFY(s);
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
/**
 * Bill-extraction patterns, tried in order. List the most specific
 * (full-word "Bill No.", "Invoice No.", "Sale Inv.No") first so they
 * win over the bare-prefix ones below.
 *
 * The OSPL case (Marg ledger vs Finsys ledger of the same business
 * relationship) showed that:
 *   - Marg writes "Bill No. OS64/25-26000216 Dt. 31/05/2025 …"
 *   - Finsys writes "Sale Inv.No OS64/25-26000216 000216 U-02"
 * Both narrations carry the same cross-party bill `OS64/25-26000216`,
 * but Marg's voucher field is its INTERNAL entry id (P000142) and
 * Finsys's voucher is the bill tail (000216). Extracting from
 * voucher first misroutes both sides into different buckets.
 *
 * The patterns below explicitly handle:
 *   - "Bill No. X" / "Bill No X"
 *   - "Invoice No. X" / "Inv. No. X" / "Inv.No X"  (abbreviated)
 *   - "Sale Inv.No X"  (Finsys's wrapping)
 *   - "Voucher No. X" / "Vch.No. X"
 *   - Bare prefix forms BS/123, INV-456, VCH 12, JV 100 (Tally)
 *
 * Capture group: the bill string (which may itself contain "/" and
 * "-" — `OS64/25-26000216` is kept intact; normalizeBillKey will
 * strip the separators and the FY suffix.
 */
/**
 * Narration patterns + how to read the bill string out of each match.
 *
 *   - `'group'` : the keyword is a LABEL ("Bill No.", "Invoice No.").
 *                 The bill itself sits in capture group 1.
 *   - `'full'`  : the keyword IS PART of the bill number (e.g. "BS" in
 *                 "BS/123", "VCH" in "VCH 100"). Take the full match
 *                 so the bill series stays in the key — otherwise
 *                 "BS-888" would normalise to "888" and miss the
 *                 series prefix that distinguishes BS-888 from VR-888.
 */
const NARRATION_BILL_PATTERNS: Array<{ pattern: RegExp; capture: 'group' | 'full' }> = [
  {
    // Capture allows digit-start ([A-Z0-9]) and a 3-char minimum
    // ({2,40} after the first char) so short numeric bills like
    // "Bill No. 543" — Marg's bill-543-row in the OSPL ledger —
    // are recognised. Earlier minimum was 5 chars + [A-Z] start,
    // which excluded purely-numeric bills.
    pattern: /\b(?:bill|invoice|inv\.?|voucher|vch\.?)\b\s*(?:no\.?|number|#)?[\s.:\-]*([A-Z0-9][A-Z0-9\-/]{2,40})/i,
    capture: 'group',
  },
  {
    pattern: /\b(?:BS|INV|BILL|VCH|VOUCH|VOU|VR\.?|RCT|RECEIPT|JV|JE|PRV|PUR|SAL)\b[\s\-/#:.]*[A-Z0-9][A-Z0-9\-/]{2,30}/i,
    capture: 'full',
  },
];

/**
 * Try to extract a bill reference. We prefer NARRATION over voucher
 * because cross-party reconciliation depends on the bill number that
 * BOTH parties printed — almost always the supplier-issued invoice
 * number sitting in the narration. The voucher field is ERP-local
 * and frequently carries an internal entry id that differs between
 * the two parties' books.
 *
 * Voucher is the fallback for cases where the narration is empty or
 * generic (Tally's "Sales A/c" rows often have only the voucher set).
 */
/**
 * Detect whether the row is a credit-note / debit-note ADJUSTMENT
 * that references an original bill, vs. the original sale/purchase
 * itself.
 *
 * Why this matters: Finsys (OSPL's example) writes credit notes
 * with narration like "Bill No.OS64/25-26000215 Dt. 31/05/2025
 * BEING CREDIT NOTE … AGAINST BILL NO. OS64/25-26000215". Naive
 * bill-key extraction sees the bill number and treats the row as
 * the same key as the original sale — the matcher then SUMS the
 * credit-note amount into the original-bill total, producing a
 * fake amount-mismatch when actually both ledgers agree on the
 * underlying sale.
 *
 * Returning 'cn' / 'dn' makes the caller prefix the bill key with
 * `CN-` / `DN-` so credit-notes-against-bill-X live in their own
 * bucket and the original bill X reconciles cleanly.
 */
function classifyAdjustmentType(narration: string): 'sale' | 'cn' | 'dn' {
  const n = narration.toLowerCase();
  // Order: check "credit note" before "debit note" — both phrases
  // contain "note", but the leading word disambiguates.
  if (/\bcredit\s+note\b|\bcr\s*\.?\s*note\b/.test(n)) return 'cn';
  if (/\bdebit\s+note\b|\bdr\s*\.?\s*note\b/.test(n)) return 'dn';
  return 'sale';
}

export function extractBillKey(tx: { voucher: string | null; narration: string | null }): string | null {
  const narr = tx.narration ?? '';
  const adjustment = classifyAdjustmentType(narr);
  for (const { pattern, capture } of NARRATION_BILL_PATTERNS) {
    const m = pattern.exec(narr);
    if (m) {
      const raw = capture === 'group' ? (m[1] ?? '') : m[0];
      const key = normalizeBillKey(raw);
      if (key) {
        // Credit / debit notes referencing the underlying bill go
        // into their own keyspace so they don't sum into the
        // original-bill totals. Both sides' CN-X / DN-X entries
        // will still match each other; original bill X reconciles
        // unaffected.
        if (adjustment === 'cn') return 'CN-' + key;
        if (adjustment === 'dn') return 'DN-' + key;
        return key;
      }
    }
  }
  const fromVoucher = normalizeBillKey(tx.voucher);
  if (fromVoucher) {
    if (adjustment === 'cn') return 'CN-' + fromVoucher;
    if (adjustment === 'dn') return 'DN-' + fromVoucher;
    return fromVoucher;
  }
  return null;
}

/**
 * Pull a bank-side reference token from a narration — cheque number,
 * UTR, NEFT/IMPS/RTGS reference, or branch transfer code. Used purely
 * for *display* on payment-match rows (so the user can confirm two
 * sides booked the same payment). NOT a matching gate: A's ledger
 * often records its own credit-note number (e.g. "CRN-0232-000655")
 * with no bank info, while B's records the bank reference — gating
 * on bank-ref would miss those legitimate pairs.
 *
 * Returns null when no recognisable bank ref is present.
 */
const BANK_REF_PATTERNS: RegExp[] = [
  // Cheque number — most ledger reconciliations key on this.
  /\b(?:chq\.?|cheque)\s*(?:no\.?|number|#)?\.?\s*(\d{4,16})\b/i,
  // UTR / RRN bank reference.
  /\b(?:UTR|RRN)[\s\-/.:#]*([A-Z0-9]{8,30})\b/i,
  // NEFT / IMPS / RTGS payment ref tokens.
  /\b(?:NEFT|IMPS|RTGS)[\s\-/.:#]*([A-Z0-9]{8,30})\b/i,
];

export function extractBankRef(narration: string | null): string | null {
  if (!narration) return null;
  for (const p of BANK_REF_PATTERNS) {
    const m = p.exec(narration);
    if (m) return m[1] ?? null;
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

  // Payment matcher — pair leftover no-bill rows on each side by
  // date + amount (with ±₹1 tolerance). Many real reconciliations
  // have payments booked on both sides where A wrote a credit-note
  // ref ("CRN-0232-000655") and B wrote a bank receipt ("BANK OF
  // BARODA Chq.No.300625"). No shared bill number, but same date +
  // same amount = same payment. Strong reconciliation signal worth
  // surfacing as its own bucket.
  //
  // Why a tolerance: real OSPL data showed A booking ₹7,37,33,626
  // and B booking ₹7,37,33,625 on the same day (Marg truncates paise,
  // Finsys rounds up). Exact-paise matching missed the pair and the
  // user (correctly) called it out as the same payment. ₹1 covers
  // every rounding-collision case seen so far without admitting
  // unrelated same-day payments (different real payments rarely fall
  // within ₹1 of each other).
  //
  // Algorithm:
  //   1. Group B's no-bill rows by `date` (not date+amount, because
  //      tolerance means a key-based index can't find near-matches).
  //   2. For each A no-bill row, scan the same-day B candidates and
  //      pick the closest within ±₹1. Exact (diff = 0) wins over
  //      tolerated (diff > 0) so a perfect pair is never beaten by
  //      a fuzzy one on the same day.
  //   3. Remaining rows on either side fall through to noBill A/B.
  //
  // Exact-date match for v1. Some reconciliations need ±1 day
  // tolerance (cheque issue date vs clearance date); that can be
  // layered on later if real cases hit it.
  const PAYMENT_AMOUNT_TOLERANCE = 1.0; // rupees
  const paymentMatches: PaymentMatchRow[] = [];
  const matchedBIdx = new Set<number>();
  const byDateB = new Map<string, Array<{ idx: number; tx: FlatTx }>>();
  noBillB.forEach((tx, idx) => {
    if (!tx.date || tx.absAmount === 0) return;
    if (!byDateB.has(tx.date)) byDateB.set(tx.date, []);
    byDateB.get(tx.date)!.push({ idx, tx });
  });
  const leftoverNoBillA: FlatTx[] = [];
  for (const a of noBillA) {
    if (!a.date || a.absAmount === 0) { leftoverNoBillA.push(a); continue; }
    const sameDay = byDateB.get(a.date) ?? [];
    // Pick the closest B-side amount within tolerance. Exact match
    // (diff = 0) beats any tolerated match, so the typical clean
    // case (paise-perfect on both sides) is never derailed by a
    // noisy near-amount that happens to be on the same day.
    let best: { idx: number; tx: FlatTx; diff: number } | null = null;
    for (const c of sameDay) {
      if (matchedBIdx.has(c.idx)) continue;
      const diff = Math.abs(c.tx.absAmount - a.absAmount);
      if (diff <= PAYMENT_AMOUNT_TOLERANCE && (!best || diff < best.diff)) {
        best = { idx: c.idx, tx: c.tx, diff };
      }
    }
    if (best) {
      matchedBIdx.add(best.idx);
      paymentMatches.push({
        date: a.date,
        amountA: a.absAmount,
        amountB: best.tx.absAmount,
        diff: Math.round(best.diff * 100) / 100, // round to paise for display
        narrationA: a.narration,
        narrationB: best.tx.narration,
        bankRefA: extractBankRef(a.narration),
        bankRefB: extractBankRef(best.tx.narration),
      });
    } else {
      leftoverNoBillA.push(a);
    }
  }
  const leftoverNoBillB = noBillB.filter((_, idx) => !matchedBIdx.has(idx));
  // Stable sort by date for stable rendering.
  paymentMatches.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

  // ── Pass 2: unique-date pairing (loose) ─────────────────────────
  //
  // After the tight ±₹1 pass, leftover rows may still represent the
  // SAME underlying payment recorded differently — e.g. A booked
  // "CRN-0232-00656" at ₹73,733,000 and B booked the bank receipt at
  // ₹73,733,626 on the same day. ₹626 is way outside the ±₹1 ERP-
  // rounding window but very likely the same transaction with a real
  // discrepancy worth surfacing.
  //
  // Pair only when a date has EXACTLY ONE leftover A row AND EXACTLY
  // ONE leftover B row. Days with 2+ rows on either side stay in
  // no-bill — without amount as a tiebreaker we'd risk swapping
  // unrelated payments. The user can review the resulting "date
  // matched, amount differs" table and either confirm the pair as
  // the same transaction or treat it as two separate one-sided rows.
  //
  // Bank-only matching (same bank ref, different date) is deliberately
  // NOT attempted: a single bank account processes many payments per
  // year, so same-bank-different-date catches both real clearance
  // gaps AND unrelated transactions. Not enough signal to auto-pair.
  const paymentDateMatches: PaymentMatchRow[] = [];
  if (leftoverNoBillA.length > 0 && leftoverNoBillB.length > 0) {
    const aIdxByDate = new Map<string, number[]>();
    const bIdxByDate = new Map<string, number[]>();
    leftoverNoBillA.forEach((tx, idx) => {
      if (!tx.date) return;
      if (!aIdxByDate.has(tx.date)) aIdxByDate.set(tx.date, []);
      aIdxByDate.get(tx.date)!.push(idx);
    });
    leftoverNoBillB.forEach((tx, idx) => {
      if (!tx.date) return;
      if (!bIdxByDate.has(tx.date)) bIdxByDate.set(tx.date, []);
      bIdxByDate.get(tx.date)!.push(idx);
    });
    const consumedA = new Set<number>();
    const consumedB = new Set<number>();
    for (const [date, aIdxs] of aIdxByDate) {
      const bIdxs = bIdxByDate.get(date);
      if (!bIdxs) continue;
      if (aIdxs.length === 1 && bIdxs.length === 1) {
        const a = leftoverNoBillA[aIdxs[0]];
        const b = leftoverNoBillB[bIdxs[0]];
        const diff = Math.abs(a.absAmount - b.absAmount);
        consumedA.add(aIdxs[0]);
        consumedB.add(bIdxs[0]);
        paymentDateMatches.push({
          date,
          amountA: a.absAmount,
          amountB: b.absAmount,
          diff: Math.round(diff * 100) / 100,
          narrationA: a.narration,
          narrationB: b.narration,
          bankRefA: extractBankRef(a.narration),
          bankRefB: extractBankRef(b.narration),
        });
      }
    }
    // Filter consumed rows out of the leftover lists in place so the
    // noBill arrays returned below reflect rows that survived BOTH
    // passes.
    const filteredA = leftoverNoBillA.filter((_, idx) => !consumedA.has(idx));
    const filteredB = leftoverNoBillB.filter((_, idx) => !consumedB.has(idx));
    leftoverNoBillA.length = 0;
    leftoverNoBillA.push(...filteredA);
    leftoverNoBillB.length = 0;
    leftoverNoBillB.push(...filteredB);
  }
  paymentDateMatches.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

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
    paymentMatchedCount: paymentMatches.length,
    paymentDateMatchedCount: paymentDateMatches.length,
    noBillCountA: leftoverNoBillA.length,
    noBillCountB: leftoverNoBillB.length,
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
      paymentMatchedCount: paymentMatches.length,
      paymentDateMatchedCount: paymentDateMatches.length,
      // Counts reflect rows REMAINING after BOTH payment-matcher
      // passes consumed any pairs. The "noBill" buckets are
      // genuinely-one-sided rows with no bill ref AND no twin
      // payment on the other side.
      noBillCountA: leftoverNoBillA.length,
      noBillCountB: leftoverNoBillB.length,
      grossA, grossB, netA, netB,
      netDifference: netA - netB,
      headline,
    },
    matched,
    amountMismatches,
    onlyInA,
    onlyInB,
    paymentMatches,
    paymentDateMatches,
    noBillA: leftoverNoBillA.map(t => ({ date: t.date, amount: t.absAmount, narration: t.narration })),
    noBillB: leftoverNoBillB.map(t => ({ date: t.date, amount: t.absAmount, narration: t.narration })),
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
  paymentMatchedCount: number;
  paymentDateMatchedCount: number;
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
    const extras: string[] = [];
    if (s.paymentMatchedCount > 0) {
      extras.push(`${s.paymentMatchedCount} payment${s.paymentMatchedCount === 1 ? '' : 's'} matched by date+amount`);
    }
    if (s.paymentDateMatchedCount > 0) {
      extras.push(`${s.paymentDateMatchedCount} more matched by date with amount diff to review`);
    }
    const suffix = extras.length > 0 ? ` (plus ${extras.join('; ')})` : '';
    return `Books tie: all ${s.matchedCount} bills match.${suffix}`;
  }
  const parts: string[] = [];
  if (s.amountMismatchCount > 0) parts.push(`${s.amountMismatchCount} amount mismatch${s.amountMismatchCount === 1 ? '' : 'es'}`);
  if (s.onlyInACount > 0) parts.push(`${s.onlyInACount} bill${s.onlyInACount === 1 ? '' : 's'} only on ${s.typeA} side`);
  if (s.onlyInBCount > 0) parts.push(`${s.onlyInBCount} bill${s.onlyInBCount === 1 ? '' : 's'} only on ${s.typeB} side`);
  const tail: string[] = [];
  if (s.paymentMatchedCount > 0) {
    tail.push(`${s.paymentMatchedCount} payment${s.paymentMatchedCount === 1 ? '' : 's'} matched by date+amount`);
  }
  if (s.paymentDateMatchedCount > 0) {
    tail.push(`${s.paymentDateMatchedCount} more matched by date with amount diff to review`);
  }
  const totalUnmatched = s.noBillCountA + s.noBillCountB;
  if (totalUnmatched > 0) {
    tail.push(`${totalUnmatched} row${totalUnmatched === 1 ? '' : 's'} without bill ref still unmatched`);
  }
  const extra = tail.length > 0 ? ` (${tail.join('; ')})` : '';
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
