/**
 * Per-bank deterministic column rules.
 *
 * For known bank layouts (HDFC, ICICI, Canara) we don't need the
 * column-mapping wizard or AI vision: the table structure is fixed,
 * the column headers are stable, and the grid extractor already
 * captures the columnHeaders string for each anchor. We match the
 * extracted headers against a per-bank header→role table and emit a
 * ColumnMapping the wizard would otherwise have built interactively.
 *
 * If grid extraction worked but the bank doesn't match any rule, OR
 * the grid is missing a required column, we return null — caller
 * falls back to the interactive wizard or AI vision. AI vision is
 * therefore reserved for genuinely unreadable PDFs (no text layer,
 * scanned image, OCR-only) plus banks we haven't carved a rule for
 * yet.
 */

import { parseDate, type ColumnMapping, type ColumnRole, type PdfGrid } from './pdfGrid';

interface BankRule {
  /** Display name surfaced in console + future UI hints. */
  name: string;
  /** Lowercase substrings (or regex) searched for in the first ~30
   *  grid rows. Any match counts as a positive fingerprint hit.
   *  Header banners, page footers, and statement titles all
   *  contribute. Use a regex when the substring is too generic on
   *  its own — IFSC prefixes (icic0, yesb0, jaka0) appear inside
   *  beneficiary narrations on RTGS/NEFT receipts, so we require
   *  them to sit next to the "IFSC Code:" label which only the
   *  owning bank's banner has. */
  fingerprints: Array<string | RegExp>;
  /** Header → role table. Iterated in order for each grid column;
   *  first matching pattern wins. List the more specific patterns
   *  first ("Value Dt" before plain "Date", "Closing Balance" before
   *  any other balance variant) so the right role wins. Optional —
   *  a rule can be purely positional (see `positional` below) for
   *  formats where the PDF has no transaction-header row at all
   *  (JKBANK DCR / CASH CREDIT SCHEME is the canonical case). */
  headerRules?: Array<{ pattern: RegExp; role: ColumnRole }>;
  /** Roles that MUST be present after mapping for the rule to fire.
   *  Missing any one of these means grid extraction didn't surface
   *  the full table — bail and fall back. Required when headerRules
   *  is set; ignored for positional rules. */
  required?: ColumnRole[];
  /** Positional fallback: when the PDF has no transaction-header row
   *  (some legacy bank exports just print the metadata banner then
   *  jump straight into transaction rows), match by column INDEX
   *  with content verification. Mutually exclusive with headerRules
   *  in practice — set one or the other. */
  positional?: {
    /** Exact columnCount the rule expects. Cheap structural gate
     *  before the verify callback runs. */
    columnCount: number;
    /** Role assignment per column index. `roles[i]` is the role
     *  that column i carries. Length must equal columnCount. */
    roles: ColumnRole[];
    /** Content-based verification — confirms the grid matches the
     *  layout we think it does before we trust the positional
     *  mapping. Runs after the columnCount gate. Returns true to
     *  fire, false to fall through to other rules / wizard. */
    verify: (grid: PdfGrid) => boolean;
  };
}

const HDFC: BankRule = {
  name: 'HDFC Bank',
  fingerprints: [
    'hdfc bank limited',
    'hdfc bank ltd',
    'hdfc bank house',
    'we understand your world',
  ],
  headerRules: [
    { pattern: /value\s*(?:date|dt)/i, role: 'valueDate' },
    { pattern: /closing\s*bal|^balance/i, role: 'balance' },
    { pattern: /withdraw/i, role: 'debit' },
    { pattern: /deposit/i, role: 'credit' },
    { pattern: /chq|cheque|ref\.?\s*no|reference|utr/i, role: 'reference' },
    { pattern: /narration|particulars|remarks|description/i, role: 'narration' },
    { pattern: /^date$|transaction\s*date|txn\s*date/i, role: 'date' },
  ],
  required: ['date', 'narration', 'debit', 'credit', 'balance'],
};

