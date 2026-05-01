/**
 * Renewal reminder job.
 *
 * Runs hourly. Queries users whose paid plan expires within 48 hours and who
 * haven't received a reminder in the last 20 days, then sends them a reminder
 * email via SMTP2GO.
 *
 * Call startRenewalReminderJob() once in server/index.ts after DB is ready.
 */

import { userRepo } from '../db/repositories/userRepo.js';
import { paymentRepo } from '../db/repositories/paymentRepo.js';
import { sendRenewalReminderEmail } from '../lib/mailer.js';
import { PLAN_AMOUNTS, planKey } from '../lib/razorpayPlans.js';
import type { PaidPlan, BillingCycle } from '../lib/razorpayPlans.js';

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function runRenewalReminders(): Promise<void> {
  const users = userRepo.findDueForRenewalReminder();
  if (users.length === 0) return;

  console.log(`[renewalReminder] Sending reminders to ${users.length} user(s)`);

  for (const user of users) {
    try {
      const plan = user.plan as PaidPlan;

      // Yearly is the only supported billing cycle now. Legacy payment
      // rows may still carry billing='monthly' but are treated as yearly
      // for renewal-amount display purposes.
      const lastPayment = paymentRepo.findLatestPaidByUser(user.id);
      const billing: BillingCycle = 'yearly';
      const amountPaise = lastPayment?.amount ?? PLAN_AMOUNTS[planKey(plan, billing)];
      const amountInr   = Math.round(amountPaise / 100);

      const renewalDate = user.plan_expires_at
        ? new Date(user.plan_expires_at).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'long', year: 'numeric',
          })
        : 'soon';

      await sendRenewalReminderEmail(user.email, user.name, plan, renewalDate, amountInr);
      userRepo.markRenewalReminderSent(user.id);
      console.log(`[renewalReminder] Sent to user=${user.id} (${user.email}) plan=${plan}/${billing}`);
    } catch (err) {
      console.error(`[renewalReminder] Failed for user=${user.id}:`, err);
    }
  }
}

export function startRenewalReminderJob(): void {
  // Run once at startup, then every hour
  void runRenewalReminders().catch(err => console.error('[renewalReminder] Startup run failed:', err));
  setInterval(() => void runRenewalReminders().catch(err => console.error('[renewalReminder] Run failed:', err)), INTERVAL_MS);
  console.log('[renewalReminder] Job started (runs hourly)');
}
