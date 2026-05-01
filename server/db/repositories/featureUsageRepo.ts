import db from '../index.js';

const stmts = {
  log: db.prepare('INSERT INTO feature_usage (user_id, feature, credits_used) VALUES (?, ?, ?)'),
  logWithBilling: db.prepare(
    'INSERT INTO feature_usage (user_id, billing_user_id, feature, credits_used) VALUES (?, ?, ?, ?)'
  ),
  // Counts ROWS (pre-credits accounting) — kept for any feature that
  // hasn't migrated to the credit model yet. Bank statement and
  // ledger now use the sum-of-credits queries below.
  countByBillingUserSince: db.prepare(
    'SELECT COUNT(*) as count FROM feature_usage WHERE billing_user_id = ? AND feature = ? AND created_at >= ?'
  ),
  // Sums the credits_used column. Legacy rows default to 1 credit
  // each (set by the schema default), so a feature switching from
  // count() to sum() doesn't lose history — just treats every old
  // run as one credit's worth.
  sumByBillingUserSince: db.prepare(
    'SELECT COALESCE(SUM(credits_used), 0) as total FROM feature_usage WHERE billing_user_id = ? AND feature = ? AND created_at >= ?'
  ),
};

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

  /** Count feature runs since `since` for a billing user. Caller passes
   *  the user's usage-period start (yearly billing window for paid users,
   *  account lifetime for free-trial users — see getUsagePeriodStart). */
  countSinceForBillingUser(billingUserId: string, feature: string, since: string): number {
    const row = stmts.countByBillingUserSince.get(billingUserId, feature, since) as { count: number };
    return row.count;
  },

  /** Sum credits_used since `since` for a billing user. Same semantics
   *  as countSinceForBillingUser; used for credit-billed features
   *  (bank-statement analyzer, ledger scrutiny). */
  sumCreditsSinceForBillingUser(billingUserId: string, feature: string, since: string): number {
    const row = stmts.sumByBillingUserSince.get(billingUserId, feature, since) as { total: number };
    return row.total ?? 0;
  },
};
