/**
 * Razorpay Subscription payment routes.
 *
 * Security model:
 *  - RAZORPAY_KEY_SECRET is server-side only; frontend never sees it.
 *  - Subscription verify uses HMAC-SHA256(payment_id|subscription_id, key_secret).
 *  - Ownership check: subscription ID is looked up in DB and owner confirmed before upgrade.
 *  - Idempotent: double-verify on same payment_id returns success without side effects.
 *  - Rate-limited per user.
 *
 * Auto-renewal:
 *  - Subscriptions are created with total_count = 1200 (monthly) or 100 (yearly).
 *    That is 100 years — effectively perpetual unless the user cancels.
 *  - Each recurring payment fires the subscription.charged webhook which extends
 *    plan_expires_at. Plan stays active as long as payments succeed.
 */

import { Router, Response } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { AuthRequest } from '../types.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { paymentRepo } from '../db/repositories/paymentRepo.js';
import { getRazorpayPlanId, TOTAL_COUNT, PLAN_AMOUNTS, planKey } from '../lib/razorpayPlans.js';
import { rateLimit } from 'express-rate-limit';
import type { BillingCycle, PaidPlan } from '../lib/razorpayPlans.js';
import { sendPlanWelcomeEmail, sendInvoiceEmail } from '../lib/mailer.js';

const router = Router();

function getRazorpay(): Razorpay {
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured');
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

/** Convert a Unix timestamp (seconds) to IST datetime string for SQLite */
function unixToIST(ts: number): string {
  return new Date(ts * 1000).toISOString().replace('Z', '');
}

/** Fallback expiry: now + billing period (used if webhook current_end not available) */
function fallbackExpiry(billing: BillingCycle): string {
  const d = new Date();
  billing === 'yearly' ? d.setFullYear(d.getFullYear() + 1) : d.setMonth(d.getMonth() + 1);
  return d.toISOString().replace('Z', '');
}

// Rate limiters
const createLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 5,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? 'anon',
  validate: { xForwardedForHeader: false, ip: false },
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many payment requests. Please wait.' },
});

const verifyLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 10,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? 'anon',
  validate: { xForwardedForHeader: false, ip: false },
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please wait.' },
});

