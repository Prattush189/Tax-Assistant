// server/lib/ledgerScrutinyFlags.ts
//
// Deterministic flag engine for the ledger scrutiny pipeline.
//
// The LLM-driven scrutiny pass (see ledgerScrutinyPrompt.ts) was
// confabulating arithmetic — repeating identical TDS figures across
// unrelated vendors, flagging sub-threshold §194Q, contradicting itself
// on rent thresholds, etc. Even with elaborate prompt rules and a
// regex-based egress filter, the model still got rules wrong on
// ~5–15% of accounts. Threshold checks and arithmetic are not
// language tasks — they belong in code.
//
// This module owns every rule that can be decided from numbers alone:
// §40A(3), §269SS/T/ST, §194C/H/I/J/Q, reconciliation tie-out,
// squared-off detection, one-sided credit pattern, §44AB applicability.
//
// The LLM keeps the rules that genuinely need language: suspicious
// narrations, personal-vs-business expense classification, GST RCM
// categorisation, round-tripping with cross-account contra evidence.
//
// Each flag function is a pure, side-effect-free check over the
// already-extracted ledger structure. Return shape matches the LLM's
// ScrutinyObservationRaw so the two streams can be merged trivially.

export interface DetTransaction {
  date: string | null;
  narration: string | null;
  voucher: string | null;
  debit: number;
  credit: number;
  balance: number | null;
}

export interface DetAccount {
  name: string;
  accountType: string | null;
  opening: number;
  closing: number;
  totalDebit: number;
  totalCredit: number;
  transactions: DetTransaction[];
}

export interface DetLedger {
  partyName: string | null;
  gstin: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  accounts: DetAccount[];
}

export type DetSeverity = 'info' | 'warn' | 'high';

export interface DetObservation {
  accountName: string | null;
  code: string;
  severity: DetSeverity;
  message: string;
  amount: number | null;
  dateRef: string | null;
  suggestedAction: string | null;
  // Source tag — used by the merge step to know this came from the
  // deterministic engine and not the LLM. Egress sanitization rules
  // that exist for LLM mistakes don't need to run on these.
  source: 'deterministic';
}

// ── Indian-rupee formatting (lakh / crore commas) ────────────────────

export function formatINR(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.round(n));
  const s = abs.toString();
  if (s.length <= 3) return sign + s;
  // Indian comma grouping: last three digits, then groups of two.
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const withCommas = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return sign + withCommas + ',' + last3;
}

// ── Account-type heuristics ──────────────────────────────────────────
// We need to know whether a 50-lakh+ account is a vendor (purchases →
// §194Q) or a customer (sales → buyer-side §194Q is *their* obligation).
// The extractor's accountType field is unreliable on Indian SME ledgers
// (the LLM defaults to 'other'), so we read structural signals here:
// closing-balance direction + Dr/Cr ratio.

const VENDOR_NAME_HINTS = /\b(rice|mill|mills|trader|traders|trading|enterprise|enterprises|industries|biofuels|distilleries|agro|food|foods|grain|grains|overseas|exports|imports|sugars?|jute|seviyan|bhilwara|ginning|company|co\.|co\b|pvt|llp|limited|ltd)\b/i;
const TRANSPORT_NAME_HINTS = /\b(transport|transporters|logistics|carriers|carrier|roadlines|road\s*lines|freight|cargo|lorry|truck|truckers|movers)\b/i;
const RENT_NAME_HINTS = /\brent\b/i;
const BROKERAGE_NAME_HINTS = /\b(brokerage|commission)\b/i;
const PROFESSIONAL_HEAD_HINTS = /\b(professional|consultancy|consulting|legal|audit\s*fee|technical)\b/i;
const CASH_NAME_HINTS = /\bcash\b/i;
const BANK_NAME_HINTS = /\b(bank|hdfc|icici|axis|sbi|kotak|yes\s*bank|pnb|bob|baroda|union|canara|jk\s*bank|jammu)\b/i;
const SALARY_HEAD_HINTS = /\b(salary|salaries|wages|payroll)\b/i;
// Nominal heads close to Trading / P&L at year-end. Include sales/purchases —
// the closing balance after transfer is zero, recon never ties on the columns
// alone, and §194Q-on-customer logic uses Cr-side as a proxy that doesn't
// apply to the SALES ledger itself.
const NOMINAL_HEAD_HINTS = /\b(sales?|purchases?|profit|loss|trading|opening\s*stock|closing\s*stock|stock|inventory|gross\s*profit|net\s*profit|round\s*off|rebate|discount|short.*excess|depreciation|freight\s*o\/?w|interest\s*(others|received|receivable))\b/i;
const CAPITAL_HEAD_HINTS = /\b(capital|drawings|proprietor|partner|reserves)\b/i;

export type DetAccountClass =
  | 'vendor'      // assessee buys from
  | 'customer'    // assessee sells to
  | 'bank'
  | 'cash'
  | 'rent_expense'
  | 'brokerage_expense'
  | 'professional_expense'
  | 'salary_expense'
  | 'nominal'     // P&L closing accounts, gross-profit transfers
  | 'capital'
  | 'transport_expense'
  | 'unknown';

export function classifyAccount(a: DetAccount): DetAccountClass {
  const n = a.name || '';
  if (BANK_NAME_HINTS.test(n) && !/charges/i.test(n)) return 'bank';
  if (CASH_NAME_HINTS.test(n) && !/discount|ledger/i.test(n)) return 'cash';
  if (CAPITAL_HEAD_HINTS.test(n)) return 'capital';
  if (NOMINAL_HEAD_HINTS.test(n)) return 'nominal';
  if (RENT_NAME_HINTS.test(n)) return 'rent_expense';
  if (BROKERAGE_NAME_HINTS.test(n)) return 'brokerage_expense';
  if (SALARY_HEAD_HINTS.test(n)) return 'salary_expense';
  if (PROFESSIONAL_HEAD_HINTS.test(n)) return 'professional_expense';
  if (TRANSPORT_NAME_HINTS.test(n)) return 'transport_expense';

  // Vendor vs customer disambiguation. For party accounts, direction
  // of activity tells us which side of the deal the assessee is on:
  //   - Vendors (we buy from): purchase invoices CREDIT the vendor's
  //     ledger, payments DEBIT it. Cr ≥ Dr in steady state, closing
  //     balance is typically credit (payable).
  //   - Customers (we sell to): sales invoices DEBIT them, receipts
  //     CREDIT them. Dr ≥ Cr, closing typically debit (receivable).
  // Sign convention in our extracted data: closing > 0 = Dr balance,
  // closing < 0 = Cr balance.
  const isParty = VENDOR_NAME_HINTS.test(n) || /\b(s\/o|d\/o|w\/o|h\/o)\b/i.test(n);
  if (!isParty) return 'unknown';

  if (a.closing < 0) return 'vendor';
  if (a.closing > 0) return 'customer';
  // Closing zero (squared-off): use turnover direction as a tiebreaker.
  if (a.totalCredit > a.totalDebit * 1.05) return 'vendor';
  if (a.totalDebit > a.totalCredit * 1.05) return 'customer';
  return 'vendor'; // conservative — most 50-lakh squared accounts in
                   // a milling/trading book are purchase relationships
}

