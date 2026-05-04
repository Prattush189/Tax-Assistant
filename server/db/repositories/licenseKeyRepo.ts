/**
 * License-key persistence + lifecycle.
 *
 * Every license grant — free trial, paid Razorpay plan, admin-issued
 * offline plan, admin role itself — lives in this table. Renewal
 * supersedes the previous row; revocation marks it inactive without
 * deletion. The audit trail is the point.
 */

import crypto from 'crypto';
import db from '../index.js';
import { generateLicenseKey, type LicensePlan } from '../../lib/licenseKey.js';

export type LicenseStatus = 'active' | 'expired' | 'revoked' | 'superseded';
export type LicenseGeneratedVia = 'razorpay' | 'offline' | 'seed' | 'free-signup' | 'admin-signup';

export interface LicenseKeyRow {
  id: string;
  key: string;
  user_id: string;
  plan: LicensePlan;
  starts_at: string;
  expires_at: string | null;
  status: LicenseStatus;
  generated_via: LicenseGeneratedVia;
  payment_id: string | null;
  issued_by_admin_id: string | null;
  issued_notes: string | null;
  superseded_by_id: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO license_keys (
      id, key, user_id, plan, starts_at, expires_at, status,
      generated_via, payment_id, issued_by_admin_id, issued_notes
    ) VALUES (
      @id, @key, @user_id, @plan, @starts_at, @expires_at, @status,
      @generated_via, @payment_id, @issued_by_admin_id, @issued_notes
    )
  `),
  findById: db.prepare('SELECT * FROM license_keys WHERE id = ?'),
  findByKey: db.prepare('SELECT * FROM license_keys WHERE key = ?'),
  listByUser: db.prepare('SELECT * FROM license_keys WHERE user_id = ? ORDER BY created_at DESC'),
  setUserActive: db.prepare('UPDATE users SET license_key_id = ? WHERE id = ?'),
  setUserPlan: db.prepare('UPDATE users SET plan = ?, updated_at = datetime(\'now\', \'+5 hours\', \'+30 minutes\') WHERE id = ?'),
  markSuperseded: db.prepare('UPDATE license_keys SET status = \'superseded\', superseded_by_id = ? WHERE id = ?'),
  markRevoked: db.prepare('UPDATE license_keys SET status = \'revoked\', revoked_at = datetime(\'now\', \'+5 hours\', \'+30 minutes\'), revoke_reason = ? WHERE id = ?'),
  loadActiveByUser: db.prepare(`
    SELECT lk.* FROM license_keys lk
    JOIN users u ON u.license_key_id = lk.id
    WHERE u.id = ?
      AND lk.status = 'active'
      AND (lk.expires_at IS NULL OR lk.expires_at > datetime('now', '+5 hours', '+30 minutes'))
  `),
  /** Free-fall users — those whose license just lapsed and need
   *  users.plan reset to 'free' so the gate sees them as free-tier
   *  immediately. Returns the user_ids to update. */
  expiredLicenseUsers: db.prepare(`
    SELECT u.id FROM users u
    JOIN license_keys lk ON lk.id = u.license_key_id
    WHERE lk.status = 'expired'
      AND lk.plan != 'free'
      AND lk.plan != 'admin'
      AND u.plan != 'free'
  `),
  expireBefore: db.prepare(`
    UPDATE license_keys
    SET status = 'expired'
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at < datetime('now', '+5 hours', '+30 minutes')
  `),
  countByPlan: db.prepare(`
    SELECT plan, COUNT(*) AS count
    FROM license_keys
    WHERE status = 'active'
    GROUP BY plan
  `),
};

interface IssueInput {
  userId: string;
  plan: LicensePlan;
  startsAt: string;
  expiresAt: string | null;
  generatedVia: LicenseGeneratedVia;
  paymentId?: string | null;
  issuedByAdminId?: string | null;
  issuedNotes?: string | null;
  /** Pre-generated key (for the rare backfill case where we want to
   *  reuse a string the caller already minted). Defaults to a fresh
   *  random key. */
  key?: string;
}

export const licenseKeyRepo = {
  /**
   * Issue a brand-new active license. Generates a unique key,
   * inserts the row, and points users.license_key_id at it. Marks
   * the user's previous active license as 'superseded' (if any).
   *
   * Wrapped in a transaction so a failed unique-constraint hit on
   * `key` (vanishingly rare) doesn't leave half-applied state.
   */
  issue(input: IssueInput): LicenseKeyRow {
    const id = crypto.randomUUID();
    let key = input.key ?? generateLicenseKey(input.plan);
    const tx = db.transaction((): LicenseKeyRow => {
      // Mark any current active license for this user as superseded
      // before inserting the new one. License "currentness" lives in
      // users.license_key_id, but we ALSO flip the row's status so
      // queries that scan license_keys directly see the right state.
      const current = db.prepare(`
        SELECT lk.id FROM license_keys lk
        JOIN users u ON u.license_key_id = lk.id
        WHERE u.id = ? AND lk.status = 'active'
      `).get(input.userId) as { id: string } | undefined;

      // Retry up to 3 times on the astronomically-unlikely unique-key
      // collision before giving up. crypto.randomInt is the source so
      // a real collision means the world ended.
      let attempt = 0;
      while (true) {
        try {
          stmts.insert.run({
            id,
            key,
            user_id: input.userId,
            plan: input.plan,
            starts_at: input.startsAt,
            expires_at: input.expiresAt,
            status: 'active',
            generated_via: input.generatedVia,
            payment_id: input.paymentId ?? null,
            issued_by_admin_id: input.issuedByAdminId ?? null,
            issued_notes: input.issuedNotes ?? null,
          });
          break;
        } catch (e) {
          if (++attempt >= 3) throw e;
          key = generateLicenseKey(input.plan);
        }
      }

      if (current) {
        stmts.markSuperseded.run(id, current.id);
      }
      stmts.setUserActive.run(id, input.userId);
      // Sync the denormalised users.plan cache with the license plan
      // so getEffectivePlan / getUserLimits keep working as pure
      // functions of the user row. Skip on ADMIN- keys: admin role
      // is independent of billing plan, and we don't want issuing
      // an admin license to overwrite an admin-user's underlying
      // 'enterprise' plan.
      if (input.plan !== 'admin') {
        stmts.setUserPlan.run(input.plan, input.userId);
      }
      return stmts.findById.get(id) as LicenseKeyRow;
    });
    return tx();
  },

  /** Returns the user's currently-active license (status='active' AND
   *  not yet past expires_at), or null if they have none. */
  loadActive(userId: string): LicenseKeyRow | null {
    return (stmts.loadActiveByUser.get(userId) as LicenseKeyRow | undefined) ?? null;
  },

  findById(id: string): LicenseKeyRow | null {
    return (stmts.findById.get(id) as LicenseKeyRow | undefined) ?? null;
  },
  findByKey(key: string): LicenseKeyRow | null {
    return (stmts.findByKey.get(key) as LicenseKeyRow | undefined) ?? null;
  },
  listByUser(userId: string): LicenseKeyRow[] {
    return stmts.listByUser.all(userId) as LicenseKeyRow[];
  },

  /** Mark a license as revoked. Caller is responsible for deciding
   *  whether the user gets a replacement. */
  revoke(id: string, reason: string): void {
    stmts.markRevoked.run(reason, id);
  },

  /** Sweep all licenses whose expires_at is in the past and flip
   *  their status to 'expired'. Also resets users.plan to 'free'
   *  for any user whose paid license just lapsed — keeps the
   *  denormalised plan column honest with the license source of
   *  truth, so the gate correctly demotes them on next request.
   *  Idempotent. Called on server boot and periodically by the
   *  renewal-reminder job. */
  expirePastDue(): void {
    stmts.expireBefore.run();
    const stranded = stmts.expiredLicenseUsers.all() as Array<{ id: string }>;
    for (const row of stranded) {
      stmts.setUserPlan.run('free', row.id);
    }
    if (stranded.length > 0) {
      console.log(`[license-keys] demoted ${stranded.length} user(s) to plan='free' after license expiry`);
    }
  },

  /** Active licenses by plan — for the admin Overview tile. */
  countActiveByPlan(): Record<string, number> {
    const rows = stmts.countByPlan.all() as Array<{ plan: string; count: number }>;
    return Object.fromEntries(rows.map(r => [r.plan, r.count]));
  },

  /**
   * Idempotent backfill — issues a license key for every user whose
   * license_key_id is still NULL. Mapping:
   *   role='admin'                                 → ADMIN-, no expiry
   *   plan='pro'/'enterprise' + plan_expires_at    → PRO-/ENT-, mirror existing expiry
   *   anything else (free / paid w/o expiry)       → FREE-, created_at + 30 days
   *
   * After issuing we run expirePastDue() so free users whose 30 days
   * already lapsed flip from 'active' to 'expired' — same effective
   * state as the old trial-wall behaviour.
   *
   * Called once on boot from server/index.ts. Safe to call repeatedly;
   * users already linked to a license skip.
   */
  backfillExistingUsers(): { issued: number; skipped: number } {
    const usersWithoutLicense = db.prepare(`
      SELECT id, role, plan, plan_expires_at, created_at
      FROM users
      WHERE license_key_id IS NULL
    `).all() as Array<{
      id: string;
      role: string | null;
      plan: string | null;
      plan_expires_at: string | null;
      created_at: string;
    }>;

    if (usersWithoutLicense.length === 0) return { issued: 0, skipped: 0 };

    let issued = 0;
    let skipped = 0;
    for (const u of usersWithoutLicense) {
      try {
        if (u.role === 'admin') {
          this.issue({
            userId: u.id,
            plan: 'admin',
            startsAt: u.created_at,
            expiresAt: null,
            generatedVia: 'seed',
            issuedNotes: 'Auto-generated by license-key backfill migration',
          });
        } else if ((u.plan === 'pro' || u.plan === 'enterprise') && u.plan_expires_at) {
          // Paid plans are yearly. Anchor starts_at one year before
          // expires_at; the gate only checks expires_at, but the
          // accurate starts_at keeps the audit trail honest.
          const expires = new Date(u.plan_expires_at);
          const starts = new Date(expires);
          starts.setFullYear(starts.getFullYear() - 1);
          this.issue({
            userId: u.id,
            plan: u.plan as 'pro' | 'enterprise',
            startsAt: starts.toISOString().replace('Z', ''),
            expiresAt: u.plan_expires_at,
            generatedVia: 'seed',
            issuedNotes: 'Auto-generated by license-key backfill from existing Razorpay subscription',
          });
        } else {
          const created = new Date(u.created_at);
          const trialEnd = new Date(created);
          trialEnd.setDate(trialEnd.getDate() + 30);
          this.issue({
            userId: u.id,
            plan: 'free',
            startsAt: u.created_at,
            expiresAt: trialEnd.toISOString().replace('Z', ''),
            generatedVia: 'seed',
            issuedNotes: 'Auto-generated by license-key backfill — 30-day free trial mirroring existing trial wall',
          });
        }
        issued++;
      } catch (e) {
        console.error(`[license-backfill] failed for user ${u.id}:`, (e as Error).message);
        skipped++;
      }
    }

    // Free users older than 30 days flip to 'expired' immediately —
    // same wall they hit before, just enforced via the new column.
    this.expirePastDue();

    console.log(`[license-backfill] issued ${issued} key(s), skipped ${skipped}`);
    return { issued, skipped };
  },
};
