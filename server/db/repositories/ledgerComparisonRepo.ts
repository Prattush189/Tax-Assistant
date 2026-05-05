/**
 * ledger_comparisons repo.
 *
 * Stores a pair of pre-extracted ledgers (Entity A's copy vs Entity B's
 * copy of the same ledger) plus the LLM-emitted reconciliation report.
 * Both extracted snapshots are persisted as JSON so the report can be
 * re-rendered or re-compared later without re-uploading the sources.
 */

import crypto from 'crypto';
import db from '../index.js';

export type ComparisonStatus = 'pending' | 'comparing' | 'completed' | 'failed' | 'cancelled';

export interface ComparisonRow {
  id: string;
  user_id: string;
  billing_user_id: string;
  label_a: string;
  label_b: string;
  filename_a: string | null;
  filename_b: string | null;
  extracted_a: string;
  extracted_b: string;
  report: string | null;
  status: ComparisonStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO ledger_comparisons
      (id, user_id, billing_user_id, label_a, label_b, filename_a, filename_b, extracted_a, extracted_b, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'comparing')
  `),
  findById: db.prepare(`SELECT * FROM ledger_comparisons WHERE id = ?`),
  listByUser: db.prepare(`
    SELECT id, label_a, label_b, filename_a, filename_b, status, error_message, created_at, updated_at
    FROM ledger_comparisons
    WHERE user_id = ?
    ORDER BY updated_at DESC
    LIMIT 200
  `),
  markCompleted: db.prepare(`
    UPDATE ledger_comparisons
    SET status = 'completed',
        report = ?,
        error_message = NULL,
        updated_at = datetime('now', '+5 hours', '+30 minutes')
    WHERE id = ?
  `),
  markFailed: db.prepare(`
    UPDATE ledger_comparisons
    SET status = 'failed',
        error_message = ?,
        updated_at = datetime('now', '+5 hours', '+30 minutes')
    WHERE id = ?
  `),
  delete: db.prepare(`DELETE FROM ledger_comparisons WHERE id = ? AND user_id = ?`),
};

export const ledgerComparisonRepo = {
  create(input: {
    userId: string;
    billingUserId: string;
    labelA: string;
    labelB: string;
    filenameA: string | null;
    filenameB: string | null;
    extractedAJson: string;
    extractedBJson: string;
  }): ComparisonRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.insert.run(
      id,
      input.userId,
      input.billingUserId,
      input.labelA,
      input.labelB,
      input.filenameA,
      input.filenameB,
      input.extractedAJson,
      input.extractedBJson,
    );
    return this.findById(id)!;
  },

  findById(id: string): ComparisonRow | undefined {
    return stmts.findById.get(id) as ComparisonRow | undefined;
  },

  listByUser(userId: string): Array<Pick<ComparisonRow,
    'id' | 'label_a' | 'label_b' | 'filename_a' | 'filename_b' | 'status' | 'error_message' | 'created_at' | 'updated_at'
  >> {
    return stmts.listByUser.all(userId) as Array<Pick<ComparisonRow,
      'id' | 'label_a' | 'label_b' | 'filename_a' | 'filename_b' | 'status' | 'error_message' | 'created_at' | 'updated_at'
    >>;
  },

  markCompleted(id: string, reportJson: string): void {
    stmts.markCompleted.run(reportJson, id);
  },

  markFailed(id: string, errorMessage: string): void {
    stmts.markFailed.run(errorMessage.slice(0, 1000), id);
  },

  delete(id: string, userId: string): boolean {
    const result = stmts.delete.run(id, userId);
    return result.changes > 0;
  },
};
