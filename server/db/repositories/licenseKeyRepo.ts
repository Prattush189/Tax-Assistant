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

  /** Admin Licenses tab — paginated list with joined user metadata
   *  + optional filters. Status / plan filters are exact-match,
   *  search is case-insensitive substring across name / email / key. */
  findAllForAdmin(opts: {
    search?: string | null;
    plan?: string | null;
    status?: string | null;
    limit?: number;
    offset?: number;
  } = {}): {
    rows: Array<LicenseKeyRow & { user_name: string; user_email: string }>;
    total: number;
  } {
    const search = (opts.search ?? '').trim().toLowerCase() || null;
    const likeSearch = search ? `%${search}%` : null;
    const plan = opts.plan ?? null;
    const status = opts.status ?? null;
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const params = { search, likeSearch, plan, status, limit, offset };
    const rows = db.prepare(`
      SELECT lk.*, u.name AS user_name, u.email AS user_email
      FROM license_keys lk
      JOIN users u ON u.id = lk.user_id
      WHERE (@search IS NULL
        OR LOWER(u.name) LIKE @likeSearch
        OR LOWER(u.email) LIKE @likeSearch
        OR LOWER(lk.key) LIKE @likeSearch)
        AND (@plan IS NULL OR lk.plan = @plan)
        AND (@status IS NULL OR lk.status = @status)
      ORDER BY lk.created_at DESC
      LIMIT @limit OFFSET @offset
    `).all(params) as Array<LicenseKeyRow & { user_name: string; user_email: string }>;
    const { count } = db.prepare(`
      SELECT COUNT(*) AS count
      FROM license_keys lk
      JOIN users u ON u.id = lk.user_id
      WHERE (@search IS NULL
        OR LOWER(u.name) LIKE @likeSearch
        OR LOWER(u.email) LIKE @likeSearch
        OR LOWER(lk.key) LIKE @likeSearch)
        AND (@plan IS NULL OR lk.plan = @plan)
        AND (@status IS NULL OR lk.status = @status)
    `).get(params) as { count: number };
    return { rows, total: count };
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

  /**
   * Reconcile plan / license mismatches for users whose users.plan
   * was changed directly (admin DB edit, legacy plan-flip endpoint
   * before it was 410'd). Finds users where their active license's
   * plan doesn't match users.plan, then issues a new license matching
   * the current users.plan. The previous license is superseded inside
   * licenseKeyRepo.issue's transaction.
   *
   * Skips:
   *   - Admin users (their license is independent of plan).
   *   - Users without an active license (handled by backfillExistingUsers).
   *   - Users where users.plan == license.plan (already consistent).
   *
   * For mismatch cases, the new license starts NOW and expires 1 year
   * from now — matches the yearly Razorpay cadence, gives the user a
   * full paid period from the time the mismatch is fixed. Notes record
   * the original license key for the audit trail.
   *
   * Idempotent. Safe to run on every boot.
   */
  reconcilePlanMismatches(): { reconciled: number } {
    const mismatches = db.prepare(`
      SELECT u.id AS user_id, u.plan AS user_plan, u.role AS user_role,
             lk.id AS license_id, lk.key AS old_key, lk.plan AS license_plan
      FROM users u
      JOIN license_keys lk ON lk.id = u.license_key_id
      WHERE u.role != 'admin'
        AND lk.plan != 'admin'
        AND u.plan != lk.plan
    `).all() as Array<{
      user_id: string; user_plan: string; user_role: string | null;
      license_id: string; old_key: string; license_plan: string;
    }>;

    if (mismatches.length === 0) return { reconciled: 0 };

    let reconciled = 0;
    const startsAt = new Date();
    const expiresAt = new Date(startsAt);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    const startStr = startsAt.toISOString().replace('Z', '');
    const expStr = expiresAt.toISOString().replace('Z', '');

    for (const m of mismatches) {
      // Only reconcile to active billed plans. Anything else (e.g.
      // someone manually set plan='free' after a paid period) we
      // re-issue as a fresh FREE key with the standard 30-day window.
      const validPlans = new Set(['free', 'pro', 'enterprise']);
      if (!validPlans.has(m.user_plan)) {
        console.warn(`[license-reconcile] skipping user ${m.user_id} — unknown plan '${m.user_plan}'`);
        continue;
      }
      try {
        if (m.user_plan === 'free') {
          // Free reconciliation: 30-day window from now (treat as a
          // fresh free trial since the prior paid license is being
          // demoted intentionally).
          const freeExp = new Date(startsAt);
          freeExp.setDate(freeExp.getDate() + 30);
          this.issue({
            userId: m.user_id,
            plan: 'free',
            startsAt: startStr,
            expiresAt: freeExp.toISOString().replace('Z', ''),
            generatedVia: 'seed',
            issuedNotes: `Reconciled from ${m.old_key} (was ${m.license_plan}, users.plan='free')`,
          });
        } else {
          this.issue({
            userId: m.user_id,
            plan: m.user_plan as 'pro' | 'enterprise',
            startsAt: startStr,
            expiresAt: expStr,
            generatedVia: 'seed',
            issuedNotes: `Reconciled from ${m.old_key} (was ${m.license_plan}, users.plan='${m.user_plan}'). 1-year window from reconciliation date — adjust manually if the user's actual paid period differs.`,
          });
        }
        reconciled++;
      } catch (e) {
        console.error(`[license-reconcile] failed for user ${m.user_id}:`, (e as Error).message);
      }
    }

    if (reconciled > 0) {
      console.log(`[license-reconcile] re-issued licenses for ${reconciled} user(s) whose plan didn't match their license`);
    }
    return { reconciled };
  },
};
