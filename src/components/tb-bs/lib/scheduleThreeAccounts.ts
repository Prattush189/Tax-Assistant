/**
 * Schedule III canonical chart of accounts. Drives:
 *   - The mapping step's dropdown
 *   - The Schedule III BS + P&L Excel emission layout
 *   - The TB → CMA hand-off (mapped back to CMA's coarser chart)
 *
 * Source: Schedule III to the Companies Act, 2013 — Division I
 * (Indian GAAP) Balance Sheet + Statement of Profit & Loss
 * format. Granular enough to satisfy filing requirements; not so
 * granular that mapping a typical SME TB takes 30 minutes.
 *
 * Sign convention: every value is stored as a non-negative
 * magnitude. The section determines whether it's a debit or credit;
 * the layout knows where to put it.
 */

export type ScheduleThreeSection =
  // Statement of P&L — income
  | 'pl_revenue_operations'      // I. Revenue from operations
  | 'pl_other_income'            // II. Other income
  // Statement of P&L — expenses
  | 'pl_cost_of_materials'       // IV(a). Cost of materials consumed
  | 'pl_purchases_stock'         // IV(b). Purchases of stock-in-trade
  | 'pl_change_inventory'        // IV(c). Changes in inventories of FG / WIP / stock-in-trade
  | 'pl_employee_benefits'       // IV(d). Employee benefits expense
  | 'pl_finance_costs'           // IV(e). Finance costs
  | 'pl_depreciation_amort'      // IV(f). Depreciation and amortization
  | 'pl_other_expenses'          // IV(g). Other expenses
  | 'pl_exceptional_items'       // VI. Exceptional items
  | 'pl_tax_current'             // IX(a). Current tax
  | 'pl_tax_deferred'            // IX(b). Deferred tax

  // BS — Equity & Liabilities
  | 'bs_share_capital'           // I. Shareholders' funds — Share capital
  | 'bs_reserves_surplus'        // I. Shareholders' funds — Reserves & surplus
  | 'bs_money_received_share_warrants' // I. Money received against share warrants
  | 'bs_share_application_pending'     // II. Share application pending allotment
  | 'bs_long_term_borrowings'    // III(a). Long-term borrowings
  | 'bs_deferred_tax_liab'       // III(b). Deferred tax liabilities (net)
  | 'bs_other_long_term_liab'    // III(c). Other long-term liabilities
  | 'bs_long_term_provisions'    // III(d). Long-term provisions
  | 'bs_short_term_borrowings'   // IV(a). Short-term borrowings (CC/OD/WC loan)
  | 'bs_trade_payables'          // IV(b). Trade payables
  | 'bs_other_current_liab'      // IV(c). Other current liabilities
  | 'bs_short_term_provisions'   // IV(d). Short-term provisions

  // BS — Assets
  | 'bs_tangible_assets'         // I(a). Fixed assets — Tangible
  | 'bs_intangible_assets'       // I(a). Fixed assets — Intangible
  | 'bs_capital_wip'             // I(a). Capital work-in-progress
  | 'bs_intangible_under_dev'    // I(a). Intangible assets under development
  | 'bs_non_current_investments' // I(b). Non-current investments
  | 'bs_deferred_tax_asset'      // I(c). Deferred tax assets (net)
  | 'bs_long_term_loans_advances'// I(d). Long-term loans and advances
  | 'bs_other_non_current_assets'// I(e). Other non-current assets
  | 'bs_current_investments'     // II(a). Current investments
  | 'bs_inventories'             // II(b). Inventories
  | 'bs_trade_receivables'       // II(c). Trade receivables
  | 'bs_cash_equivalents'        // II(d). Cash and cash equivalents
  | 'bs_short_term_loans_advances' // II(e). Short-term loans and advances
  | 'bs_other_current_assets';   // II(f). Other current assets

export interface ScheduleThreeAccount {
  key: ScheduleThreeSection;
  /** Display label as it should appear in the Excel + mapping UI. */
  label: string;
  /** High-level grouping for the UI. */
  group: 'pl_income' | 'pl_expense' | 'pl_tax' | 'bs_equity_liab' | 'bs_assets';
  /** Roman numeral / lettered section reference per Schedule III. */
  section: string;
  /** Whether values default to debit or credit balance in a TB.
   *  Used to auto-pick the side when a TB row has both columns. */
  side: 'debit' | 'credit';
  /** Substring hints for auto-suggest. Lower-cased. */
  matchHints: string[];
}

