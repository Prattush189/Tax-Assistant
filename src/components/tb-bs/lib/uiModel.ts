/**
 * TB → BS wizard UI model. A draft captures:
 *   - Firm identity (basic — Schedule III header info)
 *   - Trial Balance upload (raw rows + column picks)
 *   - Per-account mapping onto Schedule III line items
 *   - Optional: previous-year TB upload for two-period statements
 *
 * No projections, no MPBF, no ratios. Just classification + layout.
 * Output is Schedule III BS + P&L (and an optional "Send to CMA"
 * handoff that pipes the computed BS into a new CMA draft).
 */

/** Input type: a raw Trial Balance OR an already-prepared Balance
 *  Sheet. Both flow through the same mapping step (BS is just a TB
 *  with fewer, already-aggregated rows). Default 'tb' to preserve
 *  behaviour for drafts created before this field existed. */
export type TbBsInputType = 'tb' | 'bs';

/** Output Excel layout. The same canonical aggregate flows into
 *  three different format-specific exporters. */
export type TbBsOutputFormat = 'schedule_iii' | 'icai_nc' | 'tally_vertical';

export const OUTPUT_FORMAT_LABELS: Record<TbBsOutputFormat, string> = {
  schedule_iii: 'Schedule III (Companies Act 2013) — Corporate',
  icai_nc: 'ICAI Non-Corporate Entity (Technical Guide 2023)',
  tally_vertical: 'Tally-style Sources / Application of Funds',
};

export type TbBsStepId =
  | 'upload'         // TB or BS upload (current year + optional previous year)
  | 'firmInfo'       // Firm header info for the report
  | 'mapping'        // Map each row to a canonical line
  | 'review';        // Pick output format + export

export const STEP_LABELS: Record<TbBsStepId, string> = {
  upload: 'Upload Trial Balance',
  firmInfo: 'Firm details',
  mapping: 'Map to Schedule III',
  review: 'Review & Export',
};

export const STEP_DESCRIPTIONS: Record<TbBsStepId, string> = {
  upload: 'Upload one or two years of Trial Balance OR Balance Sheet (Excel / CSV / PDF). Tally / Busy / Marg exports all work.',
  firmInfo: 'Firm name + CIN / GSTIN for the report header.',
  mapping: 'Match each uploaded row to its canonical line.',
  review: 'Pick output format (Schedule III / ICAI Non-Corporate / Tally vertical) and download.',
};

export const STEP_ORDER: TbBsStepId[] = ['upload', 'firmInfo', 'mapping', 'review'];

/** The two reporting periods. Year B is the current period (the
 *  one you're filing for); Year A is the previous year shown
 *  alongside in the Schedule III "comparative" column. */
export interface TbUpload {
  filename?: string;
  sheetName?: string;
  rows?: string[][];
  yearLabel?: string;
  /** Column index for the account name (usually 0 or 1). */
  accountColumn?: number;
  /** Column index for debit balance. If null, we read the signed
   *  amount from `signedColumn` instead. */
  debitColumn?: number | null;
  /** Column index for credit balance. */
  creditColumn?: number | null;
  /** Alternative: single signed column (positive = debit balance). */
  signedColumn?: number | null;
}

export interface TbBsFirmInfo {
  firmName?: string;
  cin?: string;
  gstin?: string;
  /** Address / registered office for the Schedule III header. */
  registeredOffice?: string;
}

/** Per-row mapping. canonicalKey references the Schedule III chart
 *  in lib/scheduleThreeAccounts. */
export interface TbMappingEntry {
  sourceRowIndex: number;
  /** Which year the mapping applies to. Mapping is shared across
   *  years by default (the row label is identical), so this is
   *  always 'current' in v1; structure left in place for later
   *  multi-year support. */
  yearKey: 'current' | 'previous';
  canonicalKey: string;
  /** Only meaningful when canonicalKey === 'bs_long_term_borrowings'.
   *  When true, the row counts as an Unsecured Loan in the Tally
   *  Sources/Application output. Schedule III + ICAI exporters
   *  ignore this and continue to show one combined "Long-term
   *  borrowings" line. Defaults to false (= secured). */
  isUnsecured?: boolean;
}

export interface TbBsDraft {
  id?: string;
  name: string;
  firm?: TbBsFirmInfo;
  /** What kind of file the user is uploading. Defaults to 'tb' for
   *  pre-existing drafts (the field didn't exist before). */
  inputType?: TbBsInputType;
  /** Which Excel layout to emit on download. Defaults to 'schedule_iii'
   *  for pre-existing drafts. */
  outputFormat?: TbBsOutputFormat;
  /** Current-year TB or BS, depending on inputType. Same file shape
   *  (rows + column picks) regardless. */
  currentTb?: TbUpload;
  /** Previous-year TB or BS (optional). */
  previousTb?: TbUpload;
  mapping?: TbMappingEntry[];
}

export function emptyTbBsDraft(name = ''): TbBsDraft {
  return { name, inputType: 'tb', outputFormat: 'schedule_iii' };
}