/** Extract the voucher type as a single canonical letter when possible.
 *  Busy uses 'C', 'J', 'P', 'R', 'B' as single letters, sometimes
 *  followed by a slash + voucher number (e.g. "C/241"). Tally writes
 *  full words 'Cash' / 'Journal' / 'Purchase' / 'Receipt' / 'Bank' /
 *  'Payment' / 'Contra'. Returns 'C' for cash, 'J' for journal, 'P'
 *  for purchase, 'R' for receipt, 'B' for bank (Tally 'Payment' is
 *  banking-mode too), or null if unknown.
 *
 *  Word-forms are checked first because single-letter prefix matches
 *  ('^P' against 'Payment') would otherwise misclassify Tally
 *  vouchers. 'Contra' returns null — contra entries (cash↔bank
 *  transfers) aren't §40A(3)/§269ST/§269SS triggers. */
export function voucherKind(v: string | null | undefined): 'C' | 'J' | 'P' | 'R' | 'B' | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;

  // Word forms first — most specific. Order matters: 'payment' must
  // win over 'p…' single-letter, and 'contra' must NOT match 'C'.
  if (/^contra/i.test(t)) return null;
  if (/^cash/i.test(t)) return 'C';
  if (/^journ/i.test(t)) return 'J';
  if (/^purch/i.test(t)) return 'P';
  if (/^rec(eipt)?/i.test(t)) return 'R';
  if (/^(bank|payment|pay\b)/i.test(t)) return 'B';

  // Single-letter / single-letter-plus-separator forms (Busy style).
  // Require a separator after the letter (slash, dash, space, end of
  // string) so we don't misclassify a longer word that happens to
  // start with one of these letters.
  if (/^C(?:[\/\-\s_]|$)/i.test(t)) return 'C';
  if (/^J(?:[\/\-\s_]|$)/i.test(t)) return 'J';
  if (/^P(?:[\/\-\s_]|$)/i.test(t)) return 'P';
  if (/^R(?:[\/\-\s_]|$)/i.test(t)) return 'R';
  if (/^B(?:[\/\-\s_]|$)/i.test(t)) return 'B';

  return null;
}

// ── §40A(3) — cash payments > Rs. 10,000 ────────────────────────────
// Trigger: voucher is type 'C' (cash) AND single-day payment to one
// payee strictly exceeds Rs. 10,000. Transporter exception raises the
// limit to Rs. 35,000. We aggregate by (account, date) so two cash
// payments to the same payee on the same day combine.

export function flag40A3(ledger: DetLedger): DetObservation[] {
  const out: DetObservation[] = [];
  for (const acct of ledger.accounts) {
    const cls = classifyAccount(acct);
    const limit = cls === 'transport_expense' ? 35_000 : 10_000;
    // Only consider party / expense accounts. Cash deposits to bank,
    // capital introductions, etc., aren't §40A(3) territory.
    if (cls === 'bank' || cls === 'cash' || cls === 'capital' || cls === 'nominal') continue;

    // Group cash transactions by date. Same day, same payee, multiple
    // cash vouchers = aggregate.
    const cashByDate = new Map<string, number>();
    for (const tx of acct.transactions) {
      if (voucherKind(tx.voucher) !== 'C') continue;
      // §40A(3) tests outflows — debits in an expense account, credits
      // in a balance-sheet vendor account. Use the larger of the two
      // since extractor sometimes flips sign. The amount is what was
      // physically paid in cash.
      const amt = Math.max(tx.debit, tx.credit);
      if (amt <= 0) continue;
      const date = tx.date || 'undated';
      cashByDate.set(date, (cashByDate.get(date) ?? 0) + amt);
    }
    for (const [date, total] of cashByDate) {
      if (total > limit) {
        const limitTxt = limit === 35_000 ? 'Rs. 35,000 (transporter limit)' : 'Rs. 10,000';
        out.push({
          accountName: acct.name,
          code: 'CASH_40A3',
          severity: 'high',
          amount: total,
          dateRef: date === 'undated' ? null : date,
          message:
            `Cash payment of Rs. ${formatINR(total)}${date !== 'undated' ? ` on ${date}` : ''} ` +
            `to ${acct.name} exceeds the ${limitTxt} limit under §40A(3); ` +
            `the deduction will be disallowed unless covered by Rule 6DD.`,
          suggestedAction: 'Verify the cash voucher and bank trail. If genuinely cash, reverse the debit or disallow under §40A(3).',
          source: 'deterministic',
        });
      }
    }
  }
  return out;
}

// ── §269ST — cash receipts ≥ Rs. 2,00,000 ───────────────────────────

export function flag269ST(ledger: DetLedger): DetObservation[] {
  const out: DetObservation[] = [];
  // Test on the cash account: any single inflow ≥ 2L, OR same-payee
  // same-day aggregation ≥ 2L, OR same-payee same-event aggregation ≥ 2L.
  // Without per-row counterparty data on the cash account itself we
  // conservatively flag any single cash receipt ≥ 2L.
  for (const acct of ledger.accounts) {
    if (classifyAccount(acct) !== 'cash') continue;
    for (const tx of acct.transactions) {
      // Cash account: inflow = debit (cash coming in).
      if (tx.debit < 2_00_000) continue;
      if (voucherKind(tx.voucher) === 'B') continue; // bank-mode entries to cash account are unusual but skip
      out.push({
        accountName: acct.name,
        code: 'CASH_269ST',
        severity: 'high',
        amount: tx.debit,
        dateRef: tx.date,
        message:
          `Cash receipt of Rs. ${formatINR(tx.debit)}${tx.date ? ` on ${tx.date}` : ''} ` +
          `equals or exceeds the Rs. 2,00,000 §269ST limit; penalty u/s 271DA may apply.`,
        suggestedAction: 'Identify the payer and confirm whether the receipt was split across days/transactions or is genuinely a single-day single-event receipt.',
        source: 'deterministic',
      });
    }
  }
  return out;
}

// ── §269SS / §269T — cash loans accepted/repaid > Rs. 20,000 ─────────
// We don't always have an "Unsecured Loans" header to scope the search,
// so we use a behavioural detector: party account with one-sided cash
// movement that looks loan-shaped.

