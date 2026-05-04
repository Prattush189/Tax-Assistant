/**
 * High-level license-issuance helpers used by the auth and payment
 * routes. Wraps licenseKeyRepo.issue() with the right defaults for
 * each entry point so call sites stay one-liners.
 */

import { licenseKeyRepo } from '../db/repositories/licenseKeyRepo.js';
import type { LicensePlan } from './licenseKey.js';

/** Trial length for newly-signed-up free users (days). Mirrors the
 *  existing 30-day trial wall semantics so the move to license-keys
 *  is invisible to new users. */
const FREE_TRIAL_DAYS = 30;

/** Yearly window for paid plans. Matches plan_expires_at semantics
 *  on the users table (Razorpay charges yearly and extends by a
 *  year on each renewal). */
const PAID_PLAN_DAYS = 365;

function isoIst(d: Date): string {
  // Match the format used elsewhere for SQLite-friendly storage.
  return d.toISOString().replace('Z', '');
}

/**
 * Issue a FREE-plan license for a brand-new signup. Called from every
 * userRepo.create / createFromGoogle / createFromExternal /
 * createFromPhone / invitation-acceptance site so every user lands
 * with an active license from day one. Idempotent at the call site —
 * if the user already has a license_key_id this is a no-op (callers
 * pass a fresh user that just came back from userRepo.create()).
 */
export function issueSignupLicense(userId: string, createdAt: string): void {
  try {
    const start = new Date(createdAt);
    const end = new Date(start);
    end.setDate(end.getDate() + FREE_TRIAL_DAYS);
    licenseKeyRepo.issue({
      userId,
      plan: 'free',
      startsAt: isoIst(start),
      expiresAt: isoIst(end),
      generatedVia: 'free-signup',
      issuedNotes: `Auto-issued at signup, ${FREE_TRIAL_DAYS}-day free trial`,
    });
  } catch (e) {
    // License issuance shouldn't block signup. Log and continue —
    // the user can still be granted a license later via backfill or
    // admin tooling.
    console.error(`[issueSignupLicense] failed for user ${userId}:`, (e as Error).message);
  }
}

/**
 * Issue a PRO- or ENT- license after a successful Razorpay payment.
 * The new license supersedes any existing active license for the
 * user (handled inside licenseKeyRepo.issue's transaction). Called
 * from the /verify endpoint AFTER paymentRepo.markPaid so payment_id
 * resolves to the just-recorded row.
 */
export function issuePaymentLicense(input: {
  userId: string;
  plan: LicensePlan; // 'pro' | 'enterprise'
  paymentId: string;
  /** Optional explicit expiry (defaults to now + 1 year). Razorpay
   *  Subscription mode extends this on each charge cycle, but the
   *  one-shot Order flow needs a fixed expires_at on issuance. */
  expiresAt?: string;
}): void {
  try {
    if (input.plan !== 'pro' && input.plan !== 'enterprise') {
      console.warn(`[issuePaymentLicense] unexpected plan ${input.plan} — skipping`);
      return;
    }
    const start = new Date();
    const end = input.expiresAt ? new Date(input.expiresAt) : (() => {
      const e = new Date(start);
      e.setDate(e.getDate() + PAID_PLAN_DAYS);
      return e;
    })();
    licenseKeyRepo.issue({
      userId: input.userId,
      plan: input.plan,
      startsAt: isoIst(start),
      expiresAt: isoIst(end),
      generatedVia: 'razorpay',
      paymentId: input.paymentId,
      issuedNotes: `Auto-issued on Razorpay payment ${input.paymentId}`,
    });
  } catch (e) {
    console.error(`[issuePaymentLicense] failed for user ${input.userId}:`, (e as Error).message);
  }
}
