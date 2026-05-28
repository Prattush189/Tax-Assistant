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

/** Bank-anchored payment match (Pass 3) — looser than PaymentMatchRow.
 *  The two passes above (date+amount±₹1 and unique-date) consumed the
 *  clean cases; this pass picks up pairs where neither date nor amount
 *  alone gave us enough confidence, but the BANK account number is one
 *  we've already seen in successful matches.
 *
 *  Surfaces both row's date AND the date-gap / amount-gap so the user
 *  can sanity-check the pair without re-reading both narrations. */
export interface PaymentBankMatchRow {
  dateA: string | null;
  dateB: string | null;
  /** Signed day delta dateB − dateA. 0 when both rows are on the same
   *  day (matched via the amount-anchor branch of this pass); non-zero
   *  when matched via the date-window branch. */
  dateDeltaDays: number;
  amountA: number;
  amountB: number;
  /** |amountA − amountB| in rupees. 0 when matched via the amount-
   *  anchor branch; non-zero otherwise. */
  diff: number;
  /** The bank fingerprint (account number) that anchored the match —
   *  same string appears in both narrations OR was learned from the
   *  matched-payment set and present in at least one side here. */
  bankAnchor: string;
  /** Which branch of the matching rule fired:
   *    - 'date'   : same date on both sides, amount differs
   *    - 'amount' : amount close (±10%, max ₹10K), dates differ
   *  Drives the UI hint shown next to each row. */
  matchedBy: 'date' | 'amount';
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
    /** Pairs from Pass 3 — bank-anchored fallback. Used a bank account
     *  number learned from the matched-payment set; one of date (±3
     *  days) or amount (±10% / ₹10K cap) had to agree, but not both. */
    paymentBankMatchedCount: number;
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
  paymentBankMatches: PaymentBankMatchRow[];
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
  // Reject pure-alpha keys with no digits — they're never bill
  // numbers. Real bills have a counter (BS-123 → "BS123" has digits;
  // OS64/25-26000216 → "OS642526000216" has digits). Pure alpha
  // keys come from two contamination sources:
  //   - Vch Type words flowing through the voucher fallback when the
  //     ERP's "Type" column is mapped to voucher and the cell is the
  //     bare class name ("Payment", "Journal", "Purchase", "Receipt",
  //     "Contra"). Tally's Detailed Ledger export does this on every
  //     non-bill row; using "JOURNAL" as the bill key bucket-collides
  //     every cross-party "By <party>" journal entry into one bill.
  //   - Narration regex capturing the WORD after "BILL"/"VOUCHER" when
  //     no number follows ("BILL PAYMENT" / "VOUCHER PURCHASE" — Tally
  //     bank-narration shorthand meaning "this NEFT is a bill
  //     payment", not "PAYMENT is the bill ID"). Letting these through
  //     puts every "BILL PAYMENT" row under the synthetic key
  //     "PAYMENT" and they all bucket-collide on the supplier side
  //     too. Rejecting forces the row into the no-bill bucket where
  //     the date+amount payment matcher takes over — the correct
  //     pairing path for these bank-NEFT rows that lack a bill number.
  if (!/\d/.test(s)) return null;
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

/**
 * Pull every plausible bank-account-number-shaped token out of a
 * narration. Used by the Pass 3 (bank-anchored) matcher to learn the
 * set of bank accounts that appear in successfully-matched payments,
 * then locate leftover rows that reference those same accounts.
 *
 * Heuristic: a contiguous digit run of 8–20 chars. Bank account numbers
 * typically sit in this range (Indian PSU banks favour 11–17 digits;
 * cheque numbers are 6 digits). We bias against pure 6-7 digit runs so
 * we don't pick up cheque numbers as "banks" — those are the volatile
 * per-transaction tokens we explicitly want to AVOID anchoring on.
 *
 * Returns an empty array (not null) for narrations with no qualifying
 * runs, so callers can spread directly into a Set.
 *
 * Examples from real OSPL data:
 *   "BANK OF BARODA 71980200000910 Chq.No.310725 BEING AMOUNT RECEIVED"
 *     → ['71980200000910']  (the 14-digit account ID; the 6-digit
 *        cheque number is below the 8-char floor)
 *   "HDFC BANK CC-50200034032231 Chq.No.586503"
 *     → ['50200034032231']
 *   "CRN-0232-00656" → []  (no qualifying digit run)
 */
export function extractBankFingerprints(narration: string | null): string[] {
  if (!narration) return [];
  const out: string[] = [];
  // Boundary on either side to avoid partial-matching inside longer
  // hash-like tokens. Word boundary in regex treats digits as word
  // chars, so we rely on \D / start-of-string on the left and \D /
  // end-of-string on the right.
  const re = /(?<![\w])(\d{8,20})(?![\w])/g;
  for (const m of narration.matchAll(re)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
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
  // `let` (not `const`) — the cross-bucket pass below replaces these
  // with filtered copies after consuming pairs that matched a
  // counterparty's onlyIn* row by date+amount.
  let noBillA: FlatTx[] = [];
  let noBillB: FlatTx[] = [];
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
  // `let` (not `const`) so the digit-tail fallback below can replace
  // these with filtered copies after consuming paired rows.
  let onlyInA: OnlySideRow[] = [];
  let onlyInB: OnlySideRow[] = [];

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

  // ── Cross-bucket date+amount pass ──────────────────────────────────
  //
  // After exact-key bill matching, a very common pattern leaves
  // counterpart rows split across DIFFERENT buckets: one side carries
  // a bill ref (lands in onlyIn*), the other side has the same
  // economic event with NO extractable bill ref (lands in noBill*).
  //
  // Canonical case — ASSA ABLOY × Interio Paradise:
  //   onlyInB:  AAGIN25005315  24/05/2025  ₹2,06,500  "" (Dynamics
  //             invoice voucher; AAGIN is the journal-series prefix
  //             that doesn't appear on the customer's books at all)
  //   noBillA:  (no bill)      24/05/2025  ₹2,06,500  "By ASSA ABLOY
  //             OPENING SOLUTIONS INDIA PRIVATE LIMITED" (Tally
  //             journal posting that records the invoice receipt
  //             without referencing the supplier's voucher number)
  //
  // Same date, same amount, almost certainly the same business event.
  // Neither the exact-key match (different keys: AAGIN25005315 vs
  // nothing) nor the digit-tail fallback (Tally has no key at all,
  // can't extract a tail) nor the payment matcher (operates on
  // noBillA × noBillB, not noBillA × onlyInB) catches them. Without
  // this pass, 21 such pairs hide in plain sight on the Interio
  // Paradise reconciliation.
  //
  // Anti-collision gates:
  //   - Exact date AND amount within ₹1 — looser tolerances make
  //     same-day same-amount false positives plausible.
  //   - Amount ≥ ₹10 — tiny rounding rows ("R OFF" ₹1.97 etc.) are
  //     too easy to collide on.
  //   - Uniqueness on BOTH sides per (date, ₹amount) bucket. If
  //     either side has multiple candidates, the pairing is ambiguous
  //     and the rows stay in their original buckets for human review.
  //
  // Runs BEFORE the digit-tail fallback so a perfect date+amount
  // pair beats a digit-tail-only match (the 25004485 case — the
  // partial-payment row that the digit-tail would otherwise pair
  // with the invoice voucher, even though the journal entry on the
  // same day with the matching amount is the truer counterpart).
  const CROSS_BUCKET_AMOUNT_TOLERANCE = 1.0;
  const CROSS_BUCKET_MIN_AMOUNT = 10.0;
  const consumedNoBillAIdx = new Set<number>();
  const consumedNoBillBIdx = new Set<number>();
  const consumedOnlyABills = new Set<string>();
  const consumedOnlyBBills = new Set<string>();

  // Helper: walk `onlyIn` and try to find a unique date+amount peer
  // on the `noBill` side. Both-side uniqueness gating + index-based
  // consumption tracking are factored out so the two passes (onlyInB
  // × noBillA, onlyInA × noBillB) share one implementation.
  const crossBucketPass = (
    onlyIn: OnlySideRow[],
    noBill: FlatTx[],
    consumedOnlyBills: Set<string>,
    consumedNoBillIdx: Set<number>,
    // direction: 'BA' means onlyIn is side B and noBill is side A
    // (we matched B's bill against A's bill-less row); 'AB' is the
    // opposite. Drives which slot of the MatchedRow the values fill.
    direction: 'BA' | 'AB',
  ): number => {
    if (onlyIn.length === 0 || noBill.length === 0) return 0;
    // Index noBill rows by date for O(1) lookup.
    const noBillByDate = new Map<string, Array<{ idx: number; tx: FlatTx }>>();
    noBill.forEach((tx, idx) => {
      if (!tx.date || tx.absAmount < CROSS_BUCKET_MIN_AMOUNT) return;
      if (!noBillByDate.has(tx.date)) noBillByDate.set(tx.date, []);
      noBillByDate.get(tx.date)!.push({ idx, tx });
    });
    // Uniqueness gate on the onlyIn side: count (date, rounded ₹)
    // occurrences so we can skip ambiguous buckets.
    const onlyCountByKey = new Map<string, number>();
    for (const r of onlyIn) {
      if (!r.date || r.amount < CROSS_BUCKET_MIN_AMOUNT) continue;
      const key = `${r.date}|${Math.round(r.amount)}`;
      onlyCountByKey.set(key, (onlyCountByKey.get(key) ?? 0) + 1);
    }
    let pairCount = 0;
    for (const oRow of onlyIn) {
      if (!oRow.date || oRow.amount < CROSS_BUCKET_MIN_AMOUNT) continue;
      if (consumedOnlyBills.has(oRow.bill)) continue;
      const oKey = `${oRow.date}|${Math.round(oRow.amount)}`;
      // Skip if onlyIn side has multiple candidates at this (date, ₹).
      if ((onlyCountByKey.get(oKey) ?? 0) !== 1) continue;
      // Find noBill candidates on the same date within tolerance,
      // excluding already-consumed.
      const candidates = (noBillByDate.get(oRow.date) ?? []).filter(c =>
        !consumedNoBillIdx.has(c.idx)
        && Math.abs(c.tx.absAmount - oRow.amount) <= CROSS_BUCKET_AMOUNT_TOLERANCE,
      );
      // Skip if noBill side has multiple candidates — can't pick
      // confidently between same-day same-₹ rows.
      if (candidates.length !== 1) continue;
      const cand = candidates[0];
      const diff = direction === 'BA'
        ? cand.tx.absAmount - oRow.amount    // amountA - amountB (B is onlyIn)
        : oRow.amount - cand.tx.absAmount;   // amountA - amountB (A is onlyIn)
      const pair: MatchedRow = direction === 'BA'
        ? {
            bill: oRow.bill,                    // bill comes from B side
            dateA: cand.tx.date,
            dateB: oRow.date,
            amountA: cand.tx.absAmount,
            amountB: oRow.amount,
            narrationA: cand.tx.narration,
            narrationB: oRow.narration,
          }
        : {
            bill: oRow.bill,                    // bill comes from A side
            dateA: oRow.date,
            dateB: cand.tx.date,
            amountA: oRow.amount,
            amountB: cand.tx.absAmount,
            narrationA: oRow.narration,
            narrationB: cand.tx.narration,
          };
      if (Math.abs(diff) <= 1) {
        matched.push(pair);
      } else {
        amountMismatches.push({ ...pair, diff });
      }
      consumedOnlyBills.add(oRow.bill);
      consumedNoBillIdx.add(cand.idx);
      pairCount += 1;
    }
    return pairCount;
  };

  const pairedFromB = crossBucketPass(onlyInB, noBillA, consumedOnlyBBills, consumedNoBillAIdx, 'BA');
  const pairedFromA = crossBucketPass(onlyInA, noBillB, consumedOnlyABills, consumedNoBillBIdx, 'AB');
  if (pairedFromA > 0 || pairedFromB > 0) {
    console.log(`[ledgerBillMatcher] cross-bucket date+amount paired ${pairedFromB} (onlyInB↔noBillA) + ${pairedFromA} (onlyInA↔noBillB)`);
    onlyInA = onlyInA.filter(r => !consumedOnlyABills.has(r.bill));
    onlyInB = onlyInB.filter(r => !consumedOnlyBBills.has(r.bill));
    noBillA = noBillA.filter((_, idx) => !consumedNoBillAIdx.has(idx));
    noBillB = noBillB.filter((_, idx) => !consumedNoBillBIdx.has(idx));
  }

  // ── Digit-tail fallback ────────────────────────────────────────────
  //
  // Exact key match has run; whatever didn't pair sits in onlyInA /
  // onlyInB. Cross-ERP reconciliations often leave both sides citing
  // the same physical bill but with DIFFERENT prefixes attached:
  //
  //   - Tally narration → "BILL 25004485" → key "25004485"
  //   - Dynamics AX voucher → "AA-GIN25004485" → key "AAGIN25004485"
  //
  // Both clearly reference invoice counter 25004485, but the "AAGIN"
  // is Dynamics's journal-series code (ERP-internal, doesn't appear
  // on the counterparty's books). Exact-key matching can't pair them.
  //
  // Digit-tail fallback: extract the trailing 6+ digit run from each
  // unmatched bill. If the same tail appears exactly ONCE on the A
  // side AND exactly ONCE on the B side, pair them. The display key
  // becomes "A ↔ B" so the user can see both forms.
  //
  // Anti-collision gates:
  //   - Tail length ≥ 6. Bill counters with fewer digits are common
  //     (BS-123, JV-99) and create cross-prefix false-positives too
  //     easily ("BS-123" ↔ "VR-123" — different series, same counter).
  //     6-digit counters indicate a high-volume invoicing series
  //     where same-tail collisions across unrelated bills are
  //     vanishingly rare.
  //   - Uniqueness on BOTH sides. If A has two bills sharing the same
  //     tail, or B does, we can't tell which to pair with which —
  //     leave them in onlyIn* for human review.
  //   - The OSPL Marg-vs-Finsys case is unaffected: both sides keep
  //     the "OS64" series prefix so the digit-tails already matched
  //     via exact-key. The fallback only fires when exact-key missed
  //     in the first pass.
  const DIGIT_TAIL_MIN = 6;
  const digitTail = (billKey: string): string | null => {
    // Strip our adjustment-class prefix ("CN-" / "DN-") before reading
    // the tail so credit-note keys still pair against their bill series.
    const stripped = billKey.replace(/^(?:CN|DN)-/, '');
    const m = /(\d{6,})$/.exec(stripped);
    return m ? m[1] : null;
  };

  if (onlyInA.length > 0 && onlyInB.length > 0) {
    // Count tail occurrences on each side so we can gate on uniqueness.
    const tailCountA = new Map<string, number>();
    const tailCountB = new Map<string, number>();
    for (const r of onlyInA) {
      const t = digitTail(r.bill);
      if (t) tailCountA.set(t, (tailCountA.get(t) ?? 0) + 1);
    }
    for (const r of onlyInB) {
      const t = digitTail(r.bill);
      if (t) tailCountB.set(t, (tailCountB.get(t) ?? 0) + 1);
    }
    // Index B rows by tail for O(1) lookup during the A pass.
    const bByTail = new Map<string, OnlySideRow>();
    for (const r of onlyInB) {
      const t = digitTail(r.bill);
      if (t && tailCountB.get(t) === 1) bByTail.set(t, r);
    }
    const consumedABills = new Set<string>();
    const consumedBBills = new Set<string>();
    for (const aRow of onlyInA) {
      const t = digitTail(aRow.bill);
      if (!t) continue;
      if (tailCountA.get(t) !== 1) continue;       // ambiguous on A
      const bRow = bByTail.get(t);
      if (!bRow) continue;                          // no unique B counterpart
      if (consumedBBills.has(bRow.bill)) continue;  // already paired (defensive)
      const diff = aRow.amount - bRow.amount;
      // Display key shows BOTH original bill strings so the user can
      // see what the matcher paired (and audit if the pairing looks
      // wrong — e.g. a coincidental 6-digit collision between two
      // unrelated business relationships).
      const displayBill = `${aRow.bill} ↔ ${bRow.bill}`;
      const pair = {
        bill: displayBill,
        dateA: aRow.date,
        dateB: bRow.date,
        amountA: aRow.amount,
        amountB: bRow.amount,
        narrationA: aRow.narration,
        narrationB: bRow.narration,
      };
      // ₹1 tolerance for matched (same paise-rounding rule the
      // exact-key pass uses); anything bigger is a real divergence
      // worth surfacing as a mismatch even though the bill aligned.
      if (Math.abs(diff) <= 1) {
        matched.push(pair);
      } else {
        amountMismatches.push({ ...pair, diff });
      }
      consumedABills.add(aRow.bill);
      consumedBBills.add(bRow.bill);
    }
    if (consumedABills.size > 0) {
      console.log(`[ledgerBillMatcher] digit-tail fallback paired ${consumedABills.size} bill${consumedABills.size === 1 ? '' : 's'} across cross-prefix keys`);
    }
    // Remove consumed rows from the only-in buckets.
    onlyInA = onlyInA.filter(r => !consumedABills.has(r.bill));
    onlyInB = onlyInB.filter(r => !consumedBBills.has(r.bill));
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

  // ── Pass 3: bank-anchored pairing (loosest) ─────────────────────
  //
  // Learn the set of bank account numbers that appear in successfully
  // matched payment narrations (from passes 1 and 2 above). A leftover
  // no-bill row whose narration contains one of these "known" bank
  // accounts is almost certainly another payment from the same banking
  // relationship — worth attempting a fuzzy pair.
  //
  // Pairing rule (per user request): bank fingerprint must appear in at
  // least one side's narration AND either
  //   (a) DATES match within ±3 days (catches cheque-issue vs clearance
  //       gaps where amount agrees but the two ledgers booked on
  //       adjacent days), OR
  //   (b) AMOUNTS match within ±10% capped at ₹10,000 (catches the
  //       same transaction recorded with a real discrepancy — TDS
  //       deduction, bank charge swallowed on one side).
  // The "either-or" condition is intentionally loose. False positives
  // surface to the user in their own bucket for review, so the cost of
  // a wrong pair is "user ignores a row in the new table", not "wrong
  // reconciliation". The narrow buckets (passes 1 & 2) still consume
  // the clean cases first.
  //
  // Asymmetry note: the OSPL test case has banks only in B's narrations
  // ("BANK OF BARODA 71980200000910"), while A only has CRN refs. The
  // fingerprint set is therefore mostly B-side. We still require the
  // anchor to appear on AT LEAST one side of the candidate pair — so
  // an A row with no bank info can pair with a B row that uses a
  // known bank, but two A rows with no bank info cannot pair with each
  // other through this pass.
  const PASS3_DATE_WINDOW_DAYS = 3;
  const PASS3_AMOUNT_REL_TOL = 0.10;
  const PASS3_AMOUNT_ABS_CAP = 10_000;
  const knownBankFingerprints = new Set<string>();
  for (const m of paymentMatches) {
    extractBankFingerprints(m.narrationA).forEach(f => knownBankFingerprints.add(f));
    extractBankFingerprints(m.narrationB).forEach(f => knownBankFingerprints.add(f));
  }
  for (const m of paymentDateMatches) {
    extractBankFingerprints(m.narrationA).forEach(f => knownBankFingerprints.add(f));
    extractBankFingerprints(m.narrationB).forEach(f => knownBankFingerprints.add(f));
  }

  /** Find the first known bank fingerprint that appears in a narration,
   *  or null if none do. We return the matching fingerprint (not just a
   *  boolean) so the UI can show the user which bank anchored the pair. */
  const findKnownBank = (narration: string): string | null => {
    if (knownBankFingerprints.size === 0) return null;
    const found = extractBankFingerprints(narration);
    for (const f of found) {
      if (knownBankFingerprints.has(f)) return f;
    }
    return null;
  };

  /** Day delta between two YYYY-MM-DD strings, or null if either is
   *  unparseable. Positive when dateB is after dateA. */
  const daysBetween = (dateA: string | null, dateB: string | null): number | null => {
    if (!dateA || !dateB) return null;
    const a = new Date(dateA).getTime();
    const b = new Date(dateB).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.round((b - a) / (24 * 60 * 60 * 1000));
  };

  const paymentBankMatches: PaymentBankMatchRow[] = [];
  if (knownBankFingerprints.size > 0 && leftoverNoBillA.length > 0 && leftoverNoBillB.length > 0) {
    // Pre-compute the bank anchor and "is candidate" flag for each
    // leftover row. A row is a candidate iff its narration contains a
    // known fingerprint. We still allow non-candidate rows to PAIR
    // (the OSPL case: A's CRN rows have no bank info but are valid
    // counterparts), as long as their B counterpart IS a candidate.
    const aCandidates = leftoverNoBillA.map((tx) => ({
      tx, bank: findKnownBank(tx.narration),
    }));
    const bCandidates = leftoverNoBillB.map((tx) => ({
      tx, bank: findKnownBank(tx.narration),
    }));
    const consumedA = new Set<number>();
    const consumedB = new Set<number>();
    // Greedy pass over A rows. For each A row, find the best B row
    // satisfying (anchor on at least one side) AND (date-OR-amount
    // criterion). Best = smallest combined "distance" (date diff in
    // days + amount diff in rupees, both normalised) so a near-perfect
    // pair beats a borderline one when both qualify.
    for (let ai = 0; ai < aCandidates.length; ai++) {
      const a = aCandidates[ai];
      if (!a.tx.date || a.tx.absAmount === 0) continue;
      let best: {
        bi: number;
        b: typeof bCandidates[number];
        matchedBy: 'date' | 'amount';
        dateDelta: number;
        diff: number;
      } | null = null;
      for (let bi = 0; bi < bCandidates.length; bi++) {
        if (consumedB.has(bi)) continue;
        const b = bCandidates[bi];
        if (!b.tx.date || b.tx.absAmount === 0) continue;
        // Need at least one side to carry a known bank fingerprint.
        const hasAnchor = a.bank !== null || b.bank !== null;
        if (!hasAnchor) continue;
        const dayGap = daysBetween(a.tx.date, b.tx.date);
        const amtDiff = Math.abs(a.tx.absAmount - b.tx.absAmount);
        const amtCap = Math.min(PASS3_AMOUNT_ABS_CAP, a.tx.absAmount * PASS3_AMOUNT_REL_TOL);
        const dateOk = dayGap !== null && Math.abs(dayGap) <= PASS3_DATE_WINDOW_DAYS;
        const amountOk = amtDiff <= amtCap;
        if (!dateOk && !amountOk) continue;
        // matchedBy = which axis was the stronger fit. If dates agree
        // exactly (gap = 0) we report 'date' regardless of amount;
        // otherwise the tighter axis wins.
        const matchedBy: 'date' | 'amount' =
          (dateOk && (!amountOk || Math.abs(dayGap!) === 0)) ? 'date' : 'amount';
        // Distance score for greedy pick — prefer pairs where both
        // axes fit, then prefer smaller date gap, then smaller amount
        // gap. Normalise so the date and amount components are roughly
        // comparable in magnitude.
        const score =
          (dateOk ? Math.abs(dayGap!) : PASS3_DATE_WINDOW_DAYS + 1) +
          (amountOk ? (amtDiff / Math.max(1, amtCap)) : 1.1);
        if (!best || score < (
          (best.matchedBy === 'date' ? Math.abs(best.dateDelta) : PASS3_DATE_WINDOW_DAYS + 1) +
          (best.matchedBy === 'amount' ? (best.diff / Math.max(1, PASS3_AMOUNT_ABS_CAP)) : 1.1)
        )) {
          best = { bi, b, matchedBy, dateDelta: dayGap ?? 0, diff: amtDiff };
        }
      }
      if (best) {
        consumedA.add(ai);
        consumedB.add(best.bi);
        const anchor = a.bank ?? best.b.bank ?? '';
        paymentBankMatches.push({
          dateA: a.tx.date,
          dateB: best.b.tx.date,
          dateDeltaDays: best.dateDelta,
          amountA: a.tx.absAmount,
          amountB: best.b.tx.absAmount,
          diff: Math.round(best.diff * 100) / 100,
          bankAnchor: anchor,
          matchedBy: best.matchedBy,
          narrationA: a.tx.narration,
          narrationB: best.b.tx.narration,
          bankRefA: extractBankRef(a.tx.narration),
          bankRefB: extractBankRef(best.b.tx.narration),
        });
      }
    }
    // Drop the consumed rows from the leftover lists.
    const filteredA = leftoverNoBillA.filter((_, idx) => !consumedA.has(idx));
    const filteredB = leftoverNoBillB.filter((_, idx) => !consumedB.has(idx));
    leftoverNoBillA.length = 0;
    leftoverNoBillA.push(...filteredA);
    leftoverNoBillB.length = 0;
    leftoverNoBillB.push(...filteredB);
  }
  paymentBankMatches.sort((a, b) => (a.dateA ?? '').localeCompare(b.dateA ?? ''));

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
    paymentBankMatchedCount: paymentBankMatches.length,
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
      paymentBankMatchedCount: paymentBankMatches.length,
      // Counts reflect rows REMAINING after ALL THREE payment-matcher
      // passes consumed pairs. The "noBill" buckets are
      // genuinely-one-sided rows with no bill ref, no twin payment
      // on the other side, and no bank-anchor hit.
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
    paymentBankMatches,
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
  paymentBankMatchedCount: number;
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
    if (s.paymentBankMatchedCount > 0) {
      extras.push(`${s.paymentBankMatchedCount} via bank anchor (loose) to review`);
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
  if (s.paymentBankMatchedCount > 0) {
    tail.push(`${s.paymentBankMatchedCount} via bank anchor (loose) to review`);
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