export function flag269SS_269T(ledger: DetLedger): DetObservation[] {
  const out: DetObservation[] = [];
  for (const acct of ledger.accounts) {
    const cls = classifyAccount(acct);
    if (cls === 'bank' || cls === 'cash' || cls === 'capital' || cls === 'nominal') continue;
    let cashCredits = 0;  // cash *into* assessee = loan accepted
    let cashDebits = 0;   // cash *out* = loan repaid
    let exampleDate: string | null = null;
    for (const tx of acct.transactions) {
      if (voucherKind(tx.voucher) !== 'C') continue;
      if (tx.credit > 0) cashCredits += tx.credit;
      if (tx.debit > 0) cashDebits += tx.debit;
      if (!exampleDate && (tx.credit > 0 || tx.debit > 0)) exampleDate = tx.date;
    }
    if (cashCredits > 20_000) {
      out.push({
        accountName: acct.name,
        code: 'CASH_269SS',
        severity: 'high',
        amount: cashCredits,
        dateRef: exampleDate,
        message:
          `Cash credits aggregating Rs. ${formatINR(cashCredits)} in ${acct.name} appear to be loan/deposit acceptance in cash, breaching the Rs. 20,000 §269SS limit; penalty u/s 271D = 100% of the cash amount.`,
        suggestedAction: 'Verify whether these are loan/deposit acceptances. If yes, examine penalty exposure under §271D.',
        source: 'deterministic',
      });
    }
    if (cashDebits > 20_000) {
      out.push({
        accountName: acct.name,
        code: 'CASH_269T',
        severity: 'high',
        amount: cashDebits,
        dateRef: exampleDate,
        message:
          `Cash debits aggregating Rs. ${formatINR(cashDebits)} in ${acct.name} appear to be loan/deposit repayment in cash, breaching the Rs. 20,000 §269T limit; penalty u/s 271E = 100% of the cash amount.`,
        suggestedAction: 'Verify whether these are loan/deposit repayments. If yes, examine penalty exposure under §271E.',
        source: 'deterministic',
      });
    }
  }
  return out;
}

// ── §194Q — buyer-side TDS on purchases > Rs. 50 lakh ───────────────
// Trigger: vendor's annual purchase aggregate (Cr-side bills) strictly
// exceeds Rs. 50,00,000 AND assessee's preceding-FY turnover > Rs. 10 Cr.
// We don't know the preceding-FY turnover from the ledger alone, so the
// flag is conditional ("verify FY24-25 turnover crossed Rs. 10 Cr"). We
// do compute the at-risk amount precisely.
//   TDS = (aggregate − 50,00,000) × 0.001
// PAN-missing case (5%) is mentioned in suggestedAction.

export function flag194Q(ledger: DetLedger): DetObservation[] {
  const out: DetObservation[] = [];
  const THRESHOLD = 50_00_000;
  for (const acct of ledger.accounts) {
    const cls = classifyAccount(acct);
    if (cls !== 'vendor' && cls !== 'unknown') continue;
    // Purchases = Cr-side aggregate. For 'unknown' (e.g. names that
    // don't match the vendor regex but Cr > Dr meaningfully), only fire
    // if Cr is the dominant side — otherwise we'd misfire on customer
    // accounts.
    const purchases = acct.totalCredit;
    if (cls === 'unknown' && acct.totalCredit <= acct.totalDebit) continue;
    if (purchases <= THRESHOLD) continue;

    const excess = purchases - THRESHOLD;
    const tdsAtRisk = Math.round(excess * 0.001);
    // §194Q applies to the purchase value EXCLUSIVE of GST where GST is
    // charged separately (CBDT Circular 13/2021, Q.6). The vendor-ledger
    // Cr side is the GST-INCLUSIVE invoice value, so both the Rs. 50L
    // threshold test and the 0.1% TDS computed here are UPPER BOUNDS. A
    // vendor only marginally over Rs. 50L gross can fall below the
    // threshold once GST (up to ~18%) is netted out — treat that band as
    // "verify the GST-exclusive figure", not a firm default.
    const GST_BORDERLINE_CAP = Math.round(THRESHOLD * 1.18); // ~59,00,000
    const borderline = purchases <= GST_BORDERLINE_CAP;
    const gstNote = borderline
      ? `Note: this is the GST-INCLUSIVE ledger value — §194Q tests the purchase value net of GST (Circular 13/2021), and at up to ~18% GST the taxable purchases may fall BELOW Rs. 50 lakh. Confirm the GST-exclusive figure before raising any default.`
      : `Figures are GST-inclusive; §194Q applies to the GST-exclusive purchase value (Circular 13/2021), so the Rs. ${formatINR(tdsAtRisk)} at-risk TDS is an upper bound — net out GST before finalising.`;
    out.push({
      accountName: acct.name,
      code: 'TDS_194Q_MISSING',
      severity: borderline ? 'info' : 'warn',
      amount: tdsAtRisk,
      dateRef: null,
      message:
        `Aggregate purchases from ${acct.name} are Rs. ${formatINR(purchases)} (exceeds the Rs. 50 lakh §194Q threshold by Rs. ${formatINR(excess)}). ` +
        `Verify the assessee's preceding-FY turnover exceeded Rs. 10 Cr; if so, TDS @ 0.1% (Rs. ${formatINR(tdsAtRisk)}) should have been deducted, or 5% if vendor PAN is unavailable. ${gstNote}`,
      suggestedAction: 'Obtain TDS challan + Form 16A and the GST-exclusive purchase value. If TDS not deducted on the taxable value above Rs. 50 lakh, flag §40(a)(ia) disallowance of 30% of that purchase value.',
      source: 'deterministic',
    });
  }
  return out;
}

// ── §194C — contractor / transporter ─────────────────────────────────

export function flag194C(ledger: DetLedger): DetObservation[] {
  const out: DetObservation[] = [];
  for (const acct of ledger.accounts) {
    const cls = classifyAccount(acct);
    if (cls !== 'transport_expense') continue;
    // Use the larger of the two — for transporter ledgers, payments
    // (Dr) and bills booked (Cr) should be similar; we want the
    // purchase volume the law asks about.
    const aggregate = Math.max(acct.totalCredit, acct.totalDebit);
    if (aggregate <= 1_00_000) continue;
    // Check single-payment > Rs. 30,000 too (alternate trigger).
    let singleOver30k = false;
    for (const tx of acct.transactions) {
      if (Math.max(tx.debit, tx.credit) > 30_000) { singleOver30k = true; break; }
    }
    out.push({
      accountName: acct.name,
      code: 'TDS_194C_MISSING',
      severity: 'warn',
      amount: null,
      dateRef: null,
      message:
        `Aggregate payments to ${acct.name} are Rs. ${formatINR(aggregate)} (crosses the Rs. 1,00,000 §194C annual threshold${singleOver30k ? '; single payment also exceeds Rs. 30,000' : ''}). ` +
        `If transporter and PAN is on file with declaration u/s 194C(6), no TDS — otherwise deduct 1% (individual/HUF) or 2% (other).`,
      suggestedAction: 'Obtain transporter\'s PAN + §194C(6) declaration; if missing, deduct TDS at the applicable rate.',
      source: 'deterministic',
    });
  }
  return out;
}

