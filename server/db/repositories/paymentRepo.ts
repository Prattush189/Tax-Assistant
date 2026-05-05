import crypto from 'crypto';
import db from '../index.js';

export type PaymentStatus = 'created' | 'paid' | 'failed';
export type PlanType = 'pro' | 'enterprise';
export type BillingCycle = 'monthly' | 'yearly';
/** How the user paid. 'razorpay' is implied for online flows
 *  (Razorpay's own ids identify the channel). The admin's offline
 *  license issuance flow asks for one of the alternative methods
 *  + a free-text reference (cheque number, NEFT UTR, etc.). */
export type PaymentMethod = 'razorpay' | 'cash' | 'cheque' | 'neft' | 'imps' | 'upi' | 'rtgs' | 'card' | 'other';

export interface PaymentRow {
  id: string;
  user_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  plan: PlanType;
  billing: BillingCycle;
  amount: number;       // in paise
  currency: string;
  status: PaymentStatus;
  created_at: string;
  paid_at: string | null;
  expires_at: string | null;
  payment_method: PaymentMethod | null;
  payment_reference: string | null;
}

const stmts = {
  create: db.prepare(`
    INSERT INTO payments (id, user_id, razorpay_order_id, plan, billing, amount, currency, status, payment_method, payment_reference)
    VALUES (?, ?, ?, ?, ?, ?, 'INR', 'created', ?, ?)
  `),
  findByOrderId: db.prepare(
    'SELECT * FROM payments WHERE razorpay_order_id = ?'
  ),
  findByUserId: db.prepare(
    'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC'
  ),
  markPaid: db.prepare(`
    UPDATE payments
    SET status = 'paid',
        razorpay_payment_id = ?,
        paid_at = datetime('now', '+5 hours', '+30 minutes'),
        expires_at = ?
    WHERE razorpay_order_id = ?
  `),
  markFailed: db.prepare(`
    UPDATE payments SET status = 'failed' WHERE razorpay_order_id = ?
  `),
  findLatestPaidByUser: db.prepare(`
    SELECT * FROM payments
    WHERE user_id = ? AND status = 'paid'
    ORDER BY paid_at DESC
    LIMIT 1
  `),
  findById: db.prepare('SELECT * FROM payments WHERE id = ?'),
  /** Admin Payments tab: paginated list with optional case-insensitive
   *  search on user name / email / order id. */
  findAllForAdmin: db.prepare(`
    SELECT p.*, u.name AS user_name, u.email AS user_email, u.billing_details AS billing_details
    FROM payments p
    JOIN users u ON u.id = p.user_id
    WHERE (
      @search IS NULL
      OR LOWER(u.name) LIKE @likeSearch
      OR LOWER(u.email) LIKE @likeSearch
      OR LOWER(p.razorpay_order_id) LIKE @likeSearch
      OR LOWER(p.razorpay_payment_id) LIKE @likeSearch
    )
    ORDER BY p.created_at DESC
    LIMIT @limit OFFSET @offset
  `),
  countAllForAdmin: db.prepare(`
    SELECT COUNT(*) AS count
    FROM payments p
    JOIN users u ON u.id = p.user_id
    WHERE (
      @search IS NULL
      OR LOWER(u.name) LIKE @likeSearch
      OR LOWER(u.email) LIKE @likeSearch
      OR LOWER(p.razorpay_order_id) LIKE @likeSearch
      OR LOWER(p.razorpay_payment_id) LIKE @likeSearch
    )
  `),
};

export const paymentRepo = {
  create(
    userId: string,
    razorpayOrderId: string,
    plan: PlanType,
    billing: BillingCycle,
    amountPaise: number,
    paymentMethod: PaymentMethod | null = null,
    paymentReference: string | null = null,
  ): PaymentRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(id, userId, razorpayOrderId, plan, billing, amountPaise, paymentMethod, paymentReference);
    return this.findByOrderId(razorpayOrderId)!;
  },

  /** Most-recent offline payment for a user — used to pre-fill the
   *  Generate License dialog on subsequent issuances so admins don't
   *  re-type the method/reference for the same dealer / user every
   *  renewal. Razorpay rows are filtered out because the method is
   *  always 'razorpay' there and irrelevant to the offline form. */
  findLatestOfflineByUser(userId: string): PaymentRow | undefined {
    return db.prepare(`
      SELECT * FROM payments
      WHERE user_id = ?
        AND payment_method IS NOT NULL
        AND payment_method != 'razorpay'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(userId) as PaymentRow | undefined;
  },

  findByOrderId(orderId: string): PaymentRow | undefined {
    return stmts.findByOrderId.get(orderId) as PaymentRow | undefined;
  },

  findByUserId(userId: string): PaymentRow[] {
    return stmts.findByUserId.all(userId) as PaymentRow[];
  },

  findLatestPaidByUser(userId: string): PaymentRow | undefined {
    return stmts.findLatestPaidByUser.get(userId) as PaymentRow | undefined;
  },

  markPaid(orderId: string, paymentId: string, expiresAt: string): void {
    stmts.markPaid.run(paymentId, expiresAt, orderId);
  },

  markFailed(orderId: string): void {
    stmts.markFailed.run(orderId);
  },

  findById(id: string): PaymentRow | undefined {
    return stmts.findById.get(id) as PaymentRow | undefined;
  },

  /** Admin Payments tab — paginated list with joined user metadata
   *  (name, email, billing_details JSON). Returns rows + total
   *  count for pagination. */
  findAllForAdmin(opts: { search?: string | null; limit?: number; offset?: number } = {}): {
    rows: Array<PaymentRow & { user_name: string; user_email: string; billing_details: string | null }>;
    total: number;
  } {
    const search = (opts.search ?? '').trim().toLowerCase() || null;
    const likeSearch = search ? `%${search}%` : null;
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const rows = stmts.findAllForAdmin.all({ search, likeSearch, limit, offset }) as Array<
      PaymentRow & { user_name: string; user_email: string; billing_details: string | null }
    >;
    const { count } = stmts.countAllForAdmin.get({ search, likeSearch }) as { count: number };
    return { rows, total: count };
  },
};
