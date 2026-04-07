import { Router, Response } from 'express';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { AuthRequest } from '../types.js';
import db from '../db/index.js';

const router = Router();

// GET /api/admin/stats — dashboard summary
router.get('/stats', (_req: AuthRequest, res: Response) => {
  const period = (_req.query.period as string) ?? 'month';
  const stats = usageRepo.getStats(period);
  const totalUsers = (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;
  const totalChats = (db.prepare('SELECT COUNT(*) AS count FROM chats').get() as { count: number }).count;
  const totalMessages = (db.prepare('SELECT COUNT(*) AS count FROM messages').get() as { count: number }).count;

  res.json({
    ...stats,
    total_users: totalUsers,
    total_chats: totalChats,
    total_messages: totalMessages,
  });
});

// GET /api/admin/users — list all users with stats
router.get('/users', (_req: AuthRequest, res: Response) => {
  const users = userRepo.findAll();
  res.json(users.map(u => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    suspended_until: u.suspended_until,
    created_at: u.created_at,
    chat_count: u.chat_count,
    message_count: u.message_count,
  })));
});

// GET /api/admin/usage — aggregated usage per IP/user
router.get('/usage', (req: AuthRequest, res: Response) => {
  const period = (req.query.period as string) ?? 'month';
  const usage = usageRepo.getAll(period);
  res.json(usage);
});

// GET /api/admin/usage/guests — guest (non-registered) usage
router.get('/usage/guests', (req: AuthRequest, res: Response) => {
  const period = (req.query.period as string) ?? 'month';
  const usage = usageRepo.getGuests(period);
  res.json(usage);
});

// POST /api/admin/users/:id/suspend — suspend a user
router.post('/users/:id/suspend', (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { hours } = req.body;

  const user = userRepo.findById(id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  if (user.role === 'admin') {
    res.status(400).json({ error: 'Cannot suspend admin accounts' });
    return;
  }

  const h = typeof hours === 'number' && hours > 0 ? hours : 24;
  const until = new Date(Date.now() + h * 60 * 60 * 1000 + 5.5 * 60 * 60 * 1000);
  const untilStr = until.toISOString().replace('Z', '').replace('T', ' ').slice(0, 19);
  userRepo.suspend(id, untilStr);

  res.json({ success: true, suspended_until: untilStr });
});

// POST /api/admin/users/:id/unsuspend
router.post('/users/:id/unsuspend', (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const user = userRepo.findById(id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  userRepo.suspend(id, null);
  res.json({ success: true });
});

export default router;