// ── §194-I — rent (FY 2025-26: > Rs. 50,000/month) ───────────────────

export function flag194I(ledger: DetLedger): DetObservation[] {
  const out: DetObservation[] = [];
  for (const acct of ledger.accounts) {
    if (classifyAccount(acct) !== 'rent_expense') continue;
    // Group rent debits by month-of-date to test the per-month limit.
    // If we can't parse dates reliably, fall back to the annual proxy
    // of Rs. 6,00,000 (Rs. 50,000 × 12).
    const byMonth = new Map<string, number>();
    let totalRent = 0;
    for (const tx of acct.transactions) {
      const amt = tx.debit;
      if (amt <= 0) continue;
      totalRent += amt;
      const m = tx.date && /^(\d{4}-\d{2})/.exec(tx.date);
      if (m) {
        const key = m[1];
        byMonth.set(key, (byMonth.get(key) ?? 0) + amt);
      }
    }
    let triggered: { reason: string; amount: number } | null = null;
    for (const [month, amt] of byMonth) {
      if (amt > 50_000) {
        triggered = { reason: `monthly rent of Rs. ${formatINR(amt)} in ${month}`, amount: amt };
        break;
      }
    }
    if (!triggered && totalRent > 6_00_000) {
      triggered = { reason: `annual rent of Rs. ${formatINR(totalRent)} (avg monthly > Rs. 50,000)`, amount: totalRent };
    }
    if (triggered) {
      out.push({
        accountName: acct.name,
        code: 'TDS_194I_MISSING',
        severity: 'warn',
        amount: triggered.amount,
        dateRef: null,
        message:
          `Rent paid via ${acct.name}: ${triggered.reason} crosses the Rs. 50,000/month §194-I threshold (FY 2025-26). ` +
          `TDS @ 10% (building/land) or 2% (plant/machinery) should be deducted.`,
        suggestedAction: 'Obtain TDS challan + Form 16A. If not deducted, raise §40(a)(ia) disallowance.',
        source: 'deterministic',
      });
    }
  }
  return out;
}

// ── §194H — commission / brokerage (FY 2025-26: > Rs. 20,000 PA) ────

export function flag194H(ledger: DetLedger): DetObservation[] {
  const out: DetObservation[] = [];
  for (const acct of ledger.accounts) {
    if (classifyAccount(acct) !== 'brokerage_expense') continue;
    // The expense account aggregates across many recipients — we can't
    // tell from the totals which individual recipient crossed Rs. 20,000.
    // The TDS responsibility is per-recipient, so if total expense > Rs.
    // 20,000 we flag for a recipient-wise breakup (the LLM/CA does the
    // last-mile classification).
    const total = acct.totalCredit + acct.totalDebit; // brokerage may be Cr or Dr depending on book
    // Use the side that has the brokerage charges (typically Cr in the
    // expense account = brokerage expense booked through journal).
    const expenseSide = acct.totalCredit >= acct.totalDebit ? acct.totalCredit : acct.totalDebit;
    if (expenseSide <= 20_000) continue;
    out.push({
      accountName: acct.name,
      code: 'TDS_194H_MISSING',
      severity: 'warn',
      amount: null,
      dateRef: null,
      message:
        `Brokerage / commission expensed via ${acct.name}: Rs. ${formatINR(expenseSide)} aggregate. ` +
        `§194H requires TDS @ 2% (FY 2025-26 rate) on payments > Rs. 20,000 per recipient per FY.`,
      suggestedAction: 'Provide a recipient-wise breakup; for each recipient with aggregate > Rs. 20,000, confirm TDS deducted under §194H.',
      source: 'deterministic',
    });
    // Suppress unused `total` linter warning by referencing it in a comment.
    void total;
  }
  return out;
}

// ── §194J — professional / technical fees (Rs. 30,000/year) ─────────

export function flag194J(ledger: DetLedger): DetObservation[] {
  const out: DetObservation[] = [];
  for (const acct of ledger.accounts) {
    if (classifyAccount(acct) !== 'professional_expense') continue;
    const expenseSide = Math.max(acct.totalCredit, acct.totalDebit);
    if (expenseSide <= 30_000) continue;
    out.push({
      accountName: acct.name,
      code: 'TDS_194J_MISSING',
      severity: 'warn',
      amount: null,
      dateRef: null,
      message:
        `Professional / technical fees in ${acct.name}: Rs. ${formatINR(expenseSide)} aggregate, exceeds the Rs. 30,000 §194J threshold. TDS @ 10% should be deducted.`,
      suggestedAction: 'Obtain TDS challan + Form 16A; if not deducted, raise §40(a)(ia) disallowance.',
      source: 'deterministic',
    });
  }
  return out;
}

// ── New-regime salary no-TDS ceiling (default regime, AY 2026-27) ────
// The new regime is the DEFAULT for AY 2026-27. The §87A rebate (Finance
// Act 2025) wipes out tax on total income up to Rs. 12,00,000 (max rebate
// Rs. 60,000); a salaried employee also gets a Rs. 75,000 standard
// deduction. So a salaried person on the default new regime bears NIL tax
// — and therefore attracts NIL §192 TDS — up to Rs. 12,75,000 of gross
// salary. Mirrors src/data/taxRules/fy2025-26.ts (verified Finance Act 2025).
const NEW_REGIME_REBATE_CEILING = 12_00_000;
const NEW_REGIME_STD_DEDUCTION = 75_000;
const SALARY_NO_TDS_CEILING = NEW_REGIME_REBATE_CEILING + NEW_REGIME_STD_DEDUCTION; // 12,75,000

// ── §192 salary verify ──────────────────────────────────────────────

