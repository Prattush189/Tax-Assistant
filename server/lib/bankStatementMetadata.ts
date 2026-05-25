/**
 * Server-side bank-statement metadata extraction.
 *
 * Replaces the LLM's job of reading bankName / accountNumberMasked /
 * periodFrom / periodTo out of narrations. Three motivations:
 *
 * 1. Token savings — dropping the four metadata fields from the
 *    enrichment prompt + response shrinks the static prefix and the
 *    output schema. Output tokens are 4× input on T2, so every label
 *    we remove from the response schema scales by batch count.
 *
 * 2. Stability — server-extracted metadata is deterministic. The LLM
 *    would occasionally emit slightly different bank names across
 *    batches of the same statement (e.g. "HDFC Bank Limited" vs
 *    "HDFC BANK"); the first-batch-wins logic masked this but it
 *    surfaced as inconsistent display elsewhere.
 *
 * 3. Cache stability — the enrichment prompt is now identical for
 *    every batch (no metadata fields in the schema), so the cached
 *    prefix gets reused across batches with no per-batch divergence.
 *
 * All four fields fall back to null on uncertainty. The dashboard
 * handles null gracefully (displays "Unknown bank" / "Recent
 * statement"), so a missed extraction is degraded UX, never a crash.
 */

interface NormalizedRow {
  date: string | null;
  narration: string;
  amount: number;
  type: 'credit' | 'debit' | string;
  balance: number | null;
}

export interface ServerExtractedMetadata {
  bankName: string | null;
  accountNumberMasked: string | null;
  periodFrom: string | null;
  periodTo: string | null;
}

// Canonical names for the Indian banks we see most often in uploads.
// Match against narration text + filename. The patterns are LOOSE
// (substring / abbreviation) — we'd rather over-attribute to a
// well-known bank than emit null. Order matters: more-specific
// patterns first so "HDFC Bank" wins over a generic "BANK".
const BANK_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'HDFC Bank', regex: /\bHDFC\b/i },
  { name: 'ICICI Bank', regex: /\bICICI\b/i },
  { name: 'Axis Bank', regex: /\bAXIS\b/i },
  { name: 'State Bank of India', regex: /\b(SBI|STATE\s*BANK)\b/i },
  { name: 'Kotak Mahindra Bank', regex: /\bKOTAK\b/i },
  { name: 'Yes Bank', regex: /\bYES\s*BANK\b/i },
  { name: 'IndusInd Bank', regex: /\bINDUSIND\b/i },
  { name: 'IDFC First Bank', regex: /\bIDFC\b/i },
  { name: 'IDBI Bank', regex: /\bIDBI\b/i },
  { name: 'Bank of Baroda', regex: /\b(BOB|BARODA)\b/i },
  { name: 'Punjab National Bank', regex: /\b(PNB|PUNJAB\s*NATIONAL)\b/i },
  { name: 'Canara Bank', regex: /\bCANARA\b/i },
  { name: 'Union Bank of India', regex: /\bUNION\s*BANK\b/i },
  { name: 'Bank of India', regex: /\bBANK\s*OF\s*INDIA\b/i },
  { name: 'Central Bank of India', regex: /\bCENTRAL\s*BANK\b/i },
  { name: 'Indian Bank', regex: /\bINDIAN\s*BANK\b/i },
  { name: 'Federal Bank', regex: /\bFEDERAL\s*BANK\b/i },
  { name: 'RBL Bank', regex: /\bRBL\b/i },
  { name: 'AU Small Finance Bank', regex: /\bAU\s*(SMALL|SFB)\b/i },
  { name: 'Bandhan Bank', regex: /\bBANDHAN\b/i },
];

/**
 * Try filename first (most reliable — users export with bank-branded
 * names like `HDFC-XX1234-Jan-Mar-2026.csv`), then scan narrations.
 * Narrations are checked in order; first match wins.
 */
function detectBankName(filename: string | null, rows: NormalizedRow[]): string | null {
  const haystacks: string[] = [];
  if (filename) haystacks.push(filename);
  // Scan only the first 20 rows for bank name — banks typically reveal
  // themselves in headers / opening-balance / charges narrations
  // (e.g. "HDFC IB Cust ID...", "Charges for SMS-HDFC BANK"). Beyond
  // that, false-positive risk grows (a UPI to "HDFC Securities" would
  // mis-attribute a statement from a different bank).
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    haystacks.push(rows[i].narration);
  }
  const text = haystacks.join(' ');
  for (const { name, regex } of BANK_PATTERNS) {
    if (regex.test(text)) return name;
  }
  return null;
}

/**
 * Look for an "XXXX1234" / "XXXXXX1234" pattern (cPanel-style masked
 * account) in filename + narrations. Indian banks emit these widely.
 * Returns the matched string in normalised "XXXX1234" form (4 trailing
 * digits regardless of the X-prefix length the source used).
 */
function detectMaskedAccount(filename: string | null, rows: NormalizedRow[]): string | null {
  const haystacks: string[] = [];
  if (filename) haystacks.push(filename);
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    haystacks.push(rows[i].narration);
  }
  const text = haystacks.join(' ');
  // Look for 4+ X / asterisk chars followed by 4 digits.
  const masked = text.match(/[X\*xX]{2,}(\d{4})\b/);
  if (masked) return `XXXX${masked[1]}`;
  // Some statements show "Account: 1234567890" — take last 4.
  // Be conservative: require the word "account" or "a/c" nearby so
  // we don't pull random 10-digit numbers from UPI references.
  const acFollowing = text.match(/\b(?:a\/?c|account)[^\d]{0,6}(\d{6,18})\b/i);
  if (acFollowing) return `XXXX${acFollowing[1].slice(-4)}`;
  return null;
}

/**
 * Parse an Indian-style date (DD/MM/YYYY, DD-MM-YYYY, DD-Mon-YYYY,
 * YYYY-MM-DD). Returns ISO YYYY-MM-DD or null.
 */
function parseAnyDate(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // ISO first.
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // DD/MM/YYYY or DD-MM-YYYY
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let year = m[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  // DD-Mon-YYYY (e.g. 05-Jan-2026)
  m = s.match(/^(\d{1,2})[\-\s]([A-Za-z]{3})[\-\s](\d{2,4})/);
  if (m) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mm = months[m[2].toLowerCase()];
    if (!mm) return null;
    let year = m[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${mm}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

function detectPeriod(rows: NormalizedRow[]): { periodFrom: string | null; periodTo: string | null } {
  let minDate: string | null = null;
  let maxDate: string | null = null;
  for (const r of rows) {
    const iso = parseAnyDate(r.date);
    if (!iso) continue;
    if (minDate === null || iso < minDate) minDate = iso;
    if (maxDate === null || iso > maxDate) maxDate = iso;
  }
  return { periodFrom: minDate, periodTo: maxDate };
}

export function extractBankMetadata(
  filename: string | null,
  rows: NormalizedRow[],
): ServerExtractedMetadata {
  const period = detectPeriod(rows);
  return {
    bankName: detectBankName(filename, rows),
    accountNumberMasked: detectMaskedAccount(filename, rows),
    periodFrom: period.periodFrom,
    periodTo: period.periodTo,
  };
}
