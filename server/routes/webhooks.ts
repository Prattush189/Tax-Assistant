/**
 * Razorpay Webhook handler.
 *
 * Security: HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET) === X-Razorpay-Signature
 *
 * IMPORTANT: This router must be mounted with express.raw({ type: 'application/json' })
 * BEFORE the global express.json() body parser in server/index.ts, so that req.body
 * is a Buffer (not a parsed object) when this handler runs.
 *
 *   app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhooksRouter);
 *   app.use(express.json({ limit: '1mb' }));   // <-- after webhooks
 *
 * Events handled:
 *   subscription.activated — backup activation (primary is POST /api/payments/verify)
 *   subscription.charged   — extend plan_expires_at; send payment confirmation email
 *   subscription.halted    — update status; send payment-failed email
 *   subscription.cancelled — update status
 *   subscription.completed — update status
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { userRepo } from '../db/repositories/userRepo.js';
import { paymentRepo } from '../db/repositories/paymentRepo.js';
import { PLAN_AMOUNTS, planKey } from '../lib/razorpayPlans.js';
import type { BillingCycle, PaidPlan } from '../lib/razorpayPlans.js';
import {
  sendPaymentConfirmationEmail,
  sendSubscriptionHaltedEmail,
  sendInvoiceEmail,
} from '../lib/mailer.js';
import { buildReceiptBuffer, buildInvoiceBuffer } from '../lib/serverPdf.js';

const router = Router();

function unixToUtcString(ts: number): string {
  return new Date(ts * 1000).toISOString().replace('Z', '');
}

function fallbackExpiry(billing: BillingCycle): string {
  const d = new Date();
  billing === 'yearly' ? d.setFullYear(d.getFullYear() + 1) : d.setMonth(d.getMonth() + 1);
  return d.toISOString().replace('Z', '');
}

function handleEvent(eventType: string, event: Record<string, unknown>): void {
  const payload     = event.payload as Record<string, unknown> | undefined;
  const subEntity   = (payload?.subscription as Record<string, unknown> | undefined)?.entity as Record<string, unknown> | undefined;
  const payEntity   = (payload?.payment as Record<string, unknown> | undefined)?.entity as Record<string, unknown> | undefined;

  if (!subEntity) {
    console.warn(`[webhook] No subscription entity in event: ${eventType}`);
    return;
  }

  const subId      = subEntity.id as string;
  const notes      = (subEntity.notes ?? {}) as Record<string, string>;
  const plan       = notes.plan as PaidPlan | undefined;
  const billing    = notes.billing as BillingCycle | undefined;
  const currentEnd = subEntity.current_end as number | undefined;

  switch (eventType) {
    // ------------------------------------------------------------------
    // subscription.activated
    // Backup activation path — /verify is primary. Only fires if the
    // browser died between payment and the verify call.
    // ------------------------------------------------------------------
    case 'subscription.activated': {
      const userId = notes.user_id;
      if (!userId || !plan || !billing) {
        console.warn('[webhook] subscription.activated — missing notes:', notes);
        return;
      }

      // Idempotent — skip if /verify already activated it
      const existing = userRepo.findBySubscriptionId(subId);
      if (existing?.subscription_status === 'active') {
        console.log(`[webhook] subscription.activated already active — skip: ${subId}`);
        return;
      }

      const expiresAt = currentEnd ? unixToUtcString(currentEnd) : fallbackExpiry(billing);
      userRepo.updateSubscription(userId, subId, 'active', plan, expiresAt);
      console.log(`[webhook] subscription.activated: user=${userId} plan=${plan}/${billing} expires=${expiresAt}`);
      break;
    }

    // ------------------------------------------------------------------
    // subscription.charged
    // Fired on every successful payment (first AND recurring).
    // This is the authoritative event for extending plan_expires_at.
    // ------------------------------------------------------------------
    case 'subscription.charged': {
      const user = userRepo.findBySubscriptionId(subId);
      if (!user) {
        console.warn(`[webhook] subscription.charged — unknown sub: ${subId}`);
        return;
      }

      const effectivePlan    = (plan    ?? user.plan)   as PaidPlan;
      const effectiveBilling = (billing ?? 'monthly')   as BillingCycle;
      const expiresAt        = currentEnd ? unixToUtcString(currentEnd) : fallbackExpiry(effectiveBilling);

      userRepo.updateSubscription(user.id, subId, 'active', effectivePlan, expiresAt);

      // Audit-log the payment
      const paymentId   = payEntity?.id as string | undefined;
      const amountPaise = (payEntity?.amount as number | undefined)
        ?? PLAN_AMOUNTS[planKey(effectivePlan, effectiveBilling)];

      try {
        const existing = paymentRepo.findByOrderId(subId);
        if (!existing) {
          paymentRepo.create(user.id, subId, effectivePlan, effectiveBilling, amountPaise);
        }
        if (paymentId) paymentRepo.markPaid(subId, paymentId, expiresAt);
      } catch (err) {
        console.error('[webhook] Failed to log payment record:', err);
      }

      // Send confirmation + invoice emails (fire-and-forget)
      const amountInr   = Math.round(amountPaise / 100);
      const nextRenewal = new Date(expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      void sendPaymentConfirmationEmail(user.email, user.name, effectivePlan, amountInr, nextRenewal)
        .catch(err => console.error('[webhook] confirmation email failed:', err));

      // Also send invoice PDF email on renewal
      void (async () => {
        try {
          const payRec = paymentRepo.findByOrderId(subId);
          if (payRec) {
            const billingDetails = userRepo.getBillingDetails(user.id);
            const buyer = { name: user.name, email: user.email, billingDetails };
            const pdfData = {
              id: payRec.id, plan: payRec.plan, billing: payRec.billing,
              amount: payRec.amount, paidAt: payRec.paid_at, expiresAt: payRec.expires_at,
            };
            const rcpt = buildReceiptBuffer(pdfData, buyer);
            const inv  = buildInvoiceBuffer(pdfData, buyer);
            await sendInvoiceEmail(user.email, user.name, effectivePlan, rcpt, inv, payRec.id);
          }
        } catch (err) {
          console.error('[webhook] invoice email failed:', err);
        }
      })();

      console.log(`[webhook] subscription.charged: user=${user.id} plan=${effectivePlan}/${effectiveBilling} expires=${expiresAt}`);
      break;
    }

    // ------------------------------------------------------------------
    // subscription.halted
    // Razorpay halts after 3 failed retries. Notify the user.
    // ------------------------------------------------------------------
    case 'subscription.halted': {
      const user = userRepo.findBySubscriptionId(subId);
      if (!user) return;
      userRepo.updateSubscriptionStatus(subId, 'halted');
      void sendSubscriptionHaltedEmail(user.email, user.name, user.plan)
        .catch(err => console.error('[webhook] halted email failed:', err));
      console.log(`[webhook] subscription.halted: user=${user.id} sub=${subId}`);
      break;
    }

    // ------------------------------------------------------------------
    // subscription.cancelled / subscription.completed
    // ------------------------------------------------------------------
    case 'subscription.cancelled':
    case 'subscription.completed': {
      const status = eventType === 'subscription.cancelled' ? 'cancelled' : 'completed';
      userRepo.updateSubscriptionStatus(subId, status);
      console.log(`[webhook] ${eventType}: sub=${subId}`);
      break;
    }

    default:
      console.log(`[webhook] Unhandled event type: ${eventType}`);
  }
}

// ---------------------------------------------------------------------------
// POST /api/webhooks/razorpay
// ---------------------------------------------------------------------------
router.post('/razorpay', (req: Request, res: Response) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[webhook] RAZORPAY_WEBHOOK_SECRET not configured');
    res.status(503).json({ error: 'Webhook not configured' });
    return;
  }

  // req.body is a Buffer because this route is mounted with express.raw()
  const rawBody = req.body as Buffer;
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    res.status(400).json({ error: 'Empty or invalid body' });
    return;
  }

  const signature = req.headers['x-razorpay-signature'];
  if (typeof signature !== 'string') {
    res.status(400).json({ error: 'Missing X-Razorpay-Signature header' });
    return;
  }

  // HMAC-SHA256 verification
  const expectedSig = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  const expected = Buffer.from(expectedSig, 'hex');
  const received = Buffer.from(signature,   'hex');
  const valid = expected.length === received.length && crypto.timingSafeEqual(expected, received);

  if (!valid) {
    console.warn('[webhook] Signature mismatch — possible spoofing attempt');
    res.status(400).json({ error: 'Signature verification failed' });
    return;
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const eventType = event.event as string;
  console.log(`[webhook] Received: ${eventType}`);

  // Handle synchronously (better-sqlite3 is sync; emails are fire-and-forget).
  // Return 500 on DB errors so Razorpay retries; emails don't affect retry logic.
  try {
    handleEvent(eventType, event);
  } catch (err) {
    console.error(`[webhook] Error handling ${eventType}:`, err);
    res.status(500).json({ error: 'Event processing failed' });
    return;
  }

  res.json({ received: true });
});

export default router;
