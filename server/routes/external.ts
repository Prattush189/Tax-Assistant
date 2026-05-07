/**
 * External API namespace — for sister apps (assist.smartbizin.com,
 * future integrations) calling into Tax-Assistant via /api/external/*.
 *
 * Auth: Bearer EXTKEY-… (validated by requireExternalApiKey middleware,
 * mounted at the router level). No user JWT, no session.
 *
 * Mirrors a subset of the /api/admin/* licensing endpoints but with
 * dealer attribution: assist authenticates dealers in its own UI and
 * passes a `dealer` claim in the body of write requests so the row
 * audit trail records who at the dealer side issued the license.
 *
 * Webhook out: when Razorpay activates a plan we POST to the key's
 * configured webhook_url so assist's dealer console reflects the
 * grant in real time. See lib/externalWebhook.ts.
 */

import { Router, Response, Request } from 'express';
import { requireExternalApiKey, type ExternalApiRequest } from '../middleware/externalApiKey.js';
import { userRepo, type BillingDetails } from '../db/repositories/userRepo.js';
import { licenseKeyRepo } from '../db/repositories/licenseKeyRepo.js';
import { paymentRepo, type PaymentMethod } from '../db/repositories/paymentRepo.js';
import { PLAN_AMOUNTS, planKey, MAX_DEALER_DISCOUNT_INCL_PAISE } from '../lib/razorpayPlans.js';
import type { PaidPlan } from '../lib/razorpayPlans.js';

const router = Router();
router.use(requireExternalApiKey);

interface DealerClaim {
  id?: string;
  name?: string;
  email?: string;
  location?: string;
}

/** Validate + canonicalise the dealer attribution from a request body.
 *  Required on write endpoints (issue, renew, revoke); rejects with
 *  400 if missing. Read endpoints can omit it. */
function parseDealer(value: unknown): DealerClaim | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const claim: DealerClaim = {};
  if (typeof v.id === 'string' && v.id.trim()) claim.id = v.id.trim();
  if (typeof v.name === 'string' && v.name.trim()) claim.name = v.name.trim();
  if (typeof v.email === 'string' && v.email.trim()) claim.email = v.email.trim().toLowerCase();
  if (typeof v.location === 'string' && v.location.trim()) claim.location = v.location.trim();
  // At minimum we need email or id to attribute the action — name + location alone are display-only.
  if (!claim.email && !claim.id) return null;
  return claim;
}

// ── Users ──────────────────────────────────────────────────────────────

// GET /api/external/users — minimal user list for the dealer console
// to drive its license-issuance form's user picker. Returns id, name,
// email, plan, license summary (key + expires_at + status).
router.get('/users', (_req: ExternalApiRequest, res: Response) => {
  const rows = userRepo.findAll();
  const enriched = rows.map(u => {
    const lic = licenseKeyRepo.loadActive(u.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      plan: u.plan,
      role: u.role,
      created_at: u.created_at,
      activeLicense: lic ? {
        key: lic.key,
        plan: lic.plan,
        status: lic.status,
        expires_at: lic.expires_at,
      } : null,
    };
  });
  res.json({ users: enriched });
});