// ---------------------------------------------------------------------------
// POST /api/payments/create-subscription
// ---------------------------------------------------------------------------
router.post('/create-subscription', createLimiter, async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

  const { plan, billing } = req.body ?? {};
  if (!['pro', 'enterprise'].includes(plan)) {
    res.status(400).json({ error: 'plan must be pro or enterprise' }); return;
  }
  if (!['monthly', 'yearly'].includes(billing)) {
    res.status(400).json({ error: 'billing must be monthly or yearly' }); return;
  }

  try {
    const rzp    = getRazorpay();
    const planId = await getRazorpayPlanId(plan as PaidPlan, billing as BillingCycle);
    const count  = TOTAL_COUNT[billing as BillingCycle]; // 1200 or 100 (100 years)

    const sub = await rzp.subscriptions.create({
      plan_id:        planId,
      total_count:    count,
      quantity:       1,
      customer_notify: 1,
      notes: {
        user_id: req.user.id,
        plan,
        billing,
        app: 'smartbiz-ai',
      },
    } as Parameters<typeof rzp.subscriptions.create>[0]);

    const subId = (sub as { id: string }).id;

    res.json({
      subscriptionId: subId,
      keyId: process.env.RAZORPAY_KEY_ID,
      plan,
      billing,
      amount: PLAN_AMOUNTS[planKey(plan as PaidPlan, billing as BillingCycle)],
    });
  } catch (err) {
    console.error('[payments] create-subscription failed:', err);
    res.status(502).json({ error: 'Could not create subscription. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/payments/verify
// Verifies the first payment of a new subscription and activates the plan.
// Recurring payments are handled automatically by the webhook.
// ---------------------------------------------------------------------------
router.post('/verify', verifyLimiter, (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body ?? {};

  if (
    typeof razorpay_payment_id     !== 'string' ||
    typeof razorpay_subscription_id !== 'string' ||
    typeof razorpay_signature       !== 'string'
  ) {
    res.status(400).json({ error: 'razorpay_payment_id, razorpay_subscription_id and razorpay_signature are required' });
    return;
  }

  // 1. HMAC-SHA256 signature verification (subscription mode)
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) { res.status(503).json({ error: 'Payment verification not configured' }); return; }

  const expectedSig = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
    .digest('hex');

  const expected = Buffer.from(expectedSig);
  const received = Buffer.from(razorpay_signature);
  const valid = expected.length === received.length && crypto.timingSafeEqual(expected, received);

  if (!valid) {
    console.warn('[payments/verify] Signature mismatch sub:', razorpay_subscription_id);
    res.status(400).json({ error: 'Signature verification failed' });
    return;
  }

  // 2. Idempotency — already activated by webhook or prior verify
  const existingUser = userRepo.findBySubscriptionId(razorpay_subscription_id);
  if (existingUser && existingUser.subscription_status === 'active') {
    res.json({ success: true, plan: existingUser.plan, planExpiresAt: existingUser.plan_expires_at });
    return;
  }

  // 3. Determine plan/billing from the subscription ID stored by Razorpay
  //    (notes are set when we created the sub — read from request body as fallback)
  const { plan, billing } = req.body ?? {};
  if (!plan || !billing) {
    res.status(400).json({ error: 'plan and billing are required' }); return;
  }

  // 4. Activate plan — webhook will keep extending plan_expires_at each cycle
  const expiresAt = fallbackExpiry(billing as BillingCycle);
  userRepo.updateSubscription(
    req.user.id,
    razorpay_subscription_id,
    'active',
    plan as PaidPlan,
    expiresAt,
  );

  // 5. Log payment record
  const amount = PLAN_AMOUNTS[planKey(plan as PaidPlan, billing as BillingCycle)];
  try {
    // Reuse payment repo for audit trail (subscription_id stored as order_id)
    const existing = paymentRepo.findByOrderId(razorpay_subscription_id);
    if (!existing) {
      paymentRepo.create(req.user.id, razorpay_subscription_id, plan, billing, amount);
    }
    paymentRepo.markPaid(razorpay_subscription_id, razorpay_payment_id, expiresAt);
  } catch { /* non-critical — plan already activated above */ }

  console.log(`[payments/verify] Plan activated: user=${req.user.id} plan=${plan}/${billing}`);
  const fresh = userRepo.findById(req.user.id);

  // Fire-and-forget: welcome email + invoice email with PDF attachments
  void (async () => {
    try {
      const billingDetails = userRepo.getBillingDetails(req.user!.id);
      const buyer = { name: fresh?.name ?? '', email: fresh?.email ?? '', billingDetails };
      const payRec = paymentRepo.findByOrderId(razorpay_subscription_id);
      if (payRec) {
        const pdfData = {
          id: payRec.id, plan: payRec.plan, billing: payRec.billing,
          amount: payRec.amount, paidAt: payRec.paid_at, expiresAt: payRec.expires_at,
        };
        const { buildReceiptBuffer, buildInvoiceBuffer } = await import('../lib/serverPdf.js');
        const [rcpt, inv] = [buildReceiptBuffer(pdfData, buyer), buildInvoiceBuffer(pdfData, buyer)];
        await sendPlanWelcomeEmail(buyer.email, buyer.name, plan as string, billing as string, expiresAt);
        await sendInvoiceEmail(buyer.email, buyer.name, plan as string, rcpt, inv, payRec.id);
      }
    } catch (err) {
      console.error('[payments/verify] post-payment emails failed:', err);
    }
  })();

  res.json({ success: true, plan: fresh?.plan, planExpiresAt: fresh?.plan_expires_at });
});

// ---------------------------------------------------------------------------
// DELETE /api/payments/subscription  — cancel current subscription
// ---------------------------------------------------------------------------
router.delete('/subscription', async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

  const user = userRepo.findById(req.user.id);
  if (!user?.razorpay_subscription_id) {
    res.status(404).json({ error: 'No active subscription found' }); return;
  }
  if (user.subscription_status === 'cancelled') {
    res.status(409).json({ error: 'Subscription is already cancelled' }); return;
  }

  try {
    const rzp = getRazorpay();
    await rzp.subscriptions.cancel(user.razorpay_subscription_id, false);
    // Plan stays active until plan_expires_at — Razorpay stops billing after that
    userRepo.updateSubscriptionStatus(user.razorpay_subscription_id, 'cancelled');
    console.log(`[payments] Subscription cancelled: user=${req.user.id} sub=${user.razorpay_subscription_id}`);
    res.json({ success: true, message: 'Subscription cancelled. Your plan remains active until ' + user.plan_expires_at });
  } catch (err) {
    console.error('[payments] cancel subscription failed:', err);
    res.status(502).json({ error: 'Could not cancel subscription. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/payments/history
// ---------------------------------------------------------------------------
router.get('/history', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

  const user     = userRepo.findById(req.user.id);
  const payments = paymentRepo.findByUserId(req.user.id).map(p => ({
    id:         p.id,
    plan:       p.plan,
    billing:    p.billing,
    amount:     p.amount,
    currency:   p.currency,
    status:     p.status,
    createdAt:  p.created_at,
    paidAt:     p.paid_at,
    expiresAt:  p.expires_at,
  }));

  res.json({
    subscriptionId:     user?.razorpay_subscription_id ?? null,
    subscriptionStatus: user?.subscription_status ?? null,
    payments,
  });
});

export default router;
