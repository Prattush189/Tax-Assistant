/**
 * Public document-download route for payment proformas / invoices /
 * receipts, gated by a self-authenticating signed token.
 *
 * Route: GET /api/documents/:id/:kind(invoice|receipt|proforma).pdf?token=<jwt>
 *
 * Why this exists: the dealer console at assist.smartbizin.com hands
 * the documentUrl returned by /api/external/licenses to a browser's
 * "Download Proforma" button. Browsers can't safely attach the
 * server-side EXTKEY to a GET request, and they don't have the user's
 * Tax-Assistant JWT either, so neither /api/external/* nor
 * /api/admin/* is downloadable from a browser. This route accepts a
 * scoped, time-limited JWT in the URL — signed at license-creation
 * time, bound to (paymentId, kind), 30-day TTL — so the link works
 * out of the box.
 *
 * Mounted with NO middleware: signature verification IS the auth.
 */

import { Router, Request, Response } from 'express';
import { paymentRepo } from '../db/repositories/paymentRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { verifyDocumentDownloadToken } from '../lib/documentDownloadToken.js';

const router = Router();

router.get('/:id/:kind(invoice|receipt|proforma).pdf', async (req: Request, res: Response) => {
  const { id, kind } = req.params as { id: string; kind: 'invoice' | 'receipt' | 'proforma' };
  const token = typeof req.query.token === 'string' ? req.query.token : '';

  if (!verifyDocumentDownloadToken(token, id, kind)) {
    res.status(401).json({ error: 'Invalid or expired download token. Ask the dealer to re-issue the document link.' });
    return;
  }

  try {
    const pay = paymentRepo.findById(id);
    if (!pay) { res.status(404).json({ error: 'Payment not found' }); return; }
    const buyer = userRepo.findById(pay.user_id);
    if (!buyer) { res.status(404).json({ error: 'Payment user not found' }); return; }
    const isCash = pay.payment_method === 'cash';
    if (isCash && kind !== 'proforma') { res.status(404).json({ error: 'Cash payments only have a proforma — use /proforma.pdf' }); return; }
    if (!isCash && kind === 'proforma') { res.status(404).json({ error: 'Non-cash payments use tax invoice — use /invoice.pdf' }); return; }
    const billingDetails = userRepo.getBillingDetails(buyer.id);
    const { buildInvoiceBuffer, buildReceiptBuffer, buildProformaBuffer } = await import('../lib/serverPdf.js');
    const buildFn = kind === 'invoice' ? buildInvoiceBuffer : kind === 'receipt' ? buildReceiptBuffer : buildProformaBuffer;
    const buffer = buildFn({
      id: pay.id, plan: pay.plan, billing: pay.billing,
      amount: pay.amount, paidAt: pay.paid_at, expiresAt: pay.expires_at,
      invoiceNumber: pay.invoice_number,
      proformaNumber: pay.proforma_number,
      paymentMethod: pay.payment_method,
      paymentReference: pay.payment_reference,
    }, { name: buyer.name ?? '', email: buyer.email ?? '', billingDetails });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${kind}-${pay.id}.pdf"`);
    res.send(buffer);
    return;
  } catch (err) {
    console.error(`[documents/${kind}.pdf] failed for ${id}:`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: `Failed to generate ${kind} PDF`, detail: (err as Error).message?.slice(0, 200) });
    }
    return;
  }
});

export default router;
