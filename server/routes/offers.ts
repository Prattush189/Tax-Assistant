/**
 * Offers shown to signed-in users.
 *
 *   GET  /api/offers/current       — is the launch offer on, and has this
 *                                     user already closed its pop-up?
 *   POST /api/offers/current/seen  — record that the pop-up was closed.
 *
 * Users are told "50% off every feature except chat"; the paths and
 * payload never name the model behind the app. The offer itself (half
 * the Gemini price on every non-chat call, whichever model answers) is
 * applied in computeWeightedTokens; this route drives the one-time
 * pop-up, the plans-page banner and the offer prices in Settings.
 * `active` turns false on 13 Dec, or earlier if the Claude credits run
 * out (launchOffer.ts setLaunchOfferEarlyEnd); `endsAt` follows.
 */

import { Router, Response } from 'express';
import db from '../db/index.js';
import { LAUNCH_OFFER, launchOfferActive, launchOfferEndsAt } from '../lib/launchOffer.js';
import { AuthRequest } from '../types.js';

const router = Router();

const seenStmt = db.prepare('SELECT 1 FROM user_notices_seen WHERE user_id = ? AND notice_id = ?');
const markSeenStmt = db.prepare('INSERT OR IGNORE INTO user_notices_seen (user_id, notice_id) VALUES (?, ?)');

router.get('/current', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  res.json({
    active: launchOfferActive(),
    discountPct: LAUNCH_OFFER.discountPct,
    endsAt: launchOfferEndsAt(),
    excludes: LAUNCH_OFFER.excludes,
    seen: !!seenStmt.get(req.user.id, LAUNCH_OFFER.id),
  });
});

router.post('/current/seen', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  markSeenStmt.run(req.user.id, LAUNCH_OFFER.id);
  res.json({ success: true });
});

export default router;