const ICICI: BankRule = {
  name: 'ICICI Bank',
  fingerprints: [
    'icici bank limited',
    'icici bank ltd',
    'statement of transactions in saving account',
    'team icici bank',
    'www.icici.bank.in',
    // ICICI's "Detailed Statement" web export (the new corporate
    // format) doesn't include the bank-name boilerplate in the first
    // 30 rows — the only ICICI-distinctive markers in the banner are
    // the title "Detailed Statement" and the IFSC prefix "ICIC0".
    // Both are unique to ICICI and safe to add.
    'detailed statement',
    // IFSC prefix fingerprint, anchored to the "IFSC Code:" label so
    // it doesn't false-fire on RTGS narrations like "...PAYTM-ICIC00..."
    // that quote a beneficiary's IFSC.
    /ifsc[^a-z]{0,8}icic0/i,
  ],
  headerRules: [
    { pattern: /balance/i, role: 'balance' },
    { pattern: /withdraw/i, role: 'debit' },
    { pattern: /deposit/i, role: 'credit' },
    { pattern: /cheque\s*number|chq\.?|ref\.?\s*no|reference|utr/i, role: 'reference' },
    { pattern: /transaction\s*remarks|^remarks|narration|particulars/i, role: 'narration' },
    // ICICI's compact statement prints "Transaction" / "Date" as a
    // two-line column header; the grid extractor sometimes captures
    // only "Transaction". Accept that variant — the date-content
    // verification step downstream will reject any false-positive
    // assignment to a column that doesn't actually contain dates.
    { pattern: /^transaction$|transaction\s*date|^date$|txn\s*date/i, role: 'date' },
    // S No. column has no header word the extractor recognises, so it
    // stays as 'skip' — no rule fires. That's fine.
  ],
  required: ['date', 'narration', 'debit', 'credit', 'balance'],
};

const CANARA: BankRule = {
  name: 'Canara Bank',
  fingerprints: [
    'canara bank',
    'syndicate bank',
    /ifsc[^a-z]{0,8}cnrb0/i,
  ],
  headerRules: [
    { pattern: /^balance$|closing\s*bal/i, role: 'balance' },
    // Canara prints plural forms — "Withdrawals" / "Deposits".
    { pattern: /withdraw/i, role: 'debit' },
    { pattern: /deposit/i, role: 'credit' },
    { pattern: /particulars|narration|description|remarks/i, role: 'narration' },
    { pattern: /^date$|transaction\s*date/i, role: 'date' },
  ],
  required: ['date', 'narration', 'debit', 'credit', 'balance'],
};

const PNB: BankRule = {
  name: 'Punjab National Bank',
  fingerprints: [
    // PNB's statement banner is unusually anonymous — the bank name
    // doesn't appear in the header zone at all. The IFSC prefix
    // "PUNB0" is the most reliable tell, plus "Customer Care No.:"
    // wrapped with the 1800 1800 / 1800 2021 PNB-specific helpline
    // numbers and the "CKYC No.:" label that PNB uses (other banks
    // write it as "cKYC Id" / "CKYC NO."). Account number prefix
    // 31xx is also a PNB tell but too narrow to fingerprint on.
    /ifsc[^a-z]{0,8}punb0/i,
    'punjab national bank',
    '1800 1800/1800 2021',
  ],
  headerRules: [
    // PNB's column order on the e-statement is unusual: Date, then
    // Withdrawal, Deposit, CHQ. NO., Balance, Narration (narration
    // last, not after date). The header→role map is order-agnostic
    // so it still works.
    { pattern: /balance/i, role: 'balance' },
    { pattern: /withdraw/i, role: 'debit' },
    { pattern: /deposit/i, role: 'credit' },
    { pattern: /chq\.?\s*no|cheque\s*no|ref\.?\s*no|reference|utr/i, role: 'reference' },
    { pattern: /narration|particulars|description|remarks/i, role: 'narration' },
    { pattern: /^date$|tran\s*date|transaction\s*date/i, role: 'date' },
  ],
  required: ['date', 'narration', 'debit', 'credit', 'balance'],
};

const YES_BANK: BankRule = {
  name: 'Yes Bank',
  fingerprints: [
    // Yes Bank prints "STATEMENT OF ACCOUNT" + "YES BANK LTD" right
    // at the top, plus the YESB IFSC prefix. The bank-name string
    // alone is unambiguous (no other bank uses "yes bank").
    'yes bank ltd',
    'yes bank limited',
    /ifsc[^a-z]{0,8}yesb0/i,
  ],
  headerRules: [
    { pattern: /balance/i, role: 'balance' },
    { pattern: /^debits?$|withdraw|^dr$/i, role: 'debit' },
    { pattern: /^credits?$|deposit|^cr$/i, role: 'credit' },
    { pattern: /value\s*date/i, role: 'valueDate' },
    { pattern: /reference|utr|chq|cheque|ref\.?\s*no/i, role: 'reference' },
    { pattern: /description|narration|particulars|remarks/i, role: 'narration' },
    { pattern: /^txn\s*date|^transaction\s*date|^tran\s*date|^date$/i, role: 'date' },
  ],
  required: ['date', 'narration', 'debit', 'credit', 'balance'],
};

