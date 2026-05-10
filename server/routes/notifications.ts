/**
 * Tax notifications API.
 *
 *   GET  /api/notifications/latest          — list the welcome-screen items
 *   POST /api/notifications/:id/detail      — return the long-form detail
 *                                              (cached if generated before,
 *                                               else generates with grounding)
 *
 * The list is populated daily by the notificationRefresh job. The detail
 * route is the click handler for the welcome-screen cards: first click
 * runs Gemini once and caches; every subsequent click on the same card
 * is a free-on-our-side DB read.
 */

import { Router, Response } from 'express';
import { notificationsRepo } from '../db/repositories/notificationsRepo.js';
import { generateNotificationDetail } from '../lib/notificationFetcher.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { getBillingUser } from '../lib/billing.js';
import { AuthRequest } from '../types.js';

const router = Router();

router.get('/latest', (_req: AuthRequest, res: Response) => {
  const items = notificationsRepo.listLatest(12);
  res.json({
    items: items.map(it => ({
      id: it.id,
      category: it.category,
      heading: it.heading,
      summary: it.summary,
      notificationDate: it.notification_date,
      sourceUrl: it.source_url,
      hasDetail: !!it.full_detail,
      fetchedAt: it.fetched_at,
    })),
  });
});

router.post('/:id/detail', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const id = req.params.id;
  const row = notificationsRepo.byId(id);
  if (!row) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }

  // Cached path — first click on this card generated the detail and
  // wrote it to full_detail; every subsequent click reads here without
  // a Gemini call. The frontend also gets a `cached: true` flag so the
  // recent-API-calls table doesn't double-count.
  if (row.full_detail && row.full_detail.trim().length > 0) {
    res.json({
      detail: row.full_detail,
      cached: true,
      generatedAt: row.full_detail_generated_at,
      heading: row.heading,
      sourceUrl: row.source_url,
    });
    return;
  }

  // Cold path — generate with grounding and persist.
  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : null;
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
  const result = await generateNotificationDetail(id, row.heading, row.summary, row.source_url, {
    actorUserId: req.user.id,
    billingUserId: billingUser?.id ?? req.user.id,
    ip,
  });
  if (!result.ok || !result.detail) {
    res.status(502).json({ error: result.error ?? 'Failed to generate detail' });
    return;
  }
  res.json({
    detail: result.detail,
    cached: false,
    generatedAt: new Date().toISOString(),
    heading: row.heading,
    sourceUrl: row.source_url,
  });
});

export default router;
