/**
 * Partnership Deed wizard UI model.
 *
 * Five templates are supported. Each draft owns a flat `templateId` plus
 * shared firm/partner/banking/clauses sub-objects, and template-specific
 * sub-objects that are only filled for the relevant templateId. Switching
 * the template after creation is locked at the picker step (mirrors the
 * board-resolutions wizard) so unrelated data isn't silently kept around.
 */

export type PartnershipDeedTemplateId =
  | 'partnership_deed'        // Indian Partnership Act 1932 — formation
  | 'llp_agreement'           // LLP Act 2008
  | 'reconstitution_deed'     // admit new partner
  | 'retirement_deed'         // partner exit
  | 'dissolution_deed';       // dissolution

export interface PartnerBlock {
  name?: string;
  address?: string;
  pan?: string;                  // ABCDE1234F format (validated client-side)
  age?: number;                  // must be >= 18
  capitalContribution?: number;  // INR
  profitSharePct?: number;       // 0-100; partners must sum to 100
}

export type DurationKind = 'at_will' | 'fixed';

export interface FirmCore {
  firmName?: string;
  businessNature?: string;
  principalPlace?: string;
  state?: string;                // drives stamp-duty grounding via Google Search
  commencementDate?: string;     // YYYY-MM-DD
  duration?: { kind: DurationKind; fixedUntil?: string };
  booksLocation?: string;
}

export interface BankingAuthority {
  operatingPartnerNames?: string[]; // names from partners[] selected as account-operating
  mode?: 'singly' | 'jointly';
  bankName?: string;                // optional — many deeds keep this open
}

export interface ClausesBlock {
  arbitration?: boolean;
  specialClauses?: string;          // free-form, appended verbatim by AI
}

// Reconstitution: admission of one or more new partners; revised shares apply
// to the full firm post-admission. The UI initialises revisedProfitShares
// from partners[] + incomingPartners[].
export interface ReconstitutionBlock {
  incomingPartners?: PartnerBlock[];
  effectiveDate?: string;
  revisedProfitShares?: { partnerName: string; sharePct: number }[];
}

export interface RetirementBlock {
  outgoingPartnerName?: string;     // must match a name in partners[]
  effectiveDate?: string;
  settlementAmount?: number;        // INR
  settlementMode?: string;          // "lump-sum on date X", "installments", etc.
}

export interface DissolutionBlock {
  dissolutionDate?: string;
  settlementPlan?: string;
  assetDistribution?: { partnerName: string; assetDescription: string; amount?: number }[];
  liabilityDischargePlan?: string;
}

export interface PartnershipDeedDraft {
  templateId: PartnershipDeedTemplateId;
  firm?: FirmCore;
  partners?: PartnerBlock[];
  banking?: BankingAuthority;
  clauses?: ClausesBlock;
  // template-specific (each only present for the relevant templateId)
  reconstitution?: ReconstitutionBlock;
  retirement?: RetirementBlock;
  dissolution?: DissolutionBlock;
}

export type StepId =
  | 'templatePicker'
  | 'firm'
  | 'partners'
  | 'banking'
  | 'clauses'
  | 'reconstitution'
  | 'retirement'
  | 'dissolution'
  | 'review';

export const STEP_LABELS: Record<StepId, string> = {
  templatePicker: 'Template',
  firm: 'Firm',
  partners: 'Partners',
  banking: 'Banking',
  clauses: 'Clauses',
  reconstitution: 'New Partner(s)',
  retirement: 'Retiring Partner',
  dissolution: 'Dissolution',
  review: 'Review & Generate',
};

export const STEP_DESCRIPTIONS: Record<StepId, string> = {
  templatePicker: 'Pick the deed template.',
  firm: 'Firm name, business, state, commencement, duration.',
  partners: 'Each partner\'s identity, capital and profit share.',
  banking: 'Account-operating partners and signing mode.',
  clauses: 'Arbitration toggle and any special clauses.',
  reconstitution: 'Incoming partners and revised profit shares.',
  retirement: 'Retiring partner, effective date, settlement.',
  dissolution: 'Dissolution date, asset and liability plan.',
  review: 'Generate the deed (AI) and download as PDF.',
};

export const TEMPLATE_TITLES: Record<PartnershipDeedTemplateId, string> = {
  partnership_deed: 'Partnership Deed',
  llp_agreement: 'LLP Agreement',
  reconstitution_deed: 'Reconstitution Deed',
  retirement_deed: 'Retirement Deed',
  dissolution_deed: 'Dissolution Deed',
};

export function emptyDraft(templateId: PartnershipDeedTemplateId): PartnershipDeedDraft {
  return { templateId };
}

/** Step order varies by template — only show the relevant template-specific step. */
export function getStepOrder(templateId: PartnershipDeedTemplateId): StepId[] {
  const base: StepId[] = ['templatePicker', 'firm', 'partners', 'banking', 'clauses'];
  if (templateId === 'reconstitution_deed') return [...base, 'reconstitution', 'review'];
  if (templateId === 'retirement_deed') return [...base, 'retirement', 'review'];
  if (templateId === 'dissolution_deed') return [...base, 'dissolution', 'review'];
  return [...base, 'review'];
}
