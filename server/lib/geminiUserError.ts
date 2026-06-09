/**
 * Map a raw Gemini upstream error (HTTP status + raw body text) to a
 * clean, user-facing message. Strips Google's verbose JSON / billing
 * URLs / quota explanations that we don't want to leak to end users.
 *
 * Why this exists:
 *   - 429 prepay-depleted bodies include a URL to AI Studio's billing
 *     page, which exposes our infra detail and confuses the user.
 *   - 503 "overloaded" / 500 "internal error" bodies sometimes include
 *     model names, region hints, and stack traces.
 *   - Surfacing those directly in a user toast is bad UX — operators
 *     should see them in server logs (they still get the raw text
 *     via console.warn at the call site).
 *
 * Always returns a single sentence ending with a period, suitable for
 * a toast.
 */

export function formatGeminiUserError(status: number, rawBody: string | undefined): string {
  const body = (rawBody ?? '').toLowerCase();

  // 429 — quota / billing exhausted.
  if (status === 429 || /resource_exhausted/i.test(body) || /prepayment/i.test(body) || /quota/i.test(body)) {
    return 'AI service is temporarily unavailable. Please try again in a few minutes or contact support if the issue persists.';
  }

  // 401 / 403 — auth / API-key problem.
  if (status === 401 || status === 403) {
    return 'AI service authentication failed. Please contact support.';
  }

  // 503 — model overloaded / region down.
  if (status === 503 || /overloaded|unavailable/i.test(body)) {
    return 'AI service is busy right now. Please try again in a moment.';
  }

  // 504 — upstream timeout.
  if (status === 504) {
    return 'AI service timed out. Please try again — large documents sometimes take more than one attempt.';
  }

  // 4xx — request problem we couldn't fix automatically.
  if (status >= 400 && status < 500) {
    return 'AI service rejected the request. Please try again or contact support.';
  }

  // 5xx — upstream having issues.
  if (status >= 500) {
    return 'AI service is having issues. Please try again shortly.';
  }

  // Fallback.
  return 'AI service is unavailable. Please try again shortly.';
}

/**
 * Wraps the message in a sentinel prefix the caller can use to detect
 * "this is already user-facing, don't double-wrap" if the error
 * bubbles through multiple layers. The prefix is invisible to end
 * users (we strip it before display) but lets us distinguish a
 * formatted error from a raw one.
 */
export const GEMINI_USER_ERROR_PREFIX = '[gemini-user]';

export function buildGeminiUserError(status: number, rawBody: string | undefined): Error {
  return new Error(`${GEMINI_USER_ERROR_PREFIX} ${formatGeminiUserError(status, rawBody)}`);
}

/**
 * Strip the sentinel prefix from an error message if present so the
 * client sees a clean sentence. Idempotent — calling on a non-prefixed
 * message returns it unchanged.
 */
export function stripGeminiUserErrorPrefix(message: string): string {
  if (message.startsWith(GEMINI_USER_ERROR_PREFIX)) {
    return message.slice(GEMINI_USER_ERROR_PREFIX.length).trim();
  }
  return message;
}
