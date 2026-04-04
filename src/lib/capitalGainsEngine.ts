import type { TaxRules, CapitalGainsAssetType } from '../types';

export interface CapitalGainsInput {
  assetType: CapitalGainsAssetType;      // 'equity' | 'realEstate' | 'other'
  salePrice: number;
  purchasePrice: number;
  holdingMonths: number;
  // Real estate only:
  acquisitionBeforeJuly2024?: boolean;   // true → indexation option available
  indexedCost?: number;                  // User-supplied CII-adjusted cost
}

export interface CapitalGainsResult {
  gainType: 'STCG' | 'LTCG';
  rawGain: number;                       // salePrice - purchasePrice
  exemptionApplied: number;              // equity LTCG ₹1.25L exemption
  taxableGain: number;
  taxRate: number | 'slab';             // 'slab' means added to normal income
  taxAmount: number | null;             // null when rate is 'slab' (UI handles it)
  indexationOption?: {                   // Only for pre-July-2024 real estate
    withIndexation: { taxableGain: number; taxAmount: number };
    withoutIndexation: { taxableGain: number; taxAmount: number };
    recommendedOption: 'withIndexation' | 'withoutIndexation';
  };
}

/**
 * Calculate capital gains tax for the given asset type, holding period, and amounts.
 *
 * CRITICAL: This engine returns only capital gains tax amounts.
 * 87A rebate is NOT applied here — it belongs in taxEngine.ts and applies
 * ONLY against slab tax on normal income, never against capital gains tax.
 */
export function calculateCapitalGains(
  input: CapitalGainsInput,
  rules: TaxRules,
): CapitalGainsResult {
  const { assetType, salePrice, purchasePrice, holdingMonths } = input;
  const rawGain = salePrice - purchasePrice;
  const assetRules = rules.capitalGains[assetType];

  // Determine STCG vs LTCG based on holding period
  const isLTCG = holdingMonths >= assetRules.ltcg.holdingMonths;
  const gainType: 'STCG' | 'LTCG' = isLTCG ? 'LTCG' : 'STCG';

  // ── Equity ──────────────────────────────────────────────────────────────
  if (assetType === 'equity') {
    if (isLTCG) {
      // LTCG: apply ₹1.25L annual exemption
      const exemption = assetRules.ltcg.exemption ?? 0;
      const taxableGain = Math.max(0, rawGain - exemption);
      const taxAmount = taxableGain * (assetRules.ltcg.rate as number);

      return {
        gainType,
        rawGain,
        exemptionApplied: Math.min(rawGain, exemption),
        taxableGain,
        taxRate: assetRules.ltcg.rate,
        taxAmount,
      };
    } else {
      // STCG: 20% flat, no exemption
      const taxRate = assetRules.stcg.rate as number;
      const taxAmount = rawGain * taxRate;

      return {
        gainType,
        rawGain,
        exemptionApplied: 0,
        taxableGain: rawGain,
        taxRate,
        taxAmount,
      };
    }
  }

  // ── Real Estate ───────────────────────────────────────────────────────────
  if (assetType === 'realEstate') {
    if (isLTCG) {
      const ltcgRate = assetRules.ltcg.rate as number;
      const hasIndexationOption =
        input.acquisitionBeforeJuly2024 === true &&
        assetRules.ltcg.indexationOptionForPreJuly2024 === true;

      if (hasIndexationOption && input.indexedCost !== undefined) {
        // Provide both branches; let user/UI pick
        const withoutIndexTaxableGain = Math.max(0, rawGain);
        const withoutIndexTaxAmount = withoutIndexTaxableGain * ltcgRate;

        const indexedGain = Math.max(0, salePrice - input.indexedCost);
        const withIndexTaxAmount = indexedGain * 0.20; // old 20%-with-indexation rate

        const recommendedOption: 'withIndexation' | 'withoutIndexation' =
          withIndexTaxAmount <= withoutIndexTaxAmount ? 'withIndexation' : 'withoutIndexation';

        const chosen =
          recommendedOption === 'withIndexation'
            ? { taxableGain: indexedGain, taxAmount: withIndexTaxAmount }
            : { taxableGain: withoutIndexTaxableGain, taxAmount: withoutIndexTaxAmount };

        return {
          gainType,
          rawGain,
          exemptionApplied: 0,
          taxableGain: chosen.taxableGain,
          taxRate: recommendedOption === 'withIndexation' ? 0.20 : ltcgRate,
          taxAmount: chosen.taxAmount,
          indexationOption: {
            withIndexation: { taxableGain: indexedGain, taxAmount: withIndexTaxAmount },
            withoutIndexation: {
              taxableGain: withoutIndexTaxableGain,
              taxAmount: withoutIndexTaxAmount,
            },
            recommendedOption,
          },
        };
      }

      // No indexation option (post-July-2024 acquisition or no indexed cost supplied)
      const taxableGain = Math.max(0, rawGain);
      const taxAmount = taxableGain * ltcgRate;

      return {
        gainType,
        rawGain,
        exemptionApplied: 0,
        taxableGain,
        taxRate: ltcgRate,
        taxAmount,
      };
    } else {
      // Real estate STCG: added to normal income (slab rate)
      return {
        gainType,
        rawGain,
        exemptionApplied: 0,
        taxableGain: rawGain,
        taxRate: 'slab',
        taxAmount: null,
      };
    }
  }

  // ── Other assets ─────────────────────────────────────────────────────────
  if (isLTCG) {
    const ltcgRate = assetRules.ltcg.rate as number;
    const taxableGain = Math.max(0, rawGain);
    const taxAmount = taxableGain * ltcgRate;

    return {
      gainType,
      rawGain,
      exemptionApplied: 0,
      taxableGain,
      taxRate: ltcgRate,
      taxAmount,
    };
  } else {
    // Other STCG: slab rate
    return {
      gainType,
      rawGain,
      exemptionApplied: 0,
      taxableGain: rawGain,
      taxRate: 'slab',
      taxAmount: null,
    };
  }
}

// REFERENCE TEST CASES:
//
// Equity LTCG, gain=₹2,00,000, holdingMonths=18:
//   isLTCG = true (>=12 months)
//   exemption = 1,25,000; taxableGain = 75,000
//   taxAmount = 75,000 × 12.5% = 9,375
//
// Equity STCG, gain=₹50,000, holdingMonths=6:
//   isLTCG = false (<12 months)
//   taxableGain = 50,000; taxAmount = 50,000 × 20% = 10,000
//
// Real estate LTCG, gain=₹20L, holdingMonths=30, acquired 2022, indexedCost=₹15L:
//   withoutIndexation: taxableGain=20L, taxAmount=20L×12.5%=2.5L
//   withIndexation: taxableGain=5L, taxAmount=5L×20%=1L → recommended
//
// Real estate STCG, holdingMonths=18:
//   taxRate='slab', taxAmount=null (added to slab income by caller)
