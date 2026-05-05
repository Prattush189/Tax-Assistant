import crypto from 'crypto';
import db from '../index.js';

export type BankStatementStatus = 'analyzing' | 'done' | 'error' | 'cancelled';

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
  pages_total: number;
  pages_processed: number;
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
  /** Total page count (for PDF / vision) or row count (for CSV)
   *  computed up front. Used by the quota pre-flight check + the
   *  per-chunk pages_processed accumulator at finish time. */
  pagesTotal: number;
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
      source_filename, source_mime, file_hash, status, pages_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'analyzing', ?)`
  ),
  // Bumps pages_processed by the chunk's page count after each
  // chunk completes. On cancel/finish we read this column and
  // convert to credits via creditsForPages().
  bumpPagesProcessed: db.prepare(
    `UPDATE bank_statements
       SET pages_processed = pages_processed + ?,
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ?`
  ),
  // CSV-batch progress (separate from page-based billing). Used by
  // the wizard's categorisation path so frontend can show
  // "3 of 5 batches" via the 5s polling loop.
  setAnalyzeChunksTotal: db.prepare(
    `UPDATE bank_statements
       SET analyze_chunks_total = ?, analyze_chunks_done = 0,
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ?`
  ),
  bumpAnalyzeChunksDone: db.prepare(
    `UPDATE bank_statements
       SET analyze_chunks_done = analyze_chunks_done + 1,
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ?`
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
  cancel: db.prepare(
    `UPDATE bank_statements
       SET status = 'cancelled', error_message = COALESCE(error_message, 'Cancelled by user'),
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ? AND status = 'analyzing'`
  ),
  getStatus: db.prepare(
    'SELECT status FROM bank_statements WHERE id = ? AND user_id = ?'
  ),
  inProgressByHashForUser: db.prepare(
    `SELECT * FROM bank_statements
       WHERE user_id = ? AND file_hash = ? AND status = 'analyzing'
       ORDER BY created_at DESC LIMIT 1`
  ),
  // Used to dedupe SUCCESSFUL re-uploads of the same file. Without this,
  // a second upload of the same statement re-runs Gemini and (because
  // even at temperature: 0 the fallback model can land on different
  // chunks across runs) produces different totals — confusing the user.
  doneByHashForUser: db.prepare(
    `SELECT * FROM bank_statements
       WHERE user_id = ? AND file_hash = ? AND status = 'done'
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
      input.pagesTotal,
    );
    return this.findByIdForUser(id, userId)!;
  },

  /** Add to pages_processed after each successful chunk. Returns the
   *  current accumulator so the caller can log progress. */
  bumpPagesProcessed(id: string, userId: string, deltaPages: number): void {
    if (deltaPages <= 0) return;
    stmts.bumpPagesProcessed.run(deltaPages, id, userId);
  },

  /** CSV-batch progress (used by the wizard's categorisation path). */
  setAnalyzeChunksTotal(id: string, userId: string, total: number): void {
    stmts.setAnalyzeChunksTotal.run(total, id, userId);
  },

  bumpAnalyzeChunksDone(id: string, userId: string): void {
    stmts.bumpAnalyzeChunksDone.run(id, userId);
  },

  /** Flip provider_fallback to 1 when an LLM call on this run dropped
   *  from the primary to a backup model. */
  markProviderFallback(id: string): void {
    db.prepare(`UPDATE bank_statements SET provider_fallback = 1 WHERE id = ?`).run(id);
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

  /** Cancel an analyzing statement. Only flips rows that are still
   *  'analyzing' so a late update from a finished Gemini run can't
   *  silently overwrite the cancel intent. */
  cancel(id: string, userId: string): boolean {
    return stmts.cancel.run(id, userId).changes > 0;
  },

  /** Cheap status read for the in-flight cancel guard in /analyze. */
  getStatus(id: string, userId: string): BankStatementStatus | null {
    const row = stmts.getStatus.get(id, userId) as { status: BankStatementStatus } | undefined;
    return row?.status ?? null;
  },

  findInProgressByHashForUser(userId: string, fileHash: string): BankStatementRow | undefined {
    return stmts.inProgressByHashForUser.get(userId, fileHash) as BankStatementRow | undefined;
  },

  findDoneByHashForUser(userId: string, fileHash: string): BankStatementRow | undefined {
    return stmts.doneByHashForUser.get(userId, fileHash) as BankStatementRow | undefined;
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
