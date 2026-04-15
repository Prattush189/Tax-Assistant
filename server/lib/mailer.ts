/**
 * SMTP2GO REST API mailer — load-safe, follows the grok.ts pattern.
 *
 * Uses the v3 email send endpoint rather than SMTP so the only config we
 * need is an API key + a from address. The endpoint accepts JSON with the
 * api_key in the body.
 *
 * If SMTP2GO_API_KEY is missing the module still loads (no throw) but
 * `mailerConfigured` is false and every send returns `{ ok: false }`.
 * Callers (signup, invitations, password reset) must check and surface 503.
 *
 * Required env vars:
 *   SMTP2GO_API_KEY   (api-... opaque token issued by smtp2go.com)
 *   SMTP2GO_FROM      (verified sender, e.g. "no-reply@assist.smartbizin.com"
 *                     or "Smartbiz AI <no-reply@assist.smartbizin.com>")
 *
 * APP_URL is also required for invitation accept links; that one is read by
 * server/routes/invitations.ts, not here.
 */

const API_URL = 'https://api.smtp2go.com/v3/email/send';

const SMTP2GO_API_KEY = process.env.SMTP2GO_API_KEY ?? '';
const SMTP2GO_FROM = process.env.SMTP2GO_FROM ?? 'no-reply@assist.smartbizin.com';

export const mailerConfigured = Boolean(SMTP2GO_API_KEY);

if (!mailerConfigured) {
  console.warn(
    '[mailer] SMTP2GO_API_KEY is not set — signup OTP + invite emails will fail until it is configured',
  );
} else {
  console.log(`[mailer] SMTP2GO API configured (from: ${SMTP2GO_FROM})`);
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendMailResult {
  ok: boolean;
  error?: string;
}

/**
 * Never throws. Returns `{ ok: false, error }` on any failure so callers
 * can respond with 503 cleanly. Uses the global fetch available in Node 18+.
 */
export async function sendMail(opts: SendMailInput): Promise<SendMailResult> {
  if (!mailerConfigured) {
    return { ok: false, error: 'Email service not configured' };
  }
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: SMTP2GO_API_KEY,
        to: [opts.to],
        sender: SMTP2GO_FROM,
        subject: opts.subject,
        html_body: opts.html,
        text_body: opts.text,
      }),
    });
    // v3 returns 200 with { data: { succeeded, failed, ... } } — check both.
    // Any 4xx/5xx or `failed > 0` counts as failure.
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      const msg = `SMTP2GO API ${res.status}: ${bodyText.slice(0, 200)}`;
      console.error('[mailer]', msg);
      return { ok: false, error: msg };
    }
    const body = (await res.json().catch(() => null)) as
      | { data?: { succeeded?: number; failed?: number; error?: string } }
      | null;
    const succeeded = body?.data?.succeeded ?? 0;
    const failed = body?.data?.failed ?? 0;
    if (succeeded === 0 || failed > 0) {
      const msg = body?.data?.error ?? `SMTP2GO reported ${failed} failure(s) / ${succeeded} success`;
      console.error('[mailer]', msg);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[mailer] sendMail failed:', msg);
    return { ok: false, error: msg };
  }
}

/**
 * Sends a 6-digit OTP for signup verification. Short subject with the code
 * up front so it reads clearly in notification previews.
 */
export async function sendOtpEmail(to: string, code: string): Promise<SendMailResult> {
  const subject = `${code} is your Smartbiz AI verification code`;
  const text =
    `Your Smartbiz AI verification code is: ${code}\n\n` +
    `This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.`;
  const html = `
<!doctype html><html><body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #111827;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 18px; font-weight: 600; color: #0D9668; margin: 0;">Smartbiz AI</h1>
  </div>
  <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 12px;">Verify your email</h2>
  <p style="font-size: 14px; line-height: 1.6; color: #4b5563; margin: 0 0 24px;">
    Enter this code to finish creating your Smartbiz AI account. It expires in 10 minutes.
  </p>
  <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; text-align: center; padding: 20px; background: #ecfdf5; color: #065f46; border-radius: 12px; margin: 0 0 24px;">
    ${code}
  </div>
  <p style="font-size: 12px; color: #9ca3af; margin: 0;">
    If you didn't request this, you can safely ignore this email.
  </p>
</body></html>`.trim();
  return sendMail({ to, subject, html, text });
}

