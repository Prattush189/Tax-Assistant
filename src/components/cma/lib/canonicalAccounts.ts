/**
 * Canonical chart of accounts for CMA reports.
 *
 * Banks demand a specific line-item structure in CMA Form II (sometimes
 * called "Form for assessment of working capital limits"). This file
 * defines every line we surface in the output Excel, grouped by
 * section. The user maps their uploaded P&L / BS rows to these
 * canonical keys in the wizard's Mapping step; projections + MPBF +
 * ratios all run against this normalized shape.
 *
 * Design principle: detailed enough that the bank's officer sees the
 * lines they expect to see, but not so granular that the user spends
 * 30 minutes mapping every account in their trial balance. Most CAs
 * exporting from Tally / Busy get a BS / P&L at this granularity
 * directly — the mapping is usually 1:1 with their export.
 *
 * Sign convention: every value is stored as a NON-NEGATIVE magnitude.
 * The section determines whether it's a credit or debit, and the
 * derived totals know how to subtract / add. This avoids the common
 * "is the expense column positive or negative?" confusion.
 */

export type CanonicalSection =
  | 'pl_revenue'                  // Operating revenue
  | 'pl_other_income'             // Non-operating income (interest received, misc)
  | 'pl_cogs'                     // Cost of goods sold / direct expense
  | 'pl_operating_expense'        // Selling, admin, employee, other operating expenses
  | 'pl_depreciation'             // Depreciation + amortization
  | 'pl_finance_cost'             // Interest expense
  | 'pl_tax'                      // Current + deferred tax
  // Balance sheet — current assets
  | 'bs_inventory'
  | 'bs_receivables'              // Sundry debtors, trade receivables
  | 'bs_cash_bank'                // Cash, bank balances
  | 'bs_other_current_assets'     // Loans + advances, prepaid, etc.
  // Balance sheet — non-current assets
  | 'bs_gross_fixed_assets'
  | 'bs_accumulated_depreciation'
  | 'bs_other_non_current_assets' // Long-term investments, goodwill
  // Balance sheet — liabilities
  | 'bs_creditors'                // Sundry creditors, trade payables
  | 'bs_bank_borrowing_short'     // CC, OD, WC loan (fund-based limits)
  | 'bs_statutory_dues'           // GST, TDS, PF, ESI payable
  | 'bs_other_current_liabilities'
  | 'bs_term_loan'                // Existing term loans
  | 'bs_other_non_current_liab'   // Long-term provisions, deferred tax liab
  // Balance sheet — equity / net worth
  | 'bs_paid_up_capital'
  | 'bs_reserves_surplus';

export interface CanonicalAccount {
  key: CanonicalSection;
  label: string;
  /** High-level grouping for the wizard's mapping UI. Each group
   *  renders as a collapsible section so users scan a short list of
   *  ~6 lines per group rather than 22 lines in one list. */
  group: 'pl' | 'bs_assets' | 'bs_liabilities' | 'bs_equity';
  /** Hints surfaced in the mapping wizard — the substrings we expect
   *  to see in the user's uploaded row names for this canonical line.
   *  Used by the auto-suggest heuristic AND printed beside the picker
   *  ("commonly appears as: …"). Lower-cased for case-insensitive
   *  matching. */
  matchHints: string[];
}

