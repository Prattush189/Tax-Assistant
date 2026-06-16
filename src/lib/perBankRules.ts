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
  /** Optional grid-reshape hook. Runs AFTER the fingerprint matches
   *  but BEFORE headerRules / positional are applied. Use this when
   *  a bank's compact PDF layout merges two logical columns into one
   *  grid cell (Kotak's "31 Mar 2025 PCI/9710/..." cell that fuses
   *  date and description is the canonical case). Return a new
   *  PdfGrid with the split applied; the caller treats the returned
   *  value as the working grid for the rest of detection. Return
   *  the input grid unchanged to skip preprocessing.
   *
   *  Keep these LOCAL to the per-bank rule — do NOT generalise into
   *  pdfGrid because the heuristic for which cell to split is bank-
   *  specific and a wrong split would corrupt other banks' grids. */
  preprocess?: (grid: PdfGrid) => PdfGrid;
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
    // HDFC's "Virtual Imperia" statement variant doesn't include any
    // of the bank-name strings in the first 30 grid rows — only the
    // IFSC line ("rtgs/neft ifsc : hdfc0000138") surfaces. Match the
    // IFSC anchored to the "IFSC" label. Uses `.{0,30}` between
    // because the printed label is sometimes "IFSC Code:" /
    // "IFSC :" / "RTGS/NEFT IFSC:" — letters between, which would
    // defeat a `[^a-z]` character class.
    /\bifsc\b.{0,30}\bhdfc0\d{4,}/i,
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
    // IFSC prefix fingerprint, anchored to the "IFSC" label so it
    // doesn't false-fire on RTGS narrations like "...PAYTM-ICIC00..."
    // that quote a beneficiary's IFSC. Uses `.{0,30}` between
    // because the printed label is sometimes "IFSC Code:" /
    // "IFSC :" — letters between would defeat a `[^a-z]` class.
    /\bifsc\b.{0,30}\bicic0\d{4,}/i,
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
    // IFSC anchor — see note on HDFC's regex. Canara's epassbook
    // export ("statement for a/c xxx between … ifsc code cnrb0…")
    // is the realistic case where the bank-name strings DON'T
    // appear in the first 30 rows but the IFSC line does.
    /\bifsc\b.{0,30}\bcnrb0\d{4,}/i,
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
    // IFSC anchor — see note on HDFC's regex.
    /\bifsc\b.{0,30}\bpunb0\d{4,}/i,
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
    // IFSC anchor — see note on HDFC's regex.
    /\bifsc\b.{0,30}\byesb0\d{4,}/i,
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

