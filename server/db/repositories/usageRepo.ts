import db from '../index.js';

export interface UsageByIp {
  ip: string;
  users: string; // comma-separated user names or "Guest"
  requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
}

export interface UsageStats {
  total_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  unique_ips: number;
  unique_users: number;
  total_search_calls: number;
}

export interface BlockedIp {
  ip: string;
  reason: string | null;
  blocked_until: string | null;
  created_at: string;
}

const stmts = {
  countByUser: db.prepare(
    'SELECT COUNT(*) AS count FROM api_usage WHERE user_id = ? AND created_at >= ?'
  ),
  countByBillingUser: db.prepare(
    'SELECT COUNT(*) AS count FROM api_usage WHERE billing_user_id = ? AND created_at >= ?'
  ),
  log: db.prepare(
    'INSERT INTO api_usage (ip, user_id, input_tokens, output_tokens, cost, is_plugin) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  logWithBilling: db.prepare(
    'INSERT INTO api_usage (ip, user_id, billing_user_id, input_tokens, output_tokens, cost, is_plugin, model, search_used, category, input_units, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  // Token quota query: sum input + output tokens for the current month
  // for THIS billing user, EXCLUDING failed calls. Cancelled calls
  // count because they consumed real Gemini tokens; failed calls don't
  // because they're typically retried successfully.
  //
  // The OR clause covers historic rows logged before billing_user_id
  // was wired in: those rows have NULL billing_user_id but the user_id
  // identifies who was billed (free users billed themselves; pre-CA-
  // hierarchy data can't roll up to a billing aggregate anyway). Without
  // this fallback, the admin "this period" widget reads 0 while the
  // cumulative "Total tokens" tile reads the real number — the mismatch
  // we hit on the Suresh Sethi free account.
  sumTokensThisMonthByBillingUser: db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
    FROM api_usage
    WHERE (billing_user_id = ? OR (billing_user_id IS NULL AND user_id = ?))
      AND created_at >= ?
      AND status != 'failed'
  `),
  getByIp: db.prepare(`
    SELECT
      a.ip,
      GROUP_CONCAT(DISTINCT COALESCE(u.name, 'Guest')) AS users,
      COUNT(*) AS requests,
      SUM(a.input_tokens) AS total_input_tokens,
      SUM(a.output_tokens) AS total_output_tokens,
      SUM(a.cost) AS total_cost
    FROM api_usage a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.created_at >= ?
    GROUP BY a.ip
    ORDER BY total_cost DESC
  `),
  getStats: db.prepare(`
    SELECT
      COUNT(*) AS total_requests,
      COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(cost), 0) AS total_cost,
      COUNT(DISTINCT ip) AS unique_ips,
      COUNT(DISTINCT user_id) AS unique_users,
      COALESCE(SUM(CASE WHEN search_used = 1 THEN 1 ELSE 0 END), 0) AS total_search_calls
    FROM api_usage
    WHERE created_at >= ?
  `),
  // Blocked IPs
  blockIp: db.prepare(
    'INSERT OR REPLACE INTO blocked_ips (ip, reason, blocked_until) VALUES (?, ?, ?)'
  ),
  unblockIp: db.prepare('DELETE FROM blocked_ips WHERE ip = ?'),
  isBlocked: db.prepare('SELECT * FROM blocked_ips WHERE ip = ?'),
  allBlocked: db.prepare('SELECT * FROM blocked_ips ORDER BY created_at DESC'),
};

export interface UsageByUser {
  user_id: string;
  user_name: string;
  user_email: string;
  user_plan: string;
  requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  avg_cost_per_msg: number;
  last_used: string;
}

export interface DailyUsage {
  date: string;
  requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
}

const analyticsStmts = {
  byUser: db.prepare(`
    SELECT
      a.user_id,
      COALESCE(u.name, 'Unknown') AS user_name,
      COALESCE(u.email, '') AS user_email,
      COALESCE(u.plan, 'free') AS user_plan,
      COUNT(*) AS requests,
      COALESCE(SUM(a.input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(a.output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(a.cost), 0) AS total_cost,
      COALESCE(SUM(a.cost) * 1.0 / NULLIF(COUNT(*), 0), 0) AS avg_cost_per_msg,
      MAX(a.created_at) AS last_used
    FROM api_usage a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.created_at >= ? AND a.user_id IS NOT NULL
    GROUP BY a.user_id
    ORDER BY total_cost DESC
  `),
  daily: db.prepare(`
    SELECT
      DATE(created_at) AS date,
      COUNT(*) AS requests,
      COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(cost), 0) AS total_cost
    FROM api_usage
    WHERE created_at >= ?
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `),
  recentRequests: db.prepare(`
    SELECT
      a.id, a.user_id, a.input_tokens, a.output_tokens, a.cost, a.created_at, a.model,
      COALESCE(u.name, 'Guest') AS user_name
    FROM api_usage a
    LEFT JOIN users u ON a.user_id = u.id
    ORDER BY a.created_at DESC
    LIMIT ?
  `),
  recentRequestsPaginated: db.prepare(`
    SELECT
      a.id, a.user_id, a.input_tokens, a.output_tokens, a.cost, a.created_at,
      a.model, a.search_used, a.is_plugin, a.category, a.input_units, a.status,
      COALESCE(u.name, 'Guest') AS user_name,
      COALESCE(u.email, '') AS user_email,
      COALESCE(u.plan, 'free') AS user_plan
    FROM api_usage a
    LEFT JOIN users u ON a.user_id = u.id
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?
  `),
  recentRequestsCount: db.prepare(`
    SELECT COUNT(*) AS count FROM api_usage
  `),
  byModel: db.prepare(`
    SELECT
      COALESCE(model, 'unknown') AS model,
      COUNT(*) AS requests,
      COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(cost), 0) AS total_cost,
      COALESCE(AVG(cost), 0) AS avg_cost
    FROM api_usage
    WHERE created_at >= ?
    GROUP BY model
    ORDER BY total_cost DESC
  `),
};

/** Start of current month in IST as the 'YYYY-MM-01 00:00:00' string
 *  the SQL queries match against created_at. Mirrors the helper in
 *  featureUsageRepo so the same month boundary is used by both the
 *  per-feature counters and the cross-feature token sum. */
function startOfMonthIST(): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return start.toISOString().replace('Z', '');
}

function periodToDate(period: string): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  if (period === 'day') now.setDate(now.getDate() - 1);
  else if (period === 'week') now.setDate(now.getDate() - 7);
  else now.setDate(1);
  return now.toISOString().replace('Z', '');
}

export const usageRepo = {
  countByUser(userId: string, since: string): number {
    const row = stmts.countByUser.get(userId, since) as { count: number };
    return row.count;
  },

  /** Count usage against a billing (pool) user. Used by shared-plan limit checks. */
  countByBillingUser(billingUserId: string, since: string): number {
    const row = stmts.countByBillingUser.get(billingUserId, since) as { count: number };
    return row.count;
  },

  log(ip: string, userId: string | null, inputTokens: number, outputTokens: number, cost: number, isPlugin: boolean): void {
    stmts.log.run(ip, userId, inputTokens, outputTokens, cost, isPlugin ? 1 : 0);
  },

  /** Log usage with both actor (user_id) and billing (billing_user_id) ids.
   *  inputUnits is the user-input size in the unit that matters for the
   *  category (transactions for bank/ledger, pages for notice/document,
   *  message count for chat/suggestion). Defaults to 0 — admin UI shows
   *  '—' for legacy / non-applicable rows.
   *  status: 'success' (default) | 'cancelled' | 'failed'. Token quota
   *  counts success + cancelled but excludes failed. */
  logWithBilling(
    ip: string,
    userId: string,
    billingUserId: string,
    inputTokens: number,
    outputTokens: number,
    cost: number,
    isPlugin: boolean,
    model?: string,
    searchUsed?: boolean,
    category?: string,
    inputUnits?: number,
    status?: 'success' | 'cancelled' | 'failed',
  ): void {
    stmts.logWithBilling.run(ip, userId, billingUserId, inputTokens, outputTokens, cost, isPlugin ? 1 : 0, model ?? null, searchUsed ? 1 : 0, category ?? null, inputUnits ?? 0, status ?? 'success');
  },

  /** Sum tokens (input+output) used since `since` by this billing user,
   *  excluding 'failed' calls. Used by enforceTokenQuota.
   *
   *  `since` should be the user's usage-period start (see
   *  getUsagePeriodStart in planLimits.ts) — a one-year window for paid
   *  yearly subscribers (resets on Razorpay renewal) or the user's
   *  created_at for free-trial users (never resets; lockout at 30 days). */
  sumTokensSinceForBillingUser(billingUserId: string, since: string): number {
    // Pass billingUserId twice: once for the canonical billing_user_id
    // match, once for the NULL-fallback path that keys off user_id for
    // historic rows. See the prepared statement comment above.
    const row = stmts.sumTokensThisMonthByBillingUser.get(billingUserId, billingUserId, since) as { tokens: number };
    return row.tokens ?? 0;
  },

  getByIp(period: string = 'month'): UsageByIp[] {
    return stmts.getByIp.all(periodToDate(period)) as UsageByIp[];
  },

  getStats(period: string = 'month'): UsageStats {
    return stmts.getStats.get(periodToDate(period)) as UsageStats;
  },

  // IP blocking
  blockIp(ip: string, hours: number, reason?: string): void {
    const until = new Date(Date.now() + hours * 60 * 60 * 1000 + 5.5 * 60 * 60 * 1000);
    const untilStr = until.toISOString().replace('Z', '').replace('T', ' ').slice(0, 19);
    stmts.blockIp.run(ip, reason ?? null, untilStr);
  },

  unblockIp(ip: string): void {
    stmts.unblockIp.run(ip);
  },

  isBlocked(ip: string): BlockedIp | null {
    const row = stmts.isBlocked.get(ip) as BlockedIp | undefined;
    if (!row) return null;
    // Check expiry
    if (row.blocked_until) {
      const until = new Date(row.blocked_until + '+05:30');
      if (until <= new Date()) {
        stmts.unblockIp.run(ip);
        return null;
      }
    }
    return row;
  },

  allBlocked(): BlockedIp[] {
    return stmts.allBlocked.all() as BlockedIp[];
  },

  // ── Analytics (admin dashboard) ──────────────────────────────────────

  getByUser(period: string = 'month'): UsageByUser[] {
    return analyticsStmts.byUser.all(periodToDate(period)) as UsageByUser[];
  },

  getDailyUsage(period: string = 'month'): DailyUsage[] {
    return analyticsStmts.daily.all(periodToDate(period)) as DailyUsage[];
  },

  getByModel(period: string = 'month'): Array<{
    model: string; requests: number; total_input_tokens: number;
    total_output_tokens: number; total_cost: number; avg_cost: number;
  }> {
    return analyticsStmts.byModel.all(periodToDate(period)) as any[];
  },

  getRecentRequests(limit: number = 50): Array<{
    id: number; user_id: string; input_tokens: number; output_tokens: number;
    cost: number; created_at: string; user_name: string;
  }> {
    return analyticsStmts.recentRequests.all(limit) as any[];
  },

  getRecentRequestsPaginated(limit: number, offset: number): Array<{
    id: number; user_id: string | null; input_tokens: number; output_tokens: number;
    cost: number; created_at: string; model: string | null; search_used: number; is_plugin: number;
    category: string | null; input_units: number; status: string; user_name: string; user_email: string; user_plan: string;
  }> {
    return analyticsStmts.recentRequestsPaginated.all(limit, offset) as any[];
  },

  countRecentRequests(): number {
    const row = analyticsStmts.recentRequestsCount.get() as { count: number };
    return row.count;
  },
};
