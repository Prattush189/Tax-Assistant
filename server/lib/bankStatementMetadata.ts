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
// well-known bank than emit null.
//
// Detection uses FREQUENCY-WEIGHTED matching (see detectBankName
// below): every pattern is scanned against the haystack and the
// pattern with the most matches wins. This is more robust than the
// previous first-match-wins design, which mis-attributed a J&K Bank
// CC statement to "HDFC Bank" because the very first UPI row in
// narrations contained "UPI/HDFC/<rrn>" — the customer's *own* bank
// (J&K) only appears in its IFSC code "JAKA" and on the charges/
// statement-header narrations, but in raw count terms it dominates
// every other bank pattern.
//
// Patterns use the global `g` flag so .match() can count occurrences.
const BANK_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  // J&K Bank: IFSC prefix "JAKA" + the full bank name string. Listed
  // first only for source readability — pattern order no longer
  // matters under frequency-weighted detection.
  { name: 'J&K Bank', regex: /\b(JAKA|JAMMU\s*AND\s*KASHMIR\s*BANK|J\s*&\s*K\s*BANK|JK\s*BANK)\b/gi },
  { name: 'HDFC Bank', regex: /\bHDFC\b/gi },
  { name: 'ICICI Bank', regex: /\bICICI\b/gi },
  { name: 'Axis Bank', regex: /\bAXIS\b/gi },
  { name: 'State Bank of India', regex: /\b(SBI|STATE\s*BANK)\b/gi },
  { name: 'Kotak Mahindra Bank', regex: /\bKOTAK\b/gi },
  { name: 'Yes Bank', regex: /\bYES\s*BANK\b/gi },
  { name: 'IndusInd Bank', regex: /\bINDUSIND\b/gi },
  { name: 'IDFC First Bank', regex: /\bIDFC\b/gi },
  { name: 'IDBI Bank', regex: /\bIDBI\b/gi },
  { name: 'Bank of Baroda', regex: /\b(BOB|BARODA)\b/gi },
  { name: 'Punjab National Bank', regex: /\b(PNB|PUNJAB\s*NATIONAL)\b/gi },
  { name: 'Canara Bank', regex: /\bCANARA\b/gi },
  { name: 'Union Bank of India', regex: /\bUNION\s*BANK\b/gi },
  { name: 'Bank of India', regex: /\bBANK\s*OF\s*INDIA\b/gi },
  { name: 'Central Bank of India', regex: /\bCENTRAL\s*BANK\b/gi },
  { name: 'Indian Bank', regex: /\bINDIAN\s*BANK\b/gi },
  { name: 'Federal Bank', regex: /\bFEDERAL\s*BANK\b/gi },
  { name: 'RBL Bank', regex: /\bRBL\b/gi },
  { name: 'AU Small Finance Bank', regex: /\bAU\s*(SMALL|SFB)\b/gi },
  { name: 'Bandhan Bank', regex: /\bBANDHAN\b/gi },
];

/**
 * Detect bank name by scanning filename + transaction narrations and
 * picking the bank whose pattern appears the MOST times. Frequency
 * matters because:
 *
 *   - The customer's OWN bank shows up in every charges row
 *     (`CHRGS/IMPS/MBK`), every internal IFSC reference, every
 *     statement-header echo, every recurring transfer line.
 *   - OTHER banks appear once or twice each as UPI counterparty
 *     references (`UPI/HDFC/<rrn>`, `UPI/SBIN/<rrn>`) — high
 *     ALPHABETIC variety but low per-bank count.
 *
 * First-match-wins (the previous algorithm) attributed every
 * J&K Bank statement that had ANY UPI/HDFC line to HDFC. Frequency
 * scoring gives J&K Bank the win because JAKA appears dozens of
 * times while HDFC appears only as a UPI counterparty mention or two.
 *
 * Filename always counts as one hit if it contains the pattern,
 * pushing the customer's own bank ahead in the rare case where
 * narrations are perfectly tied.
 */
function detectBankName(filename: string | null, rows: NormalizedRow[]): string | null {
  const haystacks: string[] = [];
  if (filename) haystacks.push(filename);
  // Scan ALL transaction narrations now — frequency-weighted matching
  // is robust against high counterparty diversity, so a deeper sample
  // gives the customer's own bank an even stronger lead.
  for (const r of rows) haystacks.push(r.narration);
  const text = haystacks.join(' ');

  let bestName: string | null = null;
  let bestCount = 0;
  for (const { name, regex } of BANK_PATTERNS) {
    const matches = text.match(regex);
    const count = matches?.length ?? 0;
    if (count > bestCount) {
      bestCount = count;
      bestName = name;
    }
  }
  return bestName;
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
