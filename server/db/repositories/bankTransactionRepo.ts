import crypto from 'crypto';
import db from '../index.js';

export interface BankTransactionRow {
  id: string;
  statement_id: string;
  tx_date: string | null;
  narration: string | null;
  amount: number;          // signed: positive=credit, negative=debit
  balance: number | null;
  category: string;
  subcategory: string | null;
  counterparty: string | null;
  reference: string | null;
  is_recurring: number;
  user_override: number;
  sort_index: number;
  fingerprint: string | null;
}

export interface BankTransactionInput {
  date: string | null;
  narration: string | null;
  amount: number;
  balance: number | null;
  category: string;
  subcategory: string | null;
  counterparty: string | null;
  reference: string | null;
  isRecurring: boolean;
  /** Narration fingerprint, computed by extractNarrationFingerprint.
   *  Optional on input so callers that don't compute it (legacy CSV
   *  paths) can omit; the insert stmt will write NULL and queries
   *  treat that as "no history available". */
  fingerprint?: string | null;
}

const stmts = {
  listByStatement: db.prepare(
    'SELECT * FROM bank_transactions WHERE statement_id = ? ORDER BY sort_index ASC'
  ),
  // Distinct fingerprints from the billing user's prior statements
  // within a lookback window. Joined via bank_statements.billing_user_id
  // because bank_transactions doesn't carry that field. Excludes the
  // current statement (the anomaly detector compares the new run
  // against prior history, not against itself). Excludes NULL
  // fingerprints (legacy rows pre-fingerprint-column) — they'd match
  // nothing anyway.
  fingerprintsForBillingUserSince: db.prepare(`
    SELECT DISTINCT bt.fingerprint
    FROM bank_transactions bt
    JOIN bank_statements bs ON bs.id = bt.statement_id
    WHERE bs.billing_user_id = ?
      AND bs.id != ?
      AND bs.created_at >= ?
      AND bt.fingerprint IS NOT NULL
  `),
  // Cheap existence check used by the anomaly detector to decide
  // whether to fire the new-counterparty rule (first-upload accounts
  // skip it entirely — without prior data, every counterparty looks
  // new). Returns 1 if the billing user has ANY prior statement,
  // else 0.
  hasPriorStatement: db.prepare(`
    SELECT EXISTS(
      SELECT 1 FROM bank_statements
      WHERE billing_user_id = ?
        AND id != ?
        AND status = 'done'
    ) AS has_prior
  `),
  insert: db.prepare(
    `INSERT INTO bank_transactions (
      id, statement_id, tx_date, narration, amount, balance,
      category, subcategory, counterparty, reference, is_recurring, user_override, sort_index, fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ),
  deleteByStatement: db.prepare(
    'DELETE FROM bank_transactions WHERE statement_id = ?'
  ),
  // updateCategory scopes by statement_id joined to user_id — callers pass both
  updateCategory: db.prepare(
    `UPDATE bank_transactions
        SET category = ?, subcategory = ?, user_override = 1
      WHERE id = ?
        AND statement_id IN (SELECT id FROM bank_statements WHERE id = ? AND user_id = ?)`
  ),
};

const insertMany = db.transaction((stmtId: string, txs: BankTransactionInput[]) => {
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    const id = crypto.randomBytes(16).toString('hex');
    stmts.insert.run(
      id,
      stmtId,
      tx.date,
      tx.narration,
      tx.amount,
      tx.balance,
      tx.category,
      tx.subcategory,
      tx.counterparty,
      tx.reference,
      tx.isRecurring ? 1 : 0,
      i,
      tx.fingerprint ?? null,
    );
  }
});

export const bankTransactionRepo = {
  listByStatement(statementId: string): BankTransactionRow[] {
    return stmts.listByStatement.all(statementId) as BankTransactionRow[];
  },

  bulkInsert(statementId: string, txs: BankTransactionInput[]): void {
    insertMany(statementId, txs);
  },

  replaceAll(statementId: string, txs: BankTransactionInput[]): void {
    const replace = db.transaction(() => {
      stmts.deleteByStatement.run(statementId);
      insertMany(statementId, txs);
    });
    replace();
  },

  updateCategory(txId: string, statementId: string, userId: string, category: string, subcategory: string | null): boolean {
    return stmts.updateCategory.run(category, subcategory, txId, statementId, userId).changes > 0;
  },

  /**
   * Fetch the set of narration fingerprints the billing user has
   * seen in the lookback window, excluding the current statement.
   * Used by the anomaly detector's "new counterparty" rule.
   *
   * @param excludeStatementId The statement we're analysing (skip it
   *   so the detector compares against PRIOR history, not the
   *   current run's own rows).
   * @param sinceDateIso A SQLite-friendly IST timestamp (the same
   *   format bank_statements.created_at uses — see toSqlIst).
   */
  fingerprintsForBillingUserSince(
    billingUserId: string,
    excludeStatementId: string,
    sinceDateIso: string,
  ): Set<string> {
    const rows = stmts.fingerprintsForBillingUserSince.all(
      billingUserId,
      excludeStatementId,
      sinceDateIso,
    ) as Array<{ fingerprint: string }>;
    return new Set(rows.map((r) => r.fingerprint));
  },

  hasPriorStatementForBillingUser(billingUserId: string, excludeStatementId: string): boolean {
    const row = stmts.hasPriorStatement.get(billingUserId, excludeStatementId) as { has_prior: number };
    return row.has_prior === 1;
  },
};
