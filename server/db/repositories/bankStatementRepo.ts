import crypto from 'crypto';
import db from '../index.js';

export type BankStatementStatus = 'analyzing' | 'done' | 'error';

export interface BankStatementRow {
  id: string;
  user_id: string;
  billing_user_id: string | null;
  name: string;
  bank_name: string | null;
  account_number_masked: string | null;
  period_from: string | null;
  period_to: string | null;
  source_filename: string | null;
  source_mime: string | null;
  total_inflow: number;
  total_outflow: number;
  tx_count: number;
  raw_extracted: string | null;
  status: BankStatementStatus;
  file_hash: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankStatementCreateInput {
  name: string;
  bankName: string | null;
  accountNumberMasked: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  sourceFilename: string | null;
  sourceMime: string | null;
  rawExtracted: string | null;
}

export interface BankStatementPlaceholderInput {
  name: string;
  sourceFilename: string | null;
  sourceMime: string | null;
  fileHash: string | null;
}

const stmts = {
  findByUserId: db.prepare(
    'SELECT * FROM bank_statements WHERE user_id = ? ORDER BY updated_at DESC'
  ),
  findByIdForUser: db.prepare(
    'SELECT * FROM bank_statements WHERE id = ? AND user_id = ?'
  ),
  create: db.prepare(
    `INSERT INTO bank_statements (
      id, user_id, billing_user_id, name,
      bank_name, account_number_masked, period_from, period_to,
      source_filename, source_mime, raw_extracted, status, file_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', ?)`
  ),
  // Upfront row written before Gemini work starts so a tab-close + reload
  // can re-attach via /api/bank-statements/:id polling and the
  // findInProgressByHashForUser dedup guard can refuse a parallel run.
  createPlaceholder: db.prepare(
    `INSERT INTO bank_statements (
      id, user_id, billing_user_id, name,
      source_filename, source_mime, file_hash, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'analyzing')`
  ),
  updateAfterAnalyze: db.prepare(
    `UPDATE bank_statements
       SET name = ?, bank_name = ?, account_number_masked = ?,
           period_from = ?, period_to = ?, raw_extracted = ?,
           status = 'done', error_message = NULL,
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ?`
  ),
  setError: db.prepare(
    `UPDATE bank_statements
       SET status = 'error', error_message = ?,
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ?`
  ),
  inProgressByHashForUser: db.prepare(
    `SELECT * FROM bank_statements
       WHERE user_id = ? AND file_hash = ? AND status = 'analyzing'
       ORDER BY created_at DESC LIMIT 1`
  ),
  updateName: db.prepare(
    "UPDATE bank_statements SET name = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  updateTotals: db.prepare(
    `UPDATE bank_statements
       SET total_inflow = ?, total_outflow = ?, tx_count = ?,
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ?`
  ),
  deleteById: db.prepare('DELETE FROM bank_statements WHERE id = ? AND user_id = ?'),
  countByBillingUser: db.prepare(
    'SELECT COUNT(*) as count FROM bank_statements WHERE billing_user_id = ?'
  ),
};

export const bankStatementRepo = {
  findByUserId(userId: string): BankStatementRow[] {
    return stmts.findByUserId.all(userId) as BankStatementRow[];
  },

  findByIdForUser(id: string, userId: string): BankStatementRow | undefined {
    return stmts.findByIdForUser.get(id, userId) as BankStatementRow | undefined;
  },

  create(userId: string, billingUserId: string, input: BankStatementCreateInput, fileHash: string | null = null): BankStatementRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(
      id,
      userId,
      billingUserId,
      input.name,
      input.bankName,
      input.accountNumberMasked,
      input.periodFrom,
      input.periodTo,
      input.sourceFilename,
      input.sourceMime,
      input.rawExtracted,
      fileHash,
    );
    return this.findByIdForUser(id, userId)!;
  },

  /** Insert an `analyzing` placeholder. Returns the row so the route can
   *  respond with the id immediately and the frontend can poll for it. */
  createPlaceholder(userId: string, billingUserId: string, input: BankStatementPlaceholderInput): BankStatementRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.createPlaceholder.run(
      id,
      userId,
      billingUserId,
      input.name,
      input.sourceFilename,
      input.sourceMime,
      input.fileHash,
    );
    return this.findByIdForUser(id, userId)!;
  },

  /** Fill in extracted metadata + flip status to 'done'. Used after the
   *  Gemini analysis completes for a placeholder created upfront. */
  updateAfterAnalyze(id: string, userId: string, input: BankStatementCreateInput): boolean {
    return stmts.updateAfterAnalyze.run(
      input.name,
      input.bankName,
      input.accountNumberMasked,
      input.periodFrom,
      input.periodTo,
      input.rawExtracted,
      id,
      userId,
    ).changes > 0;
  },

  setError(id: string, userId: string, message: string): boolean {
    return stmts.setError.run(message.slice(0, 500), id, userId).changes > 0;
  },

  findInProgressByHashForUser(userId: string, fileHash: string): BankStatementRow | undefined {
    return stmts.inProgressByHashForUser.get(userId, fileHash) as BankStatementRow | undefined;
  },

  updateName(id: string, userId: string, name: string): boolean {
    return stmts.updateName.run(name, id, userId).changes > 0;
  },

  updateTotals(id: string, inflow: number, outflow: number, txCount: number): void {
    stmts.updateTotals.run(inflow, outflow, txCount, id);
  },

  deleteById(id: string, userId: string): boolean {
    return stmts.deleteById.run(id, userId).changes > 0;
  },

  countByBillingUser(billingUserId: string): number {
    return (stmts.countByBillingUser.get(billingUserId) as { count: number }).count;
  },
};
