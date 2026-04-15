import crypto from 'crypto';
import db from '../index.js';

export interface UserRow {
  id: string;
  email: string;
  password: string;
  name: string;
  role: 'user' | 'admin';
  plan: 'free' | 'pro' | 'enterprise';
  suspended_until: string | null;
  google_id: string | null;
  external_id: string | null;
  plugin_plan: string | null;         // e.g. 'enterprise-shared' (not constrained by CHECK)
  plugin_limits: string | null;       // JSON — see server/lib/planLimits.ts
  plugin_role: string | null;         // 'consultant' | 'staff' | 'client'
  plugin_consultant_id: string | null;
  phone: string | null;               // digits-only, used for phone-login plugin users
  email_verified: number;             // 0 | 1 (SQLite has no bool)
  inviter_id: string | null;          // pool owner for shared-plan members
  itr_enabled: number;                // 0 | 1 — grants ITR tab without admin role
  session_token: string | null;       // random token per login — single-session enforcement
  plan_expires_at: string | null;           // ISO timestamp — paid plan expiry; NULL = no paid sub
  razorpay_subscription_id: string | null;  // active Razorpay subscription ID
  subscription_status: string | null;       // 'active' | 'halted' | 'cancelled' | 'completed' | null
  renewal_reminder_sent_at: string | null;  // last time 48hr reminder email was sent
  created_at: string;
  updated_at: string;
}