// Kotak Mahindra's modern e-statement uses a 7-column table:
//   # | Date | Description | Chq/Ref. No. | Withdrawal (Dr.) | Deposit (Cr.) | Balance
// "#" is a row-number column with no header word that matches any
// role pattern, so it falls through to 'skip' — that's the right
// outcome. The other six map cleanly via the standard balance /
// withdraw / deposit / chq.ref / description / date patterns.
//
// Fingerprint: empirically, the bank name doesn't make it into the
// first 30 grid rows — the Kotak logo is a vector image (not
// extracted as text) and "Kotak Mahindra Bank Ltd." only appears in
// the legal footer on page 9-10, far past the 30-row scan window.
// The dependable signal is the IFSC code on the metadata line
// ("MICR 180485002 IFSC Code KKBK0004446"). KKBK0 followed by ≥4
// digits is the Kotak IFSC format and is unique to Kotak — false-
// firing on a counterparty's KKBK IFSC quoted inside an RTGS
// narration would still mean the transaction goes to/from a Kotak
// account, so even that edge case isn't actually a misroute. Earlier
// attempt used `/ifsc[^a-z]{0,8}kkbk0/i` to require an "IFSC" label
// adjacent — but " Code " between "IFSC" and "KKBK0" in the printed
// label contains alphabetic chars that `[^a-z]` excludes, so the
// regex never fired.
//
// KNOWN LIMITATION (2026-05): on Kotak's compact savings layout the
// pdfGrid extractor merges the Date and Description columns into
// one cell because they share an x-coordinate range in the PDF
// ("31 Mar 2025 PCI/9710/Segpay.com..." lands in column 1 together;
// column 0 ends up holding only the row number "1", "2", "3", …).
// The fingerprint + headerRules below DO match, but the rule's
// downstream date-column verification then sees row numbers in
// column 0 and bails — caller falls back to the column-mapping
// wizard, same as if no rule existed. Until pdfGrid learns to split
// leading-date-prefix cells, this rule is forward-looking: the
// detection is correct and the rule will automatically activate
// once grid extraction improves. The wizard path still works for
// these PDFs today (user maps col 1 → narration and accepts that
// the date prefix is part of the narration field, which the
// downstream parser strips).
//
// Date format is "31 Mar 2025" (dd MMM yyyy) — already handled by
// parseDate's named-month regex, no extra work needed here.
// Kotak's compact layout merges Date and Description into one grid
// cell because they share an x-coordinate range in the PDF. Without
// preprocessing we'd see col 1 = "31 Mar 2025 PCI/9710/Segpay.co"
// and col 0 = the row-number "#" column. The split preprocess below
// detects rows whose col 1 starts with a `dd MMM yyyy` prefix and
// extracts that prefix into a new column inserted between col 0 and
// the description remainder. Result: 7-column input becomes
// 8-column output with Date and Description as distinct cells.
//
// Heuristic gate: only split when at least 5 of the first 50 col-1
// cells match the leading-date pattern. This protects other banks'
// grids from accidental damage if they somehow share Kotak's
// fingerprint (they don't today — KKBK0 is unique — but the gate is
// cheap defence in depth).
function kotakSplitDateFromDescription(grid: PdfGrid): PdfGrid {
  // `dd MMM yyyy` (with month name) at the START of the cell. Kotak's
  // statement date format. The pattern requires a trailing space so we
  // only match prefixes followed by actual description text — a bare
  // "31 Mar 2025" cell (no description) would still split into Date +
  // empty Description, which is correct for header rows.
  const leadingDate = /^(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:[a-z]*\.?)\s+\d{4})\b\s*(.*)$/i;
  // Need a column to split. Look at the first ~50 rows for col-1 cells
  // matching the leading-date pattern. If we don't find enough, the
  // grid isn't the merged layout we expect — return unchanged.
  const sample = grid.rows.slice(0, 50);
  const hits = sample.filter(r => leadingDate.test((r[1] ?? '').trim())).length;
  if (hits < 5) return grid;

  // Reshape: insert a new column at index 1, shifting everything ≥1
  // right by one. Header row gets "Date" / "Description" split too.
  const newColumnCount = grid.columnCount + 1;
  const newRows: string[][] = grid.rows.map(r => {
    const out: string[] = new Array(newColumnCount).fill('');
    out[0] = r[0] ?? '';
    const cellOne = (r[1] ?? '').trim();
    const m = leadingDate.exec(cellOne);
    if (m) {
      out[1] = m[1];   // extracted date prefix
      out[2] = m[2];   // remainder = description
    } else {
      // Row whose col 1 isn't a date-prefixed description (header
      // row, banner, opening-balance row). Keep its content in the
      // description position; date column stays empty for this row.
      out[1] = '';
      out[2] = cellOne;
    }
    // Everything from col 2 onwards in the original grid shifts to
    // col 3 onwards.
    for (let i = 2; i < grid.columnCount; i++) {
      out[i + 1] = r[i] ?? '';
    }
    return out;
  });

  // Synthesize new column headers. The grid extractor mislabels
  // col 0 as "Date" (the column header text floats above the
  // data-column boundary in Kotak's layout) — copying that header
  // through would re-attach the 'date' role to col 0 where row
  // numbers live, then verification fails. Force col 0's header
  // empty so no role matches it, and use canonical names for the
  // newly-split Date + Description columns regardless of what the
  // grid extractor reported.
  const oldHeaders = grid.columnHeaders ?? [];
  const newHeaders: Array<string | null> = new Array(newColumnCount).fill('');
  newHeaders[0] = '';            // row-number column, no role
  newHeaders[1] = 'Date';        // extracted leading-date prefix
  newHeaders[2] = 'Description'; // remainder after the date prefix
  for (let i = 2; i < oldHeaders.length; i++) {
    newHeaders[i + 1] = oldHeaders[i] ?? '';
  }

  return {
    ...grid,
    rows: newRows,
    columnCount: newColumnCount,
    columnHeaders: newHeaders,
  };
}

