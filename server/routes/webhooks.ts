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
 *   payment.captured — backup activation path (primary is POST /api/payments/verify)
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { userRepo } from '../db/repositories/userRepo.js';
import { paymentRepo } from '../db/repositories/paymentRepo.js';
import { issuePaymentLicense } from '../lib/issueLicense.js';
import { PLAN_AMOUNTS, planKey } from '../lib/razorpayPlans.js';
import type { PaidPlan } from '../lib/razorpayPlans.js';
import {
  sendPaymentConfirmationEmail,
  sendInvoiceEmail,
} from '../lib/mailer.js';
import { licenseKeyRepo } from '../db/repositories/licenseKeyRepo.js';
import { fanoutEvent } from '../lib/externalWebhook.js';

const router = Router();

function fallbackExpiry(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().replace('Z', '');
}

function handleEvent(eventType: string, event: Record<string, unknown>): void {
  const payload    = event.payload as Record<string, unknown> | undefined;
  const payEntity  = (payload?.payment as Record<string, unknown> | undefined)?.entity as Record<string, unknown> | undefined;

  switch (eventType) {
    // ------------------------------------------------------------------
    // payment.captured
    // Backup activation path — /verify is primary. Only fires if the
    // browser died between payment and the verify call.
    // ------------------------------------------------------------------
    case 'payment.captured': {
      if (!payEntity) {
        console.warn(`[webhook] No payment entity in event: ${eventType}`);
        return;
      }

      const orderId   = payEntity.order_id as string | undefined;
      const paymentId = payEntity.id as string | undefined;
      const notes     = (payEntity.notes ?? {}) as Record<string, string>;
      const userId    = notes.user_id;
      const plan      = notes.plan as PaidPlan | undefined;

      if (!orderId || !paymentId || !userId || !plan) {
        console.warn('[webhook] payment.captured — missing fields:', { orderId, paymentId, userId, plan });
        return;
      }

      // Idempotent — skip if /verify already activated it
      const existingPayment = paymentRepo.findByOrderId(orderId);
      if (existingPayment?.status === 'paid') {
        console.log(`[webhook] payment.captured already activated — skip: ${orderId}`);
        return;
      }

      const expiresAt = fallbackExpiry();
      userRepo.updateSubscription(userId, orderId, 'active', plan, expiresAt);

      const amountPaise = (payEntity.amount as number | undefined)
        ?? PLAN_AMOUNTS[planKey(plan, 'yearly')];

      let paymentRowId: string | null = null;
      try {
        const existing = paymentRepo.findByOrderId(orderId);
        if (!existing) {
          paymentRepo.create(userId, orderId, plan, 'yearly', amountPaise, 'razorpay');
        }
        paymentRepo.markPaid(orderId, paymentId, expiresAt);
        paymentRowId = paymentRepo.findByOrderId(orderId)?.id ?? null;
      } catch (err) {
        console.error('[webhook] Failed to log payment record:', err);
      }

      // Issue the license. Webhook may fire before /verify (or at all
      // if the user closed the tab on Razorpay's success page), so
      // this is the canonical issuance path. /verify also issues
      // licenses but is short-circuited above when the row already
      // shows status='paid' — the unique-key + supersede semantics
      // in licenseKeyRepo.issue prevent double-issue if both fire.
      if (paymentRowId) {
        issuePaymentLicense({ userId, plan, paymentId: paymentRowId, expiresAt });
        try {
          const license = licenseKeyRepo.loadActive(userId);
          const payment = paymentRepo.findById(paymentRowId);
          const userRow = userRepo.findById(userId);
          if (license) {
            fanoutEvent({
              event: 'license.issued',
              license: license as unknown as Record<string, unknown>,
              payment: (payment as unknown as Record<string, unknown>) ?? null,
              user: userRow ? { id: userRow.id, name: userRow.name, email: userRow.email, plan: userRow.plan } : null,
            });
          }
        } catch (e) { console.warn('[webhook] external fanout failed:', (e as Error).message); }
      }

      const user = userRepo.findById(userId);
      if (user) {
        const amountInr    = Math.round(amountPaise / 100);
        const nextRenewal  = new Date(expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
        void sendPaymentConfirmationEmail(user.email, user.name, plan, amountInr, nextRenewal)
          .catch(err => console.error('[webhook] confirmation email failed:', err));

        void (async () => {
          try {
            const payRec = paymentRepo.findByOrderId(orderId);
            if (payRec) {
              const billingDetails = userRepo.getBillingDetails(userId);
              const buyer = { name: user.name, email: user.email, billingDetails };
              const pdfData = {
                id: payRec.id, plan: payRec.plan, billing: payRec.billing,
                amount: payRec.amount, paidAt: payRec.paid_at, expiresAt: payRec.expires_at,
              };
              const { buildReceiptBuffer, buildInvoiceBuffer } = await import('../lib/serverPdf.js');
              const rcpt = buildReceiptBuffer(pdfData, buyer);
              const inv  = buildInvoiceBuffer(pdfData, buyer);
              await sendInvoiceEmail(user.email, user.name, plan, rcpt, inv, payRec.id);
            }
          } catch (err) {
            console.error('[webhook] invoice email failed:', err);
          }
        })();
      }

      console.log(`[webhook] payment.captured: user=${userId} plan=${plan} expires=${expiresAt}`);
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
