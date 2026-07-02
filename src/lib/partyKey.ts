/**
 * Party identity normalisation for the counterparty summary + ledgers.
 *
 * The same person routinely appears under several counterparty strings
 * across one statement because narrations embed the SENDER/RECEIVER
 * BANK, not just the person:
 *
 *   "AMRIT PAL"                    (NEFT)
 *   "AMRIT PAL AXIS BANK"          (IMPS via Axis)
 *   "AMRIT PAL YES BANK"           (IMPS via Yes Bank)
 *   "amritpal@okaxis"              (UPI handle, Axis)
 *   "amritpal@ybl"                 (UPI handle, PhonePe/Yes)
 *
 * Grouping on the raw string splits one party's ledger into per-bank
 * fragments — a CA wants ONE ledger account per party regardless of
 * which bank the money moved through. normalizePartyKey() collapses
 * the bank-routing noise; displayPartyName() strips the same noise
 * from the label the user sees.
 *
 * Deliberately conservative: only standalone bank tokens and UPI
 * @handles are stripped. If stripping would leave fewer than 3
 * characters (the party IS the bank — e.g. bank charges rows named
 * "YES BANK"), the original string is kept.
 */

// Standalone bank tokens seen in Indian narrations — IFSC prefixes,
// short names, and the generic "BANK"/"BNK" that rides along with them.
// Stripped ONLY as a trailing run of whole words (the routing suffix
// position: "AMRIT PAL YES BANK"), never mid-name — "AXIS METALS PVT
// LTD" and "UNIONWALA TRADERS" keep every letter.
const BANK_TOKENS = new Set([
  'bank', 'bnk',
  'hdfc', 'icic', 'icici', 'sbi', 'sbin',
  'axis', 'axisbank', 'utib',
  'kotak', 'kkbk',
  'punb', 'pnb',
  'yes', 'yesb', 'yesbank', 'ybl',
  'bob', 'bobl', 'barb', 'baroda',
  'idfc', 'idfb', 'idfcfirst',
  'indusind', 'indb', 'idbi', 'ibkl',
  'canara', 'cnrb',
  'union', 'ubin',
  'jaka', 'jkb',
  'citi', 'citin', 'hsbc', 'scbl',
  'rbl', 'rblb', 'ratn',
  'federal', 'fdrl', 'dcb', 'dcbl',
  'iob', 'ioba', 'boi', 'bkid',
  'paytm', 'pytm', 'airtel', 'airp', // payments banks (routing, not identity)
]);

// IFSC-shaped token: 4 alpha + '0' + 6 alphanumerics.
const IFSC_RE = /\b[a-z]{4}0[a-z0-9]{6}\b/gi;

/** Strip bank-routing noise from a counterparty string, preserving the
 *  original casing of what remains. Returns the input unchanged when
 *  stripping would destroy the identity. */
export function displayPartyName(raw: string): string {
  const original = (raw ?? '').trim();
  if (!original) return original;
  const s = original
    .replace(/@[a-z0-9.]+/gi, ' ')  // UPI handle suffix
    .replace(IFSC_RE, ' ');
  // Drop the TRAILING run of bank tokens only — the routing-suffix
  // position. A bank word inside or at the start of a name is part of
  // the name.
  const words = s.split(/[\s/\-_.]+/).filter(Boolean);
  while (words.length > 1 && BANK_TOKENS.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  // Guard: the party IS a bank ("YES BANK" → would shrink to "YES") or
  // the name was nothing but noise — keep the original untouched.
  if (words.length === 1 && BANK_TOKENS.has(words[0].toLowerCase())) return original;
  const cleaned = words.join(' ').trim();
  if (cleaned.replace(/[^a-z0-9]/gi, '').length < 3) return original;
  return cleaned;
}

/** Stable grouping key: bank-noise-stripped, lowercased, whitespace
 *  collapsed. Two counterparty variants of one party share a key. */
export function normalizePartyKey(raw: string): string {
  return displayPartyName(raw).toLowerCase().replace(/\s+/g, ' ').trim();
}
