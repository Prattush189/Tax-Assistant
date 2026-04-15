/**
 * Razorpay payment integration.
 *
 * Security model:
 *  - RAZORPAY_KEY_SECRET lives only server-side; frontend never sees it.
 *  - Every verify request checks the HMAC-SHA256 signature before touching the DB.
 *  - Orders are idempotent by razorpay_order_id (UNIQUE constraint in payments table).
 *  - Only the order's owner can verify it (user_id check before upgrade).
 *  - Rate-limited: 5 order-create attempts per user per minute.
 */

import { Router, Response } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { AuthRequest } from '../types.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { paymentRepo } from '../db/repositories/paymentRepo.js';
import { rateLimit } from 'express-rate-limit';

const router = Router();

// Lazily initialise Razorpay so the server still boots without keys in dev.
function getRazorpay(): Razorpay {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in environment');
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

// Pricing table (amounts in paise — 1 INR = 100 paise)
const PRICES: Record<string, Record<string, number>> = {
  pro: {
    monthly: 40_000,   // ₹400
    yearly:  3_60_000, // ₹3,600
  },
  enterprise: {
    monthly: 70_000,   // ₹700
    yearly:  6_00_000, // ₹6,000
  },
};

/** Days added to plan_expires_at based on billing cycle */
function planDurationDays(billing: 'monthly' | 'yearly'): number {
  return billing === 'yearly' ? 365 : 31; // 31 days for monthly (buffer)
}

function addDays(days: number): string {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // IST base
  d.setDate(d.getDate() + days);
  return d.toISOString().replace('Z', '');
}

// Rate-limit order creation: max 5 per user per minute
const orderCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? 'anon',
  validate: { xForwardedForHeader: false, ip: false },
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many payment requests. Please wait a moment.' },
});

// Rate-limit verify: max 10 per user per minute (retries are expected)
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? 'anon',
  validate: { xForwardedForHeader: false, ip: false },
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please wait a moment.' },
});

// ---------------------------------------------------------------------------
// POST /api/payments/create-order
// ---------------------------------------------------------------------------
router.post('/create-order', orderCreateLimiter, async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

  const { plan, billing } = req.body ?? {};

  if (!['pro', 'enterprise'].includes(plan)) {
    res.status(400).json({ error: 'plan must be pro or enterprise' });
    return;
  }
  if (!['monthly', 'yearly'].includes(billing)) {
    res.status(400).json({ error: 'billing must be monthly or yearly' });
    return;
  }

  const amount = PRICES[plan]?.[billing];
  if (!amount) {
    res.status(400).json({ error: 'Invalid plan/billing combination' });
    return;
  }

  try {
    const rzp = getRazorpay();
    const order = await rzp.orders.create({
      amount,
      currency: 'INR',
      receipt: `uid_${req.user.id.slice(0, 8)}_${Date.now()}`,
      notes: {
        user_id: req.user.id,
        plan,
        billing,
      },
    });

    // Persist the order so we can validate ownership at verify time
    paymentRepo.create(req.user.id, order.id, plan, billing, amount);

    res.json({
      orderId: order.id,
      amount,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Payment service error';
    console.error('[payments] create-order failed:', msg);
    res.status(502).json({ error: 'Could not create payment order. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/payments/verify
// ---------------------------------------------------------------------------
router.post('/verify', verifyLimiter, (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};

  if (
    typeof razorpay_order_id !== 'string' ||
    typeof razorpay_payment_id !== 'string' ||
    typeof razorpay_signature !== 'string'
  ) {
    res.status(400).json({ error: 'razorpay_order_id, razorpay_payment_id and razorpay_signature are required' });
    return;
  }

  // 1. Verify HMAC-SHA256 signature — this is the critical security check.
  //    If the signature doesn't match, the payment did not come from Razorpay.
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    console.error('[payments] RAZORPAY_KEY_SECRET not configured');
    res.status(503).json({ error: 'Payment verification not configured' });
    return;
  }

  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const expected = Buffer.from(expectedSignature);
  const received = Buffer.from(razorpay_signature);
  const isValid =
    expected.length === received.length &&
    crypto.timingSafeEqual(expected, received);

  if (!isValid) {
    console.warn('[payments] Signature mismatch for order', razorpay_order_id);
    res.status(400).json({ error: 'Payment verification failed — invalid signature' });
    return;
  }

  // 2. Look up the order and confirm it belongs to this user (prevent IDOR)
  const payment = paymentRepo.findByOrderId(razorpay_order_id);
  if (!payment) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }
  if (payment.user_id !== req.user.id) {
    console.warn('[payments] Order owner mismatch — possible IDOR attempt', {
      orderId: razorpay_order_id,
      claimedUser: req.user.id,
      actualOwner: payment.user_id,
    });
    res.status(403).json({ error: 'Order does not belong to this account' });
    return;
  }

  // 3. Idempotency — if already paid, just return success
  if (payment.status === 'paid') {
    const user = userRepo.findById(req.user.id);
    res.json({ success: true, plan: user?.plan, planExpiresAt: user?.plan_expires_at });
    return;
  }

  // 4. Activate plan
  const expiresAt = addDays(planDurationDays(payment.billing as 'monthly' | 'yearly'));
  paymentRepo.markPaid(razorpay_order_id, razorpay_payment_id, expiresAt);
  userRepo.updatePlanWithExpiry(req.user.id, payment.plan as 'pro' | 'enterprise', expiresAt);

  console.log(`[payments] Plan activated: user=${req.user.id} plan=${payment.plan} billing=${payment.billing} expires=${expiresAt}`);

  // 5. Return fresh user data so frontend can update state immediately
  const updatedUser = userRepo.findById(req.user.id);
  res.json({
    success: true,
    plan: updatedUser?.plan,
    planExpiresAt: updatedUser?.plan_expires_at,
  });
});

// ---------------------------------------------------------------------------
// GET /api/payments/history  — current user's payment history
// ---------------------------------------------------------------------------
router.get('/history', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

  const payments = paymentRepo.findByUserId(req.user.id).map(p => ({
    id: p.id,
    plan: p.plan,
    billing: p.billing,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    createdAt: p.created_at,
    paidAt: p.paid_at,
    expiresAt: p.expires_at,
  }));

  res.json({ payments });
});

export default router;
