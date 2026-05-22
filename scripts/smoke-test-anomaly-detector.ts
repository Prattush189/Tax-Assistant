/**
 * Smoke test for server/lib/bankAnomalyDetector.ts.
 *
 * Each rule gets a positive case (should fire) and a negative case
 * (should not fire) so threshold drift on either side surfaces here
 * before it bites a user.
 *
 * Run with:
 *   npx tsx scripts/smoke-test-anomaly-detector.ts
 */

import { detectAnomalies, type AnomalyInputTx, type AnomalyHistory } from '../server/lib/bankAnomalyDetector';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function expect<T>(label: string, actual: T, expected: T) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++;
  } else {
    fail++;
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function expectTrue(label: string, cond: boolean) {
  if (cond) pass++;
  else { fail++; failures.push(label); }
}

const noHistory: AnomalyHistory = { knownFingerprints: new Set(), hasPriorHistory: false };
const richHistory: AnomalyHistory = {
  knownFingerprints: new Set(['acme distributors', 'salary smartbiz', 'electricity board mh']),
  hasPriorHistory: true,
};

function tx(over: Partial<AnomalyInputTx>): AnomalyInputTx {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    date: over.date ?? '2026-04-01',
    narration: over.narration ?? '',
    amount: over.amount ?? 0,
    category: over.category ?? 'Other',
    subcategory: over.subcategory ?? null,
    fingerprint: over.fingerprint ?? null,
  };
}

// ─── Rule 1: outlier amount ────────────────────────────────────
{
  // 6 cash deposits, one is way out — should fire on the outlier.
  const txs: AnomalyInputTx[] = [
    tx({ id: 'a1', amount: 10000, category: 'Cash Deposit' }),
    tx({ id: 'a2', amount: 12000, category: 'Cash Deposit' }),
    tx({ id: 'a3', amount: 9500,  category: 'Cash Deposit' }),
    tx({ id: 'a4', amount: 11000, category: 'Cash Deposit' }),
    tx({ id: 'a5', amount: 13000, category: 'Cash Deposit' }),
    tx({ id: 'a6', amount: 500000, category: 'Cash Deposit' }), // outlier (45σ above ~11K mean)
  ];
  const anomalies = detectAnomalies(txs, noHistory);
  // 500K row hits both outlier_amount (z-score) AND round_cash_deposit
  // (500K is divisible by 10K and ≥ 50K). The presence of BOTH is fine.
  const outlier = anomalies.find((a) => a.type === 'outlier_amount');
  expectTrue('outlier_amount fires on the 500K row', !!outlier && outlier.transactionId === 'a6');
  const otherRowsFlagged = anomalies.filter((a) => a.type === 'outlier_amount' && a.transactionId !== 'a6');
  expectTrue('outlier_amount does NOT fire on inlier rows', otherRowsFlagged.length === 0);
}

// Below-threshold sample size: 4 rows in a category should NOT fire.
{
  const txs: AnomalyInputTx[] = [
    tx({ id: 'b1', amount: 1000, category: 'Bank Charges' }),
    tx({ id: 'b2', amount: 5000, category: 'Bank Charges' }),
    tx({ id: 'b3', amount: 200, category: 'Bank Charges' }),
    tx({ id: 'b4', amount: 50000, category: 'Bank Charges' }), // would be outlier IF sample size sufficient
  ];
  const anomalies = detectAnomalies(txs, noHistory).filter((a) => a.type === 'outlier_amount');
  expect('outlier_amount skips below MIN_CATEGORY_SAMPLES_FOR_Z', anomalies.length, 0);
}

// ─── Rule 2: new counterparty over threshold ───────────────────
{
  // ₹2L from a fingerprint not in known set → fire.
  const txs: AnomalyInputTx[] = [
    tx({ id: 'c1', amount: 200000, fingerprint: 'unknown counterparty', category: 'Other' }),
  ];
  const anomalies = detectAnomalies(txs, richHistory).filter((a) => a.type === 'new_counterparty');
  expect('new_counterparty fires on >₹1L unknown', anomalies.length, 1);
  expectTrue('new_counterparty is warn severity', anomalies[0]?.severity === 'warn');
}

