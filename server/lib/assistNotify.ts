/**
 * Fire-and-forget notification to assist's GetDealerInfo endpoint on
 * every successful Tax-Assistant login.
 *
 * The endpoint doubles as a dealer-lookup AND a login-event notifier
 * — assist uses these calls to track which users are active under
 * which dealer. We don't act on the response: a non-Success msg
 * ("Access Denied !!!" / "Invalid Email !!!") doesn't block the
 * login, and a network error is silently logged. Admin role logins
 * are skipped.
 *
 * Timeout: 3 s. Anything longer would slow down the login response,
 * which we serve before this finishes anyway.
 */

const ASSIST_DEALER_INFO_URL = 'http://smartbizin.com/checking/assistservices.svc/GetDealerInfo';
const TIMEOUT_MS = 3_000;

interface NotifyInput {
  email: string;
  ipAddress: string | null;
  /** Tax-Assistant user role; admin logins skip the call. */
  role?: string | null;
}

export function notifyAssistOfLogin(input: NotifyInput): void {
  if ((input.role ?? '').toLowerCase() === 'admin') return;
  if (!input.email) return;

  // Fire-and-forget — caller doesn't await.
  void (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ASSIST_DEALER_INFO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.email, ipAddress: input.ipAddress ?? '0.0.0.0' }),
        signal: controller.signal,
      });
      // The response shape wraps a JSON-string in a JSON-string —
      // unwrap once to log the dealer / msg for ops visibility.
      // We DON'T act on the result; non-Success msg doesn't block
      // login (already issued by the time this runs).
      if (res.ok) {
        const body = await res.json().catch(() => null) as { GetDealerInfoResult?: string } | null;
        if (body?.GetDealerInfoResult) {
          try {
            const inner = JSON.parse(body.GetDealerInfoResult) as { msg?: string; dealer?: string; subDealer?: string };
            console.log(`[assistNotify] ${input.email} → msg="${inner.msg}" dealer="${inner.dealer ?? '-'}" subDealer="${inner.subDealer ?? '-'}"`);
          } catch { /* malformed inner JSON — log raw */ }
        }
      } else {
        console.warn(`[assistNotify] ${input.email}: HTTP ${res.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[assistNotify] ${input.email}: ${msg.slice(0, 200)}`);
    } finally {
      clearTimeout(timer);
    }
  })();
}
