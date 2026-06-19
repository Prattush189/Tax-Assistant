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
  | 'partnership_deed'             // Indian Partnership Act 1932 — formation
  | 'llp_agreement'                // LLP Act 2008
  | 'reconstitution_deed'          // admit new partner
  | 'retirement_deed'              // partner exit
  | 'retirement_admission_deed'    // simultaneous exit + admission in one instrument
  | 'dissolution_deed'             // dissolution
  | 'rent_agreement';              // landlord–tenant rent / lease agreement

export interface PartnerBlock {
  name?: string;
  address?: string;
  pan?: string;                  // ABCDE1234F format (validated client-side)
  age?: number;                  // must be >= 18
  capitalContribution?: number;  // INR
  profitSharePct?: number;       // 0-100; partners must sum to 100
  /** UI convenience (partners #2+): mirror partner #1's address.
   *  While true the address field is read-only and tracks #1. */
  sameAddressAsFirst?: boolean;
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

// Partner remuneration (salary) and interest on capital — the
// Clause 9 inputs. Governed by Section 40(b) of the Income Tax Act,
// 1961: interest on capital is deductible only up to 12% p.a., and
// remuneration is deductible only to WORKING partners up to the
// statutory slab ceiling. Collecting these lets the generated deed
// authorise the amounts the firm actually intends to pay.
export interface RemunerationBlock {
  /** Pay interest on partners' capital balances. */
  interestOnCapital?: boolean;
  /** Annual simple-interest rate on capital, % p.a. Section 40(b)(iv)
   *  caps the deductible rate at 12% p.a.; the UI clamps the input. */
  interestRatePct?: number;
  /** Pay remuneration (salary) to the working partners. */
  partnerSalary?: boolean;
  /** How working-partner remuneration is fixed:
   *   - 'as_per_40b' : the deed authorises remuneration up to the
   *      maximum allowable under Section 40(b)(v), apportioned among
   *      the working partners in their profit-sharing ratio.
   *   - 'fixed'      : specific annual amounts per working partner
   *      (still subject to the 40(b) ceiling on assessment). */
  salaryMode?: 'as_per_40b' | 'fixed';
  /** Names (from partners[]) who are working partners eligible for
   *  remuneration. Only working partners may be paid under 40(b). */
  workingPartnerNames?: string[];
  /** Per-working-partner annual remuneration when salaryMode==='fixed'. */
  fixedRemuneration?: { partnerName: string; annualAmount: number }[];
}

// Rent / lease agreement between a landlord (lessor) and tenant
// (lessee). This is NOT a partnership instrument — it reuses the
// deeds wizard's generation + PDF pipeline but collects its own
// landlord/tenant/property fields and skips the firm/partner steps.
export interface RentAgreementBlock {
  landlordName?: string;
  landlordAddress?: string;
  landlordPan?: string;
  tenantName?: string;
  tenantAddress?: string;
  tenantPan?: string;
  propertyAddress?: string;
  state?: string;                  // drives stamp duty + jurisdiction
  purpose?: 'residential' | 'commercial';
  monthlyRent?: number;            // INR
  securityDeposit?: number;        // INR
  startDate?: string;              // YYYY-MM-DD
  durationMonths?: number;         // lease term, e.g. 11
  rentDueDay?: number;             // day of month rent falls due (1-31)
  escalationPct?: number;          // annual rent escalation %
  noticePeriodMonths?: number;     // termination notice period
  maintenanceBy?: 'tenant' | 'landlord';
  furnishing?: string;             // free text: furnished/semi/unfurnished + notes
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
  remuneration?: RemunerationBlock;   // formation deeds + LLP agreement
  rentAgreement?: RentAgreementBlock;  // rent_agreement only
}

export type StepId =
  | 'templatePicker'
  | 'firm'
  | 'partners'
  | 'banking'
  | 'remuneration'
  | 'clauses'
  | 'reconstitution'
  | 'retirement'
  | 'dissolution'
  | 'rentAgreement'
  | 'review';

export const STEP_LABELS: Record<StepId, string> = {
  templatePicker: 'Template',
  firm: 'Firm',
  partners: 'Partners',
  banking: 'Banking',
  remuneration: 'Salary & Interest',
  clauses: 'Clauses',
  reconstitution: 'New Partner(s)',
  retirement: 'Retiring Partner',
  dissolution: 'Dissolution',
  rentAgreement: 'Rent Agreement',
  review: 'Review & Generate',
};

export const STEP_DESCRIPTIONS: Record<StepId, string> = {
  templatePicker: 'Pick the deed template.',
  firm: 'Firm name, business, state, commencement, duration.',
  partners: 'Each partner\'s identity, capital and profit share.',
  banking: 'Account-operating partners and signing mode.',
  remuneration: 'Partner remuneration and interest on capital (Section 40(b)).',
  clauses: 'Arbitration toggle and any special clauses.',
  reconstitution: 'Incoming partners and revised profit shares.',
  retirement: 'Retiring partner, effective date, settlement.',
  dissolution: 'Dissolution date, asset and liability plan.',
  rentAgreement: 'Landlord, tenant, property, rent, deposit and term.',
  review: 'Generate the document (AI) and download as PDF.',
};

export const TEMPLATE_TITLES: Record<PartnershipDeedTemplateId, string> = {
  partnership_deed: 'Partnership Deed',
  llp_agreement: 'LLP Agreement',
  reconstitution_deed: 'Reconstitution Deed',
  retirement_deed: 'Retirement Deed',
  retirement_admission_deed: 'Retirement cum Admission Deed',
  dissolution_deed: 'Dissolution Deed',
  rent_agreement: 'Rent Agreement',
};

export function emptyDraft(templateId: PartnershipDeedTemplateId): PartnershipDeedDraft {
  return { templateId };
}

/** Step order varies by template — only show the relevant template-specific step.
 *  Retirement-cum-admission needs BOTH the retirement AND the reconstitution
 *  steps because the same instrument carries an exit and an entry. We show
 *  retirement first (the outgoing partner), then reconstitution (the
 *  incoming partner + revised shares post-both-changes).
 *
 *  Rent agreement is a separate, non-partnership instrument: it skips the
 *  firm / partners / banking / remuneration / clauses steps entirely and
 *  collects only its own landlord/tenant/property block.
 *
 *  The Salary & Interest (remuneration) step appears only on the formation
 *  instruments (partnership deed + LLP agreement). Amendment deeds inherit
 *  the original firm's Clause 9 terms, so the step is omitted there. */
export function getStepOrder(templateId: PartnershipDeedTemplateId): StepId[] {
  if (templateId === 'rent_agreement') {
    return ['templatePicker', 'rentAgreement', 'review'];
  }
  const order: StepId[] = ['templatePicker', 'firm', 'partners', 'banking'];
  if (templateId === 'partnership_deed' || templateId === 'llp_agreement') {
    order.push('remuneration');
  }
  order.push('clauses');
  if (templateId === 'reconstitution_deed') order.push('reconstitution');
  else if (templateId === 'retirement_deed') order.push('retirement');
  else if (templateId === 'retirement_admission_deed') { order.push('retirement', 'reconstitution'); }
  else if (templateId === 'dissolution_deed') order.push('dissolution');
  order.push('review');
  return order;
}
