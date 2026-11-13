/**
 * Offers shown to signed-in users.
 *
 *   GET  /api/offers/current       — is the launch offer on, and has this
 *                                     user already closed its pop-up?
 *   POST /api/offers/current/seen  — record that the pop-up was closed.
 *
 * Users are told "every feature uses 75% fewer credits"; the paths and
 * payload never name the model behind the app. The offer itself (25%
 * credits on every AI call, whichever model answers) is applied in
 * computeWeightedTokens; this route drives the one-time pop-up, the
 * plans-page banner and the offer prices in the chat box and Settings.
 */

import { Router, Response } from 'express';
import db from '../db/index.js';
import { LAUNCH_OFFER, launchOfferActive } from '../lib/launchOffer.js';
import { AuthRequest } from '../types.js';

const router = Router();

const seenStmt = db.prepare('SELECT 1 FROM user_notices_seen WHERE user_id = ? AND notice_id = ?');
const markSeenStmt = db.prepare('INSERT OR IGNORE INTO user_notices_seen (user_id, notice_id) VALUES (?, ?)');

router.get('/current', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  res.json({
    active: launchOfferActive(),
    discountPct: LAUNCH_OFFER.discountPct,
    endsAt: LAUNCH_OFFER.endsAt,
    seen: !!seenStmt.get(req.user.id, LAUNCH_OFFER.id),
  });
});

router.post('/current/seen', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  markSeenStmt.run(req.user.id, LAUNCH_OFFER.id);
  res.json({ success: true });
});

export default router;
