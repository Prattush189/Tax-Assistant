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
  /** 1 if a user condition flagged this row as hidden by the
   *  post-extraction filter pass. Default 0. The row stays in the
   *  table either way; callers filter on this flag at display /
   *  export time. */
  hidden_by_condition: number;
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
  // Re-classify path: overwrite category/subcategory for a row WITHOUT
  // setting user_override. Used by POST /:id/reclassify so previously
  // mis-tagged rows from older classifier deploys can be corrected
  // without nuking the user's manual overrides (which we skip — see
  // the WHERE user_override = 0 guard).
  reclassifyRow: db.prepare(
    `UPDATE bank_transactions
        SET category = ?, subcategory = ?
      WHERE id = ?
        AND statement_id = ?
        AND user_override = 0`
  ),
  // Re-apply user auto-tagging rules to an existing statement. Sets
  // category + counterparty (rules don't carry subcategory) WITHOUT
  // marking user_override — and skips rows the user manually re-tagged,
  // same guard as reclassifyRow. Lets a user who edits their rule list
  // push the change onto an already-processed statement instead of
  // re-uploading the PDF.
  applyRuleRow: db.prepare(
    `UPDATE bank_transactions
        SET category = ?, counterparty = ?
      WHERE id = ?
        AND statement_id = ?
        AND user_override = 0`
  ),
  // Flip every signed amount in a statement. Escape hatch for the
  // rare case where the CC auto-detect missed (or wrongly fired) and
  // the user wants a one-click sign correction without re-uploading.
  // Negates amount in place — also negates balance, since the
  // dashboard treats balance as account-relative (a Dr balance
  // displayed as +12,79,294 represents debt; after the flip the
  // signs flow consistently as if accountKind was the other way).
  flipSignsForStatement: db.prepare(
    `UPDATE bank_transactions
        SET amount = -amount,
            balance = CASE WHEN balance IS NULL THEN NULL ELSE -balance END
      WHERE statement_id = ?`
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

  /**
   * Re-classify every non-user-override row of one statement using
   * the caller-supplied classifier callback. Returns counts of rows
   * scanned / updated. Wrapped in a transaction so a mid-flight crash
   * leaves the DB in a consistent state.
   *
   * `classify` is passed in (not imported) so this repo keeps zero
   * runtime dependency on the classifier module — keeps the dep graph
   * pointing one way (route → repo → db).
   */
  /**
   * Flip the sign of every transaction in a statement. Returns the
   * number of rows updated. Used by the manual "Flip signs" toggle
   * when the CC auto-detection got the account-type wrong.
   */
  flipSigns(statementId: string): { updated: number } {
    const info = stmts.flipSignsForStatement.run(statementId);
    return { updated: info.changes };
  },

  reclassifyStatement(
    statementId: string,
    classify: (row: BankTransactionRow) => { category: string; subcategory: string | null } | null,
  ): { scanned: number; updated: number } {
    const rows = stmts.listByStatement.all(statementId) as BankTransactionRow[];
    let updated = 0;
    const apply = db.transaction(() => {
      for (const r of rows) {
        if (r.user_override === 1) continue;
        const result = classify(r);
        if (!result) continue;
        if (result.category === r.category && result.subcategory === r.subcategory) continue;
        stmts.reclassifyRow.run(result.category, result.subcategory, r.id, statementId);
        updated++;
      }
    });
    apply();
    return { scanned: rows.length, updated };
  },

  // Apply the user's auto-tagging rules to an already-persisted
  // statement. `match` returns the new category + counterparty for a
  // row (or null when no rule matched). Skips user_override rows and
  // only writes when something actually changed. Mirrors the upload
  // path's applyUserRules so re-applying gives the same result a fresh
  // upload would.
  applyRulesToStatement(
    statementId: string,
    match: (row: BankTransactionRow) => { category: string; counterparty: string | null } | null,
  ): { scanned: number; updated: number } {
    const rows = stmts.listByStatement.all(statementId) as BankTransactionRow[];
    let updated = 0;
    const apply = db.transaction(() => {
      for (const r of rows) {
        if (r.user_override === 1) continue;
        const result = match(r);
        if (!result) continue;
        if (result.category === r.category && result.counterparty === r.counterparty) continue;
        stmts.applyRuleRow.run(result.category, result.counterparty, r.id, statementId);
        updated++;
      }
    });
    apply();
    return { scanned: rows.length, updated };
  },
};
