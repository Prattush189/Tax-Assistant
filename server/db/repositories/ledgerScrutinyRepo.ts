import crypto from 'crypto';
import db from '../index.js';

export type LedgerJobStatus = 'pending' | 'extracting' | 'scrutinizing' | 'done' | 'error' | 'cancelled';
export type LedgerObservationSeverity = 'info' | 'warn' | 'high';
export type LedgerObservationStatus = 'open' | 'resolved';

export interface LedgerJobRow {
  id: string;
  user_id: string;
  billing_user_id: string | null;
  name: string;
  party_name: string | null;
  gstin: string | null;
  period_from: string | null;
  period_to: string | null;
  source_filename: string | null;
  source_mime: string | null;
  file_hash: string | null;
  status: LedgerJobStatus;
  total_flags_high: number;
  total_flags_warn: number;
  total_flags_info: number;
  total_flagged_amount: number;
  raw_extracted: string | null;
  error_message: string | null;
  pages_total: number;
  pages_processed: number;
  created_at: string;
  updated_at: string;
}

export interface LedgerAccountRow {
  id: string;
  job_id: string;
  name: string;
  account_type: string | null;
  opening: number;
  closing: number;
  total_debit: number;
  total_credit: number;
  tx_count: number;
  sort_index: number;
}

export interface LedgerObservationRow {
  id: string;
  job_id: string;
  account_id: string | null;
  account_name: string | null;
  code: string;
  severity: LedgerObservationSeverity;
  message: string;
  amount: number | null;
  date_ref: string | null;
  suggested_action: string | null;
  status: LedgerObservationStatus;
  source: string;
  created_at: string;
}

export interface LedgerJobCreateInput {
  name: string;
  partyName: string | null;
  gstin: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  sourceFilename: string | null;
  sourceMime: string | null;
  fileHash: string | null;
}

export interface LedgerAccountCreateInput {
  name: string;
  accountType: string | null;
  opening: number;
  closing: number;
  totalDebit: number;
  totalCredit: number;
  txCount: number;
  sortIndex: number;
}

export interface LedgerObservationCreateInput {
  accountId: string | null;
  accountName: string | null;
  code: string;
  severity: LedgerObservationSeverity;
  message: string;
  amount: number | null;
  dateRef: string | null;
  suggestedAction: string | null;
}

