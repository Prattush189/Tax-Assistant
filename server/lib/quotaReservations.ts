/**
 * In-memory quota reservation tracker.
 *
 * Pre-flight token estimates are added to the user's "used" total
 * BEFORE the Gemini call runs, so a single oversized request — or two
 * concurrent average requests that would collectively overshoot —
 * gets rejected at the gate instead of running and pushing the user
 * past their budget.
 *
 * Lifecycle:
 *   1. Route computes an estimate and calls `reserve(billingUserId, tokens)`.
 *   2. Gate checks `usage_in_db + sum(active_reservations) + estimate <= budget`.
 *   3. Run completes (success / cancel / fail) and route calls `release(id)`.
 *      The actual cost is logged separately to api_usage by the route — the
 *      reservation only exists to *gate* the run, not to track real spend.
 *
 * Stored in-memory because:
 *   - Reservations only need to outlive the request that owns them. A
 *     server restart kills every in-flight request, so any "leaked"
 *     reservation goes with the process.
 *   - Latency: the gate fires on every Gemini-spending route. A DB
 *     round-trip per gate would add measurable overhead.
 *   - Single-process deployment (pm2 cluster mode disabled today). If
 *     we move to multi-process / multi-host, this needs to migrate to
 *     Redis or a DB table — keep the API surface narrow so that swap
 *     is a one-file change.
 */

interface Reservation {
  id: string;
  billingUserId: string;
  tokens: number;
  createdAt: number;
}

const reservations = new Map<string, Reservation>();
let reservationSeq = 0;

/** Total reserved (estimated) tokens currently in flight for a billing user. */
export function reservedTokensFor(billingUserId: string): number {
  let sum = 0;
  for (const r of reservations.values()) {
    if (r.billingUserId === billingUserId) sum += r.tokens;
  }
  return sum;
}

/** Reserve `tokens` for `billingUserId` and return a release function.
 *  Idempotent: calling release more than once is a no-op. */
export function reserve(billingUserId: string, tokens: number): () => void {
  if (tokens <= 0) return () => { /* nothing reserved */ };
  const id = `r${++reservationSeq}`;
  reservations.set(id, { id, billingUserId, tokens, createdAt: Date.now() });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    reservations.delete(id);
  };
}

/** Sweep stale reservations older than `maxAgeMs`. Defensive cleanup —
 *  a route that throws before its `finally` could leak; this caps the
 *  blast radius. Default 30 minutes covers the longest legitimate
 *  Gemini run (a 50-chunk bank statement). */
export function reapStaleReservations(maxAgeMs = 30 * 60 * 1000): number {
  const now = Date.now();
  let reaped = 0;
  for (const [id, r] of reservations) {
    if (now - r.createdAt > maxAgeMs) {
      reservations.delete(id);
      reaped++;
    }
  }
  return reaped;
}

// Cheap defensive sweep every 5 minutes. unref so it doesn't hold the
// event loop open during a clean shutdown.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const sweepTimer = setInterval(() => {
  const reaped = reapStaleReservations();
  if (reaped > 0) console.warn(`[quotaReservations] reaped ${reaped} stale reservation(s) — likely a route handler that didn't release()`);
}, SWEEP_INTERVAL_MS);
// Node returns a Timeout object with .unref(); browser/edge runtimes
// return a number. Guard against the latter without `any`.
(sweepTimer as { unref?: () => void }).unref?.();

/** Test helper: clear every reservation. */
export function _resetReservations(): void {
  reservations.clear();
  reservationSeq = 0;
}
