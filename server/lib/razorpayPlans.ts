/**
 * Razorpay Plan management.
 *
 * Razorpay "Plans" are billing templates (amount + period) that subscriptions
 * reference. We create both yearly plans once via API on first boot and cache
 * their IDs in the local DB — no dashboard action needed.
 *
 * Plan keys:  pro_yearly | enterprise_yearly
 *
 * Only YEARLY billing is supported. The token / feature budget tied to a paid
 * plan resets exclusively when the yearly subscription renews — there is no
 * monthly billing cycle and no calendar-month reset.
 */

import Razorpay from 'razorpay';
import db from '../db/index.js';

export type PlanKey = 'pro_yearly_v3' | 'enterprise_yearly_v3';
/** Kept as a type alias for downstream callers (jobs, webhooks, payment PDFs)
 *  that historically passed a billing cycle. The only valid value is 'yearly'. */
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

/** Human-readable plan names for Razorpay dashboard */
const PLAN_NAMES: Record<PlanKey, string> = {
  pro_yearly_v3:          'Smartbiz AI Pro — Yearly',
  enterprise_yearly_v3:   'Smartbiz AI Enterprise — Yearly',
};

/**
 * Number of billing cycles per subscription.
 * Yearly: 1 charge (1 year). Subscription completes after the year ends.
 * subscription.completed fires when done — our webhook sets status to
 * 'completed' and the auto-downgrade middleware handles the rest.
 */
export const TOTAL_COUNT: Record<BillingCycle, number> = {
  yearly: 1,
};

const cacheGet = db.prepare('SELECT razorpay_plan_id FROM razorpay_plan_cache WHERE key = ?');
const cacheSet = db.prepare(
  'INSERT OR REPLACE INTO razorpay_plan_cache (key, razorpay_plan_id) VALUES (?, ?)'
);

function getRazorpay(): Razorpay {
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set');
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

export function planKey(plan: PaidPlan, _billing: BillingCycle = 'yearly'): PlanKey {
  return `${plan}_yearly_v3` as PlanKey;
}

/**
 * Returns the Razorpay Plan ID for the given plan. Creates it via API and
 * caches it in the DB on first call.
 */
export async function getRazorpayPlanId(plan: PaidPlan, _billing: BillingCycle = 'yearly'): Promise<string> {
  const key = planKey(plan);

  // Check cache first
  const cached = cacheGet.get(key) as { razorpay_plan_id: string } | undefined;
  if (cached) return cached.razorpay_plan_id;

  // Create in Razorpay
  const rzp = getRazorpay();
  const amount = PLAN_AMOUNTS[key];

  const created = await rzp.plans.create({
    period: 'yearly',
    interval: 1,
    item: {
      name: PLAN_NAMES[key],
      amount,
      unit_amount: amount,
      currency: 'INR',
    },
    notes: { plan, billing: 'yearly', app: 'smartbiz-ai' },
  } as Parameters<typeof rzp.plans.create>[0]);

  const planId = (created as { id: string }).id;
  cacheSet.run(key, planId);
  console.log(`[razorpayPlans] Created Razorpay plan ${key} → ${planId}`);
  return planId;
}

/**
 * Pre-warms both yearly plans on server startup so the first user to pay
 * never experiences a delay. Failures are logged but don't crash the server.
 */
export async function warmupRazorpayPlans(): Promise<void> {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.warn('[razorpayPlans] Keys not configured — skipping plan warmup');
    return;
  }
  const plans: PaidPlan[] = ['pro', 'enterprise'];
  for (const plan of plans) {
    try {
      await getRazorpayPlanId(plan, 'yearly');
    } catch (err) {
      console.error(`[razorpayPlans] Failed to warm ${plan}_yearly:`, err);
    }
  }
  console.log('[razorpayPlans] All Razorpay plans ready');
}
