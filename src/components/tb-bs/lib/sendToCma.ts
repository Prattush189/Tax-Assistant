/**
 * Hand-off from TB → BS to CMA. Maps the Schedule III aggregate
 * onto CMA's coarser canonical chart, packages it as a single-year
 * "historical" block, and creates a new CMA draft pre-filled.
 *
 * Important asymmetry: TB → BS produces ONE year (the user's just-
 * filed period). CMA expects TWO historical years to project from.
 * For v1 we hand off only the current year and label both columns
 * the same; the user can re-upload an earlier year via CMA's upload
 * step if they want a real two-year baseline. Documented in the
 * confirmation toast so the user isn't surprised.
 */

import { createCmaDraft } from '../../../services/api';
import type { TbBsDraft } from './uiModel';
import type { ScheduleThreeReport } from './scheduleThreeBuilder';
import { mapScheduleThreeToCma, type ScheduleThreeSection } from './scheduleThreeAccounts';

export interface SendToCmaResult {
  cmaDraftId: string;
}

export async function sendToCma(
  draft: TbBsDraft,
  report: ScheduleThreeReport,
): Promise<SendToCmaResult> {
  // Roll up Schedule III aggregate values into CMA's coarser chart.
  // Multiple Schedule III keys can map to the same CMA key (e.g.
  // tangible + intangible + CWIP → bs_gross_fixed_assets); we sum.
  const cmaSeries: Record<string, [number, number]> = {};
  for (const [keyRaw, val] of Object.entries(report.aggregate)) {
    if (!val) continue;
    const key = keyRaw as ScheduleThreeSection;
    const cmaKey = mapScheduleThreeToCma(key);
    if (!cmaKey) continue;
    if (!cmaSeries[cmaKey]) cmaSeries[cmaKey] = [0, 0];
    cmaSeries[cmaKey][0] += val.current;
    cmaSeries[cmaKey][1] += val.previous;
  }

  // Build the CMA "historical" upload as a synthetic rows table so
  // CMA's existing mapping step can consume it. Each row is
  // [canonical_label, current, previous]. CMA's auto-suggest will
  // see the labels and snap each row to the right canonical key.
  const labelsByCmaKey: Record<string, string> = {
    pl_revenue: 'Revenue from operations',
    pl_other_income: 'Other income',
    pl_cogs: 'Cost of goods sold / Direct expenses',
    pl_operating_expense: 'Operating expenses',
    pl_depreciation: 'Depreciation & amortization',
    pl_finance_cost: 'Finance costs',
    pl_tax: 'Tax expense',
    bs_inventory: 'Inventory',
    bs_receivables: 'Trade receivables',
    bs_cash_bank: 'Cash & bank',
    bs_other_current_assets: 'Other current assets',
    bs_gross_fixed_assets: 'Gross fixed assets',
    bs_accumulated_depreciation: 'Accumulated depreciation',
    bs_other_non_current_assets: 'Other non-current assets',
    bs_creditors: 'Trade payables',
    bs_bank_borrowing_short: 'Short-term bank borrowings',
    bs_statutory_dues: 'Statutory dues',
    bs_other_current_liabilities: 'Other current liabilities',
    bs_term_loan: 'Term loans (long-term)',
    bs_other_non_current_liab: 'Other non-current liabilities',
    bs_paid_up_capital: 'Paid-up capital',
    bs_reserves_surplus: 'Reserves & surplus',
  };

  // First row = header (CMA's mapping step treats row 0 specially).
  const header = ['Particulars', report.previousLabel || 'Previous year', report.currentLabel || 'Current year'];
  const rows: string[][] = [header];
  const cmaMapping: Array<{ sourceRowIndex: number; canonicalKey: string }> = [];

  let i = 1;
  for (const [cmaKey, [cur, prev]] of Object.entries(cmaSeries)) {
    const label = labelsByCmaKey[cmaKey] ?? cmaKey;
    rows.push([label, String(Math.round(prev)), String(Math.round(cur))]);
    cmaMapping.push({ sourceRowIndex: i, canonicalKey: cmaKey });
    i++;
  }

  // Construct the CMA draft payload. Columns: previous = col 1,
  // current = col 2. The mapping is pre-populated so the user can
  // skip CMA's mapping step entirely (and we'll deep-link them past
  // it). Two year labels make CMA happy even though the previous
  // year is technically derived from the TB → BS previous-year TB
  // (or zeros when none was uploaded).
  const cmaPayload = {
    name: draft.name + ' (from TB)',
    historical: {
      filename: 'Imported from TB → BS',
      sheetName: 'Imported',
      rows,
      yearLabels: [report.previousLabel || 'Previous year', report.currentLabel || 'Current year'],
      yearColumnA: 1,
      yearColumnB: 2,
    },
    mapping: cmaMapping,
    firm: {
      firmName: draft.firm?.firmName,
      gstin: draft.firm?.gstin,
    },
  };

  const cmaDraft = await createCmaDraft({
    name: cmaPayload.name,
    ui_payload: cmaPayload as never, // CmaDraft shape — synthesised, accepted as-is
  });
  return { cmaDraftId: cmaDraft.id };
}