// Below-threshold amount: ₹50K from unknown party → no fire.
{
  const txs: AnomalyInputTx[] = [
    tx({ id: 'd1', amount: 50000, fingerprint: 'unknown counterparty', category: 'Other' }),
  ];
  const anomalies = detectAnomalies(txs, richHistory).filter((a) => a.type === 'new_counterparty');
  expect('new_counterparty does NOT fire below threshold', anomalies.length, 0);
}

// Known counterparty over threshold: no fire.
{
  const txs: AnomalyInputTx[] = [
    tx({ id: 'e1', amount: 500000, fingerprint: 'acme distributors', category: 'Other' }),
  ];
  const anomalies = detectAnomalies(txs, richHistory).filter((a) => a.type === 'new_counterparty');
  expect('new_counterparty does NOT fire on known counterparty', anomalies.length, 0);
}

// First-upload case (no history): should NOT fire even on ₹5L
// unknown counterparties — otherwise every counterparty on the
// user's first statement gets tagged as new.
{
  const txs: AnomalyInputTx[] = [
    tx({ id: 'f1', amount: 500000, fingerprint: 'whatever', category: 'Other' }),
    tx({ id: 'f2', amount: 1000000, fingerprint: 'whoever', category: 'Other' }),
  ];
  const anomalies = detectAnomalies(txs, noHistory).filter((a) => a.type === 'new_counterparty');
  expect('new_counterparty short-circuits on first upload', anomalies.length, 0);
}

// Null fingerprint should not fire (no signal).
{
  const txs: AnomalyInputTx[] = [
    tx({ id: 'g1', amount: 500000, fingerprint: null, category: 'Other' }),
  ];
  const anomalies = detectAnomalies(txs, richHistory).filter((a) => a.type === 'new_counterparty');
  expect('new_counterparty skips null fingerprint', anomalies.length, 0);
}

// ─── Rule 3: round cash deposit ────────────────────────────────
{
  // ₹50,000 cash deposit → fire.
  const txs: AnomalyInputTx[] = [
    tx({ id: 'h1', amount: 50000, category: 'Cash Deposit' }),
    tx({ id: 'h2', amount: 100000, category: 'Cash Deposit' }),
    tx({ id: 'h3', amount: 200000, category: 'Cash Deposit' }),
  ];
  const anomalies = detectAnomalies(txs, noHistory).filter((a) => a.type === 'round_cash_deposit');
  expect('round_cash_deposit fires on 50K/100K/200K', anomalies.length, 3);
}

// Non-round amount: ₹55,000 → no fire (not divisible by 10K).
{
  const txs: AnomalyInputTx[] = [
    tx({ id: 'i1', amount: 55000, category: 'Cash Deposit' }),
  ];
  const anomalies = detectAnomalies(txs, noHistory).filter((a) => a.type === 'round_cash_deposit');
  expect('round_cash_deposit skips non-round', anomalies.length, 0);
}

// Below-threshold amount: ₹40,000 → no fire.
{
  const txs: AnomalyInputTx[] = [
    tx({ id: 'j1', amount: 40000, category: 'Cash Deposit' }),
  ];
  const anomalies = detectAnomalies(txs, noHistory).filter((a) => a.type === 'round_cash_deposit');
  expect('round_cash_deposit skips below 50K', anomalies.length, 0);
}

// Non-cash category: ₹100K UPI receipt → no fire.
{
  const txs: AnomalyInputTx[] = [
    tx({ id: 'k1', amount: 100000, category: 'Business Income' }),
  ];
  const anomalies = detectAnomalies(txs, noHistory).filter((a) => a.type === 'round_cash_deposit');
  expect('round_cash_deposit skips non-cash category', anomalies.length, 0);
}

