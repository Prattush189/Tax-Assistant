/**
 * Per-user active-session store.
 *
 * Each row = one logged-in device (browser, mobile, plugin) holding
 * a JWT issued by the auth routes. The JWT carries `sessionToken`,
 * which is matched against this table on every authenticated request
 * by the auth middleware. Logging out, "Sign out of all other
 * devices", and explicit per-device revoke from Settings all reduce
 * to deletes on this table.
 *
 * Concurrent-session cap: 5 per user. On the 6th login, the oldest
 * session (by last_seen_at) is evicted FIFO so the new login always
 * succeeds without surfacing a "you've reached the device limit"
 * error — the eviction is silent and the displaced device gets a
 * "session expired" message the next time it talks to the server.
 * Five was chosen as the right floor for a CA practice: laptop +
 * phone + tablet + office-desk + spare/borrowed = 5 realistic
 * devices; anything beyond is almost always credential sharing the
 * product shouldn't encourage.
 */

import crypto from 'crypto';
import db from '../index.js';

export const MAX_SESSIONS_PER_USER = 5;

export interface UserSessionRow {
  id: string;
  user_id: string;
  session_token: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO user_sessions (id, user_id, session_token, user_agent, ip)
    VALUES (?, ?, ?, ?, ?)
  `),
  findByToken: db.prepare('SELECT * FROM user_sessions WHERE session_token = ?'),
  findByIdForUser: db.prepare('SELECT * FROM user_sessions WHERE id = ? AND user_id = ?'),
  listForUser: db.prepare(`
    SELECT * FROM user_sessions
    WHERE user_id = ?
    ORDER BY last_seen_at DESC
  `),
  countForUser: db.prepare('SELECT COUNT(*) as n FROM user_sessions WHERE user_id = ?'),
  // Eviction: oldest by last_seen_at. We delete N rows where N =
  // count - MAX_SESSIONS_PER_USER. Sub-select returns the IDs to
  // delete; the outer DELETE applies. Using a sub-select (not LIMIT
  // on DELETE) because SQLite's LIMIT on DELETE requires a compile
  // flag that's off in better-sqlite3's default build.
  evictOldestForUser: db.prepare(`
    DELETE FROM user_sessions
    WHERE id IN (
      SELECT id FROM user_sessions
      WHERE user_id = ?
      ORDER BY last_seen_at ASC
      LIMIT ?
    )
  `),
  // Best-effort last_seen_at refresh. Called from the auth middleware
  // on every authenticated request. We rate-limit ourselves to one
  // write per minute per session (the WHERE clause is the rate
  // limiter — if last_seen_at is within the last 60s, the UPDATE is
  // a no-op). Without this guard a single chat session would write
  // hundreds of times per minute as messages stream.
  touch: db.prepare(`
    UPDATE user_sessions
       SET last_seen_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE session_token = ?
       AND last_seen_at < datetime('now', '+5 hours', '+30 minutes', '-60 seconds')
  `),
  deleteByIdForUser: db.prepare(
    'DELETE FROM user_sessions WHERE id = ? AND user_id = ?'
  ),
  deleteByToken: db.prepare('DELETE FROM user_sessions WHERE session_token = ?'),
  deleteAllOtherForUser: db.prepare(
    'DELETE FROM user_sessions WHERE user_id = ? AND session_token != ?'
  ),
  deleteAllForUser: db.prepare('DELETE FROM user_sessions WHERE user_id = ?'),
};

export const userSessionRepo = {
  /**
   * Create a new session row for a fresh login. Returns the random
   * session_token to embed in the JWT. Evicts the oldest session if
   * the user is now over the per-user cap so the cap is always
   * enforced even under concurrent logins.
   */
  create(userId: string, userAgent: string | null, ip: string | null): string {
    const id = crypto.randomBytes(16).toString('hex');
    const sessionToken = crypto.randomBytes(24).toString('hex');
    stmts.insert.run(id, userId, sessionToken, userAgent?.slice(0, 500) ?? null, ip?.slice(0, 64) ?? null);
    // After insert, check count. Evict oldest if over the cap. Done
    // post-insert so the cap is enforced atomically even when two
    // concurrent logins land — better-sqlite3 is synchronous so
    // this is single-threaded per process; multi-process would
    // need a transaction, not relevant here.
    const count = (stmts.countForUser.get(userId) as { n: number }).n;
    if (count > MAX_SESSIONS_PER_USER) {
      const toEvict = count - MAX_SESSIONS_PER_USER;
      const result = stmts.evictOldestForUser.run(userId, toEvict);
      if (result.changes > 0) {
        console.log(`[userSessionRepo] evicted ${result.changes} oldest session(s) for user ${userId} (cap=${MAX_SESSIONS_PER_USER})`);
      }
    }
    return sessionToken;
  },

  /** Fast lookup used by auth middleware to validate a JWT's session token. */
  findByToken(sessionToken: string): UserSessionRow | null {
    const row = stmts.findByToken.get(sessionToken) as UserSessionRow | undefined;
    return row ?? null;
  },

  findByIdForUser(id: string, userId: string): UserSessionRow | null {
    const row = stmts.findByIdForUser.get(id, userId) as UserSessionRow | undefined;
    return row ?? null;
  },

  listForUser(userId: string): UserSessionRow[] {
    return stmts.listForUser.all(userId) as UserSessionRow[];
  },

  /** Bump last_seen_at if it's been ≥60s. Best-effort; never throws. */
  touch(sessionToken: string): void {
    try { stmts.touch.run(sessionToken); }
    catch (e) { console.warn('[userSessionRepo] touch failed:', (e as Error).message); }
  },

  /** Revoke a single session by id (used by the Settings UI). */
  deleteByIdForUser(id: string, userId: string): boolean {
    return stmts.deleteByIdForUser.run(id, userId).changes > 0;
  },

  /** Revoke by session token (used by client-side logout). */
  deleteByToken(sessionToken: string): boolean {
    return stmts.deleteByToken.run(sessionToken).changes > 0;
  },

  /** "Sign out of all other devices" — keeps the current session,
   *  drops every other session for this user. */
  deleteAllOtherForUser(userId: string, keepSessionToken: string): number {
    return stmts.deleteAllOtherForUser.run(userId, keepSessionToken).changes;
  },

  /** Nuclear: drop every session for a user. Used by admin suspend. */
  deleteAllForUser(userId: string): number {
    return stmts.deleteAllForUser.run(userId).changes;
  },
};
