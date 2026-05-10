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
import { chatRepo } from '../db/repositories/chatRepo.js';
import { messageRepo } from '../db/repositories/messageRepo.js';
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

  // The frontend creates a fresh chat for each click and passes its id
  // here so the synthetic user→model exchange is PERSISTED — without
  // this, the conversation only lived in component state, never showed
  // up in the chat list, and follow-up questions had no chat to attach
  // to. With chatId set, the user can ask follow-ups in the same
  // thread and the chat appears in the sidebar like any other.
  const requestedChatId = typeof req.body?.chatId === 'string' ? req.body.chatId.trim() : null;

  let resolvedDetail: string | null = null;
  let cached = false;
  let generatedAt: string | null = null;

  // Cached path — first click on this card generated the detail and
  // wrote it to full_detail; every subsequent click reads here without
  // a Gemini call. We still persist the exchange to the requested
  // chat so the user can resume the thread and follow up.
  if (row.full_detail && row.full_detail.trim().length > 0) {
    resolvedDetail = row.full_detail;
    cached = true;
    generatedAt = row.full_detail_generated_at;
  } else {
    // Cold path — generate with grounding, repo writes full_detail.
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
    resolvedDetail = result.detail;
    cached = false;
    generatedAt = new Date().toISOString();
  }

  // If a chatId was supplied, verify it belongs to this user, then
  // append the user→model exchange so it appears in the chat history.
  // We also retitle the chat to the notification heading so the chat
  // list reads like any other branch ("Explain: GST Notification 12/2025…").
  if (requestedChatId) {
    const chat = chatRepo.findById(requestedChatId);
    if (chat && chat.user_id === req.user.id) {
      const userText = `Explain: ${row.heading}`;
      try {
        messageRepo.create(requestedChatId, 'user', userText);
        messageRepo.create(requestedChatId, 'model', resolvedDetail);
        // Title only re-set if the chat is still on its default name —
        // don't clobber a user-renamed chat.
        if (!chat.title || chat.title === 'New Chat') {
          chatRepo.updateTitle(requestedChatId, row.heading.slice(0, 80));
        }
      } catch (e) {
        console.error('[notifications] failed to persist exchange to chat:', e instanceof Error ? e.message : e);
        // Don't fail the request — frontend still gets the detail and
        // can render it locally; only the chat-history side-effect failed.
      }
    } else {
      console.warn(`[notifications] requested chatId=${requestedChatId} not found or not owned by user=${req.user.id}; skipping persistence`);
    }
  }

  res.json({
    detail: resolvedDetail,
    cached,
    generatedAt,
    heading: row.heading,
    sourceUrl: row.source_url,
    chatId: requestedChatId ?? null,
  });
});

export default router;