const stmts = {
  jobsByUser: db.prepare(
    'SELECT * FROM ledger_scrutiny_jobs WHERE user_id = ? ORDER BY updated_at DESC'
  ),
  jobByIdForUser: db.prepare(
    'SELECT * FROM ledger_scrutiny_jobs WHERE id = ? AND user_id = ?'
  ),
  jobByHashForUser: db.prepare(
    'SELECT * FROM ledger_scrutiny_jobs WHERE user_id = ? AND file_hash = ? ORDER BY created_at DESC LIMIT 1'
  ),
  // Used to refuse a duplicate extract when one is still running for the
  // same file. Without this, a user reload-and-retry triggers a parallel
  // extraction that burns Gemini tokens for work the previous request is
  // still finishing on the server.
  inProgressJobByHashForUser: db.prepare(
    `SELECT * FROM ledger_scrutiny_jobs
       WHERE user_id = ? AND file_hash = ? AND status IN ('extracting','scrutinizing','pending')
       ORDER BY created_at DESC LIMIT 1`
  ),
  insertJob: db.prepare(
    `INSERT INTO ledger_scrutiny_jobs (
      id, user_id, billing_user_id, name,
      party_name, gstin, period_from, period_to,
      source_filename, source_mime, file_hash, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateJobStatus: db.prepare(
    `UPDATE ledger_scrutiny_jobs
       SET status = ?, error_message = ?,
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ?`
  ),
  // Used by the cancel button. Only flips RUNNING jobs to 'cancelled' so a
  // late server-side completion doesn't accidentally re-cancel a 'done' job.
  cancelJob: db.prepare(
    `UPDATE ledger_scrutiny_jobs
       SET status = 'cancelled', error_message = COALESCE(error_message, 'Cancelled by user'),
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ? AND status IN ('pending','extracting','scrutinizing')`
  ),
  // Read just the current status — used by long-running handlers to bail
  // out early if the user clicked Cancel mid-flight (the in-progress
  // Promise chain keeps producing chunks but we throw away the result).
  getStatus: db.prepare(
    'SELECT status FROM ledger_scrutiny_jobs WHERE id = ? AND user_id = ?'
  ),
  // Set pages_total once at upload time (after we've counted PDF
  // pages). Separate from the bump statement so the route can fail
  // pre-flight without touching pages_processed.
  setPagesTotal: db.prepare(
    `UPDATE ledger_scrutiny_jobs
       SET pages_total = ?,
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ?`
  ),
  // Bumps pages_processed as chunks complete. On cancel/finish we
  // read pages_processed and convert to credits via creditsForPages().
  bumpPagesProcessed: db.prepare(
    `UPDATE ledger_scrutiny_jobs
       SET pages_processed = pages_processed + ?,
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ?`
  ),
  getPagesTotals: db.prepare(
    'SELECT pages_total, pages_processed FROM ledger_scrutiny_jobs WHERE id = ? AND user_id = ?'
  ),
  // Scrutiny-pass chunk progress. Updated after every chunk finishes
  // so the frontend polling at /api/ledger-scrutiny/:id sees a live
  // counter. scrutiny_chunks_total is set once when chunking starts;
  // scrutiny_chunks_done bumps from 0 → total.
  setScrutinyChunksTotal: db.prepare(
    `UPDATE ledger_scrutiny_jobs
       SET scrutiny_chunks_total = ?, scrutiny_chunks_done = 0,
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ?`
  ),
  bumpScrutinyChunksDone: db.prepare(
    `UPDATE ledger_scrutiny_jobs
       SET scrutiny_chunks_done = scrutiny_chunks_done + 1,
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ?`
  ),
  getScrutinyChunkProgress: db.prepare(
    'SELECT scrutiny_chunks_total, scrutiny_chunks_done FROM ledger_scrutiny_jobs WHERE id = ? AND user_id = ?'
  ),
  updateJobExtraction: db.prepare(
    `UPDATE ledger_scrutiny_jobs
       SET raw_extracted = ?, party_name = COALESCE(?, party_name),
           gstin = COALESCE(?, gstin),
           period_from = COALESCE(?, period_from),
           period_to = COALESCE(?, period_to),
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ?`
  ),
  updateJobName: db.prepare(
    "UPDATE ledger_scrutiny_jobs SET name = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  updateJobTotals: db.prepare(
    `UPDATE ledger_scrutiny_jobs
       SET total_flags_high = ?, total_flags_warn = ?, total_flags_info = ?,
           total_flagged_amount = ?,
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ?`
  ),
  deleteJob: db.prepare('DELETE FROM ledger_scrutiny_jobs WHERE id = ? AND user_id = ?'),

  accountsByJob: db.prepare(
    'SELECT * FROM ledger_accounts WHERE job_id = ? ORDER BY sort_index ASC, name ASC'
  ),
  insertAccount: db.prepare(
    `INSERT INTO ledger_accounts (
      id, job_id, name, account_type,
      opening, closing, total_debit, total_credit, tx_count, sort_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  deleteAccountsByJob: db.prepare('DELETE FROM ledger_accounts WHERE job_id = ?'),

  observationsByJob: db.prepare(
    'SELECT * FROM ledger_observations WHERE job_id = ? ORDER BY CASE severity WHEN \'high\' THEN 0 WHEN \'warn\' THEN 1 ELSE 2 END, created_at ASC'
  ),
  insertObservation: db.prepare(
    `INSERT INTO ledger_observations (
      id, job_id, account_id, account_name,
      code, severity, message, amount, date_ref, suggested_action,
      status, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'ai')`
  ),
  deleteObservationsByJob: db.prepare('DELETE FROM ledger_observations WHERE job_id = ?'),
  updateObservationStatus: db.prepare(
    `UPDATE ledger_observations SET status = ?
       WHERE id = ? AND job_id IN (SELECT id FROM ledger_scrutiny_jobs WHERE user_id = ?)`
  ),
  observationByIdForUser: db.prepare(
    `SELECT o.* FROM ledger_observations o
       JOIN ledger_scrutiny_jobs j ON j.id = o.job_id
      WHERE o.id = ? AND j.user_id = ?`
  ),
};

export const ledgerScrutinyRepo = {
  // ── jobs ────────────────────────────────────────────────────────────
  listByUser(userId: string): LedgerJobRow[] {
    return stmts.jobsByUser.all(userId) as LedgerJobRow[];
  },

  findByIdForUser(id: string, userId: string): LedgerJobRow | undefined {
    return stmts.jobByIdForUser.get(id, userId) as LedgerJobRow | undefined;
  },

  findByHashForUser(userId: string, fileHash: string): LedgerJobRow | undefined {
    return stmts.jobByHashForUser.get(userId, fileHash) as LedgerJobRow | undefined;
  },

  findInProgressByHashForUser(userId: string, fileHash: string): LedgerJobRow | undefined {
    return stmts.inProgressJobByHashForUser.get(userId, fileHash) as LedgerJobRow | undefined;
  },

  createJob(userId: string, billingUserId: string, input: LedgerJobCreateInput): LedgerJobRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.insertJob.run(
      id,
      userId,
      billingUserId,
      input.name,
      input.partyName,
      input.gstin,
      input.periodFrom,
      input.periodTo,
      input.sourceFilename,
      input.sourceMime,
      input.fileHash,
      'pending',
    );
    return this.findByIdForUser(id, userId)!;
  },

  setStatus(id: string, userId: string, status: LedgerJobStatus, errorMessage: string | null = null): void {
    stmts.updateJobStatus.run(status, errorMessage, id, userId);
  },

  /** Cancel a running job. Returns true if the cancel actually flipped a
   *  row, false if the job had already settled (done/error/cancelled).
   *  The Gemini Promise chain on the server keeps running until natural
   *  completion — there's no kill-mid-fetch in Node — but the route
   *  re-checks status before persisting results so a cancelled job's
   *  output is discarded. */
  cancelJob(id: string, userId: string): boolean {
    return stmts.cancelJob.run(id, userId).changes > 0;
  },

  /** Cheap status read for in-flight bail-out checks. */
  getStatus(id: string, userId: string): LedgerJobStatus | null {
    const row = stmts.getStatus.get(id, userId) as { status: LedgerJobStatus } | undefined;
    return row?.status ?? null;
  },

  setPagesTotal(id: string, userId: string, pagesTotal: number): void {
    stmts.setPagesTotal.run(pagesTotal, id, userId);
  },

  bumpPagesProcessed(id: string, userId: string, deltaPages: number): void {
    if (deltaPages <= 0) return;
    stmts.bumpPagesProcessed.run(deltaPages, id, userId);
  },

  setScrutinyChunksTotal(id: string, userId: string, total: number): void {
    stmts.setScrutinyChunksTotal.run(total, id, userId);
  },

  bumpScrutinyChunksDone(id: string, userId: string): void {
    stmts.bumpScrutinyChunksDone.run(id, userId);
  },

  getScrutinyChunkProgress(id: string, userId: string): { scrutiny_chunks_total: number; scrutiny_chunks_done: number } | null {
    const row = stmts.getScrutinyChunkProgress.get(id, userId) as { scrutiny_chunks_total: number; scrutiny_chunks_done: number } | undefined;
    return row ?? null;
  },

  getPagesTotals(id: string, userId: string): { pages_total: number; pages_processed: number } | null {
    const row = stmts.getPagesTotals.get(id, userId) as { pages_total: number; pages_processed: number } | undefined;
    return row ?? null;
  },

  saveExtraction(
    id: string,
    userId: string,
    rawJson: string,
    meta: { partyName?: string | null; gstin?: string | null; periodFrom?: string | null; periodTo?: string | null },
  ): void {
    stmts.updateJobExtraction.run(
      rawJson,
      meta.partyName ?? null,
      meta.gstin ?? null,
      meta.periodFrom ?? null,
      meta.periodTo ?? null,
      id,
      userId,
    );
  },

  rename(id: string, userId: string, name: string): boolean {
    return stmts.updateJobName.run(name, id, userId).changes > 0;
  },

  updateTotals(id: string, high: number, warn: number, info: number, flaggedAmount: number): void {
    stmts.updateJobTotals.run(high, warn, info, flaggedAmount, id);
  },

  deleteById(id: string, userId: string): boolean {
    return stmts.deleteJob.run(id, userId).changes > 0;
  },

  // ── accounts ────────────────────────────────────────────────────────
  listAccounts(jobId: string): LedgerAccountRow[] {
    return stmts.accountsByJob.all(jobId) as LedgerAccountRow[];
  },

  replaceAccounts(jobId: string, accounts: LedgerAccountCreateInput[]): LedgerAccountRow[] {
    const tx = db.transaction((rows: LedgerAccountCreateInput[]) => {
      stmts.deleteAccountsByJob.run(jobId);
      for (const a of rows) {
        const id = crypto.randomBytes(16).toString('hex');
        stmts.insertAccount.run(
          id,
          jobId,
          a.name,
          a.accountType,
          a.opening,
          a.closing,
          a.totalDebit,
          a.totalCredit,
          a.txCount,
          a.sortIndex,
        );
      }
    });
    tx(accounts);
    return this.listAccounts(jobId);
  },

  // ── observations ────────────────────────────────────────────────────
  listObservations(jobId: string): LedgerObservationRow[] {
    return stmts.observationsByJob.all(jobId) as LedgerObservationRow[];
  },

  replaceObservations(jobId: string, observations: LedgerObservationCreateInput[]): LedgerObservationRow[] {
    const tx = db.transaction((rows: LedgerObservationCreateInput[]) => {
      stmts.deleteObservationsByJob.run(jobId);
      for (const o of rows) {
        const id = crypto.randomBytes(16).toString('hex');
        stmts.insertObservation.run(
          id,
          jobId,
          o.accountId,
          o.accountName,
          o.code,
          o.severity,
          o.message,
          o.amount,
          o.dateRef,
          o.suggestedAction,
        );
      }
    });
    tx(observations);
    return this.listObservations(jobId);
  },

  /** Append observations as scrutiny chunks complete — used by the
   *  "pause and save progress" flow. Each chunk's observations land
   *  in the DB immediately so a mid-run cancel preserves whatever
   *  the audit found before being stopped, and the polling loop on
   *  the frontend surfaces them as they appear instead of waiting
   *  for the whole 46-chunk run to finish. No delete; pure insert. */
  appendObservations(jobId: string, observations: LedgerObservationCreateInput[]): void {
    if (observations.length === 0) return;
    const tx = db.transaction((rows: LedgerObservationCreateInput[]) => {
      for (const o of rows) {
        const id = crypto.randomBytes(16).toString('hex');
        stmts.insertObservation.run(
          id,
          jobId,
          o.accountId,
          o.accountName,
          o.code,
          o.severity,
          o.message,
          o.amount,
          o.dateRef,
          o.suggestedAction,
        );
      }
    });
    tx(observations);
  },

  setObservationStatus(observationId: string, userId: string, status: LedgerObservationStatus): boolean {
    return stmts.updateObservationStatus.run(status, observationId, userId).changes > 0;
  },

  findObservationForUser(observationId: string, userId: string): LedgerObservationRow | undefined {
    return stmts.observationByIdForUser.get(observationId, userId) as LedgerObservationRow | undefined;
  },
};