export const SCHEDULE_THREE_ACCOUNTS: ScheduleThreeAccount[] = [
  // ── P&L Income ────────────────────────────────────────────────
  { key: 'pl_revenue_operations', label: 'Revenue from operations', group: 'pl_income', section: 'I',
    side: 'credit',
    matchHints: ['sales', 'turnover', 'revenue from operations', 'service income', 'income from operations'] },
  { key: 'pl_other_income', label: 'Other income', group: 'pl_income', section: 'II',
    side: 'credit',
    matchHints: ['other income', 'interest received', 'misc income', 'discount received', 'rent received', 'commission received', 'profit on sale'] },

  // ── P&L Expenses ──────────────────────────────────────────────
  { key: 'pl_cost_of_materials', label: 'Cost of materials consumed', group: 'pl_expense', section: 'IV(a)',
    side: 'debit',
    matchHints: ['raw material', 'materials consumed', 'consumption of raw', 'opening stock raw', 'closing stock raw'] },
  { key: 'pl_purchases_stock', label: 'Purchases of stock-in-trade', group: 'pl_expense', section: 'IV(b)',
    side: 'debit',
    matchHints: ['purchases', 'purchase account', 'stock in trade', 'trading purchases'] },
  { key: 'pl_change_inventory', label: 'Changes in inventories of FG / WIP', group: 'pl_expense', section: 'IV(c)',
    side: 'debit',
    // NOTE: 'closing stock' / 'opening stock' / 'wip' are
    // intentionally NOT here — those typically appear as inventory
    // BALANCES on a TB (mapped to bs_inventories), not as P&L change-
    // in-stock lines. The "change" line is an accounting adjustment
    // computed from the two balances, rarely a literal TB row name.
    matchHints: ['changes in inventory', 'change in stock', 'increase decrease in inventory'] },
  { key: 'pl_employee_benefits', label: 'Employee benefits expense', group: 'pl_expense', section: 'IV(d)',
    side: 'debit',
    matchHints: ['salary', 'salaries', 'wages', 'staff', 'employee', 'pf contribution', 'esi contribution', 'gratuity', 'bonus'] },
  { key: 'pl_finance_costs', label: 'Finance costs', group: 'pl_expense', section: 'IV(e)',
    side: 'debit',
    matchHints: ['interest', 'finance cost', 'interest paid', 'loan interest', 'bank interest', 'bank charges'] },
  { key: 'pl_depreciation_amort', label: 'Depreciation and amortization', group: 'pl_expense', section: 'IV(f)',
    side: 'debit',
    matchHints: ['depreciation', 'amortization', 'amortisation'] },
  { key: 'pl_other_expenses', label: 'Other expenses', group: 'pl_expense', section: 'IV(g)',
    side: 'debit',
    matchHints: ['rent paid', 'electricity', 'professional fee', 'travel', 'communication', 'printing stationery', 'repairs', 'insurance', 'office expense', 'miscellaneous', 'audit fee', 'legal'] },
  { key: 'pl_exceptional_items', label: 'Exceptional items', group: 'pl_expense', section: 'VI',
    side: 'debit',
    matchHints: ['exceptional', 'extraordinary', 'one time'] },

  // ── P&L Tax ───────────────────────────────────────────────────
  { key: 'pl_tax_current', label: 'Current tax', group: 'pl_tax', section: 'IX(a)',
    side: 'debit',
    matchHints: ['current tax', 'income tax', 'provision for tax', 'tax expense'] },
  { key: 'pl_tax_deferred', label: 'Deferred tax', group: 'pl_tax', section: 'IX(b)',
    side: 'debit',
    matchHints: ['deferred tax expense', 'deferred tax charge'] },

  // ── BS — Equity & Liabilities ─────────────────────────────────
  { key: 'bs_share_capital', label: 'Share capital', group: 'bs_equity_liab', section: 'I(a)',
    side: 'credit',
    matchHints: ['share capital', 'paid up capital', 'equity share', 'preference share', 'partner capital', 'proprietor capital'] },
  { key: 'bs_reserves_surplus', label: 'Reserves and surplus', group: 'bs_equity_liab', section: 'I(b)',
    side: 'credit',
    matchHints: ['reserves', 'surplus', 'general reserve', 'retained earnings', 'profit and loss account', 'securities premium', 'capital reserve'] },
  { key: 'bs_money_received_share_warrants', label: 'Money received against share warrants', group: 'bs_equity_liab', section: 'I(c)',
    side: 'credit',
    matchHints: ['share warrant', 'money received against share'] },
  { key: 'bs_share_application_pending', label: 'Share application money pending allotment', group: 'bs_equity_liab', section: 'II',
    side: 'credit',
    matchHints: ['share application', 'application money pending'] },
  { key: 'bs_long_term_borrowings', label: 'Long-term borrowings', group: 'bs_equity_liab', section: 'III(a)',
    side: 'credit',
    matchHints: ['long term loan', 'long term borrowing', 'term loan', 'secured loan', 'unsecured loan', 'debentures', 'bonds'] },
  { key: 'bs_deferred_tax_liab', label: 'Deferred tax liabilities (net)', group: 'bs_equity_liab', section: 'III(b)',
    side: 'credit',
    matchHints: ['deferred tax liability', 'dtl'] },
  { key: 'bs_other_long_term_liab', label: 'Other long-term liabilities', group: 'bs_equity_liab', section: 'III(c)',
    side: 'credit',
    matchHints: ['other long term liab'] },
  { key: 'bs_long_term_provisions', label: 'Long-term provisions', group: 'bs_equity_liab', section: 'III(d)',
    side: 'credit',
    matchHints: ['long term provision', 'provision for gratuity', 'provision for leave encashment'] },
  { key: 'bs_short_term_borrowings', label: 'Short-term borrowings', group: 'bs_equity_liab', section: 'IV(a)',
    side: 'credit',
    matchHints: ['cash credit', 'cc account', 'overdraft', 'working capital loan', 'wc loan', 'short term borrowing'] },
  { key: 'bs_trade_payables', label: 'Trade payables', group: 'bs_equity_liab', section: 'IV(b)',
    side: 'credit',
    matchHints: ['creditors', 'sundry creditors', 'trade payables', 'bills payable'] },
  { key: 'bs_other_current_liab', label: 'Other current liabilities', group: 'bs_equity_liab', section: 'IV(c)',
    side: 'credit',
    matchHints: ['other current liab', 'advance from customers', 'outstanding expenses', 'accrued', 'gst payable', 'tds payable', 'duties and taxes', 'statutory dues'] },
  { key: 'bs_short_term_provisions', label: 'Short-term provisions', group: 'bs_equity_liab', section: 'IV(d)',
    side: 'credit',
    matchHints: ['short term provision', 'provision for tax', 'proposed dividend'] },

  // ── BS — Assets ───────────────────────────────────────────────
  { key: 'bs_tangible_assets', label: 'Tangible fixed assets', group: 'bs_assets', section: 'I(a)(i)',
    side: 'debit',
    matchHints: ['land', 'building', 'plant', 'machinery', 'furniture', 'fixtures', 'vehicles', 'computer', 'office equipment', 'tangible asset', 'fixed asset'] },
  { key: 'bs_intangible_assets', label: 'Intangible assets', group: 'bs_assets', section: 'I(a)(ii)',
    side: 'debit',
    matchHints: ['goodwill', 'patents', 'trademark', 'copyright', 'software', 'intangible', 'license'] },
  { key: 'bs_capital_wip', label: 'Capital work-in-progress', group: 'bs_assets', section: 'I(a)(iii)',
    side: 'debit',
    matchHints: ['capital wip', 'capital work in progress', 'cwip'] },
  { key: 'bs_intangible_under_dev', label: 'Intangible assets under development', group: 'bs_assets', section: 'I(a)(iv)',
    side: 'debit',
    matchHints: ['intangible under development'] },
  { key: 'bs_non_current_investments', label: 'Non-current investments', group: 'bs_assets', section: 'I(b)',
    side: 'debit',
    matchHints: ['long term investment', 'non current investment', 'investment in shares', 'investment in subsidiary'] },
  { key: 'bs_deferred_tax_asset', label: 'Deferred tax assets (net)', group: 'bs_assets', section: 'I(c)',
    side: 'debit',
    matchHints: ['deferred tax asset', 'dta'] },
  { key: 'bs_long_term_loans_advances', label: 'Long-term loans and advances', group: 'bs_assets', section: 'I(d)',
    side: 'debit',
    matchHints: ['long term loan given', 'long term advances', 'security deposit', 'capital advance'] },
  { key: 'bs_other_non_current_assets', label: 'Other non-current assets', group: 'bs_assets', section: 'I(e)',
    side: 'debit',
    matchHints: ['other non current asset', 'preliminary expense'] },
  { key: 'bs_current_investments', label: 'Current investments', group: 'bs_assets', section: 'II(a)',
    side: 'debit',
    matchHints: ['current investment', 'mutual fund', 'short term investment'] },
  { key: 'bs_inventories', label: 'Inventories', group: 'bs_assets', section: 'II(b)',
    side: 'debit',
    matchHints: ['inventory', 'stock', 'closing stock', 'work in progress', 'wip', 'finished goods', 'raw material stock'] },
  { key: 'bs_trade_receivables', label: 'Trade receivables', group: 'bs_assets', section: 'II(c)',
    side: 'debit',
    matchHints: ['debtors', 'sundry debtors', 'receivables', 'trade receivables', 'bills receivable'] },
  { key: 'bs_cash_equivalents', label: 'Cash and cash equivalents', group: 'bs_assets', section: 'II(d)',
    side: 'debit',
    matchHints: ['cash', 'cash in hand', 'bank', 'bank balance', 'current account', 'savings account', 'fixed deposit', 'fd'] },
  { key: 'bs_short_term_loans_advances', label: 'Short-term loans and advances', group: 'bs_assets', section: 'II(e)',
    side: 'debit',
    matchHints: ['loans and advances', 'short term advances', 'staff advance', 'advance to suppliers'] },
  { key: 'bs_other_current_assets', label: 'Other current assets', group: 'bs_assets', section: 'II(f)',
    side: 'debit',
    matchHints: ['prepaid', 'gst input', 'tds receivable', 'income tax refund', 'other current assets', 'accrued interest'] },
];

