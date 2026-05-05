import { Router, Response } from 'express';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { AuthRequest } from '../types.js';
import db from '../db/index.js';
import { getBillingUser } from '../lib/billing.js';
import { getEffectivePlan, getUsagePeriodStart } from '../lib/planLimits.js';
import { licenseKeyRepo } from '../db/repositories/licenseKeyRepo.js';
import { paymentRepo } from '../db/repositories/paymentRepo.js';

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

// GET /api/admin/users — includes IPs + per-user totals (requests,
//   tokens, cost, avg cost per 1M tokens) so the admin Users tab can
//   filter & sort by spend without expanding every card to fetch
//   the per-user details.
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

  // Cumulative totals per user (failed rows excluded — same filter
  // sumTokensThisMonth uses, so the numbers add up consistently).
  const totalsRows = db.prepare(`
    SELECT
      user_id,
      COUNT(*) AS requests,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cost), 0) AS cost
    FROM api_usage
    WHERE user_id IS NOT NULL
      AND COALESCE(status, 'success') != 'failed'
    GROUP BY user_id
  `).all() as Array<{
    user_id: string;
    requests: number;
    input_tokens: number;
    output_tokens: number;
    cost: number;
  }>;
  const totalsMap = new Map(totalsRows.map(r => [r.user_id, r]));
  const usdToInr = 85;

  res.json(users.map(u => {
    const t = totalsMap.get(u.id);
    const requests = t?.requests ?? 0;
    const inputTokens = t?.input_tokens ?? 0;
    const outputTokens = t?.output_tokens ?? 0;
    const totalTokens = inputTokens + outputTokens;
    const totalCostUsd = t?.cost ?? 0;
    const totalCostInr = Math.round(totalCostUsd * usdToInr * 100) / 100;
    const avgCostPer1MUsd = totalTokens > 0 ? (totalCostUsd / totalTokens) * 1_000_000 : 0;
    const avgCostPer1MInr = Math.round(avgCostPer1MUsd * usdToInr * 100) / 100;

    return {
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
      requests,
      total_tokens: totalTokens,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_cost_usd: totalCostUsd,
      total_cost_inr: totalCostInr,
      avg_cost_per_1m_usd: Math.round(avgCostPer1MUsd * 1000) / 1000,
      avg_cost_per_1m_inr: avgCostPer1MInr,
    };
  }));
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

