/**
 * Deterministic defaults for the Phase 2 CMA fields (Project Report
 * content, BEP variable-cost split, Form IV holding periods).
 *
 * The wizard user typically can't fill all of these from memory, and
 * lighting them up only when the user opens a "advanced" panel hides
 * them from the 80% case. So we compute reasonable defaults from
 * what we already have on the draft (firm name, business nature,
 * projection numbers, term-loan principals) and let the user edit on
 * ReviewStep when they want to. The Excel exporter falls back to
 * these defaults internally if the user didn't override.
 *
 * Future: an AI-default mode can call Gemini to write a more
 * specific brief profile / cost-of-project breakdown. For now the
 * defaults are template-driven (deterministic, no API cost, easy to
 * audit). The user always sees them as editable.
 */

import type { CmaDraft, ProjectReport, BepAssumption } from './uiModel';

/** Round an Indian-currency amount to the nearest whole rupee. */
function round0(n: number): number {
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * Auto-generate a Project Report block from whatever is on the draft.
 * Doesn't overwrite values the user has already set — merge rule is
 * "user value wins; default fills in the gaps". The exporter consumes
 * the merged value.
 */
export function buildProjectReportDefaults(draft: CmaDraft): ProjectReport {
  const firm = draft.firm ?? {};
  const firmName = firm.firmName || 'the applicant';
  const businessNature = firm.businessNature || 'business operations';

  // Cost of project — sum of proposed term-loan principals (used as
  // proxy for capex outlay) + any margin contribution. Banker's
  // "cost of project" is the asset side; "means of finance" is how
  // it's funded.
  const proposedLoans = (draft.termLoans ?? []).filter(tl => tl.status === 'proposed');
  const proposedPrincipalTotal = proposedLoans.reduce((s, tl) => s + (tl.principal ?? 0), 0);
  const margin = 0.25; // 25% own contribution is the standard banker assumption
  // ownContribution = bankLoan × (margin / (1 − margin))
  // So that bankLoan / (bankLoan + ownContribution) = 1 − margin.
  const ownContribution = proposedPrincipalTotal > 0
    ? round0(proposedPrincipalTotal * (margin / (1 - margin)))
    : 0;
  const projectCost = proposedPrincipalTotal + ownContribution;

  const costOfProject: Array<{ item: string; amount: number }> = projectCost > 0
    ? [{ item: 'Machinery / Plant & Equipment (incl. installation)', amount: projectCost }]
    : [];

  const meansOfFinance: Array<{ item: string; amount: number }> = [];
  if (proposedPrincipalTotal > 0) {
    meansOfFinance.push({ item: 'Bank Loan (Term Loan — Proposed)', amount: proposedPrincipalTotal });
  }
  if (ownContribution > 0) {
    meansOfFinance.push({ item: 'Promoter Contribution / Own Funds', amount: ownContribution });
  }

  // Multi-paragraph brief profile generated from the firm metadata.
  // Deliberately generic — the CA on ReviewStep will rewrite this
  // with specifics about the promoter, years in business, etc.
  const briefProfile = [
    `${firmName} is engaged in the business of ${businessNature}.`,
    firm.state ? `The unit is located in ${firm.state}, India.` : '',
    'The promoter has the requisite experience and infrastructure to carry out the proposed business activities.',
    'The unit has obtained the necessary statutory approvals and licences applicable to its operations.',
  ].filter(Boolean).join('\n');

  // ROI notes — pulled from term-loan inputs when available.
  const tlRates = proposedLoans.map(tl => tl.interestRatePct).filter((x): x is number => typeof x === 'number');
  const rateOfInterestNotes = tlRates.length > 0
    ? `Term Loan(s) assumed at ${tlRates[0].toFixed(2)}% p.a.${tlRates.length > 1 ? ` (range: ${Math.min(...tlRates).toFixed(2)}–${Math.max(...tlRates).toFixed(2)}%).` : '.'}`
    : 'Rates of interest as per applicable bank pricing on the date of sanction.';

  return {
    creditRequest: firm.applicationContext,
    margin,
    costOfProject,
    meansOfFinance,
    briefProfile,
    machineryDetails: 'As per detailed machinery quotation attached separately.',
    premises: 'The premises are suitable for installation of the proposed machinery and smooth operations.',
    powerConnection: 'Adequate power connection load is in place to support the proposed operations.',
    rateOfInterestNotes,
  };
}

/**
 * Default variable-fraction map. Tuned to typical manufacturing /
 * trading P&L economics:
 *   - COGS: 100% variable (scales with sales)
 *   - SG&A: 20% variable (mostly fixed — admin salaries, rent — with
 *     some sales-linked component like commissions and freight)
 *   - Depreciation: 0% (fully fixed)
 *   - Finance cost: 0% (fully fixed within a budget period)
 *   - Tax: not applicable to BEP (computed below the line)
 *   - Other income: not applicable
 * Services or fee businesses run a different mix (lower COGS, higher
 * variable SG&A); ReviewStep lets the CA override per line.
 */
export function buildBepDefaults(): BepAssumption {
  return {
    variableFractionByKey: {
      pl_cogs: 1.0,
      pl_operating_expense: 0.2,
      pl_depreciation: 0.0,
      pl_finance_cost: 0.0,
    },
  };
}

/**
 * Merge user-provided values over deterministic defaults so the
 * exporter / preview always works with a fully-populated block. The
 * shape mirrors a deep merge but only one level deep (sufficient for
 * the Phase 2 fields) so we don't take a full lodash dependency.
 */
export function resolveProjectReport(draft: CmaDraft): ProjectReport {
  const defaults = buildProjectReportDefaults(draft);
  const userValues = draft.projectReport ?? {};
  return {
    creditRequest: userValues.creditRequest ?? defaults.creditRequest,
    margin: userValues.margin ?? defaults.margin,
    costOfProject: userValues.costOfProject?.length ? userValues.costOfProject : defaults.costOfProject,
    meansOfFinance: userValues.meansOfFinance?.length ? userValues.meansOfFinance : defaults.meansOfFinance,
    briefProfile: userValues.briefProfile ?? defaults.briefProfile,
    machineryDetails: userValues.machineryDetails ?? defaults.machineryDetails,
    premises: userValues.premises ?? defaults.premises,
    powerConnection: userValues.powerConnection ?? defaults.powerConnection,
    rateOfInterestNotes: userValues.rateOfInterestNotes ?? defaults.rateOfInterestNotes,
  };
}

export function resolveBep(draft: CmaDraft): BepAssumption {
  const defaults = buildBepDefaults();
  const userValues = draft.bep ?? {};
  return {
    variableFractionByKey: {
      ...(defaults.variableFractionByKey ?? {}),
      ...(userValues.variableFractionByKey ?? {}),
    },
  };
}

/**
 * Resolve banker holding-period assumptions for Form IV. Falls back
 * to the existing days-based working-capital fields when explicit
 * months haven't been set (days / 30, rounded to 1 decimal). Default
 * fallbacks below mirror the conservative banker assumptions used
 * when a user provides neither — 2 months of stock, 1.5 months of
 * receivables, 1 month of creditors — so the sheet always produces
 * a sensible result without forcing the user through more inputs.
 */
export interface ResolvedHoldingPeriods {
  rawMaterialMonths: number;
  workInProcessMonths: number;
  finishedGoodsMonths: number;
  receivablesMonths: number;
  payablesMonths: number;
}

export function resolveHoldingPeriods(draft: CmaDraft): ResolvedHoldingPeriods {
  const wc = draft.workingCapital;
  const hp = wc?.holdingPeriods ?? {};
  const fromDays = (d: number | undefined): number | undefined =>
    typeof d === 'number' && Number.isFinite(d) ? Math.round((d / 30) * 10) / 10 : undefined;

  return {
    rawMaterialMonths: hp.rawMaterialMonths ?? fromDays(wc?.inventoryDays) ?? 2.0,
    workInProcessMonths: hp.workInProcessMonths ?? 0.5,
    finishedGoodsMonths: hp.finishedGoodsMonths ?? fromDays(wc?.inventoryDays) ?? 1.5,
    receivablesMonths: hp.receivablesMonths ?? fromDays(wc?.debtorDays) ?? 1.5,
    payablesMonths: hp.payablesMonths ?? fromDays(wc?.creditorDays) ?? 1.0,
  };
}
