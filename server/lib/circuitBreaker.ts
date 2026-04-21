/**
 * In-memory circuit breaker per upstream (provider) name.
 *
 * Three states, classic pattern:
 *   CLOSED   — calls flow through. Failures increment a rolling window count.
 *   OPEN     — calls fail-fast for `cooldownMs`. After cooldown, transition to HALF_OPEN.
 *   HALF_OPEN — first call is allowed through as a probe. Success → CLOSED, failure → OPEN.
 *
 * Used by `geminiJson.ts` and `anthropic.ts` retry wrappers so a real upstream
 * outage stops the retry storm: instead of every concurrent request burning
 * 6+ seconds of backoff, the breaker opens after a few failures and the next
 * 60s of requests get a fast `BreakerOpenError` to surface to the user.
 *
 * Config is intentionally simple (count-based, not error-rate-based) — at the
 * traffic levels we care about, error-rate windowing adds complexity without
 * meaningful accuracy improvement.
 */

export class BreakerOpenError extends Error {
  constructor(readonly upstream: string, readonly retryAfterMs: number) {
    super(`Upstream "${upstream}" is temporarily unavailable. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = 'BreakerOpenError';
  }
}

type State = 'closed' | 'open' | 'half_open';

interface BreakerConfig {
  /** Consecutive failures that flip CLOSED → OPEN. Default 5. */
  failureThreshold?: number;
  /** Cooldown before OPEN → HALF_OPEN. Default 60_000 ms. */
  cooldownMs?: number;
}

interface BreakerEntry {
  state: State;
  failures: number;
  openedAt: number;
  config: Required<BreakerConfig>;
}

const breakers = new Map<string, BreakerEntry>();

const DEFAULTS: Required<BreakerConfig> = {
  failureThreshold: 5,
  cooldownMs: 60_000,
};

function getOrCreate(upstream: string, config?: BreakerConfig): BreakerEntry {
  let entry = breakers.get(upstream);
  if (!entry) {
    entry = { state: 'closed', failures: 0, openedAt: 0, config: { ...DEFAULTS, ...config } };
    breakers.set(upstream, entry);
  }
  return entry;
}

/** Run `fn` through the breaker. Throws `BreakerOpenError` if the breaker is open. */
export async function withBreaker<T>(
  upstream: string,
  fn: () => Promise<T>,
  config?: BreakerConfig,
): Promise<T> {
  const entry = getOrCreate(upstream, config);

  // OPEN: fail fast unless cooldown has elapsed
  if (entry.state === 'open') {
    const elapsed = Date.now() - entry.openedAt;
    if (elapsed < entry.config.cooldownMs) {
      throw new BreakerOpenError(upstream, entry.config.cooldownMs - elapsed);
    }
    entry.state = 'half_open';
  }

  try {
    const result = await fn();
    // Success: reset failure count and close the breaker.
    if (entry.state !== 'closed') {
      console.log(`[circuit] ${upstream} → CLOSED (probe succeeded)`);
    }
    entry.state = 'closed';
    entry.failures = 0;
    return result;
  } catch (err) {
    // Don't count BreakerOpenError as a failure (it's our own short-circuit).
    if (err instanceof BreakerOpenError) throw err;

    entry.failures++;
    // We can only reach this branch from CLOSED or HALF_OPEN (an existing OPEN
    // breaker would have short-circuited at the top). So any time we open here
    // is a real transition — always log it.
    const shouldOpen = entry.state === 'half_open' || entry.failures >= entry.config.failureThreshold;
    if (shouldOpen) {
      entry.state = 'open';
      entry.openedAt = Date.now();
      console.warn(`[circuit] ${upstream} → OPEN after ${entry.failures} failures`);
    }
    throw err;
  }
}

/** Test / admin helper: force the breaker into a specific state. */
export function _resetBreaker(upstream: string): void {
  breakers.delete(upstream);
}

/** Snapshot for the admin dashboard. */
export function getBreakerStatus(): Array<{ upstream: string; state: State; failures: number; openedAgoMs: number }> {
  return [...breakers.entries()].map(([upstream, e]) => ({
    upstream,
    state: e.state,
    failures: e.failures,
    openedAgoMs: e.state === 'open' ? Date.now() - e.openedAt : 0,
  }));
}
