/**
 * Stops "delete account → sign up again" from resetting the free plan.
 *
 * Free credits are a lifetime budget and the free trial runs from
 * users.created_at, both keyed to the account id. Deleting the account
 * and signing up again (same email, or a +tag / dotted Gmail variant)
 * used to produce a brand-new id with 0 used and a fresh 30-day trial —
 * one user did it six times on 2026-09-16.
 *
 * On self-deletion of a free account we keep a tombstone: a SHA-256 of
 * the normalised email, the original signup time and the weighted
 * tokens used. When that email signs up again, the new account inherits
 * both — created_at is set back to the first signup (trial clock) and
 * the used tokens are re-logged as one `carryover` usage row (credit
 * budget). Only the hash is stored, never the address.
 */
import crypto from 'crypto';
import db from '../db/index.js';
import type { UserRow } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { getUsagePeriodStart } from './planLimits.js';

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/** Collapse the variants one inbox accepts: case, `+tag`, and for Gmail
 *  the dots in the local part (and googlemail.com). */
export function normalizeEmailForAbuse(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at <= 0) return e;
  let local = e.slice(0, at).split('+')[0];
  let domain = e.slice(at + 1);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

export function emailAbuseHash(email: string): string {
  return crypto.createHash('sha256').update('email:' + normalizeEmailForAbuse(email)).digest('hex');
}

const stmts = {
  insert: db.prepare(
    'INSERT INTO deleted_account_usage (email_hash, first_created_at, used_weighted) VALUES (?, ?, ?)',
  ),
  lookup: db.prepare(
    'SELECT MIN(first_created_at) AS first_created_at, MAX(used_weighted) AS used_weighted, COUNT(*) AS n FROM deleted_account_usage WHERE email_hash = ?',
  ),
  setCreatedAt: db.prepare('UPDATE users SET created_at = ? WHERE id = ?'),
  carryoverRow: db.prepare(`
    INSERT INTO api_usage (ip, user_id, billing_user_id, input_tokens, output_tokens, cost, is_plugin, model, search_used, category, status, weighted_tokens)
    VALUES ('carryover', ?, ?, 0, 0, 0, 0, 'carryover', 0, 'carryover', 'success', ?)
  `),
};

/** Only self-billed, non-plugin free accounts carry a budget worth
 *  protecting; paid customers and team members are not the abuse path. */
function isProtectedFreeAccount(user: UserRow): boolean {
  return user.plan === 'free' && !user.inviter_id && !user.plugin_plan && !user.external_id && user.role !== 'admin';
}

/** Call immediately BEFORE deleting an account the user asked to delete. */
export function recordDeletedAccount(user: UserRow): void {
  if (!isProtectedFreeAccount(user) || !user.email) return;
  const used = usageRepo.sumTokensSinceForBillingUser(user.id, getUsagePeriodStart(user));
  stmts.insert.run(emailAbuseHash(user.email), user.created_at, Math.max(0, Math.round(used)));
}

/** Call right after creating a self-signup account, BEFORE issuing the
 *  signup license (which is dated from created_at). Returns the user
 *  as it now stands. */
export function applyDeletedAccountCarryover(user: UserRow): UserRow {
  const prior = stmts.lookup.get(emailAbuseHash(user.email)) as
    { first_created_at: string | null; used_weighted: number | null; n: number };
  if (!prior.n || !prior.first_created_at) return user;

  const createdAt = prior.first_created_at < user.created_at ? prior.first_created_at : user.created_at;
  const used = prior.used_weighted ?? 0;
  db.transaction(() => {
    stmts.setCreatedAt.run(createdAt, user.id);
    if (used > 0) stmts.carryoverRow.run(user.id, user.id, used);
  })();
  console.log(`[deletedAccountGuard] re-signup of a deleted free account (${prior.n} prior) — trial from ${createdAt}, ${used} weighted tokens carried over`);
  return { ...user, created_at: createdAt };
}
