import { Router, Response } from 'express';
import { chatRepo } from '../db/repositories/chatRepo.js';
import { messageRepo } from '../db/repositories/messageRepo.js';
import { documentRepo } from '../db/repositories/documentRepo.js';
import { messageReportRepo, REPORT_REASONS, type ReportReason } from '../db/repositories/messageReportRepo.js';
import { AuthRequest } from '../types.js';

const router = Router();

// GET /api/chats — list user's chats
router.get('/', (req: AuthRequest, res: Response) => {
  const chats = chatRepo.findByUserId(req.user!.id);
  res.json(chats);
});

// GET /api/chats/search?q= — chats whose title or messages contain q,
// each with a short snippet around the first hit in the latest match.
router.get('/search', (req: AuthRequest, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
  if (q.length < 2) {
    res.json([]);
    return;
  }
  const rows = chatRepo.search(req.user!.id, q);
  res.json(rows.map(r => ({
    id: r.id,
    title: r.title,
    created_at: r.created_at,
    updated_at: r.updated_at,
    pinned_at: r.pinned_at,
    snippet: r.match_content ? makeSnippet(r.match_content, q) : null,
  })));
});

function makeSnippet(content: string, q: string): string {
  // Plain text for the sidebar: drop markdown emphasis/table/heading marks
  // and the internal [[PDF:…]] wrappers before cutting the excerpt.
  const flat = content
    .replace(/\[\[\/?PDF:?[^\]]*\]\]/g, ' ')
    .replace(/[*_`#>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return flat.slice(0, 120);
  const start = Math.max(0, at - 40);
  const end = Math.min(flat.length, at + q.length + 80);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

// POST /api/chats — create a new chat
router.post('/', (req: AuthRequest, res: Response) => {
  const { title } = req.body ?? {};
  const chat = chatRepo.create(req.user!.id, title || 'New Chat');
  res.status(201).json(chat);
});

// GET /api/chats/:chatId/messages — get messages for a chat
router.get('/:chatId/messages', (req: AuthRequest, res: Response) => {
  const chat = chatRepo.findById(req.params.chatId);
  if (!chat || chat.user_id !== req.user!.id) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }
  const messages = messageRepo.findByChatId(chat.id);
  res.json(messages);
});

// GET /api/chats/:chatId/documents — documents the assistant remembers in this chat
router.get('/:chatId/documents', (req: AuthRequest, res: Response) => {
  const chat = chatRepo.findById(req.params.chatId);
  if (!chat || chat.user_id !== req.user!.id) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }
  res.json(documentRepo.listByChatId(chat.id));
});

// DELETE /api/chats/:chatId/documents/:docId — stop sending a document with this chat
router.delete('/:chatId/documents/:docId', (req: AuthRequest, res: Response) => {
  const chat = chatRepo.findById(req.params.chatId);
  const doc = documentRepo.findById(req.params.docId);
  if (!chat || chat.user_id !== req.user!.id || !doc || doc.chat_id !== chat.id) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  documentRepo.delete(doc.id);
  res.json({ success: true });
});

// POST /api/chats/:chatId/messages/:messageId/report — flag an answer.
// Body: { reason: 'wrong_info'|'not_answered'|'confusing'|'other', note? }
router.post('/:chatId/messages/:messageId/report', (req: AuthRequest, res: Response) => {
  const chat = chatRepo.findById(req.params.chatId);
  const messageId = Number(req.params.messageId);
  const msg = Number.isInteger(messageId) ? messageRepo.findById(messageId) : undefined;
  if (!chat || chat.user_id !== req.user!.id || !msg || msg.chat_id !== chat.id || msg.role !== 'model') {
    res.status(404).json({ error: 'Message not found' });
    return;
  }
  const reason = req.body?.reason as ReportReason;
  if (!REPORT_REASONS.includes(reason)) {
    res.status(400).json({ error: 'Invalid reason' });
    return;
  }
  const rawNote = req.body?.note;
  const note = typeof rawNote === 'string' && rawNote.trim() ? rawNote.trim().slice(0, 1000) : null;
  messageReportRepo.upsert(msg.id, req.user!.id, reason, note);
  res.json({ success: true });
});

// PATCH /api/chats/:chatId — rename and/or pin. Body: { title?, pinned? }.
// Returns the updated chat.
router.patch('/:chatId', (req: AuthRequest, res: Response) => {
  const chat = chatRepo.findById(req.params.chatId);
  if (!chat || chat.user_id !== req.user!.id) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }
  const { title, pinned } = req.body ?? {};
  if (title === undefined && pinned === undefined) {
    res.status(400).json({ error: 'Nothing to update' });
    return;
  }
  let trimmed: string | undefined;
  if (title !== undefined) {
    trimmed = typeof title === 'string' ? title.trim().slice(0, 120) : '';
    if (!trimmed) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }
  }
  if (pinned !== undefined && typeof pinned !== 'boolean') {
    res.status(400).json({ error: 'pinned must be true or false' });
    return;
  }
  if (trimmed) chatRepo.rename(chat.id, trimmed);
  // Re-pinning an already pinned chat keeps its original pin time.
  if (pinned !== undefined && pinned !== (chat.pinned_at !== null)) chatRepo.setPinned(chat.id, pinned);
  const updated = chatRepo.findById(chat.id)!;
  res.json({ id: updated.id, title: updated.title, created_at: updated.created_at, updated_at: updated.updated_at, pinned_at: updated.pinned_at });
});

// DELETE /api/chats/:chatId — delete a chat (cascades to messages + documents)
router.delete('/:chatId', (req: AuthRequest, res: Response) => {
  const chat = chatRepo.findById(req.params.chatId);
  if (!chat || chat.user_id !== req.user!.id) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }
  chatRepo.delete(chat.id);
  res.json({ success: true });
});

export default router;
