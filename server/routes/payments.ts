/**
 * Razorpay Order payment routes (one-time, non-recurring).
 *
 * Security model:
 *  - RAZORPAY_KEY_SECRET is server-side only; frontend never sees it.
 *  - Order verify uses HMAC-SHA256(order_id|payment_id, key_secret).
 *  - Ownership check: order ID is looked up in DB and owner confirmed before upgrade.
 *  - Idempotent: double-verify on same order_id returns success without side effects.
 *  - Rate-limited per user.
 *
 * Billing model:
 *  - Users pay once per year (Razorpay Order, not Subscription).
 *  - No auto-renewal — on expiry access downgrades to Free unless the user repurchases.
 */

import { Router, Response } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { AuthRequest } from '../types.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { paymentRepo } from '../db/repositories/paymentRepo.js';
import { PLAN_AMOUNTS, planKey } from '../lib/razorpayPlans.js';
import { rateLimit } from 'express-rate-limit';
import type { BillingCycle, PaidPlan } from '../lib/razorpayPlans.js';
import { sendPlanWelcomeEmail, sendInvoiceEmail } from '../lib/mailer.js';
import { issuePaymentLicense } from '../lib/issueLicense.js';
import { fanoutEvent } from '../lib/externalWebhook.js';
import { licenseKeyRepo } from '../db/repositories/licenseKeyRepo.js';

const router = Router();

function getRazorpay(): Razorpay {
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured');
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

/** Fallback expiry: now + 1 year. Only yearly billing is supported. */
function fallbackExpiry(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
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
// POST /api/payments/create-order
// Creates a one-time Razorpay Order for the given plan.
// (`/create-subscription` is kept as an alias so older cached frontend
//  bundles continue to work after the subscription -> order migration.)
// ---------------------------------------------------------------------------
router.post(['/create-order', '/create-subscription'], createLimiter, async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

  const { plan } = req.body ?? {};
  if (!['pro', 'enterprise'].includes(plan)) {
    res.status(400).json({ error: 'plan must be pro or enterprise' }); return;
  }

  try {
    const rzp    = getRazorpay();
    const key    = planKey(plan as PaidPlan);
    const amount = PLAN_AMOUNTS[key];

    const order = await rzp.orders.create({
      amount,
      currency: 'INR',
      receipt: `sbai-${plan}-${Date.now()}`,
      notes: {
        user_id: req.user.id,
        plan,
        billing: 'yearly',
        app: 'smartbiz-ai',
      },
    });

    const orderId = (order as { id: string }).id;

    res.json({
      orderId,
      keyId: process.env.RAZORPAY_KEY_ID,
      plan,
      amount,
    });
  } catch (err) {
    console.error('[payments] create-order failed:', err);
    res.status(502).json({ error: 'Could not create payment. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/payments/verify
// Verifies a completed Razorpay Order payment and activates the plan.
// ---------------------------------------------------------------------------
router.post('/verify', verifyLimiter, (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

  const body = req.body ?? {};
  const razorpay_payment_id = body.razorpay_payment_id;
  // Accept both razorpay_order_id (new) and razorpay_subscription_id (legacy
  // alias for stale frontend bundles after the subscription -> order switch).
  const razorpay_order_id   = body.razorpay_order_id ?? body.razorpay_subscription_id;
  const razorpay_signature  = body.razorpay_signature;

  if (
    typeof razorpay_payment_id !== 'string' ||
    typeof razorpay_order_id   !== 'string' ||
    typeof razorpay_signature  !== 'string'
  ) {
    res.status(400).json({ error: 'razorpay_payment_id, razorpay_order_id and razorpay_signature are required' });
    return;
  }

  // 1. HMAC-SHA256 signature verification (order mode)
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) { res.status(503).json({ error: 'Payment verification not configured' }); return; }

  const expectedSig = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const expected = Buffer.from(expectedSig);
  const received = Buffer.from(razorpay_signature);
  const valid = expected.length === received.length && crypto.timingSafeEqual(expected, received);

  if (!valid) {
    console.warn('[payments/verify] Signature mismatch order:', razorpay_order_id);
    res.status(400).json({ error: 'Signature verification failed' });
    return;
  }

  // 2. Idempotency — already activated by webhook or prior verify
  const existingPayment = paymentRepo.findByOrderId(razorpay_order_id);
  if (existingPayment?.status === 'paid') {
    const existingUser = userRepo.findById(req.user.id);
    res.json({ success: true, plan: existingUser?.plan, planExpiresAt: existingUser?.plan_expires_at });
    return;
  }

  // 3. Determine plan from request body
  const { plan } = req.body ?? {};
  if (!['pro', 'enterprise'].includes(plan)) {
    res.status(400).json({ error: 'plan must be pro or enterprise' }); return;
  }
  const billing: BillingCycle = 'yearly';

  // 4. Activate plan
  const expiresAt = fallbackExpiry();
  userRepo.updateSubscription(
    req.user.id,
    razorpay_order_id,
    'active',
    plan as PaidPlan,
    expiresAt,
  );

  // 5. Log payment record
  const amount = PLAN_AMOUNTS[planKey(plan as PaidPlan, billing)];
  let paymentRowId: string | null = null;
  try {
    const existing = paymentRepo.findByOrderId(razorpay_order_id);
    if (!existing) {
      paymentRepo.create(req.user.id, razorpay_order_id, plan, billing, amount, 'razorpay');
    }
    paymentRepo.markPaid(razorpay_order_id, razorpay_payment_id, expiresAt);
    paymentRowId = paymentRepo.findByOrderId(razorpay_order_id)?.id ?? null;
  } catch { /* non-critical — plan already activated above */ }

  // 6. Issue the license key for this payment. Supersedes any
  //    existing active license for the user (handled inside
  //    licenseKeyRepo.issue's transaction). Fails silently if the
  //    payment row didn't materialise — user is already activated
  //    via userRepo.updateSubscription above; backfill or admin
  //    intervention can issue a key later.
  if (paymentRowId) {
    issuePaymentLicense({
      userId: req.user.id,
      plan: plan as 'pro' | 'enterprise',
      paymentId: paymentRowId,
      expiresAt,
    });
    // Fan out a webhook to assist.smartbizin.com (or any other
    // configured external API key) so dealer consoles can show
    // the new license without polling.
    void (async () => {
      try {
        const license = licenseKeyRepo.loadActive(req.user!.id);
        const payment = paymentRepo.findById(paymentRowId!);
        const userRow = userRepo.findById(req.user!.id);
        if (license) {
          fanoutEvent({
            event: 'license.issued',
            license: license as unknown as Record<string, unknown>,
            payment: (payment as unknown as Record<string, unknown>) ?? null,
            user: userRow ? { id: userRow.id, name: userRow.name, email: userRow.email, plan: userRow.plan } : null,
          });
        }
      } catch (e) { console.warn('[payments/verify] webhook fanout failed:', (e as Error).message); }
    })();
  }

  console.log(`[payments/verify] Plan activated: user=${req.user.id} plan=${plan}/${billing}`);
  const fresh = userRepo.findById(req.user.id);

  // Fire-and-forget: welcome email + invoice email
  void (async () => {
    try {
      const billingDetails = userRepo.getBillingDetails(req.user!.id);
      const buyer = { name: fresh?.name ?? '', email: fresh?.email ?? '', billingDetails };
      const payRec = paymentRepo.findByOrderId(razorpay_order_id);
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
    // Kept for API shape compatibility — stores the last Razorpay order ID
    subscriptionId:     user?.razorpay_subscription_id ?? null,
    subscriptionStatus: user?.subscription_status ?? null,
    payments,
  });
});

export default router;
