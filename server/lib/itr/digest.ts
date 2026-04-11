/**
 * Digest utility for CBDT ITR JSON files.
 *
 * The CBDT schema's CreationInfo.Digest field carries a fingerprint of the
 * payload. The spec defines the pattern as `-|.{44}` which matches either
 * the placeholder `-` or a 44-char base64 string. A SHA-256 digest encoded as
 * base64 fits exactly — `Buffer.from(hash).toString('base64')` is 44 chars
 * because 256 bits = 32 bytes, which encodes to 44 base64 chars (with one `=`
 * padding). We strip nothing — the pattern allows the `=` because it's just
 * "any 44 chars".
 *
 * The digest is computed over the JSON with the Digest field itself set to
 * `'-'` so the computation is idempotent and reproducible by any validator.
 */
import crypto from 'crypto';

export function canonicalize(value: unknown): string {
  // Deterministic JSON.stringify with sorted object keys — required so two
  // different JS runtimes produce the same digest for the same logical input.
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

/**
 * Computes the Digest for an ITR JSON payload. Expects the CreationInfo to
 * already contain Digest = '-'. Returns the base64-encoded SHA-256 hash.
 */
export function computeDigest(payload: unknown): string {
  const canonical = canonicalize(payload);
  const hash = crypto.createHash('sha256').update(canonical).digest('base64');
  return hash;
}

/**
 * Stamps the Digest into the CreationInfo field of an ITR-1 or ITR-4 payload
 * (in place). The payload must have the shape { ITR: { ITR1: {...} } } or
 * { ITR: { ITR4: {...} } }. Returns the same payload for chaining.
 */
export function stampDigest<T extends Record<string, unknown>>(payload: T): T {
  const root = payload as unknown as {
    ITR?: { ITR1?: { CreationInfo?: Record<string, unknown> }; ITR4?: { CreationInfo?: Record<string, unknown> } };
  };
  const ci = root.ITR?.ITR1?.CreationInfo ?? root.ITR?.ITR4?.CreationInfo;
  if (!ci) {
    throw new Error('stampDigest: payload does not contain ITR.ITR1.CreationInfo or ITR.ITR4.CreationInfo');
  }
  // Reset to '-' before hashing so repeat calls produce the same digest.
  ci.Digest = '-';
  ci.Digest = computeDigest(payload);
  return payload;
}