const JK_BANK: BankRule = {
  name: 'J&K Bank',
  fingerprints: [
    // Jammu & Kashmir Bank has three distinct e-statement formats —
    // legacy DCR (CASH CREDIT SCHEME / loan-recovery report), modern
    // savings export, and "DETAILED ACCOUNT STATEMENT" CC export.
    // The savings/loan formats include the full bank name; the CC
    // export hides it but uses the unique title "DETAILED ACCOUNT
    // STATEMENT" (note: ICICI's similar tell is "Detailed Statement"
    // without "Account" — different string, no collision).
    'jammu and kashmir bank',
    'j&k bank',
    /ifsc[^a-z]{0,8}jaka0/i,
    'detailed account statement',
  ],
  headerRules: [
    { pattern: /balance/i, role: 'balance' },
    // JKBank's CC format uses parenthesised currency: "Withdrawal(INR)".
    // The extractor preserves that as "Withdrawal(INR)" — a /withdraw/
    // substring still matches.
    { pattern: /withdraw/i, role: 'debit' },
    { pattern: /deposit/i, role: 'credit' },
    { pattern: /chq\.?\s*no|cheque\s*no|ref\.?\s*no|^ref$|transaction\s*ref|reference|utr/i, role: 'reference' },
    { pattern: /value\s*date/i, role: 'valueDate' },
    { pattern: /particulars|narration|description|remarks/i, role: 'narration' },
    { pattern: /transaction\s*date|^txn\s*date|^date$|^tran\s*date/i, role: 'date' },
    // JKBank's DCR / CASH CREDIT SCHEME format (FORMAT-1 in our
    // fixture set) extracts as `TYPE: | DATE: | CREDIT | "" | "" | ""`
    // — three of the six grid columns have no header text and the
    // amount columns get bunched into one. That layout doesn't
    // satisfy the `required` set (no narration, no debit), so the
    // detector returns null and the upload falls through to the
    // wizard. That's the right outcome — there's no clean column
    // mapping to extract.
  ],
  required: ['date', 'narration', 'debit', 'credit', 'balance'],
};

// J&K Bank's legacy DCR / CASH CREDIT SCHEME export (FORMAT-1) prints
// a metadata banner ("JAMMU AND KASHMIR BANK LTD" / "TYPE: CASH CREDIT
// SCHEME" / customer address) and then jumps straight into transaction
// rows with NO column-header row. The grid extractor's header-detection
// heuristic latches onto the metadata banner ("TYPE:", "DATE:", "CREDIT"
// inside "CASH CREDIT SCHEME") and produces a degenerate column layout —
// the JK_BANK header rule then bails because none of withdraw/deposit/
// balance words appear as a header. Fall through to wizard was the
// previous behaviour and the wizard preview also shows metadata rows
// rather than transactions, leaving the user no usable mapping.
//
// Layout, by column index (six columns, fixed positions):
//   0 — date (dd-mm-yyyy)
//   1 — narration (spans two grid rows per transaction)
//   2 — empty (spacer)
//   3 — debit (withdrawal)
//   4 — credit (deposit, repayment)
//   5 — running balance with "Dr" / "Cr" suffix (e.g. "510239.27Dr")
//
// The unique fingerprint is "CASH CREDIT SCHEME" (the literal string
// printed in the TYPE field). Verification confirms the column layout
// before we commit to the positional mapping — col 0 must hold dates
// and col 5 must hold Dr/Cr-suffixed balances.
const JK_BANK_DCR: BankRule = {
  name: 'J&K Bank (Cash Credit Scheme)',
  fingerprints: [
    'cash credit scheme',
  ],
  positional: {
    columnCount: 6,
    roles: ['date', 'narration', 'skip', 'debit', 'credit', 'balance'],
    verify: (grid) => {
      // Col 0: at least 5 date-shaped entries.
      const datePat = /^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/;
      const dateCount = grid.rows.reduce(
        (acc, r) => acc + (datePat.test((r[0] ?? '').trim()) ? 1 : 0),
        0,
      );
      if (dateCount < 5) return false;
      // Col 5: at least 5 Dr/Cr-suffixed balance entries — the JK
      // CC-account convention (loan balance always carries direction).
      const drCrPat = /^[\d,]+(?:\.\d+)?(Dr|Cr)$/i;
      const balCount = grid.rows.reduce(
        (acc, r) => acc + (drCrPat.test((r[5] ?? '').trim()) ? 1 : 0),
        0,
      );
      if (balCount < 5) return false;
      return true;
    },
  },
};

