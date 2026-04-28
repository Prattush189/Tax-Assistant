import db from '../index.js';

const stmts = {
  log: db.prepare('INSERT INTO feature_usage (user_id, feature, credits_used) VALUES (?, ?, ?)'),
  logWithBilling: db.prepare(
    'INSERT INTO feature_usage (user_id, billing_user_id, feature, credits_used) VALUES (?, ?, ?, ?)'
  ),
  // Counts ROWS (pre-credits accounting) — kept for any feature that
  // hasn't migrated to the credit model yet. Bank statement and
  // ledger now use the sum-of-credits queries below.
  countByUserSince: db.prepare(
    'SELECT COUNT(*) as count FROM feature_usage WHERE user_id = ? AND feature = ? AND created_at >= ?'
  ),
  countByBillingUserSince: db.prepare(
    'SELECT COUNT(*) as count FROM feature_usage WHERE billing_user_id = ? AND feature = ? AND created_at >= ?'
  ),
  // Sums the credits_used column. Legacy rows default to 1 credit
  // each (set by the schema default), so a feature switching from
  // count() to sum() doesn't lose history — just treats every old
  // run as one credit's worth.
  sumByUserSince: db.prepare(
    'SELECT COALESCE(SUM(credits_used), 0) as total FROM feature_usage WHERE user_id = ? AND feature = ? AND created_at >= ?'
  ),
  sumByBillingUserSince: db.prepare(
    'SELECT COALESCE(SUM(credits_used), 0) as total FROM feature_usage WHERE billing_user_id = ? AND feature = ? AND created_at >= ?'
  ),
};

/** Start of current month in IST (YYYY-MM-01 00:00:00) */
function startOfMonthIST(): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return start.toISOString().replace('Z', '');
}

export const featureUsageRepo = {
  /** Log a feature run. `credits` defaults to 1 for backwards compatibility
   *  with callers that still bill per-run; pass an explicit value for the
   *  bank-statement / ledger flows where credits depend on pages processed. */
  log(userId: string, feature: string, credits = 1): void {
    stmts.log.run(userId, feature, Math.max(0, Math.floor(credits)));
  },

  /** Log usage with both actor (user_id) and billing (billing_user_id) ids. */
  logWithBilling(userId: string, billingUserId: string, feature: string, credits = 1): void {
    stmts.logWithBilling.run(userId, billingUserId, feature, Math.max(0, Math.floor(credits)));
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

  /** Sum credits_used for the current month. Used by the credits-based
   *  quota check (bank statement + ledger). */
  sumCreditsThisMonth(userId: string, feature: string): number {
    const since = startOfMonthIST();
    const row = stmts.sumByUserSince.get(userId, feature, since) as { total: number };
    return row.total ?? 0;
  },

  sumCreditsThisMonthByBillingUser(billingUserId: string, feature: string): number {
    const since = startOfMonthIST();
    const row = stmts.sumByBillingUserSince.get(billingUserId, feature, since) as { total: number };
    return row.total ?? 0;
  },
};