const KOTAK: BankRule = {
  name: 'Kotak Mahindra Bank',
  fingerprints: [
    /\bkkbk0\d{4,}\b/i,
    // Bank-name strings kept as additional signals — they DON'T
    // appear in the metadata header zone but DO surface in some
    // Kotak corporate / NRI statement variants whose layout puts
    // the bank header text right next to the table. Cost is zero
    // if they never match.
    'kotak mahindra bank',
    'kotak.bank.in',
  ],
  // Split the merged Date+Description column before role assignment.
  // See kotakSplitDateFromDescription for the rationale.
  preprocess: kotakSplitDateFromDescription,
  headerRules: [
    { pattern: /balance/i, role: 'balance' },
    // Kotak prints "Withdrawal (Dr.)" / "Deposit (Cr.)" — the
    // /withdraw/ and /deposit/ substrings still match cleanly.
    { pattern: /withdraw/i, role: 'debit' },
    { pattern: /deposit/i, role: 'credit' },
    { pattern: /chq.?\s*ref|chq\.?\s*no|cheque\s*no|ref\.?\s*no|reference|utr/i, role: 'reference' },
    { pattern: /description|narration|particulars|remarks/i, role: 'narration' },
    { pattern: /^date$|transaction\s*date|^txn\s*date|^tran\s*date/i, role: 'date' },
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
    // IFSC anchor — see note on HDFC's regex.
    /\bifsc\b.{0,30}\bjaka0\w{4,}/i,
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

// J&K Bank GENERAL SAVING / current-account export (amitT.pdf is the
// canonical fixture: 95 pages, "TYPE: GENERAL SAVING BANK" banner).
// Same DCR-era print engine as the Cash Credit format but a narrower
// table — the date column sits so close to the narration column that
// the grid extractor's anchor clustering fuses them into ONE cell:
//
//   row A: ["01-04-2025 UPI/FDRL/509129607", "",       "", ""          ]
//   row B: ["704/DR/Mrs SUNITA",             "200.00", "", "73510.27Cr"]
//
// Four anchors survive: [date+narration, withdrawals, deposits,
// balance]. With no date column, JK_BANK's header rule bails
// ("required role date missing") and suggestMapping sees only noise —
// the user gets a wizard full of Skip/Ignore dropdowns and no way to
// build a correct mapping by hand (the screenshot case).
//
// The preprocess below splits the leading dd-mm-yyyy off col 0 into
// its own column (same approach as Kotak's date/description split),
// turning the grid into the 5-column layout the positional mapping
// expects. applyMapping's pending/continuation machinery then
// reassembles each two-row transaction exactly like the CC format.
function jkBankSplitLeadingDate(grid: PdfGrid): PdfGrid {
  // Structural gate: this fusion only happens on the 4-column savings
  // layout. Never touch the 6-column CC grids (JK_BANK_DCR territory)
  // or anything else that shares the J&K fingerprints.
  if (grid.columnCount !== 4) return grid;
  const leadingDate = /^(\d{2}-\d{2}-\d{4})\s+(.+)$/;
  // Demand a healthy sample of date-prefixed col-0 cells before
  // reshaping — protects against false-positive fingerprint hits.
  const sample = grid.rows.slice(0, 120);
  const hits = sample.filter(r => leadingDate.test((r[0] ?? '').trim())).length;
  if (hits < 5) return grid;

  const newColumnCount = grid.columnCount + 1;
  const newRows: string[][] = grid.rows.map(r => {
    const out: string[] = new Array(newColumnCount).fill('');
    const cellZero = (r[0] ?? '').trim();
    const m = leadingDate.exec(cellZero);
    if (m) {
      out[0] = m[1];   // extracted dd-mm-yyyy
      out[1] = m[2];   // remainder = narration head (UPI/XXXX/ref)
    } else {
      // Continuation / banner / total rows: no date, full text stays
      // in the narration position.
      out[0] = '';
      out[1] = cellZero;
    }
    for (let i = 1; i < grid.columnCount; i++) {
      out[i + 1] = r[i] ?? '';
    }
    return out;
  });

  // No real header row exists in this format (the extractor reported
  // all-null headers) — emit canonical names so downstream display
  // and the wizard preview read sensibly.
  const newHeaders: Array<string | null> = ['Date', 'Particulars', 'Withdrawals', 'Deposits', 'Balance'];

  return {
    ...grid,
    rows: newRows,
    columnCount: newColumnCount,
    columnHeaders: newHeaders,
  };
}

const JK_BANK_SAVINGS: BankRule = {
  name: 'J&K Bank (Savings)',
  fingerprints: [
    'jammu and kashmir bank',
    'j&k bank',
    /\bifsc\b.{0,30}\bjaka0\w{4,}/i,
  ],
  preprocess: jkBankSplitLeadingDate,
  positional: {
    columnCount: 5, // post-preprocess
    roles: ['date', 'narration', 'debit', 'credit', 'balance'],
    verify: (grid) => {
      // Col 0: at least 5 date-shaped entries (the preprocess only
      // produces these when the split actually fired).
      const datePat = /^\d{2}-\d{2}-\d{4}$/;
      const dateCount = grid.rows.reduce(
        (acc, r) => acc + (datePat.test((r[0] ?? '').trim()) ? 1 : 0),
        0,
      );
      if (dateCount < 5) return false;
      // Col 4: at least 5 Dr/Cr-suffixed balances — the J&K print
      // engine always stamps the direction on the running balance.
      const drCrPat = /^-?[\d,]+(?:\.\d+)?(Dr|Cr)$/i;
      const balCount = grid.rows.reduce(
        (acc, r) => acc + (drCrPat.test((r[4] ?? '').trim()) ? 1 : 0),
        0,
      );
      if (balCount < 5) return false;
      return true;
    },
  },
};

// J&K Bank's legacy DCR / Cash Credit-style export prints a metadata
// banner ("JAMMU AND KASHMIR BANK LTD" / "TYPE: CASH CREDIT SCHEME" or
// "TYPE: CC MORTG TRADE/SERVICE" / customer address) and then jumps
// straight into transaction rows with NO column-header row. The grid
// extractor's header-detection heuristic latches onto the metadata
// banner ("TYPE:", "DATE:", "CREDIT" inside "CASH CREDIT SCHEME") and
// produces a degenerate column layout — the JK_BANK header rule then
// bails because none of withdraw/deposit/balance words appear as a
// header. Fall through to wizard was the previous behaviour and the
// wizard preview also shows metadata rows rather than transactions,
// leaving the user no usable mapping.
//
// Layout, by column index (six columns, fixed positions):
//   0 — date (dd-mm-yyyy)
//   1 — narration (spans two grid rows per transaction)
//   2 — empty (spacer)
//   3 — debit (withdrawal — RTGS-out, cheque clearing, etc.)
//   4 — credit (deposit, repayment — "By Cash: N" rows land here)
//   5 — running balance with "Dr" / "Cr" suffix (e.g. "510239.27Dr")
//
// Critical for AI-vision correctness: the Dr/Cr suffix on the balance
// column tripped up vision OCR on a "CC MORTG" variant we hit in May
// 2026 — the model saw "Dr" + "By Cash" narrations and inferred each
// row was an outgoing cash payment (debit/expense), swapping the
// debit and credit columns. Positional mapping eliminates the
// ambiguity: col 4 is always the credit-side, col 3 is always the
// debit-side, regardless of how the narrations read.
//
// Fingerprints cover the J&K Bank Cash Credit family. We can't anchor
// purely on "type: cc" because that's too generic (could appear in
// other banks' narrations). Instead we list the known TYPE strings
// explicitly. Add new ones here as they're discovered.
//
// Verification confirms the column layout before we commit to the
// positional mapping — col 0 must hold dates and col 5 must hold
// Dr/Cr-suffixed balances. Two structural checks that any J&K Bank
// CC statement must satisfy.
const JK_BANK_DCR: BankRule = {
  name: 'J&K Bank (Cash Credit)',
  fingerprints: [
    // Legacy DCR / CASH CREDIT SCHEME (FORMAT-1 in our fixture set).
    'cash credit scheme',
    // CC MORTG TRADE/SERVICE variant — same layout, different TYPE
    // string. "CC MORTG" is unique to J&K Bank's CC mortgage line;
    // including the space prevents false-fire on standalone "ccmortg"
    // in URLs / narrations.
    'cc mortg',
    // CC TRADE / CC SERVICE / CC PLUS — same family. Listed
    // separately so future variants can be added or removed without
    // touching the legacy DCR fingerprint above.
    'cc trade',
    'cc service',
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

// State Bank of India — internet-banking "Account Statement" PDF that
// leads with a portfolio / "Relationship Summary" cover page (Loans,
// Deposits, MY ACCOUNTS) and then the real "STATEMENT OF ACCOUNT"
// table. The cover page's summary tables pollute header detection, so
// the grid's headers come out as repeated "Balance" with no usable
// transaction-header row — but the column LAYOUT is fixed by SBI's
// template, so a positional rule maps it cleanly:
//   0 — date (txn date + value date fused into one cell; parseDate
//       takes the first)
//   1 — narration / reference (NEFT/UPI/INB string; wraps onto
//       adjacent rows, merged by applyMapping's continuation logic)
//   2 — debit  (Withdrawal column)
//   3 — skip   (spacer the cover-page anchoring inserts)
//   4 — credit (Deposit column)
//   5 — running balance
//
// Fingerprint: the branch email domain "sbi.co.in" sits on the cover
// page (within the first-30-rows fingerprint window); "state bank of
// india" / the SBIN0 IFSC appear deeper and back it up. verify()
// confirms col0 dates + col5 balances + amounts present so the rule
// only fires on this exact layout and otherwise falls to the wizard.
const SBI: BankRule = {
  name: 'State Bank of India',
  fingerprints: [
    'sbi.co.in',
    'state bank of india',
    /\bsbin0\d{4,}\b/i,
    // SBI net-banking portfolio cover page has these distinctive
    // section titles in the fingerprint window even when the bank
    // name / IFSC sit deeper on the statement-of-account page.
    'relationship summary',
    /\bmy information\b.*\bbranch information\b/i,
  ],
  positional: {
    columnCount: 6,
    roles: ['date', 'narration', 'debit', 'skip', 'credit', 'balance'],
    verify: (grid) => {
      const datePat = /\b\d{2}\/\d{2}\/\d{4}\b/;
      const numPat = /\d[\d,]*\.\d{2}/;
      let dateCount = 0, balCount = 0, amtCount = 0;
      for (const r of grid.rows) {
        if (datePat.test((r[0] ?? '').trim())) dateCount++;
        if (numPat.test((r[5] ?? '').trim())) balCount++;
        if (numPat.test((r[2] ?? '').trim()) || numPat.test((r[4] ?? '').trim())) amtCount++;
      }
      return dateCount >= 5 && balCount >= 5 && amtCount >= 5;
    },
  },
};

// Order matters: rules with more-specific fingerprints first so a
// generic substring (like "detailed account statement") doesn't get
// stolen by a different rule's broader fingerprint.
// JK_BANK_DCR sits BEFORE JK_BANK because its "cash credit scheme"
// fingerprint is more specific and only matches FORMAT-1.
// KOTAK fingerprints ("kotak mahindra bank", "kotak.bank.in",
// "KKBK0" IFSC) are unique to Kotak and don't overlap with any
// existing rule, so its position in the list is purely cosmetic
// (grouped with the other major private banks).
// JK_BANK_SAVINGS sits after JK_BANK_DCR (6-col CC grids must not be
// reshaped — its preprocess gates on columnCount === 4 anyway) and
// before JK_BANK (whose header rule can never satisfy this format's
// all-null headers, so ordering only saves a wasted attempt).
const RULES: BankRule[] = [HDFC, ICICI, CANARA, PNB, YES_BANK, KOTAK, SBI, JK_BANK_DCR, JK_BANK_SAVINGS, JK_BANK];

export interface DetectedBankMapping {
  bank: string;
  mapping: ColumnMapping;
  /** The grid the mapping is indexed against. Equal to the input grid
   *  when the rule has no preprocess hook (which is the case for HDFC
   *  / ICICI / Canara / PNB / Yes / J&K). When a rule DOES preprocess
   *  the grid (Kotak splits a merged Date+Description cell into two
   *  columns), this is the post-preprocess grid — column counts and
   *  cell contents have changed relative to what extractPdfGrid
   *  returned, and the mapping array indexes are aligned to THIS
   *  grid, not the input.
   *
   *  Callers that show the user a preview (column-mapping wizard) MUST
   *  use this grid — feeding the wizard the original grid plus a
   *  preprocessed mapping array produces an off-by-one render where
   *  the dropdowns describe one set of columns and the preview body
   *  shows another. */
  grid: PdfGrid;
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

  // Scan the first 60 rows (was 30). Some banks bury their name / IFSC
  // behind a portfolio cover page (SBI's "Relationship Summary" sits
  // before the "STATEMENT OF ACCOUNT" header where SBIN0/the bank name
  // appear). A deeper window catches those; spurious cross-bank IFSC
  // hits in the wider window are harmless — the candidates loop below
  // validates each match's structure via verify()/required and falls
  // through on a mismatch.
  const fingerprint = grid.rows.slice(0, 60).flat().join(' ').toLowerCase();
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

function tryRule(rule: BankRule, gridIn: PdfGrid): DetectedBankMapping | null {
  // Run the per-bank preprocess hook (if any) BEFORE structural
  // checks. Lets a rule reshape the grid — e.g. split a merged
  // Date+Description cell into two columns — so the downstream
  // header / positional logic sees the corrected layout. Defaults
  // to the input grid when the rule doesn't define a preprocess.
  let grid = gridIn;
  if (rule.preprocess) {
    try {
      grid = rule.preprocess(gridIn);
    } catch (err) {
      console.warn(`[perBankRules] ${rule.name} preprocess threw, falling back to raw grid: ${(err as Error).message}`);
      grid = gridIn;
    }
  }

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
    return { bank: rule.name, mapping: { roles: rule.positional.roles.slice() }, grid };
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
  // column to the right with an empty header. Three-pass logic:
  //
  //   Pass 1 — symmetric shift: if the role's current column has
  //   ≤25% numeric data AND the next column is 'skip' AND has ≥50%
  //   numeric data, shift the role to the next column. Tuned for
  //   layouts where both directions fire often enough to satisfy
  //   the 50% threshold (Canara's typical mix, HDFC corporate).
  //
  //   Pass 2 — skewed-direction shift: catches the case where the
  //   misaligned column is the LESS-COMMON direction. On a debit-
  //   heavy B2B account, credits may be <20% of sampled rows —
  //   below Pass 1's 50% gate. Conservative guards prevent false
  //   positives: current column MUST be completely empty (no numeric
  //   data at all), next column MUST be 'skip' with an empty header
  //   (proves it's an unmapped layout artifact rather than a
  //   different mapped role), and next column MUST have ≥3 numeric
  //   hits (real evidence, not noise). Canonical case: Kotak's
  //   compact format places "Deposit (Cr.)" text above an empty
  //   grid cell with the actual credit values one column further
  //   right.
  //
  //   Pass 3 — companion shift: if Pass 1 or Pass 2 fired for ANY
  //   role, the layout is confirmed to be a header-text/data-column
  //   split. For any remaining numeric role whose current column
  //   has 0 numeric data AND the next column is 'skip' AND ALSO has
  //   0 numeric data AND the next column's HEADER is empty — shift
  //   anyway. Catches the all-debits / all-credits streak case (a
  //   Canara statement with no credits in the first 50 rows can't
  //   surface evidence on the credit role's next column).
  //
  // Sample size: 50 dated rows. With smaller samples, single-
  // direction streaks produced incorrect non-shifts. 50 rows almost
  // always contains both directions on a typical account; the few
  // that don't get rescued by Pass 3.
  const dateColForShift = roles.indexOf('date');
  if (dateColForShift >= 0) {
    const datedRows = grid.rows
      .slice(1)
      .filter(r => parseDate((r[dateColForShift] ?? '').trim()))
      .slice(0, 50);
    if (datedRows.length >= 3) {
      const numAt = (i: number) => datedRows.filter(r => /\d/.test((r[i] ?? '').trim())).length;
      let anyShift = false;

      // Pass 1 — symmetric.
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
          anyShift = true;
        }
      }

      // Pass 2 — skewed-direction. Independent of Pass 1; fires when
      // the structural guards prove the layout is header-text /
      // empty / data even if the role is the minority direction.
      // Excludes 'balance' because balance is universally present on
      // every row, so a zero-count balance column is genuinely
      // unmapped, not skewed.
      for (const numericRole of ['debit', 'credit', 'amount'] as const) {
        const col = roles.indexOf(numericRole);
        if (col < 0 || col >= roles.length - 1) continue;
        if (roles[col + 1] !== 'skip') continue;
        const nextHeader = (headers[col + 1] ?? '').trim();
        if (nextHeader !== '') continue; // next col is a different mapped role
        const cur = numAt(col);
        const next = numAt(col + 1);
        if (cur === 0 && next >= 3) {
          console.log(`[perBankRules] ${rule.name} skewed-shift ${numericRole} from col ${col} → col ${col + 1} (0 numeric in header column, ${next} in next headerless column)`);
          roles[col] = 'skip';
          roles[col + 1] = numericRole;
          anyShift = true;
        }
      }

      // Pass 3 — companion (faith-based, requires Pass 1 or Pass 2
      // to have fired).
      if (anyShift) {
        for (const numericRole of ['debit', 'credit', 'amount'] as const) {
          const col = roles.indexOf(numericRole);
          if (col < 0 || col >= roles.length - 1) continue;
          if (roles[col + 1] !== 'skip') continue;
          if (numAt(col) > 0) continue; // role's current column has some data — don't blindly shift
          const nextHeader = (headers[col + 1] ?? '').trim();
          if (nextHeader !== '') continue; // next column has its own header — not part of the split layout
          console.log(`[perBankRules] ${rule.name} companion-shifting ${numericRole} from col ${col} → col ${col + 1} (sibling shift confirmed split-header layout; no data evidence in sampled rows but next col is unmapped + headerless)`);
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

  return { bank: rule.name, mapping: { roles }, grid };
}
