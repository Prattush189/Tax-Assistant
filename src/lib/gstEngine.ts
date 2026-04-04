import type { GstTransactionType } from '../types';

export interface GSTInput {
  amount: number;
  rate: number;               // e.g. 18 for 18%
  transactionType: GstTransactionType;  // 'intraState' | 'interState'
  amountIncludesGST: boolean; // true = inclusive (breakdown from total); false = exclusive (GST on top)
}

export interface GSTResult {
  taxableAmount: number;
  gstAmount: number;
  cgst?: number;              // intraState only
  sgst?: number;              // intraState only
  igst?: number;              // interState only
  totalAmount: number;
  effectiveRate: number;
}

// Valid GST rates as of September 2025 (12% and 28% slabs eliminated on 22 Sep 2025)
const VALID_GST_RATES = [0, 0.25, 3, 5, 18, 40] as const;

/**
 * Calculate GST breakdown for intra-state (CGST+SGST) or inter-state (IGST) transactions.
 * Supports both inclusive (amount includes GST) and exclusive (GST added on top) modes.
 *
 * Throws if rate is not in the current valid rate list.
 * NOTE: 12% and 28% rates were eliminated on September 22, 2025 — do not use them.
 */
export function calculateGST(input: GSTInput): GSTResult {
  const { amount, rate, transactionType, amountIncludesGST } = input;

  // Validate rate
  if (!(VALID_GST_RATES as readonly number[]).includes(rate)) {
    throw new Error(
      'Invalid GST rate. Use current rates: 0%, 5%, 18%, 40% (standard) or 3%, 0.25% (special)',
    );
  }

  // Calculate taxable amount and GST amount
  let taxableAmount: number;
  let gstAmount: number;

  if (amountIncludesGST) {
    // Inclusive: extract tax from total
    taxableAmount = amount / (1 + rate / 100);
    gstAmount = amount - taxableAmount;
  } else {
    // Exclusive: add tax on top
    taxableAmount = amount;
    gstAmount = amount * (rate / 100);
  }

  const totalAmount = taxableAmount + gstAmount;
  const effectiveRate = taxableAmount > 0 ? (gstAmount / taxableAmount) * 100 : 0;

  // Split based on transaction type
  if (transactionType === 'intraState') {
    const halfGST = gstAmount / 2;
    return {
      taxableAmount,
      gstAmount,
      cgst: halfGST,
      sgst: halfGST,
      igst: undefined,
      totalAmount,
      effectiveRate,
    };
  } else {
    return {
      taxableAmount,
      gstAmount,
      cgst: undefined,
      sgst: undefined,
      igst: gstAmount,
      totalAmount,
      effectiveRate,
    };
  }
}

// REFERENCE TEST CASES:
//
// ₹10,000 exclusive, 18% intra-state:
//   taxableAmount=10,000, gst=1,800, cgst=900, sgst=900, total=11,800
//
// ₹11,800 inclusive, 18% intra-state:
//   taxableAmount=10,000, gst=1,800, cgst=900, sgst=900, total=11,800
//
// ₹50,000 exclusive, 18% inter-state:
//   taxableAmount=50,000, gst=9,000, igst=9,000, total=59,000
//
// Invalid rate (12%) — eliminated slab:
//   throws Error('Invalid GST rate. Use current rates: 0%, 5%, 18%, 40% (standard) or 3%, 0.25% (special)')
//
// Invalid rate (28%) — eliminated slab:
//   throws Error('Invalid GST rate. Use current rates: 0%, 5%, 18%, 40% (standard) or 3%, 0.25% (special)')
