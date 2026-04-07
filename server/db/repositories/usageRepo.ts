import db from '../index.js';

export interface UsageRow {
  id: number;
  ip: string;
  user_id: string | null;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  is_plugin: number;
  created_at: string;
}

export interface UsageAggregation {
  ip: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
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
}

const stmts = {
  log: db.prepare(
    'INSERT INTO api_usage (ip, user_id, input_tokens, output_tokens, cost, is_plugin) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  getAll: db.prepare(`
    SELECT
      a.ip,
      a.user_id,
      u.email AS user_email,
      u.name AS user_name,
      COUNT(*) AS requests,
      SUM(a.input_tokens) AS total_input_tokens,
      SUM(a.output_tokens) AS total_output_tokens,
      SUM(a.cost) AS total_cost
    FROM api_usage a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.created_at >= ?
    GROUP BY a.ip, a.user_id
    ORDER BY total_cost DESC
  `),
  getGuests: db.prepare(`
    SELECT
      a.ip,
      COUNT(*) AS requests,
      SUM(a.input_tokens) AS total_input_tokens,
      SUM(a.output_tokens) AS total_output_tokens,
      SUM(a.cost) AS total_cost
    FROM api_usage a
    WHERE a.user_id IS NULL AND a.created_at >= ?
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
      COUNT(DISTINCT user_id) AS unique_users
    FROM api_usage
    WHERE created_at >= ?
  `),
};

function periodToDate(period: string): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // IST
  if (period === 'day') now.setDate(now.getDate() - 1);
  else if (period === 'week') now.setDate(now.getDate() - 7);
  else now.setDate(1); // month — from 1st
  return now.toISOString().replace('Z', '');
}

export const usageRepo = {
  log(ip: string, userId: string | null, inputTokens: number, outputTokens: number, cost: number, isPlugin: boolean): void {
    stmts.log.run(ip, userId, inputTokens, outputTokens, cost, isPlugin ? 1 : 0);
  },

  getAll(period: string = 'month'): UsageAggregation[] {
    return stmts.getAll.all(periodToDate(period)) as UsageAggregation[];
  },

  getGuests(period: string = 'month'): Omit<UsageAggregation, 'user_id' | 'user_email' | 'user_name'>[] {
    return stmts.getGuests.all(periodToDate(period)) as Omit<UsageAggregation, 'user_id' | 'user_email' | 'user_name'>[];
  },

  getStats(period: string = 'month'): UsageStats {
    return stmts.getStats.get(periodToDate(period)) as UsageStats;
  },
};