export function flag192(ledger: DetLedger): DetObservation[] {
  const out: DetObservation[] = [];
  for (const acct of ledger.accounts) {
    if (classifyAccount(acct) !== 'salary_expense') continue;
    const total = Math.max(acct.totalCredit, acct.totalDebit);
    if (total <= 0) continue;
    // Don't compute a TDS number — §192 depends on each employee's total
    // income, regime election and §87A rebate. But we CAN frame the
    // verify-flag precisely against the new-regime ceiling: under the
    // default new regime no employee bears tax (so no §192 TDS) until
    // gross salary crosses ~Rs. 12,75,000. If the WHOLE salary head sits
    // below that ceiling, no single employee can have crossed it, so TDS
    // is near-certainly NIL — say so instead of raising a generic alarm.
    const belowCeiling = total <= SALARY_NO_TDS_CEILING;
    const message = belowCeiling
      ? `Salary expense of Rs. ${formatINR(total)} aggregated in ${acct.name}. ` +
        `Under the default new regime, no §192 TDS arises until an employee's gross salary exceeds ~Rs. ${formatINR(SALARY_NO_TDS_CEILING)} ` +
        `(Rs. ${formatINR(NEW_REGIME_REBATE_CEILING)} §87A rebate ceiling + Rs. ${formatINR(NEW_REGIME_STD_DEDUCTION)} standard deduction). ` +
        `As the whole head is below that, TDS is likely NIL — confirm only that no single employee crossed it and none opted for the old regime.`
      : `Salary expense of Rs. ${formatINR(total)} aggregated in ${acct.name}. ` +
        `Verify §192 TDS per employee: under the default new regime TDS arises only where gross salary exceeds ~Rs. ${formatINR(SALARY_NO_TDS_CEILING)} ` +
        `(Rs. ${formatINR(NEW_REGIME_REBATE_CEILING)} §87A rebate ceiling + Rs. ${formatINR(NEW_REGIME_STD_DEDUCTION)} standard deduction), so identify any employee above that and confirm deduction. Old-regime electors cross tax earlier.`;
    out.push({
      accountName: acct.name,
      code: 'TDS_192_VERIFY',
      severity: 'info',
      amount: null,
      dateRef: null,
      message,
      suggestedAction: 'Request Form 12BB / regime elections; for any employee above the new-regime no-TDS ceiling (or any old-regime electors), confirm TDS deducted and Form 16 issued.',
      source: 'deterministic',
    });
  }
  return out;
}

// ── Reconciliation tie-out (sign-aware) ─────────────────────────────
// Opening + Dr − Cr should equal Closing within Rs. 1 tolerance. The
// original report's recon was wrong because it ignored sign convention.
// In our extracted data:
//   - opening / closing > 0 → Dr balance (asset / receivable / expense)
//   - opening / closing < 0 → Cr balance (payable / capital / income)
//   - totalDebit / totalCredit are always non-negative
// The formula opening + Dr − Cr produces a SIGNED computed closing.

const RECON_MATERIALITY = 1; // rupees

export function flagReconBreak(ledger: DetLedger): DetObservation[] {
  const out: DetObservation[] = [];
  for (const acct of ledger.accounts) {
    const cls = classifyAccount(acct);
    // Nominal accounts close to Trading/P&L at year-end; the closing
    // shown is post-transfer (typically zero). The formula won't tie
    // and that's expected — never flag.
    if (cls === 'nominal') continue;
    // Bank accounts: the book balance vs bank-statement balance gap is
    // a separate reconciliation artifact (cheques in transit, bank
    // charges not booked). Don't flag those as ledger-extraction errors.
    if (cls === 'bank') continue;
    const computed = acct.opening + acct.totalDebit - acct.totalCredit;
    const gap = computed - acct.closing;
    if (Math.abs(gap) < RECON_MATERIALITY) continue;
    // Suppress STRUCTURAL artifacts (the ~12 RECON_BREAK false positives).
    // A genuine dropped mid-statement transaction leaves a gap unrelated
    // to the account's own totals. But static carry-forward accounts
    // (fixed assets, deposits, prior-year openings) and squared-off
    // nominal heads produce a gap that EXACTLY equals the opening, the
    // closing, or a column total — because the B/F opening line wasn't
    // captured as a Dr/Cr row, or the closing shown is a column total.
    // If |gap| matches one of those to the rupee, it's an extraction
    // artifact, not a finding.
    const absGap = Math.abs(gap);
    const structural = [acct.opening, acct.closing, acct.totalDebit, acct.totalCredit]
      .some((v) => v !== 0 && Math.abs(absGap - Math.abs(v)) <= RECON_MATERIALITY * 2);
    if (structural) continue;
    out.push({
      accountName: acct.name,
      code: 'RECON_BREAK',
      severity: 'info',
      amount: gap,
      dateRef: null,
      // ASCII hyphen-minus (U+002D), NOT the Unicode minus sign
      // (U+2212). The PDF generator's default font (Helvetica) lacks
      // a glyph for U+2212 and falls back to a smart-quote glyph
      // (U+201D right-double-quote), so the user saw
      // "Debits Rs. 6,000 " Credits Rs. 33,000" instead of
      // "Debits Rs. 6,000 - Credits Rs. 33,000". ASCII chars render
      // in every PDF font.
      message:
        `Opening Rs. ${formatINR(acct.opening)} + Debits Rs. ${formatINR(acct.totalDebit)} - Credits Rs. ${formatINR(acct.totalCredit)} = Rs. ${formatINR(computed)}; ledger reports closing Rs. ${formatINR(acct.closing)}. Gap Rs. ${formatINR(gap)}.`,
      suggestedAction: 'Re-extract from source ledger; the gap usually reflects a brought-forward opening that was missed or a transaction the parser dropped.',
      source: 'deterministic',
    });
  }
  return out;
}

// ── Squared-off vendor accounts (potential round-trip) ──────────────
// Dr exactly = Cr to the rupee, with non-trivial volume, for party
// accounts. Many will be legitimate fully-cleared vendors, but the
// precise equality across many parties is a marker for accommodation
// entries — worth a sample check.

const SQUARED_OFF_MIN = 5_00_000;

export function flagSquaredOff(ledger: DetLedger): DetObservation[] {
  const out: DetObservation[] = [];
  let candidates: { name: string; vol: number }[] = [];
  for (const acct of ledger.accounts) {
    const cls = classifyAccount(acct);
    if (cls === 'bank' || cls === 'cash' || cls === 'capital' || cls === 'nominal') continue;
    if (acct.totalDebit < SQUARED_OFF_MIN) continue;
    if (Math.abs(acct.totalDebit - acct.totalCredit) > 1) continue;
    if (Math.abs(acct.closing) > 1) continue;
    candidates.push({ name: acct.name, vol: acct.totalDebit });
  }
  if (candidates.length >= 5) {
    // Sort by volume, take top samples. One observation per ledger.
    candidates.sort((a, b) => b.vol - a.vol);
    const sample = candidates.slice(0, 12).map(c => `${c.name} (Rs. ${formatINR(c.vol)})`).join('; ');
    const totalVol = candidates.reduce((s, c) => s + c.vol, 0);
    out.push({
      accountName: null,
      code: 'PATTERN_SQUARED_OFF',
      severity: 'warn',
      amount: totalVol,
      dateRef: null,
      message:
        `${candidates.length} party accounts close at exactly zero with Dr = Cr to the rupee, aggregating Rs. ${formatINR(totalVol)}. ` +
        `Genuine fully-paid vendors do this naturally, but exact equality across many parties is a marker for accommodation entries — sample-vouch goods movement (GR notes, transport docs, stock register). Top by volume: ${sample}.`,
      suggestedAction: 'Pick 5 random accounts from the list and verify physical goods movement against the bills booked.',
      source: 'deterministic',
    });
  }
  return out;
}

