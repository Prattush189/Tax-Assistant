/**
 * Shared-pool billing resolver.
 *
 * When an enterprise-plan user invites others, all members draw from the
 * inviter's quota. Every limit-check and usage-log in the server must call
 * `getBillingUserId(req.user)` to find the pool owner and count/write
 * against that id — NEVER against `req.user.id` (that's the audit/actor).
 *
 * Authorization queries (findByUserId etc.) must still scope to the actor.
 * The shared pool only affects the limit counters.
 */
import db from '../db/index.js';
import type { UserRow } from '../db/repositories/userRepo.js';

/** Max members per enterprise pool (inviter + up to 9 invitees). */
export const SEAT_CAP = 10;

export type BillingUserInput = Pick<UserRow, 'id' | 'inviter_id'> | {
  id: string;
  inviter_id?: string | null;
};

/**
 * Returns the user id whose quota this user consumes from. If the user was
 * invited by someone, returns that inviter's id. Otherwise returns the user's
 * own id.
 */
export function getBillingUserId(user: BillingUserInput): string {
  const inviterId = (user as { inviter_id?: string | null }).inviter_id;
  return inviterId ?? user.id;
}

/**
 * Returns a UserRow subset for the billing owner — useful when a route
 * needs to resolve limits via planLimits.getUserLimits for the pool rather
 * than the actor.
 */
export function getBillingUser(user: UserRow): UserRow {
  if (!user.inviter_id) return user;
  const inviter = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(user.inviter_id) as UserRow | undefined;
  // Fallback: if the inviter row somehow vanished, bill to self.
  return inviter ?? user;
}

/**
 * Seat accounting for a given inviter. `accepted` includes the inviter
 * themselves. `pending` is open invitations (not revoked/expired/accepted).
 */
export function countSeats(inviterId: string): {
  accepted: number;
  pending: number;
  total: number;
} {
  const accepted =
    (db.prepare('SELECT COUNT(*) as n FROM users WHERE inviter_id = ?').get(inviterId) as {
      n: number;
    }).n + 1; // +1 for the inviter themselves
  const pending = (db
    .prepare(
      "SELECT COUNT(*) as n FROM invitations WHERE inviter_user_id = ? AND status = 'pending' AND expires_at > datetime('now', '+5 hours', '+30 minutes')",
    )
    .get(inviterId) as { n: number }).n;
  return { accepted, pending, total: accepted + pending };
}

/**
 * Can this user invite others? Only enterprise standalones (not invited
 * themselves — chain-block) qualify.
 */
export function canInvite(user: UserRow): boolean {
  if (user.inviter_id) return false; // chain-block: invitees never invite
  return user.plan === 'enterprise' || user.plugin_plan === 'enterprise';
}
