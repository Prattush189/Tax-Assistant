/**
 * Monthly amortisation engine for term loans.
 *
 * Builds a per-month schedule honouring:
 *   - Disbursement month within the projection's first FY
 *   - Initial moratorium (interest accrues / capitalises, no EMI)
 *   - Repayment type — equal_emi (standard reducing-balance EMI)
 *     OR equal_principal (flat principal, declining interest)
 *
 * Output is a flat array of monthly rows; the exporter groups by FY
 * for the Form-V-style "Year / Month / Opening / Disbursement /
 * Repayment / Closing / Interest / Total Instalments" table the
 * reference CMAs use.
 *
 * Months use a 1-based "Month within Year" index. FY months map to
 * Apr = 1, May = 2, …, Mar = 12 (India FY convention). The exporter
 * renders the month name from this index.
 *
 * Interest model: nominal annual rate / 12 = monthly rate. Compounded
 * monthly. We accept this as the banker convention for term-loan
 * schedules in CMA reports; actual sanction letters may use effective
 * annual rate — caller adjusts the input rate accordingly.
 *
 * Moratorium handling: during the moratorium window, principal
 * repayment is zero. Interest still accrues; the schedule emits the
 * interest cell (which the borrower must service — "interest serving
 * moratorium" — unless the bank specifically capitalised it into
 * principal, which we don't auto-capitalise here).
 */

import type { TermLoan } from './uiModel';

export interface MonthlyAmortRow {
  /** Absolute month index across the whole projection (0-based,
   *  month 0 = April of the first FY). */
  absoluteMonth: number;
  /** FY ordinal — 0 = first FY of the projection, 1 = second FY, … */
  fyIndex: number;
  /** Month within the FY — 1-based, Apr = 1, Mar = 12. */
  monthOfFy: number;
  monthName: string;
  /** Opening principal balance at the start of this month. */
  opening: number;
  /** Disbursement during this month (≥ 0). Non-zero only on the
   *  disbursement month. */
  disbursement: number;
  /** Principal + interest paid during this month. */
  repayment: number;
  closing: number;
  /** Interest accrued during this month (monthly rate × opening + disb). */
  interest: number;
  /** Total instalment = repayment + interest. The reference CMA emits
   *  this as a single "Total Instalments" column. */
  totalInstalment: number;
}

const MONTH_NAMES_FY = [
  'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'January', 'February', 'March',
] as const;

/**
 * Build the full monthly amortisation schedule for one term loan
 * across `horizonYears` financial years. Stops when the loan is
 * fully repaid OR the horizon ends, whichever comes first. The
 * remainder of the horizon is padded with zero-rows so the table
 * looks uniform.
 */
export function buildMonthlyAmortisation(loan: TermLoan, horizonYears: number): MonthlyAmortRow[] {
  const principal = Math.max(0, loan.principal ?? 0);
  const annualRatePct = Math.max(0, loan.interestRatePct ?? 0);
  const monthlyRate = annualRatePct / 100 / 12;
  const tenureMonths = Math.max(1, loan.tenureMonths ?? 60);
  const moratorium = Math.max(0, loan.moratoriumMonths ?? 0);
  const disbursementMonth = Math.max(1, Math.min(12, loan.disbursementMonth ?? 1));
  const repaymentType = loan.repaymentType ?? 'equal_emi';

  // Disbursement absolute index — month (disbursementMonth − 1) in
  // year 0. Repayments start `moratorium` months later.
  const disbursementAbs = disbursementMonth - 1;
  const repaymentStartAbs = disbursementAbs + moratorium;
  // Repayment is spread across the loan's tenure starting from the
  // moratorium end. Last instalment lands at disbursement + tenure − 1.
  const lastInstalmentAbs = disbursementAbs + tenureMonths - 1;
  // Number of months over which repayment is split.
  const repaymentMonths = Math.max(1, lastInstalmentAbs - repaymentStartAbs + 1);

  // Equal-EMI calculation: r × P × (1+r)^n / ((1+r)^n − 1) where n =
  // repaymentMonths and P = principal (interest accrued during
  // moratorium is paid as it accrues — not capitalised — so the EMI
  // base is the original principal).
  const equalEmi = monthlyRate > 0
    ? (monthlyRate * principal * Math.pow(1 + monthlyRate, repaymentMonths)) / (Math.pow(1 + monthlyRate, repaymentMonths) - 1)
    : principal / repaymentMonths;
  const equalPrincipal = principal / repaymentMonths;

  const totalMonths = horizonYears * 12;
  const rows: MonthlyAmortRow[] = [];
  let opening = 0;
  for (let m = 0; m < totalMonths; m++) {
    const fyIndex = Math.floor(m / 12);
    const monthOfFy = (m % 12) + 1;
    const monthName = MONTH_NAMES_FY[m % 12];

    const disbursement = m === disbursementAbs ? principal : 0;
    const balanceAfterDisbursement = opening + disbursement;
    const interest = balanceAfterDisbursement * monthlyRate;

    let principalPayment = 0;
    if (m >= repaymentStartAbs && m <= lastInstalmentAbs && balanceAfterDisbursement > 0.001) {
      if (repaymentType === 'equal_emi') {
        // EMI is constant — principal portion = EMI − interest.
        principalPayment = Math.max(0, equalEmi - interest);
      } else {
        // equal_principal
        principalPayment = equalPrincipal;
      }
      // Don't repay more than what's outstanding (handles rounding
      // on the final instalment).
      principalPayment = Math.min(principalPayment, balanceAfterDisbursement);
    }

    const closing = balanceAfterDisbursement - principalPayment;
    const totalInstalment = principalPayment + interest;
    rows.push({
      absoluteMonth: m,
      fyIndex,
      monthOfFy,
      monthName,
      opening,
      disbursement,
      repayment: principalPayment,
      closing,
      interest,
      totalInstalment,
    });
    opening = closing;
  }
  return rows;
}

/** Convenience: group monthly rows by FY for the exporter. */
export function groupByFy(rows: MonthlyAmortRow[]): Record<number, MonthlyAmortRow[]> {
  const out: Record<number, MonthlyAmortRow[]> = {};
  for (const r of rows) {
    if (!out[r.fyIndex]) out[r.fyIndex] = [];
    out[r.fyIndex].push(r);
  }
  return out;
}
