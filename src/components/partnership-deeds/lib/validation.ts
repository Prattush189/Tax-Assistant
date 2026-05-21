import { PartnershipDeedDraft, PartnerBlock } from './uiModel';

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function isValidPan(pan: string | undefined): boolean {
  if (!pan) return false;
  return PAN_REGEX.test(pan.toUpperCase());
}

/** Sum profit-share percentages across all partners. */
export function sumProfitShares(partners: PartnerBlock[] | undefined): number {
  if (!partners) return 0;
  return partners.reduce((acc, p) => acc + (p.profitSharePct ?? 0), 0);
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Comprehensive pre-generation check. Production-grade — failing items
 * here block the AI call so we never bill quota for an incomplete deed.
 */
export function validateDraft(draft: PartnershipDeedDraft): ValidationResult {
  const errors: string[] = [];

  // Firm core
  const firm = draft.firm ?? {};
  if (!firm.firmName?.trim()) errors.push('Firm name is required.');
  if (!firm.businessNature?.trim()) errors.push('Nature of business is required.');
  if (!firm.principalPlace?.trim()) errors.push('Principal place of business is required.');
  if (!firm.state?.trim()) errors.push('State is required (drives stamp duty lookup).');
  if (!firm.commencementDate) errors.push('Commencement date is required.');

  // Partners — required for every template; at least 2 partners for
  // formation / LLP / reconstitution / dissolution / retirement-cum-admission.
  // Retirement-cum-admission needs at least 2 existing partners so the
  // outgoing one can be selected and at least one continuing partner remains
  // before the incoming partner joins.
  const partners = draft.partners ?? [];
  const minPartners = 2;
  if (partners.length < minPartners) {
    errors.push(`At least ${minPartners} partners are required.`);
  }
  partners.forEach((p, idx) => {
    const tag = p.name?.trim() ? `Partner "${p.name}"` : `Partner #${idx + 1}`;
    if (!p.name?.trim()) errors.push(`${tag}: name is required.`);
    if (!p.address?.trim()) errors.push(`${tag}: address is required.`);
    if (!p.pan?.trim()) errors.push(`${tag}: PAN is required.`);
    else if (!isValidPan(p.pan)) errors.push(`${tag}: PAN format is invalid (expected ABCDE1234F).`);
    if (typeof p.age !== 'number' || Number.isNaN(p.age)) errors.push(`${tag}: age is required.`);
    else if (p.age < 18) errors.push(`${tag}: must be at least 18 years old.`);
    if (typeof p.capitalContribution !== 'number' || p.capitalContribution < 0) {
      errors.push(`${tag}: capital contribution is required.`);
    }
    if (typeof p.profitSharePct !== 'number' || p.profitSharePct < 0) {
      errors.push(`${tag}: profit share % is required.`);
    }
  });

  // Profit shares must sum to 100 (with a small tolerance for fractional shares).
  if (partners.length > 0) {
    const total = sumProfitShares(partners);
    if (Math.abs(total - 100) > 0.01) {
      errors.push(`Profit shares must sum to 100% (currently ${total.toFixed(2)}%).`);
    }
  }

  // Banking
  const banking = draft.banking ?? {};
  if (!banking.operatingPartnerNames || banking.operatingPartnerNames.length === 0) {
    errors.push('At least one account-operating partner must be selected.');
  }
  if (!banking.mode) errors.push('Banking signing mode is required.');

  // Template-specific.
  // Retirement-cum-admission carries BOTH a retirement block (outgoing
  // partner + settlement) AND a reconstitution block (incoming partner +
  // revised shares), so both passes fire for it.
  const needsReconstitution =
    draft.templateId === 'reconstitution_deed' ||
    draft.templateId === 'retirement_admission_deed';
  const needsRetirement =
    draft.templateId === 'retirement_deed' ||
    draft.templateId === 'retirement_admission_deed';

  if (needsReconstitution) {
    const r = draft.reconstitution ?? {};
    if (!r.incomingPartners || r.incomingPartners.length === 0) {
      errors.push('At least one incoming partner is required.');
    }
    if (!r.effectiveDate) {
      errors.push(
        draft.templateId === 'retirement_admission_deed'
          ? 'Effective date of admission is required.'
          : 'Effective date of reconstitution is required.',
      );
    }
    (r.incomingPartners ?? []).forEach((p, idx) => {
      const tag = p.name?.trim() ? `Incoming partner "${p.name}"` : `Incoming partner #${idx + 1}`;
      if (!p.name?.trim()) errors.push(`${tag}: name is required.`);
      if (!p.pan?.trim()) errors.push(`${tag}: PAN is required.`);
      else if (!isValidPan(p.pan)) errors.push(`${tag}: PAN format is invalid.`);
    });
    // Revised shares must sum to 100 if provided.
    if (r.revisedProfitShares && r.revisedProfitShares.length > 0) {
      const total = r.revisedProfitShares.reduce((acc, s) => acc + (s.sharePct ?? 0), 0);
      if (Math.abs(total - 100) > 0.01) {
        errors.push(`Revised profit shares must sum to 100% (currently ${total.toFixed(2)}%).`);
      }
    }
  }

  if (needsRetirement) {
    const r = draft.retirement ?? {};
    if (!r.outgoingPartnerName?.trim()) errors.push('Retiring partner must be selected.');
    if (!r.effectiveDate) errors.push('Effective date of retirement is required.');
    if (typeof r.settlementAmount !== 'number' || r.settlementAmount < 0) {
      errors.push('Settlement amount is required.');
    }
    if (!r.settlementMode?.trim()) errors.push('Settlement mode is required.');
    // Outgoing partner must exist in partners[].
    if (r.outgoingPartnerName && !partners.some((p) => p.name === r.outgoingPartnerName)) {
      errors.push('Retiring partner name must match one of the listed partners.');
    }
  }

  if (draft.templateId === 'dissolution_deed') {
    const d = draft.dissolution ?? {};
    if (!d.dissolutionDate) errors.push('Dissolution date is required.');
    if (!d.settlementPlan?.trim()) errors.push('Settlement plan is required.');
    if (!d.liabilityDischargePlan?.trim()) errors.push('Liability discharge plan is required.');
  }

  return { ok: errors.length === 0, errors };
}