// GET /api/external/users/:id/billing-prefill — billing + last
// payment method, same shape the admin endpoint returns.
router.get('/users/:id/billing-prefill', (req: ExternalApiRequest, res: Response) => {
  const user = userRepo.findById(req.params.id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  const billingDetails = userRepo.getBillingDetails(req.params.id);
  const lastOffline = paymentRepo.findLatestOfflineByUser(req.params.id);
  res.json({
    billingDetails: billingDetails ?? null,
    lastPaymentMethod: lastOffline?.payment_method ?? null,
    lastPaymentReference: lastOffline?.payment_reference ?? null,
  });
});

// ── Licenses ───────────────────────────────────────────────────────────

const VALID_PLANS = new Set(['pro', 'enterprise']);
const VALID_PAYMENT_METHODS = new Set<PaymentMethod>(['cash', 'cheque', 'neft', 'imps', 'upi', 'rtgs', 'card', 'other']);
const PAYMENT_METHODS_NEEDING_REFERENCE = new Set(['cheque', 'neft', 'imps', 'upi', 'rtgs']);

// GET /api/external/licenses?search=&plan=&status=&page=
router.get('/licenses', (req: ExternalApiRequest, res: Response) => {
  const search = typeof req.query.search === 'string' ? req.query.search : null;
  const plan = typeof req.query.plan === 'string' && req.query.plan ? req.query.plan : null;
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;
  const result = licenseKeyRepo.findAllForAdmin({ search, plan, status, limit, offset });
  res.json({ ...result, page, limit });
});

// POST /api/external/licenses
//   Body: same shape as POST /api/admin/licenses, plus required `dealer`.
router.post('/licenses', (req: ExternalApiRequest, res: Response) => {
  const { userId, plan, paymentMethod, paymentReference, amount, billingDetails, notes, dealer } = req.body ?? {};

  if (typeof userId !== 'string' || !userId) {
    res.status(400).json({ error: 'userId is required' }); return;
  }
  if (!VALID_PLANS.has(plan)) {
    res.status(400).json({ error: 'plan must be "pro" or "enterprise"' }); return;
  }
  if (!VALID_PAYMENT_METHODS.has(paymentMethod)) {
    res.status(400).json({ error: 'paymentMethod required (cash | cheque | neft | imps | upi | rtgs | card | other)' }); return;
  }
  if (PAYMENT_METHODS_NEEDING_REFERENCE.has(paymentMethod) && (!paymentReference || !String(paymentReference).trim())) {
    res.status(400).json({ error: `paymentReference required for ${paymentMethod}` }); return;
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    res.status(400).json({ error: 'amount (in paise) is required and must be a positive integer' }); return;
  }
  // Bound the paid amount: must be ≤ MRP (no overcharge) and ≥ MRP minus
  // the dealer discount cap (₹1,000 base = ₹1,180 incl. GST). Any value
  // below the floor is treated as a data-entry mistake; assist's UI also
  // enforces the same cap, this is the server-side guard.
  const mrpInclPaise = PLAN_AMOUNTS[planKey(plan as PaidPlan)];
  const minInclPaise = mrpInclPaise - MAX_DEALER_DISCOUNT_INCL_PAISE;
  if (amount > mrpInclPaise) {
    res.status(400).json({ error: `amount (${amount} paise) exceeds plan MRP (${mrpInclPaise} paise incl. GST)` }); return;
  }
  if (amount < minInclPaise) {
    res.status(400).json({ error: `amount (${amount} paise) is below the minimum allowed for this plan (${minInclPaise} paise; max dealer discount is ₹1,000 + GST)` }); return;
  }
  if (!billingDetails || typeof billingDetails !== 'object') {
    res.status(400).json({ error: 'billingDetails is required' }); return;
  }
  const bd = billingDetails as Record<string, unknown>;
  for (const field of ['name', 'addressLine1', 'city', 'state', 'pincode']) {
    if (typeof bd[field] !== 'string' || !(bd[field] as string).trim()) {
      res.status(400).json({ error: `billingDetails.${field} is required` }); return;
    }
  }
  const dealerClaim = parseDealer(dealer);
  if (!dealerClaim) {
    res.status(400).json({ error: 'dealer object required: { id?, name?, email, location? } — at least email or id must be set' }); return;
  }

  const targetUser = userRepo.findById(userId);
  if (!targetUser) { res.status(404).json({ error: 'User not found' }); return; }

  const startsAt = new Date();
  const expiresAt = new Date(startsAt);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  const startStr = startsAt.toISOString().replace('Z', '');
  const expStr = expiresAt.toISOString().replace('Z', '');

  const cleanBilling: BillingDetails = {
    name: String(bd.name).trim(),
    addressLine1: String(bd.addressLine1).trim(),
    addressLine2: typeof bd.addressLine2 === 'string' ? bd.addressLine2.trim() : undefined,
    city: String(bd.city).trim(),
    state: String(bd.state).trim(),
    pincode: String(bd.pincode).trim(),
    gstin: typeof bd.gstin === 'string' && bd.gstin.trim() ? bd.gstin.trim() : undefined,
  };
  try { userRepo.setBillingDetails(userId, cleanBilling); }
  catch (err) { console.warn('[external/licenses] failed to persist billing details:', err); }

  let paymentRowId: string | null = null;
  try {
    const offlineOrderId = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    paymentRepo.create(
      userId, offlineOrderId, plan, 'yearly', amount,
      paymentMethod as PaymentMethod,
      typeof paymentReference === 'string' && paymentReference.trim() ? paymentReference.trim() : null,
    );
    paymentRepo.markPaid(offlineOrderId, `offline_pay_${Date.now()}`, expStr);
    const created = paymentRepo.findByOrderId(offlineOrderId);
    paymentRowId = created?.id ?? null;
    // Stamp dealer attribution on the payment row too — dealer
    // commission reports / dealer-by-dealer payment views read this.
    if (paymentRowId) {
      try { paymentRepo.setDealerAttribution(paymentRowId, dealerClaim); }
      catch (err) { console.warn('[external/licenses] failed to stamp dealer on payment:', err); }
    }
  } catch (err) {
    console.error('[external/licenses] payment row create failed:', err);
  }

  const license = licenseKeyRepo.issue({
    userId,
    plan: plan as 'pro' | 'enterprise',
    startsAt: startStr,
    expiresAt: expStr,
    generatedVia: 'offline',
    paymentId: paymentRowId,
    issuedByAdminId: null,
    issuedNotes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
    issuedByDealer: dealerClaim,
  });

  res.json({
    license,
    paymentId: paymentRowId,
    invoiceUrl: paymentRowId ? `/api/external/payments/${paymentRowId}/invoice.pdf` : null,
    receiptUrl: paymentRowId ? `/api/external/payments/${paymentRowId}/receipt.pdf` : null,
  });
});

// POST /api/external/licenses/:id/renew  body: { durationMonths?, dealer }
router.post('/licenses/:id/renew', (req: ExternalApiRequest, res: Response) => {
  const months = parseInt(String(req.body?.durationMonths ?? '12'), 10);
  if (!Number.isFinite(months) || months < 1 || months > 60) {
    res.status(400).json({ error: 'durationMonths must be 1..60' }); return;
  }
  const dealerClaim = parseDealer(req.body?.dealer);
  if (!dealerClaim) {
    res.status(400).json({ error: 'dealer required' }); return;
  }
  const existing = licenseKeyRepo.findById(req.params.id);
  if (!existing) { res.status(404).json({ error: 'License not found' }); return; }
  if (existing.plan === 'admin') {
    res.status(400).json({ error: 'Admin licenses don\'t expire and cannot be renewed' }); return;
  }
  const startsAt = new Date();
  const expiresAt = new Date(startsAt);
  expiresAt.setMonth(expiresAt.getMonth() + months);
  const license = licenseKeyRepo.issue({
    userId: existing.user_id,
    plan: existing.plan as 'free' | 'pro' | 'enterprise',
    startsAt: startsAt.toISOString().replace('Z', ''),
    expiresAt: expiresAt.toISOString().replace('Z', ''),
    generatedVia: 'offline',
    issuedByAdminId: null,
    issuedNotes: `Renewed from ${existing.key} for ${months} month(s) via dealer console`,
    issuedByDealer: dealerClaim,
  });
  res.json({ license });
});

// POST /api/external/licenses/:id/revoke  body: { reason?, dealer }
router.post('/licenses/:id/revoke', (req: ExternalApiRequest, res: Response) => {
  const dealerClaim = parseDealer(req.body?.dealer);
  if (!dealerClaim) {
    res.status(400).json({ error: 'dealer required' }); return;
  }
  const existing = licenseKeyRepo.findById(req.params.id);
  if (!existing) { res.status(404).json({ error: 'License not found' }); return; }
  const baseReason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 400) : 'Revoked';
  const reason = `${baseReason} (via dealer ${dealerClaim.email ?? dealerClaim.id})`;
  licenseKeyRepo.revoke(req.params.id, reason);
  if (existing.status === 'active' && existing.plan !== 'admin' && existing.plan !== 'free') {
    userRepo.updatePlan(existing.user_id, 'free');
  }
  res.json({ success: true });
});

