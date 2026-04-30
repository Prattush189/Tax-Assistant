import { Router, Response } from 'express';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { AuthRequest } from '../types.js';
import db from '../db/index.js';
import { getBillingUser } from '../lib/billing.js';
import { getEffectivePlan } from '../lib/planLimits.js';

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

// POST /api/admin/usage/reset-self — admin-only, scoped to the
// admin's OWN billing user. Wipes the current month's feature_usage
// rows so the calling admin's quota counters reset to 0 without
// waiting for the calendar rollover. Useful for testing and for the
// admin's own self-service when they hit a limit while QA-ing.
//
// Hard rules:
//   - This route ONLY clears rows for `billing_user_id = <admin's
//     own billing user>`. Cannot be used to reset another user's
//     quota — there's no `:userId` param on purpose.
//   - Only deletes feature_usage rows (the quota source). Does NOT
//     touch api_usage (the cost ledger), bank_statements / ledger_
//     scrutiny_jobs row history, or the per-key Gemini search quota.
//   - adminMiddleware on the parent /api/admin mount is the auth
//     gate; non-admin requests never reach this handler.
router.post('/usage/reset-self', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const actor = userRepo.findById(req.user.id);
  if (!actor) { res.status(404).json({ error: 'User not found' }); return; }
  const billingUser = getBillingUser(actor);

  // Same start-of-month-IST cutoff used by featureUsageRepo's read
  // queries — keeps the reset semantically equivalent to the calendar
  // rollover (everything from the 1st of the IST month, inclusive).
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const since = start.toISOString().replace('Z', '');

  // Two tables to clear:
  //   - feature_usage:  per-feature soft counters (notices, deeds, etc.)
  //   - api_usage:      actual Gemini token logs — what the
  //                     enforceTokenQuota gate sums for the hard
  //                     monthly budget. Without clearing this too,
  //                     "reset my usage" zeros the dashboard counters
  //                     but the token-quota gate keeps rejecting.
  let featureRowsCleared = 0;
  let apiRowsCleared = 0;
  try {
    const featureResult = db.prepare('DELETE FROM feature_usage WHERE billing_user_id = ? AND created_at >= ?').run(billingUser.id, since);
    featureRowsCleared = featureResult.changes;
    const apiResult = db.prepare('DELETE FROM api_usage WHERE billing_user_id = ? AND created_at >= ?').run(billingUser.id, since);
    apiRowsCleared = apiResult.changes;
  } catch (err) {
    console.error('[admin] usage reset-self failed', err);
    res.status(500).json({ error: 'Reset failed', detail: (err as Error).message?.slice(0, 200) });
    return;
  }
  console.log(`[admin] ${actor.email ?? actor.id} reset their own monthly usage (feature_usage: ${featureRowsCleared}, api_usage: ${apiRowsCleared} rows cleared)`);
  res.json({
    success: true,
    cleared: featureRowsCleared + apiRowsCleared,
    featureRowsCleared,
    apiRowsCleared,
    billingUserId: billingUser.id,
  });
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

// GET /api/admin/users/:id/details — detailed cost / token / call breakdown
//   for a single user. Powers the expandable user-card view in the admin UI.
//   Returns: cumulative + month tokens & cost, monthly token budget, last
//   30 days daily history, recent 50 api_usage rows.
router.get('/users/:id/details', (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const user = userRepo.findById(id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  // Token budget — uses the same effective-plan resolver the runtime
  // quota guard uses, so the bar matches what the user actually sees
  // in their own Settings page.
  const billing = getBillingUser(user);
  const tokensThisMonth = usageRepo.sumTokensThisMonthByBillingUser(billing.id);
  const effectivePlan = getEffectivePlan(billing);
  const PLAN_BUDGETS: Record<string, number> = {
    free: 250_000, pro: 2_000_000, enterprise: 6_000_000,
  };
  const monthlyTokenBudget = PLAN_BUDGETS[effectivePlan] ?? PLAN_BUDGETS.free;

  // Cumulative totals across api_usage (excluding failed). Same filter
  // sumTokensThisMonth uses, so totals add up.
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS requests,
      COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(cost), 0) AS total_cost,
      MAX(created_at) AS last_used
    FROM api_usage
    WHERE user_id = ? AND COALESCE(status, 'success') != 'failed'
  `).get(id) as {
    requests: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost: number;
    last_used: string | null;
  };

  // Daily history — last 30 days, one row per day (gaps fine, UI fills 0s).
  const daily = db.prepare(`
    SELECT
      DATE(created_at) AS date,
      COUNT(*) AS requests,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cost), 0) AS cost
    FROM api_usage
    WHERE user_id = ?
      AND COALESCE(status, 'success') != 'failed'
      AND created_at >= datetime('now', '-30 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all(id) as Array<{
    date: string;
    requests: number;
    input_tokens: number;
    output_tokens: number;
    cost: number;
  }>;

  // Recent 50 api_usage rows — what the cards expand to show.
  const recent = db.prepare(`
    SELECT
      id, input_tokens, output_tokens, cost, model, search_used,
      is_plugin, category, status, created_at
    FROM api_usage
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(id) as Array<{
    id: string;
    input_tokens: number;
    output_tokens: number;
    cost: number;
    model: string | null;
    search_used: number;
    is_plugin: number;
    category: string | null;
    status: string | null;
    created_at: string;
  }>;

  // Avg cost per 1M tokens — what the user actually wants to see at a
  // glance, normalised across input + output. Guard against div-by-zero.
  const totalTokens = totals.total_input_tokens + totals.total_output_tokens;
  const avgCostPer1MUsd = totalTokens > 0 ? (totals.total_cost / totalTokens) * 1_000_000 : 0;
  const usdToInr = 85;

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      plan: user.plan,
      effectivePlan,
      role: user.role,
      created_at: user.created_at,
      suspended_until: user.suspended_until,
    },
    totals: {
      requests: totals.requests,
      inputTokens: totals.total_input_tokens,
      outputTokens: totals.total_output_tokens,
      totalTokens,
      totalCostUsd: totals.total_cost,
      totalCostInr: Math.round(totals.total_cost * usdToInr * 100) / 100,
      avgCostPer1MUsd: Math.round(avgCostPer1MUsd * 1000) / 1000,
      avgCostPer1MInr: Math.round(avgCostPer1MUsd * usdToInr * 100) / 100,
      lastUsed: totals.last_used,
    },
    monthly: {
      tokensUsed: tokensThisMonth,
      tokenBudget: monthlyTokenBudget,
      pct: monthlyTokenBudget > 0
        ? Math.min(100, Math.round((tokensThisMonth / monthlyTokenBudget) * 1000) / 10)
        : 0,
    },
    daily: daily.map(d => ({
      ...d,
      cost_inr: Math.round(d.cost * usdToInr * 1000) / 1000,
    })),
    recent: recent.map(r => ({
      ...r,
      cost_inr: Math.round(r.cost * usdToInr * 1000) / 1000,
    })),
  });
});

// GET /api/admin/stats/plans — user count by plan
router.get('/stats/plans', (_req: AuthRequest, res: Response) => {
  const rows = db.prepare('SELECT plan, COUNT(*) as count FROM users GROUP BY plan').all() as { plan: string; count: number }[];

  res.json({ plans: rows });
});

import { getQuotaStatus, getGeminiConfig, setGeminiLimits, setActiveKey } from '../lib/searchQuota.js';
import { getRateLimiterStatus } from '../lib/rateLimiter.js';
import { getBreakerStatus } from '../lib/circuitBreaker.js';

// ── API Cost Analytics Dashboard ──────────────────────────────────────────

// GET /api/admin/api-costs — detailed cost breakdown by user, daily trend, recent requests
router.get('/api-costs', (req: AuthRequest, res: Response) => {
  const period = (req.query.period as string) ?? 'month';

  const stats = usageRepo.getStats(period);
  const byUser = usageRepo.getByUser(period);
  const daily = usageRepo.getDailyUsage(period);
  const recent = usageRepo.getRecentRequests(100);
  const byModel = usageRepo.getByModel(period);

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

  const quota = getQuotaStatus();

  res.json({
    period,
    searchQuota: quota,
    rateLimits: getRateLimiterStatus(),
    circuitBreakers: getBreakerStatus(),
    summary: {
      totalRequests: stats.total_requests,
      totalInputTokens: stats.total_input_tokens,
      totalOutputTokens: stats.total_output_tokens,
      totalCostUsd: stats.total_cost,
      totalCostInr: Math.round(stats.total_cost * usdToInr * 100) / 100,
      avgCostPerMsgUsd: stats.total_requests > 0 ? stats.total_cost / stats.total_requests : 0,
      avgCostPerMsgInr: stats.total_requests > 0 ? Math.round((stats.total_cost / stats.total_requests) * usdToInr * 1000) / 1000 : 0,
      uniqueUsers: stats.unique_users,
      totalSearchCalls: stats.total_search_calls,
      searchPct: stats.total_requests > 0 ? Math.round((stats.total_search_calls / stats.total_requests) * 1000) / 10 : 0,
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
    byModel: byModel.map(m => ({
      ...m,
      total_cost_inr: Math.round(m.total_cost * usdToInr * 100) / 100,
      avg_cost_inr: Math.round(m.avg_cost * usdToInr * 1000) / 1000,
    })),
  });
});

// ── Recent API Calls (paginated, full history) ─────────────────────────────

// GET /api/admin/recent-calls?limit=100&offset=0
router.get('/recent-calls', (req: AuthRequest, res: Response) => {
  const usdToInr = 85;
  const limitRaw = parseInt((req.query.limit as string) ?? '100', 10);
  const offsetRaw = parseInt((req.query.offset as string) ?? '0', 10);
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 100));
  const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);

  const calls = usageRepo.getRecentRequestsPaginated(limit, offset).map(r => ({
    ...r,
    search_used: !!r.search_used,
    is_plugin: !!r.is_plugin,
    category: r.category ?? null,
    cost_inr: Math.round(r.cost * usdToInr * 10000) / 10000,
  }));
  const total = usageRepo.countRecentRequests();

  res.json({ total, limit, offset, calls });
});

// ── Gemini config (mutable limits + active key) ────────────────────────────

// GET /api/admin/gemini-config
router.get('/gemini-config', (_req: AuthRequest, res: Response) => {
  res.json(getGeminiConfig());
});

// POST /api/admin/gemini-limits — body: { t1Limit?, t2Limit? }
// Server clamps each value to [0, DEFAULT_*_LIMIT]; admin cannot raise above free tier.
router.post('/gemini-limits', (req: AuthRequest, res: Response) => {
  const { t1Limit, t2Limit } = req.body ?? {};
  if (t1Limit !== undefined && (typeof t1Limit !== 'number' || !Number.isFinite(t1Limit) || t1Limit < 0)) {
    res.status(400).json({ error: 't1Limit must be a non-negative number' });
    return;
  }
  if (t2Limit !== undefined && (typeof t2Limit !== 'number' || !Number.isFinite(t2Limit) || t2Limit < 0)) {
    res.status(400).json({ error: 't2Limit must be a non-negative number' });
    return;
  }
  setGeminiLimits({ t1Limit, t2Limit });
  res.json(getGeminiConfig());
});

// POST /api/admin/active-key — body: { keyIndex: number }
router.post('/active-key', (req: AuthRequest, res: Response) => {
  const { keyIndex } = req.body ?? {};
  if (!setActiveKey(keyIndex)) {
    res.status(400).json({ error: 'Invalid keyIndex' });
    return;
  }
  res.json(getGeminiConfig());
});

export default router;
