/**
 * Self-authenticating download tokens for payment-document PDFs
 * (proforma / invoice / receipt). Issued at license-creation time and
 * embedded into the documentUrl returned by /api/external/licenses,
 * so the dealer console can hand the URL straight to a browser
 * without needing to ferry the server-side EXTKEY through.
 *
 * Why this exists: assist.smartbizin.com's "Download Proforma" button
 * was popping a 401 from Tax-Assistant because the dealer's browser
 * has no way to attach the EXTKEY (which is a server-side credential)
 * to the GET /api/external/payments/.../proforma.pdf request. With a
 * signed ?token=<jwt> on the URL, the browser can hit the endpoint
 * directly — Tax-Assistant verifies the signature, scope (payment id
 * + kind), and TTL, and serves the PDF.
 *
 * Scope binding: the token is signed with paymentId + kind so a token
 * minted for proforma X cannot be replayed against invoice Y or
 * proforma Z. The hash of the JWT_SECRET environment variable signs
 * it, so a leaked token from this server can't be forged on another
 * deployment. TTL defaults to 30 days — long enough for a dealer to
 * forward the link to the customer over email but short enough to
 * cap exposure if the URL leaks.
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';
const TOKEN_TTL_DAYS = 30;

interface TokenPayload {
  /** Payment row id the token grants access to. Bound on issue;
   *  verifier rejects the token if the URL's :id doesn't match. */
  paymentId: string;
  /** Document type: 'proforma' / 'invoice' / 'receipt'. Bound so a
   *  proforma-scoped token can't pull the receipt for the same row. */
  kind: 'proforma' | 'invoice' | 'receipt';
  /** Always 'doc' — distinguishes these tokens from the user-auth
   *  JWT in case the same secret is reused. */
  scope: 'doc';
}

export function signDocumentDownloadToken(paymentId: string, kind: 'proforma' | 'invoice' | 'receipt'): string {
  const payload: TokenPayload = { paymentId, kind, scope: 'doc' };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: `${TOKEN_TTL_DAYS}d` });
}

export function verifyDocumentDownloadToken(
  token: string,
  expectedPaymentId: string,
  expectedKind: 'proforma' | 'invoice' | 'receipt',
): boolean {
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    if (decoded.scope !== 'doc') return false;
    if (decoded.paymentId !== expectedPaymentId) return false;
    if (decoded.kind !== expectedKind) return false;
    return true;
  } catch {
    return false;
  }
}