export const SCHEDULE_THREE_BY_KEY: Record<ScheduleThreeSection, ScheduleThreeAccount> = Object.fromEntries(
  SCHEDULE_THREE_ACCOUNTS.map((a) => [a.key, a]),
) as Record<ScheduleThreeSection, ScheduleThreeAccount>;

export const SCHEDULE_THREE_GROUP_LABELS: Record<ScheduleThreeAccount['group'], string> = {
  pl_income: 'P&L — Income',
  pl_expense: 'P&L — Expenses',
  pl_tax: 'P&L — Tax',
  bs_equity_liab: 'BS — Equity & Liabilities',
  bs_assets: 'BS — Assets',
};

/**
 * Auto-suggest the best Schedule III key for a given uploaded
 * account name. Same heuristic as CMA's suggestCanonicalKey —
 * longest-hint substring match wins, minimum 4 chars to avoid
 * "of" / "to" matching everything.
 */
export function suggestScheduleThreeKey(accountName: string): ScheduleThreeSection | null {
  const hay = accountName.toLowerCase().trim();
  if (hay.length < 3) return null;
  let bestKey: ScheduleThreeSection | null = null;
  let bestScore = 0;
  for (const acc of SCHEDULE_THREE_ACCOUNTS) {
    for (const hint of acc.matchHints) {
      if (hint.length < 4) continue;
      if (hay.includes(hint) && hint.length > bestScore) {
        bestScore = hint.length;
        bestKey = acc.key;
      }
    }
  }
  return bestKey;
}