// Order matters: rules with more-specific fingerprints first so a
// generic substring (like "detailed account statement") doesn't get
// stolen by a different rule's broader fingerprint.
// JK_BANK_DCR sits BEFORE JK_BANK because its "cash credit scheme"
// fingerprint is more specific and only matches FORMAT-1.
const RULES: BankRule[] = [HDFC, ICICI, CANARA, PNB, YES_BANK, JK_BANK_DCR, JK_BANK];

export interface DetectedBankMapping {
  bank: string;
  mapping: ColumnMapping;
}

/**
 * Match the grid against the known-bank rule set. Returns the
 * deterministic mapping when a rule fires AND every required role is
 * covered by the extracted column headers. Returns null otherwise so
 * the caller can fall through to the wizard / vision pipeline.
 *
 * The first rule whose fingerprint hits is the only one tried —
 * fingerprints are mutually exclusive in practice (each bank's
 * boilerplate is distinct). If the grid headers turn out incomplete
 * we don't try a different rule.
 */
export function detectAndMapBank(grid: PdfGrid | null): DetectedBankMapping | null {
  if (!grid) return null;
  if (grid.rows.length < 5) return null;
  if (grid.columnCount < 4) return null;

  const fingerprint = grid.rows.slice(0, 30).flat().join(' ').toLowerCase();
  // Try every rule whose fingerprint matches, in declaration order.
  // The previous version used RULES.find(...) which short-circuited
  // on first fingerprint hit — but bank narrations routinely embed
  // OTHER banks' IFSC prefixes (e.g. a JKBank statement records an
  // outgoing RTGS to "YESB0000001", which makes the Yes Bank
  // fingerprint 'yesb0' fire spuriously). When that happens the
  // first match's headers don't satisfy the rule's `required` set
  // and we need to fall through to the next candidate. Iterating
  // all matches in order until one fully validates fixes that.
  const matches = (fp: string | RegExp): boolean =>
    typeof fp === 'string' ? fingerprint.includes(fp) : fp.test(fingerprint);
  const candidates = RULES.filter(r => r.fingerprints.some(matches));
  if (!candidates.length) return null;

  for (const rule of candidates) {
    const result = tryRule(rule, grid);
    if (result) return result;
  }
  return null;
}

