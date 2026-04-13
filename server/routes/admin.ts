import { Router, Response } from 'express';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { AuthRequest } from '../types.js';
import db from '../db/index.js';

const router = Router();

// GET /api/admin/stats
router.get('/stats', (req: AuthRequest, res: Response) => {
  const period = (req.query.period as string) ?? 'month';
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

// GET /api/admin/users — includes IPs per user
router.get('/users', (_req: AuthRequest, res: Response) => {
  const users = userRepo.findAll();

  // Get distinct IPs per user from api_usage
  const ipsByUser = db.prepare(`
    SELECT user_id, GROUP_CONCAT(DISTINCT ip) AS ips
    FROM api_usage
    WHERE user_id IS NOT NULL
    GROUP BY user_id
  `).all() as { user_id: string; ips: string }[];

  const ipMap = new Map(ipsByUser.map(r => [r.user_id, r.ips]));

  res.json(users.map(u => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    plan: u.plan ?? 'free',
    suspended_until: u.suspended_until,
    created_at: u.created_at,
    chat_count: u.chat_count,
    message_count: u.message_count,
    ips: ipMap.get(u.id) || '',
  })));
});

// GET /api/admin/usage — grouped by IP (kept for stats)
router.get('/usage', (req: AuthRequest, res: Response) => {
  const period = (req.query.period as string) ?? 'month';
  const usage = usageRepo.getByIp(period);
  res.json(usage);
});

// POST /api/admin/users/:id/plan — change user's plan
router.post('/users/:id/plan', (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { plan } = req.body;
  if (!['free', 'pro', 'enterprise'].includes(plan)) {
    res.status(400).json({ error: 'Invalid plan. Must be free, pro, or enterprise.' });
    return;
  }
  const user = userRepo.findById(id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  const wasEnterprise = user.plan === 'enterprise';
  userRepo.updatePlan(id, plan);
  // If an enterprise account is being downgraded, detach any team members so
  // their future usage routes to themselves rather than an ex-inviter pool.
  // Historical usage rows keep their old billing_user_id for audit.
  if (wasEnterprise && plan !== 'enterprise') {
    userRepo.detachAllInvitees(id);
  }
  res.json({ success: true });
});

// POST /api/admin/users/:id/suspend
router.post('/users/:id/suspend', (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { hours } = req.body;
  const user = userRepo.findById(id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  if (user.role === 'admin') { res.status(400).json({ error: 'Cannot suspend admin' }); return; }
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
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  userRepo.suspend(id, null);
  res.json({ success: true });
});

// GET /api/admin/stats/trend — daily cost/usage for last 30 days
router.get('/stats/trend', (_req: AuthRequest, res: Response) => {
  const rows = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as requests, SUM(cost) as cost, COUNT(DISTINCT user_id) as users
    FROM api_usage
    WHERE created_at >= date('now', '-30 days')
    GROUP BY day
    ORDER BY day
  `).all() as { day: string; requests: number; cost: number; users: number }[];

  res.json({ trend: rows });
});

// GET /api/admin/stats/plans — user count by plan
router.get('/stats/plans', (_req: AuthRequest, res: Response) => {
  const rows = db.prepare('SELECT plan, COUNT(*) as count FROM users GROUP BY plan').all() as { plan: string; count: number }[];

  res.json({ plans: rows });
});

// ── API Cost Analytics Dashboard ──────────────────────────────────────────

// GET /api/admin/api-costs — detailed cost breakdown by user, daily trend, recent requests
router.get('/api-costs', (req: AuthRequest, res: Response) => {
  const period = (req.query.period as string) ?? 'month';

  const stats = usageRepo.getStats(period);
  const byUser = usageRepo.getByUser(period);
  const daily = usageRepo.getDailyUsage(period);
  const recent = usageRepo.getRecentRequests(100);

  // Cost by plan tier
  const costByPlan: Record<string, { requests: number; cost: number; users: number }> = {};
  for (const u of byUser) {
    const plan = u.user_plan || 'free';
    if (!costByPlan[plan]) costByPlan[plan] = { requests: 0, cost: 0, users: 0 };
    costByPlan[plan].requests += u.requests;
    costByPlan[plan].cost += u.total_cost;
    costByPlan[plan].users += 1;
  }

  // INR conversion (approximate)
  const usdToInr = 85;

  res.json({
    period,
    summary: {
      totalRequests: stats.total_requests,
      totalInputTokens: stats.total_input_tokens,
      totalOutputTokens: stats.total_output_tokens,
      totalCostUsd: stats.total_cost,
      totalCostInr: Math.round(stats.total_cost * usdToInr * 100) / 100,
      avgCostPerMsgUsd: stats.total_requests > 0 ? stats.total_cost / stats.total_requests : 0,
      avgCostPerMsgInr: stats.total_requests > 0 ? Math.round((stats.total_cost / stats.total_requests) * usdToInr * 1000) / 1000 : 0,
      uniqueUsers: stats.unique_users,
    },
    costByPlan,
    byUser: byUser.map(u => ({
      ...u,
      total_cost_inr: Math.round(u.total_cost * usdToInr * 100) / 100,
      avg_cost_per_msg_inr: Math.round(u.avg_cost_per_msg * usdToInr * 1000) / 1000,
    })),
    daily: daily.map(d => ({
      ...d,
      total_cost_inr: Math.round(d.total_cost * usdToInr * 100) / 100,
    })),
    recent: recent.map(r => ({
      ...r,
      cost_inr: Math.round(r.cost * usdToInr * 1000) / 1000,
    })),
  });
});

export default router;
