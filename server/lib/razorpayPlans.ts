/**
 * Razorpay plan constants.
 *
 * Only YEARLY billing is supported. Payments are one-time Razorpay Orders
 * (not Subscriptions) — no auto-renewal. Access expires after one year and
 * the user must repurchase to continue.
 *
 * Plan keys:  pro_yearly_v3 | enterprise_yearly_v3
 */

export type PlanKey = 'pro_yearly_v3' | 'enterprise_yearly_v3';
/** Kept as a type alias for downstream callers (jobs, webhooks, payment PDFs). */
export type BillingCycle = 'yearly';
export type PaidPlan = 'pro' | 'enterprise';

/** GST rate applied on top of base plan prices (18% as per Indian GST for SaaS) */
export const GST_RATE = 0.18;

/** Returns amount in paise inclusive of 18% GST */
function withGst(basePaise: number): number {
  return Math.round(basePaise * (1 + GST_RATE));
}

/**
 * Amount in paise for each plan key — inclusive of 18% GST.
 * Yearly base prices are 12 × the previous monthly base (no annual discount):
 *   Pro        ₹500/mo × 12 = ₹6,000/yr  → ₹7,080 incl. GST
 *   Enterprise ₹750/mo × 12 = ₹9,000/yr  → ₹10,620 incl. GST
 */
export const PLAN_AMOUNTS: Record<PlanKey, number> = {
  pro_yearly_v3:          withGst(6_00_000),  // ₹6,000 + 18% GST = ₹7,080
  enterprise_yearly_v3:   withGst(9_00_000),  // ₹9,000 + 18% GST = ₹10,620
};

export function planKey(plan: PaidPlan, _billing: BillingCycle = 'yearly'): PlanKey {
  return `${plan}_yearly_v3` as PlanKey;
}
