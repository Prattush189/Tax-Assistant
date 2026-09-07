/**
 * Boot-time secret validation.
 *
 * Several modules read auth secrets at import time with a dev fallback,
 * e.g. `process.env.JWT_SECRET ?? 'dev-secret-change-me'`. That fallback
 * is convenient in local dev but catastrophic in production: if the env
 * var is ever unset, the app signs and verifies JWTs with a value that
 * is public (it's in the source tree), letting anyone forge a token for
 * any user — including an admin — which is full account takeover plus
 * unlimited, mis-attributed token spend.
 *
 * This module fails the process fast on boot when running in production
 * with a missing / dev-default / too-short auth secret, so a
 * misconfigured deploy never comes up serving forgeable tokens. It is a
 * no-op outside production so local dev keeps working with the fallback.
 *
 * Import this FIRST in server/index.ts (right after `dotenv/config`) so
 * it runs before anything binds a port.
 */

// Known dev defaults hard-coded elsewhere in the tree. Kept in sync with
// middleware/auth.ts, routes/auth.ts and lib/documentDownloadToken.ts.
const DEV_DEFAULTS = new Set([
  'dev-secret-change-me',
  'dev-refresh-secret-change-me',
]);

/** Minimum length for a real secret. 32 hex chars is the floor; the
 *  .env.example generator produces 128-char values. */
const MIN_SECRET_LEN = 32;

interface SecretSpec {
  name: string;
  /** true = process refuses to boot in production if invalid.
   *  false = warn only (feature silently disabled at runtime instead). */
  required: boolean;
}

const SECRETS: SecretSpec[] = [
  { name: 'JWT_SECRET', required: true },
  { name: 'JWT_REFRESH_SECRET', required: true },
  // Not required — the plugin SSO route already returns an error when
  // PLUGIN_SSO_SECRET is empty, so an unset value fails closed. Warn so
  // the operator knows plugin SSO is off.
  { name: 'PLUGIN_SSO_SECRET', required: false },
];

export function validateSecrets(): void {
  // Non-fatal: without this the Razorpay webhook answers 503, so payments
  // reconcile only through the client-side verify path and a tab closed
  // mid-payment is never picked up. Warn loudly every boot until it is set.
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.warn('[secrets] RAZORPAY_WEBHOOK_SECRET is not set — POST /api/webhooks/razorpay will return 503. Create the secret in Razorpay Dashboard → Settings → Webhooks and add it to .env.');
  }
  // Only enforce in production. Dev/test keep the convenient fallbacks.
  if (process.env.NODE_ENV !== 'production') return;

  const fatal: string[] = [];
  const warnings: string[] = [];

  for (const spec of SECRETS) {
    const value = process.env[spec.name];
    let problem: string | null = null;
    if (!value) problem = 'is not set';
    else if (DEV_DEFAULTS.has(value)) problem = 'is set to a known dev default';
    else if (value.length < MIN_SECRET_LEN) problem = `is too short (< ${MIN_SECRET_LEN} chars)`;

    if (problem) {
      (spec.required ? fatal : warnings).push(`${spec.name} ${problem}`);
    }
  }

  for (const w of warnings) console.warn(`[secrets] WARNING: ${w} — the dependent feature will be disabled.`);

  if (fatal.length > 0) {
    console.error('[secrets] FATAL: refusing to start in production with insecure auth secrets:');
    for (const f of fatal) console.error(`  - ${f}`);
    console.error('  Generate strong values with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    // Hard-exit rather than throw so no later import can swallow this.
    process.exit(1);
  }
}
