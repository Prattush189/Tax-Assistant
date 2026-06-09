/**
 * Bank-statement anomaly detector — Phase 2 of the reconciliation
 * upgrade. Runs after the classifier persists transactions; flags
 * rows that need a human eyeball.
 *
 * Four sharp rules (deliberately narrow — "unusual patterns" without
 * a definition just over-flags):
 *
 *   1. outlier-amount         z-score > 2.5 within statement+category
 *                             severity: info  (volume signal, not red flag)
 *
 *   2. new-counterparty       fingerprint not seen in the billing user's
 *                             prior 12 months AND |amount| > ₹1L
 *                             severity: warn  (real reconciliation surface)
 *
 *   3. round-cash-deposit     cash deposit ≥ ₹50K divisible by ₹10K
 *                             severity: warn  (269ST exposure indicator)
 *
 *   4. same-day-cash-cluster  ≥2 cash deposits ≥ ₹50K on same date
 *                             severity: warn  (smurfing pattern)
 *
 * Output: array of { transactionId, type, severity, reason }. Caller
 * persists these to bank_transaction_anomalies. A single transaction
 * can produce multiple anomalies (e.g. an outlier amount AND a new
 * counterparty) — they're stored as separate rows.
 *
 * Why narrow rules instead of a general anomaly model:
 *   - Statistical outlier detection without a baseline produces
 *     90% false positives. Z-score within a CATEGORY gives the
 *     baseline for free (compare cash deposits to other cash deposits,
 *     not to all transactions).
 *   - Each rule maps to a concrete CA workflow ("did the client
 *     receive an unusually large payment from someone new?"). Anything
 *     that doesn't map to a workflow doesn't make the cut.
 *   - Tunable thresholds at the top of this file. If we get user
 *     feedback that warn-tier is too noisy, tweak here, redeploy.
 */

export type AnomalySeverity = 'info' | 'warn';
export type AnomalyType =
  | 'outlier_amount'
  | 'new_counterparty'
  | 'round_cash_deposit'
  | 'same_day_cash_cluster';

export interface AnomalyRecord {
  transactionId: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  reason: string;
}

// Tunable thresholds. Centralised so we can adjust based on user
// feedback without hunting through the rules.
//
// Z-score threshold note: with the small per-category sample sizes
// typical of a single bank statement (5-30 rows), a true outlier
// inflates the stdev it's measured against — a 500K row against
// five ~10K peers only produces z ≈ 2.2 because the outlier itself
// pulls the variance up. Setting threshold at 2.0 catches this
// case while still requiring a meaningful gap above the inlier
// distribution. Going higher (2.5) misses obvious outliers.
const Z_SCORE_THRESHOLD = 2.0;
// Minimum sample size before z-score firing is statistically
// meaningful. With < 5 rows in a category, the variance is too
// twitchy and we'd flag the first big number as an outlier even
// when it's just the second sample.
const MIN_CATEGORY_SAMPLES_FOR_Z = 5;
// Absolute amount floor for outlier-amount flags. A ₹5K transaction
// isn't worth a CA's eyeball even if it's 10σ above category mean.
// Calibrated against J&K Bank CC statements where Business Income is
// dominated by hundreds of tiny UPI receipts (mean ≈ ₹543, stdev ≈
// ₹2K) — every normal ₹5K-25K deposit reads as a high-σ "outlier"
// but is operationally routine. Below this floor we suppress.
const OUTLIER_AMOUNT_FLOOR = 50_000;
// Minimum category mean before z-score firing is meaningful. When
// the baseline mean is under this floor the category is being held
// down by micro-transactions and any reasonably-sized row looks
// extreme. Comparing a ₹25K deposit to a ₹543 mean is a category-
// labelling problem, not a real anomaly.
const MIN_CATEGORY_MEAN_FOR_Z = 1_000;
const NEW_COUNTERPARTY_AMOUNT_THRESHOLD = 100_000;
const NEW_COUNTERPARTY_LOOKBACK_DAYS = 365;
const ROUND_CASH_DEPOSIT_MIN = 50_000;
const ROUND_CASH_DEPOSIT_DIVISOR = 10_000;
const SAME_DAY_CASH_CLUSTER_MIN_AMOUNT = 50_000;
const SAME_DAY_CASH_CLUSTER_MIN_COUNT = 2;

