import { Router, Response } from 'express';
import { chatRepo } from '../db/repositories/chatRepo.js';
import { messageRepo } from '../db/repositories/messageRepo.js';
import { AuthRequest } from '../types.js';

const router = Router();

// GET /api/chats — list user's chats
router.get('/', (req: AuthRequest, res: Response) => {
  const chats = chatRepo.findByUserId(req.user!.id);
  res.json(chats);
});

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

// PATCH /api/chats/:chatId — update chat title
router.patch('/:chatId', (req: AuthRequest, res: Response) => {
  const chat = chatRepo.findById(req.params.chatId);
  if (!chat || chat.user_id !== req.user!.id) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }
  const { title } = req.body;
  if (!title || typeof title !== 'string') {
    res.status(400).json({ error: 'Title is required' });
    return;
  }
  chatRepo.updateTitle(chat.id, title.trim());
  res.json({ success: true });
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
