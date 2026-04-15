import crypto from 'crypto';
import db from '../index.js';

export type PaymentStatus = 'created' | 'paid' | 'failed';
export type PlanType = 'pro' | 'enterprise';
export type BillingCycle = 'monthly' | 'yearly';

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
}

const stmts = {
  create: db.prepare(`
    INSERT INTO payments (id, user_id, razorpay_order_id, plan, billing, amount, currency, status)
    VALUES (?, ?, ?, ?, ?, ?, 'INR', 'created')
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
};

export const paymentRepo = {
  create(
    userId: string,
    razorpayOrderId: string,
    plan: PlanType,
    billing: BillingCycle,
    amountPaise: number,
  ): PaymentRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(id, userId, razorpayOrderId, plan, billing, amountPaise);
    return this.findByOrderId(razorpayOrderId)!;
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
};