/**
 * Minimal transaction shape the detector needs. Decoupled from the
 * full bank_transactions row so the detector is testable without
 * spinning up a DB. The caller (route) builds these from the
 * just-persisted rows.
 */
export interface AnomalyInputTx {
  id: string;
  date: string | null;          // YYYY-MM-DD
  narration: string | null;
  amount: number;               // signed: + = credit, − = debit
  category: string;
  subcategory: string | null;
  fingerprint: string | null;
}

/**
 * History snapshot the new-counterparty rule queries. The caller
 * (route) populates this from bank_transactions joined to
 * bank_statements within the billing user's prior 12 months. Empty
 * set = no history available (legacy data or first run); the rule
 * conservatively SKIPS firing in that case rather than flagging
 * every counterparty as new.
 */
export interface AnomalyHistory {
  /** Fingerprints seen in the billing user's previous statements
   *  within the lookback window. Excludes the current statement's
   *  own rows — the route filters those out before passing in. */
  knownFingerprints: Set<string>;
  /** True when the history snapshot is meaningful — i.e. the billing
   *  user has at least one prior statement on file. When false the
   *  new-counterparty rule short-circuits to "no anomalies" so a
   *  user's first-ever upload doesn't get tagged with 100 alerts. */
  hasPriorHistory: boolean;
}

