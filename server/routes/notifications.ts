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

  // The frontend posts to /detail with no chatId; the route creates a
  // fresh chat itself, persists the synthetic exchange, and returns
  // the new chatId so the client can switch to it. This collapses
  // what used to be two round-trips (POST /api/chats then POST
  // /api/notifications/:id/detail) into one — combined with the
  // pre-generated cache, the end-to-end click feels instant.
  // Frontend MAY still pass chatId to attach the exchange to an
  // existing chat (used by tests / future "open in current chat"
  // links); when absent we own the chat-creation step.
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

  // Resolve the chat: either attach to a caller-supplied one (verified
  // ownership) OR create a new chat titled with the notification heading.
  let chatId: string | null = null;
  if (requestedChatId) {
    const chat = chatRepo.findById(requestedChatId);
    if (chat && chat.user_id === req.user.id) {
      chatId = requestedChatId;
    } else {
      console.warn(`[notifications] requested chatId=${requestedChatId} not found or not owned by user=${req.user.id}; creating new chat instead`);
    }
  }
  if (!chatId) {
    try {
      const created = chatRepo.create(req.user.id, row.heading.slice(0, 80) || 'Notification');
      chatId = created.id;
    } catch (e) {
      console.error('[notifications] failed to create chat:', e instanceof Error ? e.message : e);
      // We still have the detail — return it without persistence
      // so the user at least sees the answer; chat history just
      // won't include it for this click.
    }
  }

  if (chatId) {
    const userText = `Explain: ${row.heading}`;
    try {
      messageRepo.create(chatId, 'user', userText);
      messageRepo.create(chatId, 'model', resolvedDetail);
      // Title only re-set on a fresh / default chat — don't clobber
      // a user-renamed chat the caller may have passed in.
      const chat = chatRepo.findById(chatId);
      if (chat && (!chat.title || chat.title === 'New Chat')) {
        chatRepo.updateTitle(chatId, row.heading.slice(0, 80));
      }
    } catch (e) {
      console.error('[notifications] failed to persist exchange to chat:', e instanceof Error ? e.message : e);
    }
  }

  res.json({
    detail: resolvedDetail,
    cached,
    generatedAt,
    heading: row.heading,
    sourceUrl: row.source_url,
    chatId,
  });
});

export default router;
