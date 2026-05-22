/**
 * CMA wizard UI model.
 *
 * A CMA draft captures everything needed to generate a bank-ready
 * Credit Monitoring Arrangement report:
 *   - Firm identity (name, business, GSTIN, application context)
 *   - 2 years of audited financials (P&L + BS)
 *   - Column mapping from the uploaded Excel onto canonical line
 *     items
 *   - Growth assumptions per P&L line for the projection horizon
 *   - Working-capital assumptions (cycle days OR % of sales)
 *   - Existing + proposed term-loan schedules
 *   - MPBF method selection (user picks per-CMA — no default)
 *   - Stress-test toggle (sales-miss percentage)
 *   - Projection horizon (3 or 5 years)
 *
 * Every block is optional in storage so partial drafts persist
 * cleanly. Validation runs at the wizard's review step before
 * Excel generation.
 */

/** Method options for Maximum Permissible Bank Finance computation.
 *  No default — the wizard forces the user to pick per-CMA so they
 *  match the borrowing bank's expectation (PSU banks differ from
 *  private; SME accounts under ₹5 cr typically use Nayak). */
export type MpbfMethod = 'tandon_i' | 'tandon_ii' | 'nayak';

export const MPBF_METHOD_LABELS: Record<MpbfMethod, string> = {
  tandon_i: 'Tandon Method I (25% on CA ex-stock)',
  tandon_ii: 'Tandon Method II (25% on WC gap)',
  nayak: 'Nayak Committee (20% of turnover)',
};

/** Projection horizon — user picks per-CMA. Term-loan applications
 *  typically need 5 years to make the DSCR-over-tenure picture
 *  visible; pure working-capital limits get away with 3. */
export type ProjectionHorizon = 3 | 5;

/** Working-capital assumption model. Banks accept either approach;
 *  some clients are more comfortable in days (inventory days, debtor
 *  days), others in % of sales (especially for service businesses
 *  with no inventory). User picks per-CMA. */
export type WorkingCapitalModel = 'cycle_days' | 'percent_of_sales';

// ── Step identifiers ────────────────────────────────────────────

export type CmaStepId =
  | 'upload'         // Upload historical Excel + map columns
  | 'firmInfo'       // Firm identity (name, GSTIN, business nature)
  | 'mapping'        // Map imported line items to canonical accounts
  | 'horizon'        // Years + MPBF method selection
  | 'assumptions'    // Growth assumptions per P&L line
  | 'workingCapital' // WC cycle days OR % of sales
  | 'termLoans'      // Existing + proposed term-loan schedules
  | 'stress'         // Stress-test toggle + sales-miss %
  | 'review';        // Generate + export

export const STEP_LABELS: Record<CmaStepId, string> = {
  upload: 'Upload',
  firmInfo: 'Firm',
  mapping: 'Mapping',
  horizon: 'Horizon & MPBF',
  assumptions: 'Assumptions',
  workingCapital: 'Working capital',
  termLoans: 'Term loans',
  stress: 'Stress test',
  review: 'Review & Export',
};

export const STEP_DESCRIPTIONS: Record<CmaStepId, string> = {
  upload: 'Upload your client\'s P&L and Balance Sheet as Excel. We\'ll guide you through mapping columns.',
  firmInfo: 'Firm name, GSTIN, nature of business, application context.',
  mapping: 'Match your uploaded line items to the canonical CMA chart of accounts.',
  horizon: 'Pick projection years (3 or 5) and the MPBF method that matches your borrowing bank.',
  assumptions: 'Per-P&L-line growth assumptions for each projection year.',
  workingCapital: 'Working-capital cycle days OR % of sales — your call based on client comfort.',
  termLoans: 'Existing and proposed term loans — amount, rate, tenure, repayment schedule.',
  stress: 'Toggle stress test — recompute under a sales-miss scenario for the bank\'s risk team.',
  review: 'Generate the CMA report and download as Excel with live formulas.',
};