// ── Payments ───────────────────────────────────────────────────────────

router.get('/payments', (req: ExternalApiRequest, res: Response) => {
  const search = typeof req.query.search === 'string' ? req.query.search : null;
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;
  // Dealers only see successfully-paid rows. Abandoned/failed Razorpay
  // attempts (status='created' / 'failed') stay out of the dealer view.
  const { rows, total } = paymentRepo.findAllForAdmin({ search, limit, offset, paidOnly: true });
  res.json({ rows, total, page, limit });
});

router.get('/payments/:id/:kind(invoice|receipt).pdf', async (req: ExternalApiRequest, res: Response) => {
  const { id, kind } = req.params as { id: string; kind: 'invoice' | 'receipt' };
  try {
    const pay = paymentRepo.findById(id);
    if (!pay) { res.status(404).json({ error: 'Payment not found' }); return; }
    const buyer = userRepo.findById(pay.user_id);
    if (!buyer) { res.status(404).json({ error: 'Payment user not found' }); return; }
    const billingDetails = userRepo.getBillingDetails(buyer.id);
    const { buildInvoiceBuffer, buildReceiptBuffer } = await import('../lib/serverPdf.js');
    const buildFn = kind === 'invoice' ? buildInvoiceBuffer : buildReceiptBuffer;
    const buffer = buildFn({
      id: pay.id, plan: pay.plan, billing: pay.billing,
      amount: pay.amount, paidAt: pay.paid_at, expiresAt: pay.expires_at,
      invoiceNumber: pay.invoice_number,
      paymentMethod: pay.payment_method,
      paymentReference: pay.payment_reference,
    }, { name: buyer.name ?? '', email: buyer.email ?? '', billingDetails });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${kind}-${pay.id}.pdf"`);
    res.send(buffer);
    return;
  } catch (err) {
    console.error(`[external/payments/${kind}.pdf] failed for ${id}:`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: `Failed to generate ${kind} PDF`, detail: (err as Error).message?.slice(0, 200) });
    }
    return;
  }
});

// Tiny health check so assist can ping the API key on startup.
router.get('/health', (_req: ExternalApiRequest, res: Response) => {
  res.json({ ok: true, service: 'tax-assistant' });
});

export default router;