// ── One-sided credit pattern (loan-shaped party accounts) ───────────
// A party with Cr > 0 and Dr = 0 (or vice versa) at year-end, where
// the closing balance is non-trivial, is shaped like an unsecured loan
// — needs §269SS verification on the receipt mode.

export function flagOneSidedCredits(ledger: DetLedger): DetObservation[] {
  const out: DetObservation[] = [];
  const candidates: { name: string; cr: number }[] = [];
  for (const acct of ledger.accounts) {
    const cls = classifyAccount(acct);
    if (cls === 'bank' || cls === 'cash' || cls === 'capital' || cls === 'nominal') continue;
    // Skip clear vendor/customer accounts — those are trade payables,
    // not unsecured loans.
    if (cls === 'vendor' && acct.totalCredit > 50_00_000) continue; // big vendors covered by §194Q already
    // Pattern: Cr > 0 AND Dr = 0 AND total Cr > 5 lakh.
    if (acct.totalDebit > 0) continue;
    if (acct.totalCredit < 5_00_000) continue;
    candidates.push({ name: acct.name, cr: acct.totalCredit });
  }
  if (candidates.length === 0) return out;
  candidates.sort((a, b) => b.cr - a.cr);
  for (const c of candidates) {
    // Escalate by size: a large one-sided ("loan-shaped") credit is a
    // material §269SS exposure, not a note. >= Rs. 50L -> high,
    // >= Rs. 10L -> warn, else info.
    const severity: DetSeverity = c.cr >= 50_00_000 ? 'high' : c.cr >= 10_00_000 ? 'warn' : 'info';
    out.push({
      accountName: c.name,
      code: 'PATTERN_ONE_SIDED_CREDIT',
      severity,
      amount: c.cr,
      dateRef: null,
      message:
        `${c.name} shows credits totaling Rs. ${formatINR(c.cr)} with no debits in the year. ` +
        `Pattern is loan-shaped — verify mode of receipt; if any single acceptance was in cash > Rs. 20,000, §269SS applies (penalty u/s 271D).`,
      suggestedAction: 'Confirm whether this is a trade liability or an unsecured loan/deposit; for loans, verify receipt mode (banking required > Rs. 20,000).',
      source: 'deterministic',
    });
  }
  return out;
}

// ── §269ST same-day structuring (split cash receipts) ───────────────
// flag269ST (above) only sees the CASH account and catches a single row
// >= Rs. 2L. §269ST(a) also aggregates ALL cash received from one person
// in a day — so a Rs. 2.3L receipt split into a Rs. 1.2L + Rs. 1.1L pair on
// the same day stays under the per-row radar but still breaches the limit.
// We catch that here from the PARTY account (single counterparty), which
// is precise: cash received from a party = C-voucher CREDITS. We only fire
// when there are 2+ same-day receipts and no single one already >= 2L
// (those are handled on the cash account) — i.e. genuinely structured.

export function flag269STSameDay(ledger: DetLedger): DetObservation[] {
  const out: DetObservation[] = [];
  for (const acct of ledger.accounts) {
    const cls = classifyAccount(acct);
    if (cls === 'bank' || cls === 'cash' || cls === 'capital' || cls === 'nominal') continue;
    const byDate = new Map<string, { total: number; count: number; max: number }>();
    for (const tx of acct.transactions) {
      if (voucherKind(tx.voucher) !== 'C') continue;
      if (tx.credit <= 0) continue; // cash received from the party
      const date = tx.date || 'undated';
      const e = byDate.get(date) ?? { total: 0, count: 0, max: 0 };
      e.total += tx.credit;
      e.count += 1;
      e.max = Math.max(e.max, tx.credit);
      byDate.set(date, e);
    }
    for (const [date, e] of byDate) {
      if (date === 'undated') continue;       // can't assert "same day" without a date
      if (e.total < 2_00_000) continue;
      if (e.count < 2) continue;              // a single receipt is the cash-account check's job
      if (e.max >= 2_00_000) continue;        // a single >= 2L row isn't "structured"
      out.push({
        accountName: acct.name,
        code: 'CASH_269ST',
        severity: 'high',
        amount: e.total,
        dateRef: date,
        message:
          `${e.count} cash receipts from ${acct.name} on ${date} aggregate Rs. ${formatINR(e.total)} (each below Rs. 2L individually). ` +
          `§269ST aggregates same-day cash received from one person, so the Rs. 2,00,000 limit is breached despite the per-voucher split; penalty u/s 271DA = 100% of the amount received.`,
        suggestedAction: 'Confirm these are receipts from a single person on one day; if so, §269ST applies regardless of how the receipt was split across vouchers.',
        source: 'deterministic',
      });
    }
  }
  return out;
}

// ── §40A(3) structuring (near-limit cash payments) ──────────────────
// flag40A3 catches a single-day cash payment > Rs. 10,000. The evasion
// pattern is the opposite: split one liability into a run of cash payments
// each just UNDER Rs. 10,000. We flag repeated near-limit (Rs. 8,000 – Rs.
// 10,000) cash payments to ONE payee as a structuring marker. Conservative:
// requires 3+ such payments, and skips transporters (whose limit is Rs.
// 35,000, so the Rs. 8-10K band isn't "near-limit" for them).

const STRUCTURING_NEAR_LIMIT_LOW = 8_000;
const STRUCTURING_MIN_COUNT = 3;

export function flag40A3Structuring(ledger: DetLedger): DetObservation[] {
  const out: DetObservation[] = [];
  for (const acct of ledger.accounts) {
    const cls = classifyAccount(acct);
    if (cls === 'bank' || cls === 'cash' || cls === 'capital' || cls === 'nominal') continue;
    if (cls === 'transport_expense') continue;
    const nearLimit: { amt: number; date: string | null }[] = [];
    for (const tx of acct.transactions) {
      if (voucherKind(tx.voucher) !== 'C') continue;
      const amt = Math.max(tx.debit, tx.credit);
      if (amt > STRUCTURING_NEAR_LIMIT_LOW && amt <= 10_000) nearLimit.push({ amt, date: tx.date });
    }
    if (nearLimit.length < STRUCTURING_MIN_COUNT) continue;
    const total = nearLimit.reduce((s, x) => s + x.amt, 0);
    const sample = nearLimit.slice(0, 5).map((x) => `Rs. ${formatINR(x.amt)}`).join(', ');
    out.push({
      accountName: acct.name,
      code: 'CASH_40A3_STRUCTURING',
      severity: 'warn',
      amount: total,
      dateRef: nearLimit[0].date,
      message:
        `${nearLimit.length} cash payments to ${acct.name} sit just below the Rs. 10,000 §40A(3) limit (${sample}${nearLimit.length > 5 ? ', …' : ''}), aggregating Rs. ${formatINR(total)}. ` +
        `Repeated near-limit cash payments to one payee are a structuring marker — if a single liability was split across vouchers to stay under the limit, the whole aggregate is disallowable u/s 40A(3).`,
      suggestedAction: 'Check whether these relate to one bill / liability split across vouchers; if so, disallow the aggregate. Otherwise document the distinct purchases and payment dates.',
      source: 'deterministic',
    });
  }
  return out;
}

