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
  /** Column index in `rows` holding the earlier year's values. The
   *  user picks these on the Mapping step; we default to the last
   *  two non-empty columns if not set. */
  yearColumnA?: number;
  yearColumnB?: number;
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
  /** Banker holding-period assumptions used by Form IV. All optional;
   *  exporter falls back to the inventoryDays / debtorDays / creditorDays
   *  values above when these aren't set explicitly. Expressed as
   *  MONTHS (not days) because Form IV's banker convention is months. */
  holdingPeriods?: {
    /** Raw material held — months of consumption. */
    rawMaterialMonths?: number;
    /** Stock-in-process — months of cost of production. */
    workInProcessMonths?: number;
    /** Finished goods — months of cost of sales. */
    finishedGoodsMonths?: number;
    /** Trade receivables — months of net sales (credit sales). */
    receivablesMonths?: number;
    /** Trade payables — months of purchases. */
    payablesMonths?: number;
  };
}

/**
 * One block of fixed assets for Schedule II–style WDV depreciation.
 * Banks expect to see asset categories split out (Plant & Machinery
 * vs Buildings vs Computers vs Furniture) because the rates differ
 * meaningfully — a CMA that puts everything under a single 15% rate
 * over-states depreciation for Buildings (10%) and under-states it
 * for Computers (40%). The Phase 4 Depreciation sheet renders one
 * block per row × N projected years.
 *
 * `additions` and `deductions` are aligned to the projection horizon
 * (one entry per FY). When omitted, the exporter treats them as
 * zero — the block simply rolls down at `ratePct`. Future enhancement
 * can derive additions from term-loan disbursements (capex proxy).
 */
export interface FixedAssetBlock {
  name: string;
  /** Depreciation rate as a decimal — 0.15 = 15%. */
  ratePct: number;
  /** Opening WDV at the start of the FIRST projected year. */
  openingWdv: number;
  /** Capex added during each projected FY (optional). */
  additions?: number[];
  /** Disposals during each projected FY (optional). */
  deductions?: number[];
}

/** Standard Schedule II–derived defaults the exporter falls back on
 *  when the user hasn't supplied any blocks. Opening WDVs are zero;
 *  the exporter substitutes the latest historical fixed-asset total
 *  into the FIRST block as a sensible starting point. */
export const DEFAULT_FIXED_ASSET_BLOCKS: FixedAssetBlock[] = [
  { name: 'Plant & Machinery', ratePct: 0.15, openingWdv: 0 },
  { name: 'Buildings', ratePct: 0.10, openingWdv: 0 },
  { name: 'Furniture & Fittings', ratePct: 0.10, openingWdv: 0 },
  { name: 'Computers', ratePct: 0.40, openingWdv: 0 },
  { name: 'Vehicles', ratePct: 0.15, openingWdv: 0 },
];

/**
 * Project Report / Introduction page content (Form I in some banker
 * templates). Phase 2 surfaces this on the exported Excel as the
 * "Introduction" sheet. Each field is optional; the exporter falls
 * back to deterministic defaults built from firm + projection data
 * when a value is missing. Users edit on ReviewStep before export.
 */
export interface ProjectReport {
  /** "Rs.83.75 Lacs Term Loan + Enhancement in CC from Rs.80L to Rs.150L". */
  creditRequest?: string;
  /** Margin (own contribution) ratio as a decimal — 0.25 = 25%. */
  margin?: number;
  /** Itemised cost-of-project entries. */
  costOfProject?: Array<{ item: string; amount: number }>;
  /** Itemised means-of-finance entries (own contribution, bank loan, etc.). */
  meansOfFinance?: Array<{ item: string; amount: number }>;
  /** Multi-paragraph narrative about the firm, promoter, business. */
  briefProfile?: string;
  /** Machinery / equipment description. */
  machineryDetails?: string;
  /** Premises description. */
  premises?: string;
  /** Power connection details. */
  powerConnection?: string;
  /** ROI assumptions (e.g. "Term Loan at 8.35% p.a., CC at 8.50% p.a."). */
  rateOfInterestNotes?: string;
}

/**
 * BEP (Break-Even Point) inputs. Each canonical cost line is treated
 * as some proportion variable and the rest fixed. The exporter uses
 * these to split the operating statement into variable vs fixed
 * components on the BEP sheet. Sensible defaults applied when a key
 * is missing: COGS = 100% variable, SG&A = 20% variable, depreciation
 * = 0% variable (fully fixed), finance cost = 0% variable. Users can
 * override on ReviewStep.
 */
export interface BepAssumption {
  /** Per canonical cost key — fraction of that line that's variable.
   *  0 = fully fixed, 1 = fully variable. Anything between 0 and 1 is
   *  a split (e.g. 0.8 means 80% variable / 20% fixed). */
  variableFractionByKey?: Partial<Record<string, number>>;
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
  /** Month within the projection's FIRST year in which the loan is
   *  disbursed (1 = April for FY accounting, 12 = March). Used by the
   *  Phase 3 monthly amortisation schedule so the disbursement row
   *  lands on the correct month and the moratorium counts forward
   *  from there. Defaults to month 1 (start of FY) when unset. */
  disbursementMonth?: number;
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
  /** Form I content (Phase 2). Auto-defaulted in the exporter; user
   *  can edit on ReviewStep before export. */
  projectReport?: ProjectReport;
  /** BEP inputs (Phase 2). Same default-and-edit pattern. */
  bep?: BepAssumption;
  /** Per-block depreciation schedule (Phase 4). When omitted, the
   *  exporter renders a single 15% Plant & Machinery block seeded
   *  from the latest historical fixed-asset total — same as Phase 3
   *  behaviour. User adds blocks on the AssumptionsStep. */
  fixedAssetBlocks?: FixedAssetBlock[];
  /** Monthly seasonality vector for the MPBF Monthly sheet (Phase
   *  4). 12 numbers summing to 1.0; when omitted, the exporter
   *  treats each month as 1/12. Useful for seasonal businesses
   *  (textiles peak in Oct-Nov; agri inputs peak in May-Jun). */
  monthlySeasonality?: number[];
}

export function emptyDraft(name = ''): CmaDraft {
  return { name, stress: { enabled: false, salesMissPct: 10 } };
}
