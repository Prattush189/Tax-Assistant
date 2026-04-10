export interface TdsSection {
  id: string;
  section: string;
  description: string;
  rateWithPAN: number;      // e.g., 0.10 for 10%
  rateWithoutPAN: number;   // typically 20%
  threshold: number;        // minimum amount for TDS
}

export const TDS_SECTIONS: TdsSection[] = [
  { id: 'salary', section: '192', description: 'Salary', rateWithPAN: 0, rateWithoutPAN: 0.20, threshold: 250000 },
  { id: 'interest', section: '194A', description: 'Interest (other than securities)', rateWithPAN: 0.10, rateWithoutPAN: 0.20, threshold: 40000 },
  { id: 'contractor', section: '194C', description: 'Contractor payment', rateWithPAN: 0.01, rateWithoutPAN: 0.20, threshold: 30000 },
  { id: 'contractor_co', section: '194C', description: 'Contractor (company/firm)', rateWithPAN: 0.02, rateWithoutPAN: 0.20, threshold: 30000 },
  { id: 'commission', section: '194H', description: 'Commission / Brokerage', rateWithPAN: 0.05, rateWithoutPAN: 0.20, threshold: 15000 },
  { id: 'rent_land', section: '194I(a)', description: 'Rent - Plant/Machinery/Equipment', rateWithPAN: 0.02, rateWithoutPAN: 0.20, threshold: 240000 },
  { id: 'rent_building', section: '194I(b)', description: 'Rent - Land/Building/Furniture', rateWithPAN: 0.10, rateWithoutPAN: 0.20, threshold: 240000 },
  { id: 'professional', section: '194J', description: 'Professional / Technical fees', rateWithPAN: 0.10, rateWithoutPAN: 0.20, threshold: 30000 },
  { id: 'professional_2', section: '194J', description: 'Professional fees (FTS to certain payees)', rateWithPAN: 0.02, rateWithoutPAN: 0.20, threshold: 30000 },
  { id: 'purchase', section: '194Q', description: 'Purchase of goods', rateWithPAN: 0.001, rateWithoutPAN: 0.05, threshold: 5000000 },
  { id: 'ecommerce', section: '194-O', description: 'E-commerce operator', rateWithPAN: 0.01, rateWithoutPAN: 0.05, threshold: 500000 },
];

export interface TdsInput {
  sectionId: string;
  amount: number;
  hasPAN: boolean;
}

export interface TdsResult {
  section: TdsSection;
  amount: number;
  tdsRate: number;
  tdsAmount: number;
  netPayment: number;
  belowThreshold: boolean;
}

/**
 * Calculate TDS for a given payment type, amount, and PAN availability.
 *
 * If the amount is below the section threshold, no TDS is deducted.
 * Rate depends on whether the deductee has a valid PAN.
 *
 * Throws if sectionId is not found in TDS_SECTIONS.
 */
export function calculateTDS(input: TdsInput): TdsResult {
  const { sectionId, amount, hasPAN } = input;

  const section = TDS_SECTIONS.find((s) => s.id === sectionId);
  if (!section) {
    throw new Error(`Unknown TDS section: ${sectionId}`);
  }

  // Below threshold — no TDS
  if (amount < section.threshold) {
    return {
      section,
      amount,
      tdsRate: 0,
      tdsAmount: 0,
      netPayment: amount,
      belowThreshold: true,
    };
  }

  const tdsRate = hasPAN ? section.rateWithPAN : section.rateWithoutPAN;
  const tdsAmount = amount * tdsRate;
  const netPayment = amount - tdsAmount;

  return {
    section,
    amount,
    tdsRate,
    tdsAmount,
    netPayment,
    belowThreshold: false,
  };
}

// REFERENCE TEST CASES:
//
// ₹50,000 professional fees (194J) with PAN:
//   tdsRate=0.10, tdsAmount=5,000, netPayment=45,000, belowThreshold=false
//
// ₹20,000 professional fees (194J) with PAN:
//   tdsRate=0, tdsAmount=0, netPayment=20,000, belowThreshold=true (below 30,000 threshold)
//
// ₹50,000 professional fees (194J) without PAN:
//   tdsRate=0.20, tdsAmount=10,000, netPayment=40,000, belowThreshold=false
//
// ₹100,000 interest (194A) with PAN:
//   tdsRate=0.10, tdsAmount=10,000, netPayment=90,000, belowThreshold=false
//
// ₹30,000 interest (194A) with PAN:
//   tdsRate=0, tdsAmount=0, netPayment=30,000, belowThreshold=true (below 40,000 threshold)
