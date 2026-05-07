/**
 * Fire-and-forget notification to assist's GetDealerInfo endpoint on
 * every successful Tax-Assistant login.
 *
 * The endpoint doubles as a dealer-lookup AND a login-event notifier
 * — assist uses these calls to track which users are active under
 * which dealer. On a Success response we persist `dealer` /
 * `sub_dealer` on the user row so admin dashboards can see the
 * attribution without re-calling the API. Non-Success response or
 * any error: nothing happens (login already issued, columns left
 * untouched). Admin-role logins skipped.
 *
 * Timeout: 3 s.
 */

import db from '../db/index.js';

const ASSIST_DEALER_INFO_URL = 'http://smartbizin.com/checking/assistservices.svc/GetDealerInfo';
const TIMEOUT_MS = 3_000;

interface NotifyInput {
  userId: string;
  email: string;
  ipAddress: string | null;
  /** Tax-Assistant user role; admin logins skip the call. */
  role?: string | null;
}

export function notifyAssistOfLogin(input: NotifyInput): void {
  if ((input.role ?? '').toLowerCase() === 'admin') return;
  if (!input.email) return;

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
      if (!res.ok) {
        console.warn(`[assistNotify] ${input.email}: HTTP ${res.status}`);
        return;
      }
      const body = await res.json().catch(() => null) as { GetDealerInfoResult?: string } | null;
      if (!body?.GetDealerInfoResult) return;
      let inner: { status?: number; msg?: string; dealer?: string; subDealer?: string };
      try {
        inner = JSON.parse(body.GetDealerInfoResult);
      } catch {
        console.warn(`[assistNotify] ${input.email}: malformed inner JSON`);
        return;
      }
      console.log(`[assistNotify] ${input.email} → msg="${inner.msg}" dealer="${inner.dealer ?? '-'}" subDealer="${inner.subDealer ?? '-'}"`);
      // Only persist on Success — Access Denied / Invalid Email leave
      // the existing dealer / sub_dealer values intact rather than
      // wiping a previously-good attribution because the API blipped.
      if ((inner.msg ?? '').trim().toLowerCase().startsWith('success')) {
        const dealer = (inner.dealer ?? '').trim() || null;
        const subDealer = (inner.subDealer ?? '').trim() || null;
        try {
          db.prepare('UPDATE users SET dealer = ?, sub_dealer = ? WHERE id = ?').run(dealer, subDealer, input.userId);
        } catch (e) {
          console.warn(`[assistNotify] ${input.email}: DB update failed: ${(e as Error).message}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[assistNotify] ${input.email}: ${msg.slice(0, 200)}`);
    } finally {
      clearTimeout(timer);
    }
  })();
}
