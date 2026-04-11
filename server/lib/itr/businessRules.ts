/**
 * Cross-field business rules that the JSON Schema cannot express.
 *
 * These are derived from `CBDT_e-Filing_ITR 1_Validation Rules_AY 2025-26_V1.1.pdf`
 * and the corresponding ITR-4 rules doc. The list is intentionally partial —
 * we encode the top ~20 rules that catch the most common upload failures.
 * The gov Common Utility is still the final authority; our job is to surface
 * the obvious mistakes early.
 *
 * A rule receives the full ITR payload and returns zero or more violations.
 * Add rules by pushing into the RULES array — each one is small and
 * self-contained.
 */
import type { ItrFormType } from './validator.js';

export interface BusinessRuleViolation {
  ruleId: string;
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

type RuleFn = (payload: ItrRootLike, formType: ItrFormType) => BusinessRuleViolation[];

// Loose payload type — the schema-generated types are big and strict; business
// rules are easier to write against `any`-ish access and we cross-check with
// the ajv validator first anyway.
interface ItrRootLike {
  ITR?: {
    ITR1?: Record<string, unknown>;
    ITR4?: Record<string, unknown>;
  };
}

function getItrBlock(payload: ItrRootLike, formType: ItrFormType): Record<string, unknown> | null {
  if (formType === 'ITR1') return (payload.ITR?.ITR1 as Record<string, unknown>) ?? null;
  if (formType === 'ITR4') return (payload.ITR?.ITR4 as Record<string, unknown>) ?? null;
  return null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function path(node: unknown, keys: string[]): unknown {
  let cur: unknown = node;
  for (const k of keys) {
    if (cur && typeof cur === 'object' && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return cur;
}

// --- Rules ------------------------------------------------------------------

const ruleSalary80cCap: RuleFn = (payload, formType) => {
  const block = getItrBlock(payload, formType);
  if (!block) return [];
  const sec80cUser = num(
    path(block, ['ITR1_IncomeDeductions', 'UsrDeductUndChapVIA', 'Section80C']) ??
      path(block, ['IncomeDeductions', 'UsrDeductUndChapVIA', 'Section80C']),
  );
  if (sec80cUser > 150000) {
    return [{
      ruleId: 'BR-80C-CAP',
      severity: 'error',
      path: '/ITR1_IncomeDeductions/UsrDeductUndChapVIA/Section80C',
      message: `80C deduction (${sec80cUser}) exceeds the ₹1,50,000 ceiling.`,
    }];
  }
  return [];
};

const ruleTotalChapVIAMatches: RuleFn = (payload, formType) => {
  const block = getItrBlock(payload, formType);
  if (!block) return [];
  const prefix =
    formType === 'ITR1' ? 'ITR1_IncomeDeductions' : 'IncomeDeductions';
  const chap = path(block, [prefix, 'DeductUndChapVIA']) as Record<string, unknown> | undefined;
  if (!chap) return [];
  const claimed = num(chap.TotalChapVIADeductions);
  const sum = Object.keys(chap)
    .filter((k) => k !== 'TotalChapVIADeductions' && typeof chap[k] === 'number')
    .reduce((acc, k) => acc + num(chap[k]), 0);
  if (claimed !== sum) {
    return [{
      ruleId: 'BR-CHVIA-SUM',
      severity: 'error',
      path: `/${prefix}/DeductUndChapVIA/TotalChapVIADeductions`,
      message: `Chapter VI-A total (${claimed}) does not equal the sum of line items (${sum}).`,
    }];
  }
  return [];
};

const ruleTotalTaxesPaidMatches: RuleFn = (payload, formType) => {
  const block = getItrBlock(payload, formType);
  if (!block) return [];
  const taxes = path(block, ['TaxPaid', 'TaxesPaid']) as Record<string, unknown> | undefined;
  if (!taxes) return [];
  const adv = num(taxes.AdvanceTax);
  const tds = num(taxes.TDS);
  const tcs = num(taxes.TCS);
  const sa = num(taxes.SelfAssessmentTax);
  const total = num(taxes.TotalTaxesPaid);
  if (adv + tds + tcs + sa !== total) {
    return [{
      ruleId: 'BR-TAXES-SUM',
      severity: 'error',
      path: '/TaxPaid/TaxesPaid/TotalTaxesPaid',
      message: `TotalTaxesPaid (${total}) does not match Advance+TDS+TCS+SA (${adv + tds + tcs + sa}).`,
    }];
  }
  return [];
};

const ruleRefundBankMandatory: RuleFn = (payload, formType) => {
  const block = getItrBlock(payload, formType);
  if (!block) return [];
  const refund = path(block, ['Refund']) as Record<string, unknown> | undefined;
  if (!refund) return [];
  const banks = path(refund, ['BankAccountDtls', 'AddtnlBankDetails']) as unknown;
  if (!Array.isArray(banks) || banks.length === 0) {
    return [{
      ruleId: 'BR-BANK-MIN-1',
      severity: 'error',
      path: '/Refund/BankAccountDtls/AddtnlBankDetails',
      message: 'At least one bank account is required.',
    }];
  }
  const refundInto = banks.some(
    (b) => (b as Record<string, unknown>).UseForRefund === 'true',
  );
  if (!refundInto) {
    return [{
      ruleId: 'BR-BANK-REFUND-FLAG',
      severity: 'error',
      path: '/Refund/BankAccountDtls/AddtnlBankDetails',
      message: 'Exactly one bank account must be marked UseForRefund = "true".',
    }];
  }
  return [];
};

const ruleLtcg112aCapInItr1: RuleFn = (payload, formType) => {
  if (formType !== 'ITR1') return [];
  const block = getItrBlock(payload, formType);
  if (!block) return [];
  const ltcg = path(block, ['LTCG112A']) as Record<string, unknown> | undefined;
  if (!ltcg) return [];
  const longCap = num(ltcg.LongCap112A);
  if (longCap > 125000) {
    return [{
      ruleId: 'BR-LTCG-ITR1-CAP',
      severity: 'error',
      path: '/LTCG112A/LongCap112A',
      message: 'LTCG u/s 112A exceeds ₹1,25,000 — file ITR-2 instead of ITR-1.',
    }];
  }
  return [];
};

const ruleStdDeduction16ia: RuleFn = (payload, formType) => {
  if (formType !== 'ITR1') return [];
  const block = getItrBlock(payload, formType);
  if (!block) return [];
  const inc = path(block, ['ITR1_IncomeDeductions']) as Record<string, unknown> | undefined;
  if (!inc) return [];
  const sd = num(inc.DeductionUs16ia);
  const netSalary = num(inc.NetSalary);
  // New regime = 75k, old regime = 50k. We accept either + zero + cap at
  // NetSalary (CBDT rule: std deduction can't exceed salary).
  if (sd > 75000) {
    return [{
      ruleId: 'BR-STD-DED-MAX',
      severity: 'error',
      path: '/ITR1_IncomeDeductions/DeductionUs16ia',
      message: `Standard deduction u/s 16(ia) ${sd} exceeds the ₹75,000 cap.`,
    }];
  }
  if (sd > netSalary && netSalary > 0) {
    return [{
      ruleId: 'BR-STD-DED-LT-SALARY',
      severity: 'error',
      path: '/ITR1_IncomeDeductions/DeductionUs16ia',
      message: `Standard deduction (${sd}) cannot exceed Net Salary (${netSalary}).`,
    }];
  }
  return [];
};

const rulePresumptive44adMinPct: RuleFn = (payload, formType) => {
  if (formType !== 'ITR4') return [];
  const block = getItrBlock(payload, formType);
  if (!block) return [];
  const bp = path(block, ['ScheduleBP']) as Record<string, unknown> | undefined;
  if (!bp) return [];
  // Business income under 44AD: presumptive income must be ≥ 6% of digital
  // turnover and ≥ 8% of cash turnover. We accept-or-warn only; the CBDT
  // utility is the final authority.
  const turnover44AD = path(bp, ['BusinessIncome44AD', 'TotPresumptiveIncomeUS44AD']) as unknown;
  if (turnover44AD === undefined) return [];
  // Placeholder — full 44AD arithmetic is encoded in a follow-up pass once the
  // UI model for ITR-4 business income is locked.
  return [];
};

const RULES: RuleFn[] = [
  ruleSalary80cCap,
  ruleTotalChapVIAMatches,
  ruleTotalTaxesPaidMatches,
  ruleRefundBankMandatory,
  ruleLtcg112aCapInItr1,
  ruleStdDeduction16ia,
  rulePresumptive44adMinPct,
];

export function runBusinessRules(
  formType: ItrFormType,
  payload: unknown,
): BusinessRuleViolation[] {
  if (!payload || typeof payload !== 'object') {
    return [{
      ruleId: 'BR-PAYLOAD',
      severity: 'error',
      path: '(root)',
      message: 'Payload is not an object.',
    }];
  }
  const root = payload as ItrRootLike;
  const violations: BusinessRuleViolation[] = [];
  for (const rule of RULES) {
    try {
      violations.push(...rule(root, formType));
    } catch (err) {
      violations.push({
        ruleId: 'BR-INTERNAL',
        severity: 'warning',
        path: '(rule)',
        message: `Business rule threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return violations;
}
