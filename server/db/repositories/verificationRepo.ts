import crypto from 'crypto';
import db from '../index.js';

/**
 * Repository for `email_verification_codes`. Codes are stored as bcrypt
 * hashes so a DB leak does not expose the plaintext OTPs. Each row carries
 * an `attempts` counter and an `expires_at` timestamp.
 *
 * Caller contract:
 *   1. `createCode` stores a fresh hashed row (10-minute TTL recommended).
 *   2. `findActive(userId, purpose)` returns the newest unexpired,
 *      unconsumed row (if any).
 *   3. Compare the user-supplied code with bcrypt.compare in the route —
 *      this repo does not do the comparison so it stays async-free.
 *   4. On success call `markConsumed`. On failure call `incrementAttempts`.
 *   5. After 5 failed attempts the route treats the code as expired.
 */

export interface VerificationCodeRow {
  id: string;
  user_id: string;
  code_hash: string;
  purpose: 'signup' | 'resend' | 'reset';
  attempts: number;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

const stmts = {
  create: db.prepare(
    "INSERT INTO email_verification_codes (id, user_id, code_hash, purpose, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+5 hours', '+30 minutes', '+' || ? || ' seconds'))"
  ),
  findActive: db.prepare(
    "SELECT * FROM email_verification_codes WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > datetime('now', '+5 hours', '+30 minutes') ORDER BY created_at DESC LIMIT 1"
  ),
  incrementAttempts: db.prepare(
    'UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?'
  ),
  markConsumed: db.prepare(
    "UPDATE email_verification_codes SET consumed_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  latestCreatedAt: db.prepare(
    'SELECT MAX(created_at) as t FROM email_verification_codes WHERE user_id = ?'
  ),
  deleteExpired: db.prepare(
    "DELETE FROM email_verification_codes WHERE expires_at < datetime('now', '+5 hours', '+30 minutes', '-1 day')"
  ),
};

export const verificationRepo = {
  create(
    userId: string,
    purpose: 'signup' | 'resend' | 'reset',
    codeHash: string,
    ttlSeconds: number,
  ): VerificationCodeRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(id, userId, codeHash, purpose, String(ttlSeconds));
    return db
      .prepare('SELECT * FROM email_verification_codes WHERE id = ?')
      .get(id) as VerificationCodeRow;
  },

  findActive(userId: string, purpose: 'signup' | 'resend' | 'reset'): VerificationCodeRow | undefined {
    return stmts.findActive.get(userId, purpose) as VerificationCodeRow | undefined;
  },

  incrementAttempts(id: string): void {
    stmts.incrementAttempts.run(id);
  },

  markConsumed(id: string): void {
    stmts.markConsumed.run(id);
  },

  /**
   * ISO string of the most recent code created for this user. Used to
   * enforce a 60-second resend cooldown.
   */
  latestCreatedAt(userId: string): string | null {
    const row = stmts.latestCreatedAt.get(userId) as { t: string | null };
    return row?.t ?? null;
  },

  deleteExpired(): void {
    stmts.deleteExpired.run();
  },
};
