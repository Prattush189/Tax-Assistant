/**
 * Middleware that gates /api/external/* routes on a valid external
 * API key. Independent of the user-JWT path used by the rest of the
 * API: there's no req.user on these requests, just req.externalKey
 * and (when supplied via the route body) req.dealer.
 *
 * Auth shape:
 *   Authorization: Bearer EXTKEY-<random>
 *
 * The dealer identity (which dealer at assist.smartbizin.com is
 * driving this call) is sent in the route body for write endpoints,
 * since assist authenticates dealers itself and Tax-Assistant just
 * trusts the attribution. Read endpoints don't need a dealer claim.
 */

import type { Request, Response, NextFunction } from 'express';
import { validateExternalApiKey, type ExternalApiKeyRow } from '../lib/externalApiKey.js';

// Lightweight cast at the route layer rather than augmenting
// express-serve-static-core (the project's TS resolver doesn't
// have @types/express-serve-static-core split available, so the
// augmentation fails at type-check time). Routes downstream cast
// `req` to ExternalApiRequest to access externalKey.
export type ExternalApiRequest = Request & { externalKey?: ExternalApiKeyRow };

export function requireExternalApiKey(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization ?? '';
  const match = /^Bearer\s+(\S+)\s*$/i.exec(auth);
  const token = match?.[1];
  if (!token) {
    res.status(401).json({ error: 'Authorization: Bearer <api-key> header required' });
    return;
  }
  const key = validateExternalApiKey(token);
  if (!key) {
    res.status(401).json({ error: 'Invalid or revoked API key' });
    return;
  }
  (req as ExternalApiRequest).externalKey = key;
  next();
}
