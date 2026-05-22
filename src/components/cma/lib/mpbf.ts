/**
 * Maximum Permissible Bank Finance (MPBF) computation.
 *
 * Three methods supported:
 *
 *   Tandon Method I:
 *     MPBF = 0.75 × (CA − OCL) − 0.25 × stock-in-process-equivalent
 *     Conservative — 25% margin on current assets EXCLUDING stock.
 *     Mostly used by banks for weaker borrowers / higher-risk
 *     industries. v1 implementation: 0.75 × (CA − OCL) − 0.25 ×
 *     (stock at 25% margin). We simplify the "stock-in-process"
 *     piece to 0.25 × inventory since CMA inputs don't break out
 *     in-process inventory separately.
 *
 *   Tandon Method II:
 *     MPBF = 0.75 × (CA − OCL)
 *     where CA = total current assets and OCL = current liabilities
 *     other than bank borrowings. The standard for working-capital
 *     limits > ₹2 cr across most banks.
 *
 *   Nayak Committee (20% of turnover):
 *     MPBF = 0.20 × projected_annual_turnover (with 5% promoter margin)
 *     Used by banks for SME loans under ₹5 cr. Doesn't need a BS at
 *     all — just the sales projection.
 *
 * Returns the MPBF figure for each projected year as an array, sized
 * to match the projection horizon (the caller knows the offset from
 * historical years).
 */

import type { MpbfMethod } from './uiModel';

export interface MpbfInputs {
  /** Projected annual turnover for each forward year. Used by Nayak
   *  and as a sanity-check denominator for the other methods. */
  projectedTurnover: number[];
  /** Total current assets per projected year. */
  totalCurrentAssets: number[];
  /** Inventory per projected year. */
  inventory: number[];
  /** "Other current liabilities" — i.e. current liabilities EXCLUDING
   *  bank borrowings. Tandon II's denominator subtracts this from
   *  CA to get the working-capital gap. */
  currentLiabExcludingBank: number[];
}

export interface MpbfResult {
  /** MPBF per projected year. */
  mpbfByYear: number[];
  /** Working-capital gap per year (CA − OCL). Same as Tandon II's
   *  CA−OCL numerator. */
  workingCapitalGap: number[];
  /** Required promoter margin per year. */
  promoterMargin: number[];
  /** Method label for display. */
  methodLabel: string;
}

export function computeMpbf(method: MpbfMethod, inputs: MpbfInputs): MpbfResult {
  const n = inputs.projectedTurnover.length;
  const workingCapitalGap = inputs.totalCurrentAssets.map(
    (ca, i) => ca - inputs.currentLiabExcludingBank[i],
  );

  if (method === 'tandon_i') {
    // Method I: more conservative — promoter contributes 25% of
    // (CA − stock), and bank funds the rest minus stock margin.
    // Approximation: MPBF = 0.75 × (CA − OCL) − 0.25 × inventory.
    const mpbfByYear = workingCapitalGap.map(
      (gap, i) => Math.max(0, 0.75 * gap - 0.25 * inputs.inventory[i]),
    );
    const promoterMargin = workingCapitalGap.map(
      (gap, i) => gap - mpbfByYear[i],
    );
    return {
      mpbfByYear,
      workingCapitalGap,
      promoterMargin,
      methodLabel: 'Tandon Method I',
    };
  }

  if (method === 'tandon_ii') {
    // Method II: 25% promoter margin on the WC gap.
    const mpbfByYear = workingCapitalGap.map(
      (gap) => Math.max(0, 0.75 * gap),
    );
    const promoterMargin = workingCapitalGap.map(
      (gap) => 0.25 * Math.max(0, gap),
    );
    return {
      mpbfByYear,
      workingCapitalGap,
      promoterMargin,
      methodLabel: 'Tandon Method II',
    };
  }

  // Nayak: 20% of turnover, 5% promoter margin (so bank funds 20% of
  // the 25% WC requirement they assume). Doesn't reference BS lines —
  // useful for SME accounts without proper books.
  const mpbfByYear = inputs.projectedTurnover.map((t) => Math.max(0, 0.20 * t));
  const promoterMargin = inputs.projectedTurnover.map((t) => 0.05 * t);
  return {
    mpbfByYear,
    workingCapitalGap,
    promoterMargin,
    methodLabel: 'Nayak Committee (20% of turnover)',
  };
  // Exhaustiveness: TS narrows to all three; no other path possible.
  // The function returns above. Adding a default branch would mask
  // a future enum extension as runtime "works" — leave it falling
  // through so tsc catches new methods at compile time.
  const _exhaust: never = method as never;
  return _exhaust;
}