/**
 * Sends a 6-digit OTP for a password reset request. Separate template so the
 * copy is appropriate ("reset" not "verify").
 */
export async function sendPasswordResetEmail(to: string, code: string): Promise<SendMailResult> {
  const subject = `${code} is your Smartbiz AI password reset code`;
  const text =
    `Your Smartbiz AI password reset code is: ${code}\n\n` +
    `This code expires in 10 minutes. If you didn't request a password reset, you can safely ignore this email — your password will not change.`;
  const html = `
<!doctype html><html><body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #111827;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 18px; font-weight: 600; color: #0D9668; margin: 0;">Smartbiz AI</h1>
  </div>
  <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 12px;">Reset your password</h2>
  <p style="font-size: 14px; line-height: 1.6; color: #4b5563; margin: 0 0 24px;">
    Someone requested a password reset for your Smartbiz AI account. Enter the code below to choose a new password. It expires in 10 minutes.
  </p>
  <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; text-align: center; padding: 20px; background: #ecfdf5; color: #065f46; border-radius: 12px; margin: 0 0 24px;">
    ${code}
  </div>
  <p style="font-size: 12px; color: #9ca3af; margin: 0;">
    If you didn't request this, you can safely ignore this email — your password will not change.
  </p>
</body></html>`.trim();
  return sendMail({ to, subject, html, text });
}

/**
 * Sends an invitation link so a new or existing user can join the inviter's
 * shared enterprise plan. The acceptUrl carries an opaque token in the query
 * string — handled by the /?invite=... route in App.tsx.
 */
export async function sendInviteEmail(
  to: string,
  acceptUrl: string,
  inviterName: string,
): Promise<SendMailResult> {
  const subject = `${inviterName} invited you to Smartbiz AI`;
  const text =
    `${inviterName} has invited you to join their Smartbiz AI team.\n\n` +
    `Accept the invitation here:\n${acceptUrl}\n\n` +
    `This link expires in 7 days.`;
  const html = `
<!doctype html><html><body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #111827;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 18px; font-weight: 600; color: #0D9668; margin: 0;">Smartbiz AI</h1>
  </div>
  <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 12px;">You've been invited</h2>
  <p style="font-size: 14px; line-height: 1.6; color: #4b5563; margin: 0 0 24px;">
    <strong>${escapeHtml(inviterName)}</strong> invited you to join their Smartbiz AI team. Click the button below
    to accept and create your account.
  </p>
  <div style="text-align: center; margin: 0 0 24px;">
    <a href="${acceptUrl}" style="display: inline-block; padding: 12px 24px; background: #0D9668; color: white; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 14px;">
      Accept invitation
    </a>
  </div>
  <p style="font-size: 12px; color: #9ca3af; margin: 0 0 8px;">
    Or paste this URL into your browser:
  </p>
  <p style="font-size: 12px; color: #4b5563; word-break: break-all; margin: 0 0 24px;">
    ${acceptUrl}
  </p>
  <p style="font-size: 12px; color: #9ca3af; margin: 0;">
    This invitation expires in 7 days. If you didn't expect this, you can safely ignore this email.
  </p>
</body></html>`.trim();
  return sendMail({ to, subject, html, text });
}

/**
 * Sent ~48 hours before a subscription renews so the user can update their
 * payment method or cancel if they no longer need the plan.
 */
export async function sendRenewalReminderEmail(
  to: string,
  name: string,
  plan: string,
  renewalDate: string,
  amountInr: number,
): Promise<SendMailResult> {
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
  const subject   = `Your Smartbiz AI ${planLabel} plan renews in 48 hours`;
  const text =
    `Hi ${name},\n\n` +
    `This is a reminder that your Smartbiz AI ${planLabel} plan will automatically renew on ${renewalDate} for ₹${amountInr.toLocaleString('en-IN')}.\n\n` +
    `If you'd like to make changes or cancel, log in and visit the Plan section.\n\n` +
    `Smartbiz AI Team`;
  const html = `
<!doctype html><html><body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #111827;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 18px; font-weight: 600; color: #0D9668; margin: 0;">Smartbiz AI</h1>
  </div>
  <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 12px;">Upcoming renewal in 48 hours</h2>
  <p style="font-size: 14px; line-height: 1.6; color: #4b5563; margin: 0 0 16px;">
    Hi ${escapeHtml(name)},
  </p>
  <p style="font-size: 14px; line-height: 1.6; color: #4b5563; margin: 0 0 24px;">
    Your <strong>${escapeHtml(planLabel)} plan</strong> will automatically renew on
    <strong>${escapeHtml(renewalDate)}</strong> for
    <strong>₹${amountInr.toLocaleString('en-IN')}</strong>.
  </p>
  <div style="background: #f9fafb; border-radius: 12px; padding: 16px; margin: 0 0 24px;">
    <p style="margin: 0; font-size: 14px; color: #6b7280;">
      To update your payment method or cancel, visit the <strong>Plan</strong> section in your account.
    </p>
  </div>
  <p style="font-size: 12px; color: #9ca3af; margin: 0;">
    If you have any questions, reply to this email. — Smartbiz AI Team
  </p>
</body></html>`.trim();
  return sendMail({ to, subject, html, text });
}

