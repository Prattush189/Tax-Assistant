/**
 * Anomaly flag repository — companion to the Phase 2 anomaly
 * detector. Persists one row per (transaction, anomaly_type) pair
 * so a single transaction with multiple anomalies (e.g. outlier
 * amount + new counterparty) gets a row for each.
 *
 * Lifecycle: rows are created in bulk by the analyze flow after
 * detectAnomalies runs. CASCADE on bank_transactions DELETE
 * automatically clears stale anomalies when the route bulk-deletes
 * transactions for re-analysis. No explicit deleteByStatement
 * needed — the cascade handles it.
 */
import crypto from 'crypto';
import db from '../index.js';
import type {
  AnomalyRecord,
  AnomalyType,
  AnomalySeverity,
} from '../../lib/bankAnomalyDetector.js';

export interface BankTransactionAnomalyRow {
  id: string;
  transaction_id: string;
  statement_id: string;
  anomaly_type: AnomalyType;
  severity: AnomalySeverity;
  reason: string;
  created_at: string;
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO bank_transaction_anomalies (
      id, transaction_id, statement_id, anomaly_type, severity, reason
    ) VALUES (?, ?, ?, ?, ?, ?)
  `),
  listByStatement: db.prepare(`
    SELECT * FROM bank_transaction_anomalies
    WHERE statement_id = ?
    ORDER BY severity DESC, anomaly_type ASC
  `),
};

// Note on insertMany: a typical statement produces 0-20 anomaly rows,
// so transactional bulk insert isn't a meaningful win (the overhead
// is negligible). But we wrap in a transaction for atomicity — if any
// single insert throws, none get persisted, avoiding partial state.
const insertMany = db.transaction((statementId: string, recs: AnomalyRecord[]) => {
  for (const a of recs) {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.insert.run(id, a.transactionId, statementId, a.type, a.severity, a.reason);
  }
});

export const bankTransactionAnomalyRepo = {
  bulkInsert(statementId: string, anomalies: AnomalyRecord[]): void {
    if (anomalies.length === 0) return;
    insertMany(statementId, anomalies);
  },

  listByStatement(statementId: string): BankTransactionAnomalyRow[] {
    return stmts.listByStatement.all(statementId) as BankTransactionAnomalyRow[];
  },
};
