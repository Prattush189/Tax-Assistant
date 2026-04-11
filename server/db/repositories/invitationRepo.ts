import crypto from 'crypto';
import db from '../index.js';

/**
 * Repository for team invitations on the enterprise plan. Tokens are stored
 * as sha256 hashes — the plaintext is only returned once on create (so the
 * UI can show a "copy link" for phone-only invites). Each invitation has
 * an explicit expiry; `expireStale()` can be called periodically to clean.
 */

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface InvitationRow {
  id: string;
  inviter_user_id: string;
  email: string | null;
  phone: string | null;
  invite_token_hash: string;
  status: InvitationStatus;
  accepted_user_id: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export function hashInviteToken(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

export function generateInviteToken(): { plaintext: string; hash: string } {
  const plaintext = crypto.randomBytes(32).toString('base64url');
  const hash = hashInviteToken(plaintext);
  return { plaintext, hash };
}

const stmts = {
  create: db.prepare(
    "INSERT INTO invitations (id, inviter_user_id, email, phone, invite_token_hash, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now', '+5 hours', '+30 minutes', '+' || ? || ' seconds'))"
  ),
  findById: db.prepare('SELECT * FROM invitations WHERE id = ?'),
  findByTokenHash: db.prepare('SELECT * FROM invitations WHERE invite_token_hash = ?'),
  listByInviter: db.prepare(
    'SELECT * FROM invitations WHERE inviter_user_id = ? ORDER BY created_at DESC'
  ),
  countPending: db.prepare(
    "SELECT COUNT(*) as n FROM invitations WHERE inviter_user_id = ? AND status = 'pending' AND expires_at > datetime('now', '+5 hours', '+30 minutes')"
  ),
  revoke: db.prepare(
    "UPDATE invitations SET status = 'revoked' WHERE id = ? AND status = 'pending'"
  ),
  markAccepted: db.prepare(
    "UPDATE invitations SET status = 'accepted', accepted_user_id = ?, accepted_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  expireStale: db.prepare(
    "UPDATE invitations SET status = 'expired' WHERE status = 'pending' AND expires_at <= datetime('now', '+5 hours', '+30 minutes')"
  ),
  deleteById: db.prepare('DELETE FROM invitations WHERE id = ?'),
};

export const invitationRepo = {
  create(
    inviterId: string,
    email: string | null,
    phone: string | null,
    tokenHash: string,
    ttlSeconds: number,
  ): InvitationRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(id, inviterId, email, phone, tokenHash, String(ttlSeconds));
    return stmts.findById.get(id) as InvitationRow;
  },

  findById(id: string): InvitationRow | undefined {
    return stmts.findById.get(id) as InvitationRow | undefined;
  },

  findByTokenHash(tokenHash: string): InvitationRow | undefined {
    return stmts.findByTokenHash.get(tokenHash) as InvitationRow | undefined;
  },

  listByInviter(inviterId: string): InvitationRow[] {
    return stmts.listByInviter.all(inviterId) as InvitationRow[];
  },

  countPending(inviterId: string): number {
    return (stmts.countPending.get(inviterId) as { n: number }).n;
  },

  /** Returns true if a pending row was marked revoked. */
  revoke(id: string): boolean {
    return stmts.revoke.run(id).changes > 0;
  },

  markAccepted(id: string, acceptedUserId: string): void {
    stmts.markAccepted.run(acceptedUserId, id);
  },

  expireStale(): void {
    stmts.expireStale.run();
  },

  deleteById(id: string): void {
    stmts.deleteById.run(id);
  },
};
