// server/lib/creditPolicy.ts
//
// Single source of truth for the page→credit and CSV-row→credit
// conversion. Touched by:
//   - the analyze / upload routes (compute credits at finish, decide
//     whether to accept a file based on remaining credits),
//   - featureUsageRepo (sum credits_used in the quota check),
//   - the admin / dashboard usage display (show pages-equivalent of
//     credit budget on the Plans page),
//   - the frontend (mirrored constants used to count pages client-side
//     for the pre-flight check before sending the request).
//
// One credit = a unit of monthly allowance; each plan tier carries a
// credit count rather than a run count. Different features and input
// formats consume credits at different rates because their actual
// Gemini cost differs:
//
//   Bank statement PDF: 5 pages = 1 credit
//   Bank statement CSV: 100 rows = 1 credit
//                       (≈20 rows/page → 5 pages = 100 rows = 1 credit)
//   Ledger scrutiny:    10 pages = 1 credit
//                       (extract + chunked audit, more total Gemini work
//                        per page than a bank statement chunk).
//
// Cancellation only debits credits for pages PROCESSED so far (chunks
// that finished before the cancel landed). Failure / timeout debits
// nothing — the user gets a free retry.

export type CreditFeature = 'bank_statement' | 'ledger_scrutiny';

/** PDF / vision pages per credit. */
export const PAGES_PER_CREDIT: Record<CreditFeature, number> = {
  bank_statement: 5,
  ledger_scrutiny: 10,
};

/** CSV rows per credit. Only bank statement currently accepts CSV
 *  input; future ledger-CSV support can plug in here without changing
 *  the call sites. */
export const CSV_ROWS_PER_CREDIT: Partial<Record<CreditFeature, number>> = {
  bank_statement: 100,
};

/** Convert pages to credits, rounded UP so a 6-page bank statement
 *  costs 2 credits (10 pages of headroom) rather than 1. Zero pages
 *  = zero credits (legitimate when a cancel beat the first chunk). */
export function creditsForPages(feature: CreditFeature, pages: number): number {
  if (pages <= 0) return 0;
  const divisor = PAGES_PER_CREDIT[feature];
  return Math.max(1, Math.ceil(pages / divisor));
}

/** Convert CSV rows to credits, same ceiling behaviour. Throws if
 *  the feature has no CSV route configured (catches typos at the
 *  call site). */
export function creditsForCsvRows(feature: CreditFeature, rows: number): number {
  const divisor = CSV_ROWS_PER_CREDIT[feature];
  if (divisor === undefined) {
    throw new Error(`No CSV credit policy configured for feature '${feature}'`);
  }
  if (rows <= 0) return 0;
  return Math.max(1, Math.ceil(rows / divisor));
}

/** Inverse of creditsForPages — used by the Plans page + admin UI
 *  to render "up to N pages" text from a credit allowance. */
export function pagesForCredits(feature: CreditFeature, credits: number): number {
  return Math.max(0, credits) * PAGES_PER_CREDIT[feature];
}

/** Same for CSV rows. */
export function csvRowsForCredits(feature: CreditFeature, credits: number): number {
  const divisor = CSV_ROWS_PER_CREDIT[feature];
  if (divisor === undefined) return 0;
  return Math.max(0, credits) * divisor;
}
