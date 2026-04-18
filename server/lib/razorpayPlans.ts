/**
 * Razorpay Plan management.
 *
 * Razorpay "Plans" are billing templates (amount + period) that subscriptions
 * reference. We create all 4 plans once via API on first boot and cache their
 * IDs in the local DB — no dashboard action needed.
 *
 * Plan keys:  pro_monthly | pro_yearly | enterprise_monthly | enterprise_yearly
 *
 * Total subscription count = 100 years:
 *   monthly → total_count 1200
 *   yearly  → total_count 100
 */

import Razorpay from 'razorpay';
import db from '../db/index.js';

export type PlanKey = 'pro_monthly_v3' | 'pro_yearly_v3' | 'enterprise_monthly_v3' | 'enterprise_yearly_v3';
export type BillingCycle = 'monthly' | 'yearly';
export type PaidPlan = 'pro' | 'enterprise';

/** GST rate applied on top of base plan prices (18% as per Indian GST for SaaS) */
export const GST_RATE = 0.18;

/** Returns amount in paise inclusive of 18% GST */
function withGst(basePaise: number): number {
  return Math.round(basePaise * (1 + GST_RATE));
}

/**
 * Amount in paise for each plan key — inclusive of 18% GST.
 * Base prices: Pro ₹500/mo, ₹3,600/yr · Enterprise ₹750/mo, ₹6,000/yr
 */
export const PLAN_AMOUNTS: Record<PlanKey, number> = {
  pro_monthly_v3:         withGst(50_000),   // ₹500 + 18% GST = ₹590
  pro_yearly_v3:         withGst(3_60_000),  // ₹3,600 + 18% GST = ₹4,248
  enterprise_monthly_v3:  withGst(75_000),   // ₹750 + 18% GST = ₹885
  enterprise_yearly_v3:  withGst(6_00_000),  // ₹6,000 + 18% GST = ₹7,080
};

/** Human-readable plan names for Razorpay dashboard */
const PLAN_NAMES: Record<PlanKey, string> = {
  pro_monthly_v3:         'Smartbiz AI Pro — Monthly',
  pro_yearly_v3:          'Smartbiz AI Pro — Yearly',
  enterprise_monthly_v3:  'Smartbiz AI Enterprise — Monthly',
  enterprise_yearly_v3:   'Smartbiz AI Enterprise — Yearly',
};

/**
 * Number of billing cycles per subscription.
 * Monthly: 12 charges (1 year). User can cancel any time before cycle 12.
 * Yearly:  1 charge (1 year). Subscription completes after the year ends.
 * In both cases, subscription.completed fires when done — our webhook
 * sets status to 'completed' and the auto-downgrade middleware handles the rest.
 */
export const TOTAL_COUNT: Record<BillingCycle, number> = {
  monthly: 12,
  yearly:   1,
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

export function planKey(plan: PaidPlan, billing: BillingCycle): PlanKey {
  return `${plan}_${billing}_v3` as PlanKey;
}

/**
 * Returns the Razorpay Plan ID for the given plan+billing combo.
 * Creates it via API and caches it in the DB on first call.
 */
export async function getRazorpayPlanId(plan: PaidPlan, billing: BillingCycle): Promise<string> {
  const key = planKey(plan, billing);

  // Check cache first
  const cached = cacheGet.get(key) as { razorpay_plan_id: string } | undefined;
  if (cached) return cached.razorpay_plan_id;

  // Create in Razorpay
  const rzp = getRazorpay();
  const period = billing === 'monthly' ? 'monthly' : 'yearly';
  const amount = PLAN_AMOUNTS[key];

  const created = await rzp.plans.create({
    period,
    interval: 1,
    item: {
      name: PLAN_NAMES[key],
      amount,
      unit_amount: amount,
      currency: 'INR',
    },
    notes: { plan, billing, app: 'smartbiz-ai' },
  } as Parameters<typeof rzp.plans.create>[0]);

  const planId = (created as { id: string }).id;
  cacheSet.run(key, planId);
  console.log(`[razorpayPlans] Created Razorpay plan ${key} → ${planId}`);
  return planId;
}

/**
 * Pre-warms all 4 plans on server startup so the first user to pay never
 * experiences a delay. Failures are logged but don't crash the server.
 */
export async function warmupRazorpayPlans(): Promise<void> {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.warn('[razorpayPlans] Keys not configured — skipping plan warmup');
    return;
  }
  const keys: Array<[PaidPlan, BillingCycle]> = [
    ['pro', 'monthly'], ['pro', 'yearly'],
    ['enterprise', 'monthly'], ['enterprise', 'yearly'],
  ];
  for (const [plan, billing] of keys) {
    try {
      await getRazorpayPlanId(plan, billing);
    } catch (err) {
      console.error(`[razorpayPlans] Failed to warm ${plan}_${billing}:`, err);
    }
  }
  console.log('[razorpayPlans] All Razorpay plans ready');
}