export function detectAnomalies(
  txs: AnomalyInputTx[],
  history: AnomalyHistory,
): AnomalyRecord[] {
  const out: AnomalyRecord[] = [];

  // ── Rule 1: outlier amount per category ─────────────────────
  // Group by category. For each category with ≥ MIN_CATEGORY_SAMPLES_FOR_Z
  // rows, compute mean + stdev of |amount|, then flag rows where the
  // z-score exceeds threshold. Severity 'info' — these are usually
  // valid but noteworthy ("salary credit was 3× normal this month").
  const byCategory = new Map<string, AnomalyInputTx[]>();
  for (const tx of txs) {
    const key = tx.category;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(tx);
  }
  for (const [category, group] of byCategory) {
    if (group.length < MIN_CATEGORY_SAMPLES_FOR_Z) continue;
    const amounts = group.map((t) => Math.abs(t.amount));
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length;
    const stdev = Math.sqrt(variance);
    if (stdev < 1) continue; // category is too uniform — every row would be 0σ
    // Skip categories dominated by micro-transactions: the baseline is
    // pulled down by tiny UPI receipts and a normal-sized deposit
    // would always look extreme without being worth a flag.
    if (mean < MIN_CATEGORY_MEAN_FOR_Z) continue;
    for (const tx of group) {
      const z = (Math.abs(tx.amount) - mean) / stdev;
      if (z > Z_SCORE_THRESHOLD && Math.abs(tx.amount) >= OUTLIER_AMOUNT_FLOOR) {
        out.push({
          transactionId: tx.id,
          type: 'outlier_amount',
          severity: 'info',
          reason: `₹${Math.round(Math.abs(tx.amount)).toLocaleString('en-IN')} is unusually large for ${category} (${z.toFixed(1)}σ above the category average of ₹${Math.round(mean).toLocaleString('en-IN')})`,
        });
      }
    }
  }

  // ── Rule 2: new counterparty over threshold ─────────────────
  // Skip entirely on first-upload accounts — without prior history
  // every counterparty is technically "new" and we'd alert on
  // everything. Once the user has at least one prior statement, this
  // rule meaningfully flags first-time receipts from suppliers /
  // customers / one-off payers.
  if (history.hasPriorHistory) {
    for (const tx of txs) {
      if (!tx.fingerprint) continue;          // can't tell history without a fingerprint
      if (history.knownFingerprints.has(tx.fingerprint)) continue;
      if (Math.abs(tx.amount) < NEW_COUNTERPARTY_AMOUNT_THRESHOLD) continue;
      out.push({
        transactionId: tx.id,
        type: 'new_counterparty',
        severity: 'warn',
        reason: `First transaction of ₹${Math.round(Math.abs(tx.amount)).toLocaleString('en-IN')} with a counterparty not seen in the past ${Math.round(NEW_COUNTERPARTY_LOOKBACK_DAYS / 30)} months`,
      });
    }
  }

  // ── Rule 3: round cash deposit ≥ ₹50K ───────────────────────
  // 269ST of the Income-tax Act caps cash receipts at ₹2L (single
  // transaction, single day, single event). A ≥ ₹50K round-figure
  // cash deposit is a documentation-trail trigger even below the
  // hard cap — auditors want to see source. Detector identifies
  // "cash deposit" via category match (existing classifier emits
  // "Cash Deposit" subcategory) — narration parsing is the AI's job,
  // not ours.
  for (const tx of txs) {
    if (tx.amount <= 0) continue;             // credits only — debits are withdrawals
    if (tx.amount < ROUND_CASH_DEPOSIT_MIN) continue;
    if (tx.amount % ROUND_CASH_DEPOSIT_DIVISOR !== 0) continue;
    // Match either the category OR a known cash-deposit subcategory.
    // Some classifiers tag the parent category as "Cash" and the
    // subcategory as "Deposit"; others use a flat "Cash Deposit".
    const isCash =
      /cash/i.test(tx.category) ||
      /cash/i.test(tx.subcategory ?? '') ||
      /^cash[\s_-]?deposit/i.test(tx.narration ?? '');
    if (!isCash) continue;
    out.push({
      transactionId: tx.id,
      type: 'round_cash_deposit',
      severity: 'warn',
      reason: `Round-figure cash deposit of ₹${Math.round(tx.amount).toLocaleString('en-IN')} — confirm documentation (269ST exposure)`,
    });
  }

  // ── Rule 4: same-day cash cluster ───────────────────────────
  // Smurfing pattern: multiple cash deposits ≥ ₹50K on the same date
  // suggest a single larger amount split to stay under a per-
  // transaction reporting threshold. Flags each row in the cluster
  // so the user sees them all and can match them up.
  const cashByDate = new Map<string, AnomalyInputTx[]>();
  for (const tx of txs) {
    if (tx.amount < SAME_DAY_CASH_CLUSTER_MIN_AMOUNT) continue;
    if (!tx.date) continue;
    const isCash =
      /cash/i.test(tx.category) ||
      /cash/i.test(tx.subcategory ?? '') ||
      /^cash[\s_-]?deposit/i.test(tx.narration ?? '');
    if (!isCash) continue;
    if (!cashByDate.has(tx.date)) cashByDate.set(tx.date, []);
    cashByDate.get(tx.date)!.push(tx);
  }
  for (const [date, cluster] of cashByDate) {
    if (cluster.length < SAME_DAY_CASH_CLUSTER_MIN_COUNT) continue;
    const total = cluster.reduce((a, t) => a + t.amount, 0);
    for (const tx of cluster) {
      out.push({
        transactionId: tx.id,
        type: 'same_day_cash_cluster',
        severity: 'warn',
        reason: `${cluster.length} cash deposits on ${date} totalling ₹${Math.round(total).toLocaleString('en-IN')} — review for structuring`,
      });
    }
  }

  return out;
}

// Exposed for testing / route diagnostics.
export const ANOMALY_THRESHOLDS = {
  Z_SCORE_THRESHOLD,
  MIN_CATEGORY_SAMPLES_FOR_Z,
  OUTLIER_AMOUNT_FLOOR,
  MIN_CATEGORY_MEAN_FOR_Z,
  NEW_COUNTERPARTY_AMOUNT_THRESHOLD,
  NEW_COUNTERPARTY_LOOKBACK_DAYS,
  ROUND_CASH_DEPOSIT_MIN,
  ROUND_CASH_DEPOSIT_DIVISOR,
  SAME_DAY_CASH_CLUSTER_MIN_AMOUNT,
  SAME_DAY_CASH_CLUSTER_MIN_COUNT,
} as const;