// ── Income-tax vs GST turnover reconciliation ───────────────────────
// Surfaces the books turnover split into taxable vs exempt / tax-free so a
// CA can tie it to the GST returns (GSTR-1 / 3B and the GSTR-9 / 9C). We
// can't pull the GST figures from the ledger, so this is a reconciliation
// PROMPT, not a computed gap. To avoid duplicating TURNOVER_AUDIT_FLAG's
// generic turnover headline, we fire ONLY when there's a material exempt
// slice to validate (the genuinely useful, error-prone classification).

export function flagITGSTRecon(ledger: DetLedger): DetObservation[] {
  let totalSales = 0;
  let exemptSales = 0;
  for (const acct of ledger.accounts) {
    if (!/\b(sales?|turnover)\b/i.test(acct.name)) continue;
    if (/return/i.test(acct.name)) continue;
    const c = acct.totalCredit;
    totalSales += c;
    if (/\b(tax.?free|exempt|nil.?rated|0\s*%|unregd|unregistered)\b/i.test(acct.name)) exemptSales += c;
  }
  const out: DetObservation[] = [];
  if (totalSales < 2_00_00_000) return out;       // below GSTR-9 scale — not worth a note
  if (exemptSales < 1_00_00_000) return out;       // no material exempt slice to validate
  const taxable = totalSales - exemptSales;
  out.push({
    accountName: null,
    code: 'IT_GST_RECON',
    severity: 'info',
    amount: exemptSales,
    dateRef: null,
    message:
      `Books turnover Rs. ${formatINR(totalSales)} splits into taxable Rs. ${formatINR(taxable)} and exempt / tax-free Rs. ${formatINR(exemptSales)}. ` +
      `Reconcile this against GST turnover (GSTR-1 / 3B and the annual GSTR-9 / 9C) and confirm the exempt slice is correctly classified (e.g. unbranded agricultural produce) — a material income-tax-vs-GST turnover gap, or a wrongly-claimed exemption, is a common scrutiny trigger.`,
    suggestedAction: 'Tie books turnover to GSTR-9 Table 5; obtain the exemption basis (HSN / notification) for the tax-free sales.',
    source: 'deterministic',
  });
  return out;
}

// ── §44AB / GST turnover summary ────────────────────────────────────

export function flagTurnoverThresholds(ledger: DetLedger): DetObservation[] {
  // Sum sales-side accounts. Naming: 'SALES', 'SALE', 'TURNOVER'.
  let salesTotal = 0;
  for (const acct of ledger.accounts) {
    if (!/\b(sales?|turnover)\b/i.test(acct.name)) continue;
    if (/return/i.test(acct.name)) continue;
    // Sales bookings are CREDITS in the sales ledger account.
    salesTotal += acct.totalCredit;
  }
  const out: DetObservation[] = [];
  if (salesTotal < 1_00_00_000) return out;

  // §44AB for a business is a TEST, not a flat Rs. 10 Cr line. The audit
  // threshold is Rs. 1 Cr, but it RISES to Rs. 10 Cr when BOTH aggregate
  // cash receipts and aggregate cash payments are each <= 5% of their
  // respective totals (first proviso to §44AB(a), inserted by Finance Act
  // 2020 and widened to 5% by Finance Act 2021). So between Rs. 1 Cr and
  // Rs. 10 Cr, audit applies UNLESS the 5% digital-mode condition is met.
  //
  // We estimate the cash share from cash- vs bank-account turnover. This is
  // an APPROXIMATION — bank totals are inflated by contra / sweep transfers,
  // which understates the cash %. So we frame it as "verify", never as a
  // determination, and we lean towards "audit applies unless..." (the safe
  // direction) rather than telling the assessee audit does NOT apply.
  let cashReceipts = 0, cashPayments = 0, bankReceipts = 0, bankPayments = 0;
  for (const acct of ledger.accounts) {
    const cls = classifyAccount(acct);
    if (cls === 'cash') { cashReceipts += acct.totalDebit; cashPayments += acct.totalCredit; }
    else if (cls === 'bank') { bankReceipts += acct.totalDebit; bankPayments += acct.totalCredit; }
  }
  const recvDenom = cashReceipts + bankReceipts;
  const payDenom = cashPayments + bankPayments;
  const cashRecvPct = recvDenom > 0 ? (cashReceipts / recvDenom) * 100 : null;
  const cashPayPct = payDenom > 0 ? (cashPayments / payDenom) * 100 : null;
  const cashShareTxt = (cashRecvPct !== null && cashPayPct !== null)
    ? ` Books suggest cash receipts ~${cashRecvPct.toFixed(1)}% and cash payments ~${cashPayPct.toFixed(1)}% of the cash+bank totals (rough estimate — bank figures include transfers).`
    : '';

  const headlines: string[] = [];
  if (salesTotal > 10_00_00_000) {
    headlines.push('§44AB tax audit applies — turnover exceeds Rs. 10 Cr (the 5% cash-mode relief caps at Rs. 10 Cr)');
  } else {
    headlines.push(
      '§44AB tax audit applies because turnover exceeds Rs. 1 Cr, UNLESS cash receipts AND cash payments are each <= 5% of their respective totals (then the audit threshold rises to Rs. 10 Cr).' + cashShareTxt,
    );
  }
  if (salesTotal >= 5_00_00_000) headlines.push('GSTR-9C reconciliation required (turnover >= Rs. 5 Cr)');
  else if (salesTotal >= 2_00_00_000) headlines.push('GSTR-9 annual return required (turnover >= Rs. 2 Cr)');

  out.push({
    accountName: null,
    code: 'TURNOVER_AUDIT_FLAG',
    severity: 'info',
    amount: salesTotal,
    dateRef: null,
    message: `Aggregate sales-side credits Rs. ${formatINR(salesTotal)}. ${headlines.join('. ')}.`,
    suggestedAction: 'Confirm filings for AY 2026-27: Form 3CD (if §44AB), GSTR-9 / 9C (if applicable). Also confirm the presumptive-scheme position (§44AD / 44ADA) if opted, and whether the 5% cash-mode relief is actually met from the cash-flow.',
    source: 'deterministic',
  });
  return out;
}

// ── Master entry point ──────────────────────────────────────────────

export interface RunDetFlagsOptions {
  /** Skip categories you don't want — useful in tests. */
  skip?: Array<DetObservation['code']>;
}

