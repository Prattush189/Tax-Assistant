/**
 * Server-side source of truth for what a Razorpay order paid for.
 *
 * The plan and buyer are written into the ORDER's notes by
 * POST /api/payments/create-order, and only the server can write those.
 * Never trust a plan sent by the browser to /verify, or the notes on the
 * PAYMENT entity a webhook carries: the buyer can set payment notes from
 * the Checkout options, so an attacker could pay for Pro and claim
 * Enterprise.
 */
import Razorpay from 'razorpay';
import type { PaidPlan } from './razorpayPlans.js';

export function getRazorpay(): Razorpay {
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured');
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

export interface OrderPurchase {
  userId: string;
  plan: PaidPlan;
  /** Order amount in paise, as created (incl. GST). */
  amount: number;
}

/** Fetches the order from Razorpay and returns what it was created for, or
 *  null if it isn't one of ours (missing / unknown notes). Throws on network
 *  or API errors so callers can fail the request (and Razorpay retries a
 *  failed webhook). */
export async function fetchOrderPurchase(orderId: string): Promise<OrderPurchase | null> {
  const order = await getRazorpay().orders.fetch(orderId) as {
    amount?: number | string;
    notes?: Record<string, string | number> | unknown[];
  };
  const notes = (order.notes && !Array.isArray(order.notes) ? order.notes : {}) as Record<string, string | number>;
  const plan = notes.plan;
  const userId = notes.user_id;
  if ((plan !== 'pro' && plan !== 'enterprise') || typeof userId !== 'string' || !userId) return null;
  return { userId, plan, amount: Number(order.amount) || 0 };
}