/**
 * Map a Schedule III key back to CMA's coarser canonical chart for
 * the TB → CMA hand-off. Lossy by design: Schedule III splits
 * tangible / intangible / CWIP into three rows, but CMA collapses
 * them into bs_gross_fixed_assets. Returns null when there's no
 * sensible CMA equivalent (rare — only "Money received against
 * share warrants" and similar low-volume lines).
 */
export function mapScheduleThreeToCma(key: ScheduleThreeSection): string | null {
  switch (key) {
    // P&L
    case 'pl_revenue_operations': return 'pl_revenue';
    case 'pl_other_income': return 'pl_other_income';
    case 'pl_cost_of_materials':
    case 'pl_purchases_stock':
    case 'pl_change_inventory':
      return 'pl_cogs';
    case 'pl_employee_benefits':
    case 'pl_other_expenses':
    case 'pl_exceptional_items':
      return 'pl_operating_expense';
    case 'pl_finance_costs': return 'pl_finance_cost';
    case 'pl_depreciation_amort': return 'pl_depreciation';
    case 'pl_tax_current':
    case 'pl_tax_deferred':
      return 'pl_tax';

    // BS — Equity
    case 'bs_share_capital': return 'bs_paid_up_capital';
    case 'bs_reserves_surplus': return 'bs_reserves_surplus';
    case 'bs_money_received_share_warrants':
    case 'bs_share_application_pending':
      return 'bs_paid_up_capital';

    // BS — Liabilities
    case 'bs_long_term_borrowings': return 'bs_term_loan';
    case 'bs_deferred_tax_liab':
    case 'bs_other_long_term_liab':
    case 'bs_long_term_provisions':
      return 'bs_other_non_current_liab';
    case 'bs_short_term_borrowings': return 'bs_bank_borrowing_short';
    case 'bs_trade_payables': return 'bs_creditors';
    case 'bs_other_current_liab': return 'bs_other_current_liabilities';
    case 'bs_short_term_provisions': return 'bs_other_current_liabilities';

    // BS — Assets
    case 'bs_tangible_assets':
    case 'bs_intangible_assets':
    case 'bs_capital_wip':
    case 'bs_intangible_under_dev':
      return 'bs_gross_fixed_assets';
    case 'bs_non_current_investments':
    case 'bs_deferred_tax_asset':
    case 'bs_long_term_loans_advances':
    case 'bs_other_non_current_assets':
      return 'bs_other_non_current_assets';
    case 'bs_current_investments': return 'bs_other_current_assets';
    case 'bs_inventories': return 'bs_inventory';
    case 'bs_trade_receivables': return 'bs_receivables';
    case 'bs_cash_equivalents': return 'bs_cash_bank';
    case 'bs_short_term_loans_advances':
    case 'bs_other_current_assets':
      return 'bs_other_current_assets';
  }
}