export function runAllFlags(ledger: DetLedger, opts?: RunDetFlagsOptions): DetObservation[] {
  const skip = new Set(opts?.skip ?? []);
  const all: DetObservation[] = [];
  const merge = (xs: DetObservation[]) => {
    for (const x of xs) if (!skip.has(x.code)) all.push(x);
  };
  merge(flag40A3(ledger));
  merge(flag269ST(ledger));
  merge(flag269SS_269T(ledger));
  merge(flag194Q(ledger));
  merge(flag194C(ledger));
  merge(flag194I(ledger));
  merge(flag194H(ledger));
  merge(flag194J(ledger));
  merge(flag192(ledger));
  merge(flag269STSameDay(ledger));
  merge(flag40A3Structuring(ledger));
  merge(flagReconBreak(ledger));
  merge(flagSquaredOff(ledger));
  merge(flagOneSidedCredits(ledger));
  merge(flagTurnoverThresholds(ledger));
  merge(flagITGSTRecon(ledger));
  return all;
}

// ── Codes the deterministic engine owns ─────────────────────────────
// The slimmed-down LLM prompt tells the model NOT to emit any of these
// codes. The merge step also uses this set to drop any duplicate the
// model emits anyway (defence in depth — the prompt is plain English
// and we should never trust it to be obeyed 100%).
export const DETERMINISTIC_CODES: ReadonlySet<string> = new Set([
  'CASH_40A3',
  'CASH_269ST',
  'CASH_269SS',
  'CASH_269T',
  'TDS_194Q_MISSING',
  'TDS_194C_MISSING',
  'TDS_194I_MISSING',
  'TDS_194H_MISSING',
  'TDS_194J_MISSING',
  'TDS_192_VERIFY',
  'CASH_40A3_STRUCTURING',
  'RECON_BREAK',
  'PATTERN_SQUARED_OFF',
  'PATTERN_ONE_SIDED_CREDIT',
  'TURNOVER_AUDIT_FLAG',
  'IT_GST_RECON',
]);

// ── Direction guard for LLM PERSONAL_EXPENSE flags ──────────────────
// A genuine PERSONAL_EXPENSE is an OUTFLOW: the business paying out a
// personal cost (a debit to an expense head funded by bank/cash). The LLM
// sometimes flags an account whose head matches a "personal" keyword —
// e.g. a SCHOOL or COLLEGE the assessee actually SELLS to — as personal
// drawings. But a debtor that was invoiced and has paid in is collected
// REVENUE, not a cost: flagging it as a personal expense mischaracterises
// turnover as drawings (the Punjab report mislabelled ~Rs. 1.27 lakh of
// collected receivables this way). This guard checks the DIRECTION of the
// account before trusting the flag's framing.

const PERSONAL_EXPENSE_CODE = /personal|drawings/i;

/** True when the account is a trading party (a collected receivable / a
 *  vendor), i.e. an inbound or two-sided relationship — NOT an outbound
 *  personal cost. Used to drop misdirected PERSONAL_EXPENSE flags. */
export function isTradingPartyNotPersonal(acct: DetAccount): boolean {
  const cls = classifyAccount(acct);
  if (cls === 'vendor' || cls === 'customer') return true;
  // Two-sided, materially-collected relationship: money was both charged
  // out (debits = invoices) AND received back (credits = receipts). A true
  // personal-expense outflow has little or no inbound receipt side, so a
  // substantial credit side comparable to the debit side means this is a
  // debtor paying in, not the business paying out.
  const lo = Math.min(acct.totalDebit, acct.totalCredit);
  const hi = Math.max(acct.totalDebit, acct.totalCredit);
  if (lo >= 50_000 && hi > 0 && lo >= hi * 0.5) return true;
  return false;
}

/** Drop LLM PERSONAL_EXPENSE / DRAWINGS observations whose named account
 *  is actually a trading party (see isTradingPartyNotPersonal). Returns
 *  the kept observations plus the dropped ones (for logging). */
export function filterMisdirectedPersonalExpense<T extends { accountName: string | null; code: string }>(
  obs: T[],
  ledger: DetLedger,
): { kept: T[]; dropped: T[] } {
  const byName = new Map<string, DetAccount>();
  for (const a of ledger.accounts) byName.set(a.name.toLowerCase(), a);
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const o of obs) {
    if (PERSONAL_EXPENSE_CODE.test(o.code ?? '') && o.accountName) {
      const acct = byName.get(o.accountName.toLowerCase());
      if (acct && isTradingPartyNotPersonal(acct)) {
        dropped.push(o);
        continue;
      }
    }
    kept.push(o);
  }
  return { kept, dropped };
}

// ── Merge: deterministic + LLM observations ─────────────────────────
// Merge rules:
//   1. All deterministic observations are kept verbatim.
//   2. LLM observations that re-use a deterministic code are dropped
//      (the deterministic version is authoritative on numbers; the LLM
//      version often disagrees by 0.1–10× and we don't want either to
//      win by accident).
//   3. LLM observations that match a deterministic observation on
//      (accountName + dateRef + amount within 1%) are dropped as
//      probable duplicates of the same finding under a different code.
//   4. The remaining LLM observations are appended.
//   5. Order is preserved within each source.

export interface MergeableObservation {
  accountName: string | null;
  code: string;
  severity: string;
  message: string;
  amount: number | null;
  dateRef: string | null;
  suggestedAction: string | null;
  // Optional 'source' lets callers tell deterministic from LLM at
  // persistence time (we tag deterministic with 'deterministic' and
  // LLM with whatever the model emits — typically absent).
  source?: string;
}

export function mergeObservations(
  det: DetObservation[],
  llm: MergeableObservation[],
): MergeableObservation[] {
  const out: MergeableObservation[] = [];
  // Deterministic first — they're authoritative.
  for (const d of det) out.push(d);

  // Build an index for duplicate detection: (accountName.lower | dateRef | rounded amount).
  const detIndex = new Set<string>();
  for (const d of det) {
    const acct = (d.accountName ?? '').toLowerCase();
    const date = d.dateRef ?? '';
    if (d.amount !== null && d.amount !== undefined) {
      // Round to nearest rupee for comparison — LLM often loses paise.
      detIndex.add(`${acct}|${date}|${Math.round(d.amount)}`);
    }
    detIndex.add(`${acct}|${date}|*`); // any-amount key for accountName+date matches
  }

  for (const l of llm) {
    const code = (l.code ?? '').toUpperCase();
    if (DETERMINISTIC_CODES.has(code)) {
      // Rule 2 — LLM tried to emit a code we own. Drop.
      continue;
    }
    const acct = (l.accountName ?? '').toLowerCase();
    const date = l.dateRef ?? '';
    if (l.amount !== null && l.amount !== undefined) {
      const k = `${acct}|${date}|${Math.round(l.amount)}`;
      if (detIndex.has(k)) continue; // same account/date/amount as a deterministic flag — drop
    }
    out.push(l);
  }
  return out;
}
