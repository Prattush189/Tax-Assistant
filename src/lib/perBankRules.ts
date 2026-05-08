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
  /** Lowercase substrings searched for in the first ~30 grid rows.
   *  Any match counts as a positive fingerprint hit. Header banners,
   *  page footers, and statement titles all contribute. */
  fingerprints: string[];
  /** Header → role table. Iterated in order for each grid column;
   *  first matching pattern wins. List the more specific patterns
   *  first ("Value Dt" before plain "Date", "Closing Balance" before
   *  any other balance variant) so the right role wins. */
  headerRules: Array<{ pattern: RegExp; role: ColumnRole }>;
  /** Roles that MUST be present after mapping for the rule to fire.
   *  Missing any one of these means grid extraction didn't surface
   *  the full table — bail and fall back. */
  required: ColumnRole[];
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
  ],
  headerRules: [
    { pattern: /balance/i, role: 'balance' },
    { pattern: /withdraw/i, role: 'debit' },
    { pattern: /deposit/i, role: 'credit' },
    { pattern: /cheque\s*number|chq\.?|ref\.?\s*no|reference|utr/i, role: 'reference' },
    { pattern: /transaction\s*remarks|^remarks|narration|particulars/i, role: 'narration' },
    { pattern: /transaction\s*date|^date$|txn\s*date/i, role: 'date' },
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
    'cnrb0',  // IFSC prefix shows up in the header block
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

const RULES: BankRule[] = [HDFC, ICICI, CANARA];

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
  const rule = RULES.find(r => r.fingerprints.some(fp => fingerprint.includes(fp)));
  if (!rule) return null;

  const roles: ColumnRole[] = new Array(grid.columnCount).fill('skip');
  const headers = grid.columnHeaders ?? [];
  const taken = new Set<ColumnRole>();
  for (let c = 0; c < grid.columnCount; c++) {
    const header = (headers[c] ?? '').trim();
    if (!header) continue;
    const match = rule.headerRules.find(r => r.pattern.test(header));
    if (!match) continue;
    // First-wins for unique roles — a duplicate header occurrence
    // somewhere downstream shouldn't overwrite the canonical column.
    if (taken.has(match.role)) continue;
    roles[c] = match.role;
    taken.add(match.role);
  }

  for (const r of rule.required) {
    if (!roles.includes(r)) {
      console.warn(
        `[perBankRules] ${rule.name} fingerprint matched but required role "${r}" missing. Headers: ${headers.map(h => `"${h ?? ''}"`).join(', ')}. Falling back to wizard / vision.`,
      );
      return null;
    }
  }

  // Trust-but-verify: the rule maps columns by header text, but the
  // grid extractor sometimes merges adjacent narrow columns (S.No. +
  // Transaction Date in ICICI's compact layout collapses into one
  // column whose cells look like "1 30.04.2026" — parseDate then
  // fails because the leading sequence number isn't a date prefix).
  // Sample only rows where the date column has text (headers/footers
  // legitimately have empty date columns and shouldn't drag the
  // parse-rate down). Bail if more than half the populated date
  // cells fail to parse — the headers lied about column boundaries.
  const dateCol = roles.indexOf('date');
  if (dateCol >= 0) {
    const samples = grid.rows
      .slice(1)
      .filter(r => (r[dateCol] ?? '').trim() !== '')
      .slice(0, 10);
    if (samples.length > 0) {
      const hits = samples.filter(r => parseDate((r[dateCol] ?? '').trim())).length;
      if (hits < Math.max(2, Math.ceil(samples.length / 2))) {
        console.warn(
          `[perBankRules] ${rule.name} fingerprint + headers matched but column ${dateCol} ("${headers[dateCol] ?? ''}") only had ${hits}/${samples.length} parseable date rows — likely a merged S.No.+Date column. Falling back to wizard.`,
        );
        return null;
      }
    }
  }

  return { bank: rule.name, mapping: { roles } };
}
