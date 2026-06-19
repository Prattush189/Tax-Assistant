/**
 * Dr/Cr direction of a ledger line, read from the Tally-style "To/By"
 * marker that opens the narration.
 *
 * Indian accounting software (Tally, Busy, Marg, …) prints a party
 * ledger so that each line names the CONTRA account prefixed with
 * "To" or "By":
 *   - "To <X>"  → THIS account is DEBITED  (Dr) — e.g. "To HDFC BANK"
 *                 (we paid the supplier; their account is debited)
 *   - "By <X>"  → THIS account is CREDITED (Cr) — e.g. "By PURCHASE"
 *                 (we bought from them; their account is credited)
 *
 * That marker is the SAME accounting signal the column-mapping wizard
 * reads from the explicit Debit/Credit columns — so the +/- it shows
 * lines up with what the wizard shows. When a narration carries no
 * To/By marker (some exports omit it), we return null and the caller
 * shows the amount with no sign rather than guessing a direction.
 */
export type LedgerDir = 'Dr' | 'Cr' | null;

export function ledgerEntryDirection(narration: string | null | undefined): LedgerDir {
  if (!narration) return null;
  const m = /^\s*(to|by)\b/i.exec(narration);
  if (!m) return null;
  return m[1].toLowerCase() === 'to' ? 'Dr' : 'Cr';
}

/**
 * Apply the app's sign convention — Credit = +, Debit = − (money-in is
 * +, money-out is −, matching MappedRow and the mapping wizard). An
 * unknown direction returns the plain magnitude (no sign assumed).
 */
export function signedByDirection(magnitude: number, dir: LedgerDir): number {
  const mag = Math.abs(magnitude);
  return dir === 'Dr' ? -mag : mag;
}