export const CANONICAL_ACCOUNTS: CanonicalAccount[] = [
  // ── P&L ────────────────────────────────────────────────────────
  { key: 'pl_revenue', label: 'Revenue from operations (net sales)', group: 'pl',
    matchHints: ['sales', 'turnover', 'revenue from operations', 'net sales', 'income from operations', 'service income'] },
  { key: 'pl_other_income', label: 'Other income', group: 'pl',
    matchHints: ['other income', 'misc income', 'interest received', 'discount received', 'rent received', 'commission received'] },
  { key: 'pl_cogs', label: 'Cost of goods sold / Direct expenses', group: 'pl',
    matchHints: ['cost of goods sold', 'cogs', 'cost of sales', 'direct expense', 'raw material', 'purchases', 'consumption', 'manufacturing expense'] },
  { key: 'pl_operating_expense', label: 'Operating expenses (selling, admin, employee)', group: 'pl',
    matchHints: ['operating expense', 'admin expense', 'office expense', 'selling expense', 'employee cost', 'salary', 'salaries', 'wages', 'staff', 'rent paid', 'electricity', 'professional fee', 'travel', 'marketing'] },
  { key: 'pl_depreciation', label: 'Depreciation & amortization', group: 'pl',
    matchHints: ['depreciation', 'amortization', 'amortisation'] },
  { key: 'pl_finance_cost', label: 'Finance costs (interest paid)', group: 'pl',
    matchHints: ['interest', 'finance cost', 'interest paid', 'loan interest', 'bank interest', 'cc interest'] },
  { key: 'pl_tax', label: 'Tax expense (current + deferred)', group: 'pl',
    matchHints: ['tax', 'income tax', 'provision for tax', 'current tax', 'deferred tax'] },

  // ── BS — current assets ────────────────────────────────────────
  { key: 'bs_inventory', label: 'Inventory / Stock', group: 'bs_assets',
    matchHints: ['inventory', 'stock', 'closing stock', 'work in progress', 'wip', 'finished goods', 'raw material stock'] },
  { key: 'bs_receivables', label: 'Trade receivables (sundry debtors)', group: 'bs_assets',
    matchHints: ['debtors', 'sundry debtors', 'receivables', 'trade receivables', 'bills receivable'] },
  { key: 'bs_cash_bank', label: 'Cash & bank balances', group: 'bs_assets',
    matchHints: ['cash', 'bank', 'cash in hand', 'bank balance', 'bank deposits', 'fixed deposit', 'fd'] },
  { key: 'bs_other_current_assets', label: 'Other current assets (advances, prepaid)', group: 'bs_assets',
    matchHints: ['loans and advances', 'prepaid', 'tds receivable', 'gst input', 'other current assets'] },

  // ── BS — non-current assets ────────────────────────────────────
  { key: 'bs_gross_fixed_assets', label: 'Gross block of fixed assets', group: 'bs_assets',
    matchHints: ['fixed assets', 'plant', 'machinery', 'land', 'building', 'furniture', 'gross block', 'computers', 'vehicles'] },
  { key: 'bs_accumulated_depreciation', label: 'Accumulated depreciation', group: 'bs_assets',
    matchHints: ['accumulated depreciation', 'less depreciation', 'depreciation reserve'] },
  { key: 'bs_other_non_current_assets', label: 'Other non-current assets (investments, goodwill)', group: 'bs_assets',
    matchHints: ['investments', 'goodwill', 'intangible', 'long term investment', 'other non current'] },

  // ── BS — liabilities ───────────────────────────────────────────
  { key: 'bs_creditors', label: 'Trade payables (sundry creditors)', group: 'bs_liabilities',
    matchHints: ['creditors', 'sundry creditors', 'trade payables', 'bills payable'] },
  { key: 'bs_bank_borrowing_short', label: 'Short-term bank borrowings (CC/OD/WC loan)', group: 'bs_liabilities',
    matchHints: ['cash credit', 'cc account', 'overdraft', 'working capital loan', 'wc loan', 'short term borrowing', 'bank borrowing'] },
  { key: 'bs_statutory_dues', label: 'Statutory dues (GST, TDS, PF)', group: 'bs_liabilities',
    matchHints: ['gst payable', 'tds payable', 'pf payable', 'esi payable', 'statutory dues', 'duties and taxes'] },
  { key: 'bs_other_current_liabilities', label: 'Other current liabilities', group: 'bs_liabilities',
    matchHints: ['other current liabilities', 'advance from customers', 'outstanding expenses', 'accrued', 'provision'] },
  { key: 'bs_term_loan', label: 'Term loans (long-term)', group: 'bs_liabilities',
    matchHints: ['term loan', 'long term loan', 'secured loan', 'unsecured loan'] },
  { key: 'bs_other_non_current_liab', label: 'Other non-current liabilities', group: 'bs_liabilities',
    matchHints: ['deferred tax', 'long term provision', 'other non current liab'] },

  // ── BS — equity ────────────────────────────────────────────────
  { key: 'bs_paid_up_capital', label: 'Paid-up capital / Partner capital', group: 'bs_equity',
    matchHints: ['capital', 'paid up capital', 'share capital', 'partner capital', 'proprietor capital', 'capital account'] },
  { key: 'bs_reserves_surplus', label: 'Reserves & surplus', group: 'bs_equity',
    matchHints: ['reserves', 'surplus', 'retained earnings', 'general reserve', 'profit and loss account'] },
];

export const ACCOUNT_BY_KEY: Record<CanonicalSection, CanonicalAccount> = Object.fromEntries(
  CANONICAL_ACCOUNTS.map((a) => [a.key, a]),
) as Record<CanonicalSection, CanonicalAccount>;

export const GROUP_LABELS: Record<CanonicalAccount['group'], string> = {
  pl: 'Profit & Loss',
  bs_assets: 'Balance Sheet — Assets',
  bs_liabilities: 'Balance Sheet — Liabilities',
  bs_equity: 'Balance Sheet — Equity / Net Worth',
};

/**
 * Auto-suggest the best canonical key for a given uploaded row name.
 * Returns the highest-scoring match (substring matches against the
 * canonical line's hints), or null when nothing scores above
 * threshold.
 *
 * Scoring: longer hint matches beat shorter ones (so "term loan"
 * beats "loan" when both could match), and the match must be at
 * least 4 chars (avoid "or" matching everything).
 */
export function suggestCanonicalKey(rowName: string): CanonicalSection | null {
  const hay = rowName.toLowerCase().trim();
  if (hay.length < 3) return null;
  let bestKey: CanonicalSection | null = null;
  let bestScore = 0;
  for (const acc of CANONICAL_ACCOUNTS) {
    for (const hint of acc.matchHints) {
      if (hint.length < 4) continue;
      if (hay.includes(hint)) {
        // Score = hint length. Tied lengths fall back to canonical
        // order (declaration order in CANONICAL_ACCOUNTS — we put
        // more specific categories first, e.g. 'term loan' before
        // 'loan' in matchHints).
        if (hint.length > bestScore) {
          bestScore = hint.length;
          bestKey = acc.key;
        }
      }
    }
  }
  return bestKey;
}
