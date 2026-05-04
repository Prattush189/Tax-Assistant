/**
 * License-key generation and validation.
 *
 * Format: `<PLAN>-XXXX-XXXX-XXXX-CC` where XXXX is from a 32-char
 * Crockford-base32 alphabet (no I, L, O, U — visually unambiguous)
 * and CC is a two-character checksum so a typo-by-one-digit fails
 * fast at validation time without a DB lookup.
 *
 *   FREE-K3HJ-92RW-7P4N-5T   (free trial, 30-day window)
 *   PRO-XQ8M-44RB-T2VK-9A    (paid pro, yearly)
 *   ENT-9HJK-2RT8-MN4Q-XW    (paid enterprise, yearly)
 *   ADMIN-ZX7K-3RT9-PQ4M-CC  (admin, no expiry)
 *
 * The prefix maps to a plan — both consumers (the auth gate, the
 * admin issuer, the analytics view) read this single source of
 * truth so a `PRO-` key issued for plan='enterprise' (e.g. by a
 * race or a bug) fails validation rather than silently granting
 * the wrong tier.
 */

import crypto from 'crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 minus I, L, O, U

export type LicensePlan = 'free' | 'pro' | 'enterprise' | 'admin';

const PLAN_PREFIX: Record<LicensePlan, string> = {
  free: 'FREE',
  pro: 'PRO',
  enterprise: 'ENT',
  admin: 'ADMIN',
};

const PREFIX_TO_PLAN: Record<string, LicensePlan> = {
  FREE: 'free',
  PRO: 'pro',
  ENT: 'enterprise',
  ADMIN: 'admin',
};

/** Generate a fresh license key for the given plan. Caller MUST
 *  insert it into license_keys with the unique constraint — collision
 *  is astronomically unlikely (32^14 ≈ 10²¹) but the unique index is
 *  the actual gate. */
export function generateLicenseKey(plan: LicensePlan): string {
  const prefix = PLAN_PREFIX[plan];
  const groups: string[] = [];
  for (let g = 0; g < 3; g++) {
    let group = '';
    for (let i = 0; i < 4; i++) {
      const byte = crypto.randomInt(0, ALPHABET.length);
      group += ALPHABET[byte];
    }
    groups.push(group);
  }
  const body = groups.join('-');
  const checksum = computeChecksum(`${prefix}-${body}`);
  return `${prefix}-${body}-${checksum}`;
}

/** Two-character checksum. Catches single-character typos at validate
 *  time before we round-trip to the DB. Not a security primitive —
 *  just a typo guard. */
function computeChecksum(input: string): string {
  const hash = crypto.createHash('sha256').update(input).digest();
  // Take 10 bits → two base32 chars.
  const idx1 = hash[0] % ALPHABET.length;
  const idx2 = hash[1] % ALPHABET.length;
  return `${ALPHABET[idx1]}${ALPHABET[idx2]}`;
}

export interface ParsedLicenseKey {
  plan: LicensePlan;
  body: string;          // the XXXX-XXXX-XXXX core
  checksum: string;      // the trailing CC
  raw: string;           // the original (uppercased, normalised) string
}

/** Parse + checksum-validate a license key. Returns null on any
 *  shape / checksum mismatch. Whitespace is stripped and the
 *  string is uppercased so users typing keys lowercase or with
 *  spaces still resolve correctly. */
export function parseLicenseKey(input: string): ParsedLicenseKey | null {
  if (!input) return null;
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, '');
  // Format: <PREFIX>-XXXX-XXXX-XXXX-CC where prefix is one of the
  // known PLAN_PREFIX values.
  const match = /^(FREE|PRO|ENT|ADMIN)-([0-9A-Z]{4})-([0-9A-Z]{4})-([0-9A-Z]{4})-([0-9A-Z]{2})$/.exec(cleaned);
  if (!match) return null;
  const [, prefix, g1, g2, g3, cc] = match;
  const plan = PREFIX_TO_PLAN[prefix];
  if (!plan) return null;
  // Reject any character outside the Crockford alphabet (the regex
  // accepts I/L/O/U too, but those would never have been emitted).
  for (const group of [g1, g2, g3, cc]) {
    for (const ch of group) if (!ALPHABET.includes(ch)) return null;
  }
  const body = `${g1}-${g2}-${g3}`;
  const expectedChecksum = computeChecksum(`${prefix}-${body}`);
  if (expectedChecksum !== cc) return null;
  return { plan, body, checksum: cc, raw: cleaned };
}

/** Convenience: just return the plan a key encodes (or null on
 *  malformed). Useful where the caller doesn't need the components. */
export function planFromLicenseKey(input: string): LicensePlan | null {
  return parseLicenseKey(input)?.plan ?? null;
}
