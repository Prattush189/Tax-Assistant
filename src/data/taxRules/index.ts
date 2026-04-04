import type { TaxRules } from '../../types';
import { FY_2025_26 } from './fy2025-26';
import { FY_2024_25 } from './fy2024-25';

export { FY_2025_26 } from './fy2025-26';
export { FY_2024_25 } from './fy2024-25';

export const TAX_RULES_BY_FY: Record<string, TaxRules> = {
  '2025-26': FY_2025_26,
  '2024-25': FY_2024_25,
};

export const SUPPORTED_FY = ['2025-26', '2024-25'] as const;
export type SupportedFY = typeof SUPPORTED_FY[number];

export function getTaxRules(fy: string): TaxRules {
  const rules = TAX_RULES_BY_FY[fy];
  if (!rules) {
    throw new Error(`Tax rules not found for FY ${fy}. Supported FYs: ${SUPPORTED_FY.join(', ')}`);
  }
  return rules;
}