export const STEP_ORDER: CmaStepId[] = [
  'upload',
  'firmInfo',
  'mapping',
  'horizon',
  'assumptions',
  'workingCapital',
  'termLoans',
  'stress',
  'review',
];

// ── Wizard payload ──────────────────────────────────────────────

export interface FirmInfo {
  firmName?: string;
  gstin?: string;
  businessNature?: string;
  applicationContext?: string; // "Fresh WC limit + term loan for plant expansion"
  state?: string;
}

/** Two years of historicals + the implicit "current year" estimate.
 *  Stored as the RAW uploaded data plus the column mapping the user
 *  confirmed in the mapping step. Numbers are resolved (mapped to
 *  canonical accounts) only at projection time so re-running the
 *  mapping is cheap. */
export interface HistoricalUpload {
  filename?: string;
  /** Sheet name selected from the uploaded workbook (Excel files
   *  often have multiple sheets — P&L on one, BS on another). */
  sheetName?: string;
  /** Raw rows from the sheet — first row treated as header. Stored
   *  client-side until persisted with the draft. */
  rows?: string[][];
  /** Year labels the user identified (e.g. ["FY 23-24", "FY 24-25"]).
   *  Used to label columns in the projected output. */
  yearLabels?: string[];
}

/** Mapping from uploaded line items (by row index) onto canonical
 *  CMA line items. canonicalKey is from the canonical chart of
 *  accounts (see lib/canonicalAccounts.ts — built in Phase 2). */
export interface MappingEntry {
  sourceRowIndex: number;
  canonicalKey: string;
}

/** Per-line growth assumption for the projection horizon. Empty
 *  values mean "no growth assumed" (flatlines from latest historical).
 *  growthPctByYear[0] is year +1 growth over latest historical; index 1
 *  is year +2 over year +1; etc. */
export interface LineAssumption {
  canonicalKey: string;
  growthPctByYear: (number | undefined)[];
}

export interface WorkingCapitalAssumption {
  model: WorkingCapitalModel;
  /** When model='cycle_days': inventory days, debtor days, creditor days. */
  inventoryDays?: number;
  debtorDays?: number;
  creditorDays?: number;
  /** When model='percent_of_sales': WC as % of projected sales. */
  wcAsPctOfSales?: number;
}

export interface TermLoan {
  /** 'existing' = already on the books; 'proposed' = the loan being
   *  applied for. Distinct because banks evaluate both differently —
   *  proposed loans feed eligible-loan-amount checks; existing loans
   *  feed DSCR computations. */
  status: 'existing' | 'proposed';
  lender?: string;
  principal?: number;
  interestRatePct?: number;
  tenureMonths?: number;
  moratoriumMonths?: number;
  /** Drawn-as-of date for existing; sanction date for proposed. */
  drawnAt?: string;
  /** Repayment schedule type. 'equal_emi' = standard EMI;
   *  'equal_principal' = principal-flat with declining interest;
   *  'ballooning' = stepped, defined separately if needed. v1
   *  supports the first two; ballooning falls through to free-form
   *  notes in the export. */
  repaymentType?: 'equal_emi' | 'equal_principal';
}

export interface StressTest {
  enabled?: boolean;
  /** Percentage by which to stress sales downward. 10 = "what if
   *  sales miss by 10%?". COGS scales proportionally; fixed costs
   *  stay flat. The bank's risk team uses this to assess DSCR
   *  resilience. */
  salesMissPct?: number;
}

export interface CmaDraft {
  /** Server-assigned id. Not set on the empty client-side draft
   *  before first save. */
  id?: string;
  name: string;
  firm?: FirmInfo;
  historical?: HistoricalUpload;
  mapping?: MappingEntry[];
  projectionHorizon?: ProjectionHorizon;
  mpbfMethod?: MpbfMethod;
  assumptions?: LineAssumption[];
  workingCapital?: WorkingCapitalAssumption;
  termLoans?: TermLoan[];
  stress?: StressTest;
}

export function emptyDraft(name = ''): CmaDraft {
  return { name, stress: { enabled: false, salesMissPct: 10 } };
}