function tryRule(rule: BankRule, grid: PdfGrid): DetectedBankMapping | null {
  // Positional mode — used for legacy formats with no header row
  // (JKBANK FORMAT-1 / CASH CREDIT SCHEME). Column count must match
  // exactly, then the verify callback confirms the data shape before
  // we trust the index-based mapping.
  if (rule.positional) {
    if (grid.columnCount !== rule.positional.columnCount) {
      console.warn(
        `[perBankRules] ${rule.name} positional mismatch: expected ${rule.positional.columnCount} columns, got ${grid.columnCount}. Falling back.`,
      );
      return null;
    }
    if (!rule.positional.verify(grid)) {
      console.warn(
        `[perBankRules] ${rule.name} positional content verification failed. Falling back.`,
      );
      return null;
    }
    return { bank: rule.name, mapping: { roles: rule.positional.roles.slice() } };
  }

  if (!rule.headerRules || !rule.required) {
    console.warn(`[perBankRules] ${rule.name} has neither headerRules+required nor positional config — skipping.`);
    return null;
  }
  const headerRules = rule.headerRules;
  const required = rule.required;

  const roles: ColumnRole[] = new Array(grid.columnCount).fill('skip');
  const headers = grid.columnHeaders ?? [];
  const taken = new Set<ColumnRole>();
  for (let c = 0; c < grid.columnCount; c++) {
    const header = (headers[c] ?? '').trim();
    if (!header) continue;
    const match = headerRules.find(r => r.pattern.test(header));
    if (!match) continue;
    // First-wins for unique roles — a duplicate header occurrence
    // somewhere downstream shouldn't overwrite the canonical column.
    if (taken.has(match.role)) continue;
    roles[c] = match.role;
    taken.add(match.role);
  }

  for (const r of required) {
    if (!roles.includes(r)) {
      console.warn(
        `[perBankRules] ${rule.name} fingerprint matched but required role "${r}" missing. Headers: ${headers.map(h => `"${h ?? ''}"`).join(', ')}. Trying next candidate / falling back to wizard.`,
      );
      return null;
    }
  }

  // Header-column → data-column shift correction. Some PDF layouts
  // split each numeric column in two: one for the left-aligned
  // header text ("Withdrawal" / "Deposit" / "Balance") and a right-
  // aligned data column for the actual numbers. The header→role
  // mapping anchors on the header column, but the data lives one
  // column to the right with an empty header. For each numeric
  // role, if the assigned column is empty for most dated rows but
  // the next column is rich with numbers AND currently mapped to
  // 'skip', shift the role over by one.
  const dateColForShift = roles.indexOf('date');
  if (dateColForShift >= 0) {
    const datedRows = grid.rows
      .slice(1)
      .filter(r => parseDate((r[dateColForShift] ?? '').trim()))
      .slice(0, 10);
    if (datedRows.length >= 3) {
      const numAt = (i: number) => datedRows.filter(r => /\d/.test((r[i] ?? '').trim())).length;
      for (const numericRole of ['debit', 'credit', 'amount', 'balance'] as const) {
        const col = roles.indexOf(numericRole);
        if (col < 0 || col >= roles.length - 1) continue;
        if (roles[col + 1] !== 'skip') continue;
        const cur = numAt(col);
        const next = numAt(col + 1);
        if (cur < datedRows.length / 4 && next >= Math.ceil(datedRows.length / 2)) {
          console.log(`[perBankRules] ${rule.name} shifting ${numericRole} from col ${col} → col ${col + 1} (${cur}/${datedRows.length} numeric vs ${next}/${datedRows.length} in next column)`);
          roles[col] = 'skip';
          roles[col + 1] = numericRole;
        }
      }
    }
  }

  // Trust-but-verify: the rule maps columns by header text, but the
  // grid extractor sometimes merges adjacent narrow columns (S.No. +
  // Transaction Date in ICICI's compact layout collapses into one
  // column whose cells look like "1 30.04.2026" — parseDate then
  // fails because the leading sequence number isn't a date prefix).
  //
  // Pre-filter samples to "date-shaped" candidates first (substring
  // matches /\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}/). Without that,
  // multi-page bank statements that repeat the address banner on
  // every page (HDFC's M/S. / C/O / JOINT HOLDERS :, "Nomination :
  // Not Registered" lines) would fill the first 10 non-empty cells
  // in column 0 with banner text, every parseDate call would fail,
  // and the rule would self-veto on a perfectly valid statement.
  // Banner-only rows have no date-shaped substring; transaction rows
  // always do — so this cleanly separates them.
  const dateCol = roles.indexOf('date');
  if (dateCol >= 0) {
    // Accept three date shapes: numeric (04/04/24, 31-03-2026,
    // 30.04.2026), dd-MMM-yyyy (01-Apr-2022, 27-Mar-2026 — used by
    // ICICI's "Detailed Statement" web export and JKBank's modern
    // savings format), and Mon dd (Apr 1, Jun 30 — Tally-style
    // compact). Without month-name support multi-page statements
    // whose only "Date" cells are in MMM form would have an empty
    // date-shaped sample set and the rule would bail.
    const dateLike = /\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;
    const samples = grid.rows
      .slice(1)
      .filter(r => dateLike.test((r[dateCol] ?? '').trim()))
      .slice(0, 20);
    // If we couldn't find ANY date-shaped cell in column 0, the
    // column doesn't actually carry dates regardless of what the
    // header said — bail.
    if (samples.length === 0) {
      console.warn(
        `[perBankRules] ${rule.name} fingerprint + headers matched but column ${dateCol} ("${headers[dateCol] ?? ''}") had no date-shaped values. Falling back to wizard.`,
      );
      return null;
    }
    const hits = samples.filter(r => parseDate((r[dateCol] ?? '').trim())).length;
    if (hits < Math.max(2, Math.ceil(samples.length / 2))) {
      console.warn(
        `[perBankRules] ${rule.name} fingerprint + headers matched but column ${dateCol} ("${headers[dateCol] ?? ''}") only had ${hits}/${samples.length} parseable date rows — likely a merged S.No.+Date column. Falling back to wizard.`,
      );
      return null;
    }
  }

  return { bank: rule.name, mapping: { roles } };
}