// Debit (withdrawal) — should not fire even on round 50K.
{
  const txs: AnomalyInputTx[] = [
    tx({ id: 'l1', amount: -50000, category: 'Cash Deposit' }),
  ];
  const anomalies = detectAnomalies(txs, noHistory).filter((a) => a.type === 'round_cash_deposit');
  expect('round_cash_deposit skips debits', anomalies.length, 0);
}

// ─── Rule 4: same-day cash cluster ─────────────────────────────
{
  // Three cash deposits on the same day → fire on all three.
  const txs: AnomalyInputTx[] = [
    tx({ id: 'm1', amount: 60000, category: 'Cash Deposit', date: '2026-04-15' }),
    tx({ id: 'm2', amount: 70000, category: 'Cash Deposit', date: '2026-04-15' }),
    tx({ id: 'm3', amount: 80000, category: 'Cash Deposit', date: '2026-04-15' }),
    // Solo cash on a different day — no cluster.
    tx({ id: 'm4', amount: 90000, category: 'Cash Deposit', date: '2026-04-16' }),
  ];
  const anomalies = detectAnomalies(txs, noHistory).filter((a) => a.type === 'same_day_cash_cluster');
  expect('same_day_cash_cluster flags all 3 rows on 04-15', anomalies.length, 3);
  const flaggedIds = new Set(anomalies.map((a) => a.transactionId));
  expectTrue('cluster includes m1, m2, m3', flaggedIds.has('m1') && flaggedIds.has('m2') && flaggedIds.has('m3'));
  expectTrue('cluster excludes m4 (solo day)', !flaggedIds.has('m4'));
}

// Single ≥50K cash on a day: no cluster (only 1 row).
{
  const txs: AnomalyInputTx[] = [
    tx({ id: 'n1', amount: 100000, category: 'Cash Deposit', date: '2026-04-20' }),
  ];
  const anomalies = detectAnomalies(txs, noHistory).filter((a) => a.type === 'same_day_cash_cluster');
  expect('same_day_cash_cluster requires ≥2 rows', anomalies.length, 0);
}

// Two cash deposits but one is below threshold: only one over ₹50K
// → not a cluster (the rule requires both rows to be ≥ 50K).
{
  const txs: AnomalyInputTx[] = [
    tx({ id: 'o1', amount: 60000, category: 'Cash Deposit', date: '2026-04-21' }),
    tx({ id: 'o2', amount: 40000, category: 'Cash Deposit', date: '2026-04-21' }),
  ];
  const anomalies = detectAnomalies(txs, noHistory).filter((a) => a.type === 'same_day_cash_cluster');
  expect('same_day_cash_cluster excludes sub-threshold rows', anomalies.length, 0);
}

// ─── Multi-rule overlap ────────────────────────────────────────
// A single transaction can fire multiple rules. Verify each anomaly
// is recorded separately (one row gets two anomalies, not merged).
{
  const txs: AnomalyInputTx[] = [
    tx({ id: 'p1', amount: 10000, category: 'Cash Deposit' }),
    tx({ id: 'p2', amount: 12000, category: 'Cash Deposit' }),
    tx({ id: 'p3', amount: 9500, category: 'Cash Deposit' }),
    tx({ id: 'p4', amount: 11000, category: 'Cash Deposit' }),
    tx({ id: 'p5', amount: 13000, category: 'Cash Deposit' }),
    tx({
      id: 'p6',
      amount: 500000,
      category: 'Cash Deposit',
      fingerprint: 'unknown',
      // Outlier (z-score), round cash (500K divisible by 10K), AND new counterparty.
    }),
  ];
  const anomalies = detectAnomalies(txs, richHistory);
  const p6Anomalies = anomalies.filter((a) => a.transactionId === 'p6');
  const types = new Set(p6Anomalies.map((a) => a.type));
  expectTrue('p6 fires outlier_amount', types.has('outlier_amount'));
  expectTrue('p6 fires round_cash_deposit', types.has('round_cash_deposit'));
  expectTrue('p6 fires new_counterparty', types.has('new_counterparty'));
}

// ─── Empty input ───────────────────────────────────────────────
expect('empty txs → empty anomalies', detectAnomalies([], richHistory), []);

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