const stmts = {
  findByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  findById: db.prepare('SELECT * FROM users WHERE id = ?'),
  findByPhone: db.prepare('SELECT * FROM users WHERE phone = ?'),
  findByGoogleId: db.prepare('SELECT * FROM users WHERE google_id = ?'),
  findByExternalId: db.prepare('SELECT * FROM users WHERE external_id = ?'),
  findAll: db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM chats WHERE user_id = u.id) AS chat_count,
      (SELECT COUNT(*) FROM api_usage WHERE user_id = u.id) AS message_count,
      (SELECT MAX(created_at) FROM api_usage WHERE user_id = u.id) AS last_api_call
    FROM users u
    ORDER BY last_api_call IS NULL, last_api_call DESC, u.created_at DESC
  `),
  create: db.prepare(
    'INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)'
  ),
  updatePlan: db.prepare(
    "UPDATE users SET plan = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  updatePlanWithExpiry: db.prepare(
    "UPDATE users SET plan = ?, plan_expires_at = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  downgradePlanIfExpired: db.prepare(
    "UPDATE users SET plan = 'free', plan_expires_at = NULL, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND plan != 'free' AND plan_expires_at IS NOT NULL AND plan_expires_at < datetime('now', '+5 hours', '+30 minutes')"
  ),
  updateSubscription: db.prepare(
    "UPDATE users SET razorpay_subscription_id = ?, subscription_status = ?, plan = ?, plan_expires_at = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  updateSubscriptionStatus: db.prepare(
    "UPDATE users SET subscription_status = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE razorpay_subscription_id = ?"
  ),
  findBySubscriptionId: db.prepare(
    'SELECT * FROM users WHERE razorpay_subscription_id = ?'
  ),
  updateRenewalReminderSent: db.prepare(
    "UPDATE users SET renewal_reminder_sent_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  findDueForRenewalReminder: db.prepare(`
    SELECT * FROM users
    WHERE plan != 'free'
      AND plan_expires_at IS NOT NULL
      AND plan_expires_at > datetime('now', '+5 hours', '+30 minutes')
      AND plan_expires_at <= datetime('now', '+5 hours', '+30 minutes', '+48 hours')
      AND (renewal_reminder_sent_at IS NULL
           OR renewal_reminder_sent_at < datetime('now', '+5 hours', '+30 minutes', '-20 days'))
  `),
  updateRole: db.prepare(
    "UPDATE users SET role = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  suspend: db.prepare(
    "UPDATE users SET suspended_until = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  createFromGoogle: db.prepare(
    "INSERT INTO users (id, email, password, name, google_id, email_verified) VALUES (?, ?, '', ?, ?, 1)"
  ),
  linkGoogle: db.prepare(
    "UPDATE users SET google_id = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  createFromExternal: db.prepare(
    "INSERT INTO users (id, email, password, name, external_id, email_verified) VALUES (?, ?, '', ?, ?, 1)"
  ),
  linkExternalId: db.prepare(
    "UPDATE users SET external_id = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  updatePluginOverrides: db.prepare(
    "UPDATE users SET plugin_plan = ?, plugin_limits = ?, plugin_role = ?, plugin_consultant_id = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  // Phone + create-from-phone + email verified + inviter
  createFromPhone: db.prepare(
    "INSERT INTO users (id, email, password, name, phone, email_verified) VALUES (?, ?, ?, ?, ?, 0)"
  ),
  setPhone: db.prepare(
    "UPDATE users SET phone = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  markEmailVerified: db.prepare(
    "UPDATE users SET email_verified = 1, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  updateSessionToken: db.prepare(
    "UPDATE users SET session_token = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  setInviterId: db.prepare(
    "UPDATE users SET inviter_id = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  clearInviterIdById: db.prepare(
    "UPDATE users SET inviter_id = NULL, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  detachAllInviteesOfInviter: db.prepare(
    "UPDATE users SET inviter_id = NULL, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE inviter_id = ?"
  ),
  listInvitees: db.prepare(
    'SELECT id, email, name, phone, created_at FROM users WHERE inviter_id = ? ORDER BY created_at ASC'
  ),
  countInvitees: db.prepare('SELECT COUNT(*) as n FROM users WHERE inviter_id = ?'),
  setItrEnabled: db.prepare(
    "UPDATE users SET itr_enabled = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  updateEmail: db.prepare(
    "UPDATE users SET email = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  updatePassword: db.prepare(
    "UPDATE users SET password = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  updateName: db.prepare(
    "UPDATE users SET name = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  deleteById: db.prepare('DELETE FROM users WHERE id = ?'),
};

export const userRepo = {
  findByEmail(email: string): UserRow | undefined {
    return stmts.findByEmail.get(email.toLowerCase()) as UserRow | undefined;
  },

  findById(id: string): UserRow | undefined {
    return stmts.findById.get(id) as UserRow | undefined;
  },

  findAll(): (UserRow & { chat_count: number; message_count: number; last_api_call: string | null })[] {
    return stmts.findAll.all() as (UserRow & { chat_count: number; message_count: number; last_api_call: string | null })[];
  },

  create(email: string, hashedPassword: string, name: string): UserRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(id, email.toLowerCase(), hashedPassword, name);
    return this.findById(id)!;
  },

  updatePlan(id: string, plan: 'free' | 'pro' | 'enterprise'): void {
    stmts.updatePlan.run(plan, id);
  },

  /** Upgrade plan and set when it expires (used after Razorpay payment verified). */
  updatePlanWithExpiry(id: string, plan: 'pro' | 'enterprise', expiresAt: string): void {
    stmts.updatePlanWithExpiry.run(plan, expiresAt, id);
  },

  /**
   * Auto-downgrade user back to free if their paid plan has expired.
   * Safe to call on every request — only fires if truly expired.
   * Returns true if a downgrade actually happened.
   */
  downgradePlanIfExpired(id: string): boolean {
    const result = stmts.downgradePlanIfExpired.run(id);
    return result.changes > 0;
  },

  /** Set subscription ID, status, plan, and expiry atomically after Razorpay activation. */
  updateSubscription(
    id: string,
    subscriptionId: string,
    status: string,
    plan: 'pro' | 'enterprise',
    expiresAt: string,
  ): void {
    stmts.updateSubscription.run(subscriptionId, status, plan, expiresAt, id);
  },

  /** Update subscription_status by Razorpay subscription ID (used in webhooks). */
  updateSubscriptionStatus(razorpaySubscriptionId: string, status: string): void {
    stmts.updateSubscriptionStatus.run(status, razorpaySubscriptionId);
  },

  findBySubscriptionId(subscriptionId: string): UserRow | undefined {
    return stmts.findBySubscriptionId.get(subscriptionId) as UserRow | undefined;
  },

  markRenewalReminderSent(id: string): void {
    stmts.updateRenewalReminderSent.run(id);
  },

  findDueForRenewalReminder(): UserRow[] {
    return stmts.findDueForRenewalReminder.all() as UserRow[];
  },

  updateRole(id: string, role: 'user' | 'admin'): void {
    stmts.updateRole.run(role, id);
  },

  suspend(id: string, until: string | null): void {
    stmts.suspend.run(until, id);
  },

  findByGoogleId(googleId: string): UserRow | undefined {
    return stmts.findByGoogleId.get(googleId) as UserRow | undefined;
  },

  createFromGoogle(email: string, name: string, googleId: string): UserRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.createFromGoogle.run(id, email.toLowerCase(), name, googleId);
    return this.findById(id)!;
  },

  linkGoogle(userId: string, googleId: string): void {
    stmts.linkGoogle.run(googleId, userId);
  },

  findByExternalId(externalId: string): UserRow | undefined {
    return stmts.findByExternalId.get(externalId) as UserRow | undefined;
  },

  createFromExternal(email: string, name: string, externalId: string): UserRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.createFromExternal.run(id, email.toLowerCase(), name, externalId);
    return this.findById(id)!;
  },

  linkExternalId(userId: string, externalId: string): void {
    stmts.linkExternalId.run(externalId, userId);
  },

  /**
   * Persist parent-app plugin overrides (plan, limits, role, consultant_id).
   * Pass null for any field you want to clear.
   */
  updatePluginOverrides(
    userId: string,
    pluginPlan: string | null,
    pluginLimitsJson: string | null,
    pluginRole: string | null,
    pluginConsultantId: string | null,
  ): void {
    stmts.updatePluginOverrides.run(pluginPlan, pluginLimitsJson, pluginRole, pluginConsultantId, userId);
  },

  updateEmail(id: string, email: string): void {
    stmts.updateEmail.run(email.toLowerCase(), id);
  },

  updatePassword(id: string, hashedPassword: string): void {
    stmts.updatePassword.run(hashedPassword, id);
  },

  updateName(id: string, name: string): void {
    stmts.updateName.run(name, id);
  },

  deleteById(id: string): void {
    stmts.deleteById.run(id);
  },

  /* ---------- Phone login + identifier dispatch ------------------------ */

  findByPhone(phone: string): UserRow | undefined {
    return stmts.findByPhone.get(normalizePhone(phone)) as UserRow | undefined;
  },

  /**
   * Looks up by email if the identifier contains `@`, otherwise by phone.
   * Used by POST /api/auth/login which now accepts `{identifier, password}`.
   */
  findByIdentifier(identifier: string): UserRow | undefined {
    const id = identifier.trim();
    if (id.includes('@')) return this.findByEmail(id);
    return this.findByPhone(id);
  },

  setPhone(userId: string, phone: string): void {
    stmts.setPhone.run(normalizePhone(phone), userId);
  },

  /**
   * Creates a phone-only user using a synthetic `<digits>@phone.local` email
   * placeholder so the `email NOT NULL` constraint stays intact. Login skips
   * the email-verified check for these accounts.
   */
  createFromPhone(phone: string, hashedPassword: string, name: string): UserRow {
    const id = crypto.randomBytes(16).toString('hex');
    const digits = normalizePhone(phone);
    const syntheticEmail = `${digits}@phone.local`;
    stmts.createFromPhone.run(id, syntheticEmail, hashedPassword, name, digits);
    return this.findById(id)!;
  },

  /* ---------- Email verification + invite plumbing --------------------- */

  markEmailVerified(userId: string): void {
    stmts.markEmailVerified.run(userId);
  },

  setInviterId(userId: string, inviterId: string): void {
    stmts.setInviterId.run(inviterId, userId);
  },

  clearInviterId(userId: string): void {
    stmts.clearInviterIdById.run(userId);
  },

  /**
   * On enterprise→lower plan change, detach every user that was invited by
   * the given inviter. Historical usage rows keep their old billing_user_id
   * for audit; future writes now route to each user's own id via the billing
   * helper.
   */
  detachAllInvitees(inviterId: string): void {
    stmts.detachAllInviteesOfInviter.run(inviterId);
  },

  listInvitees(
    inviterId: string,
  ): Array<{ id: string; email: string; name: string; phone: string | null; created_at: string }> {
    return stmts.listInvitees.all(inviterId) as Array<{
      id: string;
      email: string;
      name: string;
      phone: string | null;
      created_at: string;
    }>;
  },

  countInvitees(inviterId: string): number {
    return (stmts.countInvitees.get(inviterId) as { n: number }).n;
  },

  /**
   * Toggle ITR tab access independently of admin role. Passing `true` grants
   * the ITR tab + access to the ITR API routes. Passing `false` revokes it.
   * See itrAccessMiddleware and server/scripts/grant-itr.ts.
   */
  setItrEnabled(userId: string, enabled: boolean): void {
    stmts.setItrEnabled.run(enabled ? 1 : 0, userId);
  },

  /**
   * Stamps a new random session token on the user row. All previously issued
   * JWTs that carry a different sessionToken become invalid because the
   * authMiddleware checks `jwt.sessionToken === user.session_token`.
   */
  rotateSessionToken(userId: string): string {
    const token = crypto.randomBytes(16).toString('hex');
    stmts.updateSessionToken.run(token, userId);
    return token;
  },
};

/**
 * Phone normalizer: strip all non-digit characters except a leading `+`.
 * Keeps the representation consistent so `9999999999`, `+91 99999 99999`,
 * and `(999) 999-9999` all hit the same row.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}
