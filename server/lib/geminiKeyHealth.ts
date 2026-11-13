/**
 * Gemini API keys that Google reports as OUT OF CREDIT (prepaid balance
 * used up: HTTP 402 "Your prepayment credits are depleted"; older bodies
 * came as 429 with the same text). Such a key fails every call until it
 * is topped up, so it is skipped for an hour and its calls go to another
 * configured key. After the hour the next call tries it again; if it
 * still fails, streamGeminiChat retries that call on another key, so the
 * user never sees the failure.
 *
 * Found 2026-11-13: key 2 was out of credit while the notification
 * fetcher preferred it and chatProvider's search rotation moves to it
 * once key 1's free monthly searches run out.
 *
 * In memory only: after a restart the first failing call re-marks it.
 */

import { GEMINI_API_KEYS } from './gemini.js';
import { isOutOfCreditResponse } from './geminiUserError.js';

export { isOutOfCreditResponse };

const OUT_OF_CREDIT_SKIP_MS = 60 * 60 * 1000;
const outOfCreditUntil = new Map<number, number>();

function indexOfKey(apiKey: string): number {
  return apiKey ? GEMINI_API_KEYS.indexOf(apiKey) : -1;
}

export function isKeyIndexOutOfCredit(index: number): boolean {
  const until = outOfCreditUntil.get(index);
  if (until === undefined) return false;
  if (Date.now() >= until) { outOfCreditUntil.delete(index); return false; }
  return true;
}

export function markKeyOutOfCredit(apiKey: string): void {
  const index = indexOfKey(apiKey);
  if (index < 0) return;
  if (!isKeyIndexOutOfCredit(index)) {
    console.error(`[geminiKeyHealth] Gemini key ${index + 1} is out of credit (prepaid balance used up); skipping it for ${OUT_OF_CREDIT_SKIP_MS / 60_000} min. Top it up in Google AI Studio billing.`);
  }
  outOfCreditUntil.set(index, Date.now() + OUT_OF_CREDIT_SKIP_MS);
}

/** The key to call with: `apiKey` itself unless it is marked out of
 *  credit, else the first other configured key that isn't. Returns
 *  `apiKey` unchanged when no other key is usable (the call then fails
 *  as it would have). Keys that aren't in GEMINI_API_KEYS pass through. */
export function usableGeminiKey(apiKey: string): string {
  const index = indexOfKey(apiKey);
  if (index < 0 || !isKeyIndexOutOfCredit(index)) return apiKey;
  const other = GEMINI_API_KEYS.findIndex((k, i) => i !== index && !!k && !isKeyIndexOutOfCredit(i));
  return other >= 0 ? GEMINI_API_KEYS[other] : apiKey;
}

/** For the admin dashboard: when each key's skip ends (ISO), or null. */
export function outOfCreditUntilIso(index: number): string | null {
  return isKeyIndexOutOfCredit(index) ? new Date(outOfCreditUntil.get(index)!).toISOString() : null;
}