/**
 * Sent when Razorpay halts a subscription after repeated payment failures.
 */
export async function sendSubscriptionHaltedEmail(
  to: string,
  name: string,
  plan: string,
): Promise<SendMailResult> {
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
  const subject   = `Action needed — Smartbiz AI ${planLabel} payment failed`;
  const text =
    `Hi ${name},\n\n` +
    `We were unable to process payment for your Smartbiz AI ${planLabel} plan. Your subscription has been paused.\n\n` +
    `Please update your payment method by logging in and visiting the Plan section. Once updated, your subscription will resume automatically.\n\n` +
    `Smartbiz AI Team`;
  const html = `
<!doctype html><html><body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #111827;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 18px; font-weight: 600; color: #0D9668; margin: 0;">Smartbiz AI</h1>
  </div>
  <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 12px; color: #dc2626;">Payment failed — action needed</h2>
  <p style="font-size: 14px; line-height: 1.6; color: #4b5563; margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
  <p style="font-size: 14px; line-height: 1.6; color: #4b5563; margin: 0 0 24px;">
    We were unable to process payment for your <strong>${escapeHtml(planLabel)} plan</strong>.
    Your subscription has been paused and access will be limited until payment is resolved.
  </p>
  <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px; margin: 0 0 24px;">
    <p style="margin: 0; font-size: 14px; color: #dc2626; font-weight: 600;">
      Please update your payment method in the Plan section to restore full access.
    </p>
  </div>
  <p style="font-size: 12px; color: #9ca3af; margin: 0;">
    If you have questions, reply to this email. — Smartbiz AI Team
  </p>
</body></html>`.trim();
  return sendMail({ to, subject, html, text });
}

/**
 * Sent immediately after a successful subscription payment (first charge or renewal).
 */
export async function sendPaymentConfirmationEmail(
  to: string,
  name: string,
  plan: string,
  amountInr: number,
  nextRenewalDate: string,
): Promise<SendMailResult> {
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
  const subject   = `Payment confirmed — Smartbiz AI ${planLabel}`;
  const text =
    `Hi ${name},\n\n` +
    `Your payment of ₹${amountInr.toLocaleString('en-IN')} for the ${planLabel} plan has been received.\n\n` +
    `Your plan is now active and will renew on ${nextRenewalDate}.\n\n` +
    `Smartbiz AI Team`;
  const html = `
<!doctype html><html><body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #111827;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 18px; font-weight: 600; color: #0D9668; margin: 0;">Smartbiz AI</h1>
  </div>
  <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 12px;">Payment confirmed</h2>
  <p style="font-size: 14px; line-height: 1.6; color: #4b5563; margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
  <p style="font-size: 14px; line-height: 1.6; color: #4b5563; margin: 0 0 24px;">
    Your payment of <strong>₹${amountInr.toLocaleString('en-IN')}</strong> for the
    <strong>${escapeHtml(planLabel)} plan</strong> has been received. Your plan is now active.
  </p>
  <div style="background: #ecfdf5; border-radius: 12px; padding: 16px; margin: 0 0 24px;">
    <p style="margin: 0 0 4px; font-size: 13px; color: #065f46; font-weight: 600;">Next renewal</p>
    <p style="margin: 0; font-size: 14px; color: #059669;">${escapeHtml(nextRenewalDate)}</p>
  </div>
  <p style="font-size: 12px; color: #9ca3af; margin: 0;">
    To manage or cancel your subscription, visit the Plan section. — Smartbiz AI Team
  </p>
</body></html>`.trim();
  return sendMail({ to, subject, html, text });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
