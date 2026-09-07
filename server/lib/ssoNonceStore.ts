/**
 * Replay guard for plugin SSO nonces.
 *
 * The SSO handshake signs a `nonce` but, before this, nothing recorded
 * which nonces had been seen — so a captured, still-valid request could
 * be replayed within the ±5-minute timestamp window. This store remembers
 * recently-seen nonces and rejects repeats.
 *
 * In-memory on purpose (mirrors quotaReservations): single-process
 * deployment, and a replay only matters inside the short clock-skew
 * window, which never outlives the process. Move to Redis / a DB table
 * if we ever run multi-process — keep the surface narrow so that's a
 * one-file swap.
 */

// Nonces live slightly longer than the ±5-minute SSO clock-skew window so
// there's no gap where an expired-from-the-map but still-timestamp-valid
// nonce could be replayed.
const NONCE_TTL_MS = 11 * 60 * 1000;

const seen = new Map<string, number>(); // nonce -> expiry epoch ms

/**
 * Atomically check-and-record a nonce. Returns true if it's fresh (and
 * records it), false if it was already seen within the TTL (replay).
 * `now` is injectable for tests.
 */
export function claimNonce(nonce: string, now: number = Date.now()): boolean {
  const existing = seen.get(nonce);
  if (existing !== undefined && existing > now) return false; // replay
  seen.set(nonce, now + NONCE_TTL_MS);
  // Opportunistic sweep: purge expired entries so the map can't grow
  // unbounded under a flood of distinct nonces.
  if (seen.size > 1000) {
    for (const [k, exp] of seen) {
      if (exp <= now) seen.delete(k);
    }
  }
  return true;
}

/** Test helper. */
export function _resetNonces(): void {
  seen.clear();
}