// POST /api/admin/users/:id/plan — DISABLED.
//
// Plan changes now go exclusively through license-key issuance
// (POST /api/admin/licenses, landing in Stage 3 of the licensing
// rollout). Direct plan flips would silently bypass the audit
// trail, the renewal-tied expiry, and the invoice / receipt
// generation that ride the issuance flow.
router.post('/users/:id/plan', (_req: AuthRequest, res: Response) => {
  res.status(410).json({
    error: 'Direct plan changes are disabled. Use Generate License (in the admin Licenses tab) to change a user\'s plan — it issues a key, sets the expiry, and writes the audit row in one step.',
  });
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
  // in their own Settings page. "This period" = current yearly billing
  // window for paid users (resets only on Razorpay renewal); for free
  // trial users it covers their entire account lifetime (no reset).
  const billing = getBillingUser(user);
  const periodStart = getUsagePeriodStart(billing);
  const tokensThisPeriod = usageRepo.sumTokensSinceForBillingUser(billing.id, periodStart);
  const effectivePlan = getEffectivePlan(billing);
  const PLAN_BUDGETS: Record<string, number> = {
    free: 250_000, pro: 2_000_000, enterprise: 6_000_000,
  };
  const tokenBudget = PLAN_BUDGETS[effectivePlan] ?? PLAN_BUDGETS.free;

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
  // estimated_tokens is the gate's pre-flight estimate (only set on the
  // SUMMARY row of a request); 0 on per-chunk / failure / cancel rows.
  // Surfacing it lets the operator audit estimate-vs-actual and tune
  // the safety margin in tokenEstimate.ts.
  const recent = db.prepare(`
    SELECT
      id, input_tokens, output_tokens, estimated_tokens, cost, model, search_used,
      is_plugin, category, status, created_at
    FROM api_usage
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(id) as Array<{
    id: string;
    input_tokens: number;
    output_tokens: number;
    estimated_tokens: number;
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
    period: {
      tokensUsed: tokensThisPeriod,
      tokenBudget,
      periodStart,
      pct: tokenBudget > 0
        ? Math.min(100, Math.round((tokensThisPeriod / tokenBudget) * 1000) / 10)
        : 0,
    },
    // Legacy alias — older UIs read `.monthly` for the token bar.
    monthly: {
      tokensUsed: tokensThisPeriod,
      tokenBudget,
      pct: tokenBudget > 0
        ? Math.min(100, Math.round((tokensThisPeriod / tokenBudget) * 1000) / 10)
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

// ── Licensing endpoints ─────────────────────────────────────────────────
// All require admin auth (already enforced by router-level middleware
// at admin route registration in server/index.ts).

// GET /api/admin/licenses?search=&plan=&status=&page=
//   List licenses with filters + pagination. Joined user name/email
//   so the table doesn't need a per-row lookup on the client.
router.get('/licenses', (req: AuthRequest, res: Response) => {
  const search = typeof req.query.search === 'string' ? req.query.search : null;
  const plan = typeof req.query.plan === 'string' && req.query.plan ? req.query.plan : null;
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;
  const result = licenseKeyRepo.findAllForAdmin({ search, plan, status, limit, offset });
  res.json({ ...result, page, limit });
});

// GET /api/admin/users/:id/billing-prefill
//   Returns the saved billing details + most-recent offline payment
//   method/reference for a user, so the Generate License dialog can
//   pre-fill those fields when the admin issues another license to
//   the same person. Cuts the form down to "confirm and submit" on
//   repeat issuances.
router.get('/users/:id/billing-prefill', (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const user = userRepo.findById(id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  const billingDetails = userRepo.getBillingDetails(id);
  const lastOffline = paymentRepo.findLatestOfflineByUser(id);
  res.json({
    billingDetails: billingDetails ?? null,
    lastPaymentMethod: lastOffline?.payment_method ?? null,
    // Reference is intentionally NOT prefilled — cheque/UTR numbers
    // are per-payment, never reuse across renewals. We just surface
    // the last one as a hint in the UI.
    lastPaymentReference: lastOffline?.payment_reference ?? null,
  });
});

// POST /api/admin/licenses — issue an offline license (cash / cheque /
// NEFT / etc.). Always 12-month, plan ∈ {pro, enterprise}. Generates
// invoice + receipt PDFs and persists the user's billing details for
// reuse on the next renewal.
//   Body: {
//     userId: string,
//     plan: 'pro' | 'enterprise',
//     paymentMethod: 'cash' | 'cheque' | 'neft' | 'imps' | 'upi' | 'rtgs' | 'card' | 'other',
//     paymentReference?: string,         // cheque no, UTR, etc.
//     amount: number,                    // paise — always required, this is a paid grant
//     billingDetails: { name, addressLine1, ..., gstin? },
//     notes?: string,
//   }
const VALID_OFFLINE_PLANS = new Set(['pro', 'enterprise']);
const VALID_PAYMENT_METHODS = new Set(['cash', 'cheque', 'neft', 'imps', 'upi', 'rtgs', 'card', 'other']);
const PAYMENT_METHODS_NEEDING_REFERENCE = new Set(['cheque', 'neft', 'imps', 'upi', 'rtgs']);

router.post('/licenses', async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const { userId, plan, paymentMethod, paymentReference, amount, billingDetails, notes } = req.body ?? {};

  if (typeof userId !== 'string' || !userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }
  if (!VALID_OFFLINE_PLANS.has(plan)) {
    res.status(400).json({ error: 'plan must be "pro" or "enterprise" — free trials auto-issue at signup' });
    return;
  }
  if (!VALID_PAYMENT_METHODS.has(paymentMethod)) {
    res.status(400).json({ error: 'paymentMethod required (cash | cheque | neft | imps | upi | rtgs | card | other)' });
    return;
  }
  if (PAYMENT_METHODS_NEEDING_REFERENCE.has(paymentMethod) && (!paymentReference || !String(paymentReference).trim())) {
    res.status(400).json({ error: `paymentReference required for ${paymentMethod} (cheque/UTR/transaction id)` });
    return;
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'amount (in paise) is required and must be positive' });
    return;
  }
  if (!billingDetails || typeof billingDetails !== 'object') {
    res.status(400).json({ error: 'billingDetails is required' });
    return;
  }
  const bd = billingDetails as Record<string, unknown>;
  for (const field of ['name', 'addressLine1', 'city', 'state', 'pincode']) {
    if (typeof bd[field] !== 'string' || !(bd[field] as string).trim()) {
      res.status(400).json({ error: `billingDetails.${field} is required` });
      return;
    }
  }

  const targetUser = userRepo.findById(userId);
  if (!targetUser) { res.status(404).json({ error: 'User not found' }); return; }

  // Fixed 12-month window for offline issuance — matches the yearly
  // Razorpay cadence so admin and self-serve flows produce comparable
  // license periods. Renewal endpoint still accepts custom durations
  // for edge cases.
  const startsAt = new Date();
  const expiresAt = new Date(startsAt);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  const startStr = startsAt.toISOString().replace('Z', '');
  const expStr = expiresAt.toISOString().replace('Z', '');

  // Persist billing for reuse next time. Sanitised: trim every
  // string field; gstin is optional.
  const cleanBilling = {
    name: String(bd.name).trim(),
    addressLine1: String(bd.addressLine1).trim(),
    addressLine2: typeof bd.addressLine2 === 'string' ? bd.addressLine2.trim() : undefined,
    city: String(bd.city).trim(),
    state: String(bd.state).trim(),
    pincode: String(bd.pincode).trim(),
    gstin: typeof bd.gstin === 'string' && bd.gstin.trim() ? bd.gstin.trim() : undefined,
  };
  try { userRepo.setBillingDetails(userId, cleanBilling); }
  catch (err) { console.warn('[admin/licenses] failed to persist billing details:', err); }

  // Always create a payment row for offline issuances. Carries the
  // method + reference so the Payments tab can show how each
  // license was paid for. Tagged status='paid' immediately since
  // the admin only issues after collecting funds.
  let paymentRowId: string | null = null;
  try {
    const offlineOrderId = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    paymentRepo.create(
      userId, offlineOrderId, plan, 'yearly', amount,
      paymentMethod as 'cash' | 'cheque' | 'neft' | 'imps' | 'upi' | 'rtgs' | 'card' | 'other',
      typeof paymentReference === 'string' && paymentReference.trim() ? paymentReference.trim() : null,
    );
    paymentRepo.markPaid(offlineOrderId, `offline_pay_${Date.now()}`, expStr);
    paymentRowId = paymentRepo.findByOrderId(offlineOrderId)?.id ?? null;
  } catch (err) {
    console.error('[admin/licenses] payment row create failed:', err);
  }

  const license = licenseKeyRepo.issue({
    userId,
    plan: plan as 'pro' | 'enterprise',
    startsAt: startStr,
    expiresAt: expStr,
    generatedVia: 'offline',
    paymentId: paymentRowId,
    issuedByAdminId: req.user.id,
    issuedNotes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
  });

  res.json({
    license,
    paymentId: paymentRowId,
    // Always-on now — every offline grant gets both PDFs since we
    // captured the billing address upfront. Admin can choose not to
    // download either, but the URLs are always there.
    invoiceUrl: paymentRowId ? `/api/admin/payments/${paymentRowId}/invoice.pdf` : null,
    receiptUrl: paymentRowId ? `/api/admin/payments/${paymentRowId}/receipt.pdf` : null,
  });
});

// POST /api/admin/licenses/:id/renew — body: { durationMonths }
//   Generates a NEW key with status='active', supersedes the
//   targeted key. The user's license_key_id is updated to point at
//   the new row inside licenseKeyRepo.issue's transaction.
router.post('/licenses/:id/renew', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const { id } = req.params;
  const months = parseInt(String(req.body?.durationMonths ?? '12'), 10);
  if (!Number.isFinite(months) || months < 1 || months > 60) {
    res.status(400).json({ error: 'durationMonths must be 1..60' });
    return;
  }
  const existing = licenseKeyRepo.findById(id);
  if (!existing) { res.status(404).json({ error: 'License not found' }); return; }
  if (existing.plan === 'admin') {
    res.status(400).json({ error: 'ADMIN- licenses don\'t expire and cannot be renewed' });
    return;
  }
  const startsAt = new Date();
  const expiresAt = new Date(startsAt);
  expiresAt.setMonth(expiresAt.getMonth() + months);
  const license = licenseKeyRepo.issue({
    userId: existing.user_id,
    plan: existing.plan as 'free' | 'pro' | 'enterprise',
    startsAt: startsAt.toISOString().replace('Z', ''),
    expiresAt: expiresAt.toISOString().replace('Z', ''),
    generatedVia: 'offline',
    issuedByAdminId: req.user.id,
    issuedNotes: `Renewed from ${existing.key} for ${months} month(s)`,
  });
  res.json({ license });
});

// POST /api/admin/licenses/reconcile
//   Re-issue licenses for any user whose users.plan column doesn't
//   match their active license's plan. Used to clean up users whose
//   plan was edited directly (DB or the legacy /plan endpoint before
//   it was 410'd) without going through license issuance.
//
//   Each new license starts NOW and runs 1 year. The audit row
//   records the old key and the source of the mismatch. Admin can
//   manually adjust the new license's expires_at via Generate License
//   if the user's actual paid period started earlier than today.
router.post('/licenses/reconcile', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const result = licenseKeyRepo.reconcilePlanMismatches();
  res.json(result);
});

// POST /api/admin/licenses/:id/revoke — body: { reason? }
router.post('/licenses/:id/revoke', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const { id } = req.params;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : 'Revoked by admin';
  const existing = licenseKeyRepo.findById(id);
  if (!existing) { res.status(404).json({ error: 'License not found' }); return; }
  licenseKeyRepo.revoke(id, reason);
  // If this was the user's active license, demote them to free
  // immediately. (expirePastDue handles natural expiry; this is the
  // forced path.)
  if (existing.status === 'active' && existing.plan !== 'admin' && existing.plan !== 'free') {
    userRepo.updatePlan(existing.user_id, 'free');
  }
  res.json({ success: true });
});

// GET /api/admin/payments?search=&page= — paginated payment history
router.get('/payments', (req: AuthRequest, res: Response) => {
  const search = typeof req.query.search === 'string' ? req.query.search : null;
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;
  const { rows, total } = paymentRepo.findAllForAdmin({ search, limit, offset });
  // Resolve license_key_id per payment for the table's "License"
  // column. One JOIN would be cleaner but each payment has at most a
  // handful of rows — N+1 is fine at this volume.
  const enriched = rows.map(r => {
    const license = db.prepare('SELECT id, key, plan, status, expires_at FROM license_keys WHERE payment_id = ? LIMIT 1').get(r.id) as
      { id: string; key: string; plan: string; status: string; expires_at: string | null } | undefined;
    return { ...r, license: license ?? null };
  });
  res.json({ rows: enriched, total, page, limit });
});

// GET /api/admin/payments/:id/invoice.pdf — generate invoice on demand
// GET /api/admin/payments/:id/receipt.pdf — generate receipt on demand
router.get('/payments/:id/:kind(invoice|receipt).pdf', async (req: AuthRequest, res: Response) => {
  const { id, kind } = req.params as { id: string; kind: 'invoice' | 'receipt' };
  const pay = paymentRepo.findById(id);
  if (!pay) { res.status(404).json({ error: 'Payment not found' }); return; }
  const buyer = userRepo.findById(pay.user_id);
  if (!buyer) { res.status(404).json({ error: 'Payment user not found' }); return; }
  const billingDetails = userRepo.getBillingDetails(buyer.id);
  const { buildInvoiceBuffer, buildReceiptBuffer } = await import('../lib/serverPdf.js');
  const buildFn = kind === 'invoice' ? buildInvoiceBuffer : buildReceiptBuffer;
  const buffer = buildFn({
    id: pay.id, plan: pay.plan, billing: pay.billing,
    amount: pay.amount, paidAt: pay.paid_at, expiresAt: pay.expires_at,
  }, { name: buyer.name ?? '', email: buyer.email ?? '', billingDetails });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${kind}-${pay.id}.pdf"`);
  res.send(buffer);
});

export default router;
