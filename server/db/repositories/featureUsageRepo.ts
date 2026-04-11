import db from '../index.js';

const stmts = {
  log: db.prepare('INSERT INTO feature_usage (user_id, feature) VALUES (?, ?)'),
  logWithBilling: db.prepare(
    'INSERT INTO feature_usage (user_id, billing_user_id, feature) VALUES (?, ?, ?)'
  ),
  countByUserSince: db.prepare(
    'SELECT COUNT(*) as count FROM feature_usage WHERE user_id = ? AND feature = ? AND created_at >= ?'
  ),
  countByBillingUserSince: db.prepare(
    'SELECT COUNT(*) as count FROM feature_usage WHERE billing_user_id = ? AND feature = ? AND created_at >= ?'
  ),
};

/** Start of current month in IST (YYYY-MM-01 00:00:00) */
function startOfMonthIST(): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return start.toISOString().replace('Z', '');
}

export const featureUsageRepo = {
  log(userId: string, feature: string): void {
    stmts.log.run(userId, feature);
  },

  /** Log usage with both actor (user_id) and billing (billing_user_id) ids. */
  logWithBilling(userId: string, billingUserId: string, feature: string): void {
    stmts.logWithBilling.run(userId, billingUserId, feature);
  },

  countThisMonth(userId: string, feature: string): number {
    const since = startOfMonthIST();
    const row = stmts.countByUserSince.get(userId, feature, since) as { count: number };
    return row.count;
  },

  countThisMonthByBillingUser(billingUserId: string, feature: string): number {
    const since = startOfMonthIST();
    const row = stmts.countByBillingUserSince.get(billingUserId, feature, since) as { count: number };
    return row.count;
  },
};
