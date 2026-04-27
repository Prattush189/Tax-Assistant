import db from '../index.js';
import crypto from 'crypto';

export type NoticeStatus = 'draft' | 'generating' | 'generated' | 'error';

export interface Notice {
  id: string;
  user_id: string;
  notice_type: string;
  sub_type: string | null;
  title: string | null;
  input_data: string | null;
  generated_content: string | null;
  status: NoticeStatus;
  file_hash: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const stmts = {
  create: db.prepare(
    'INSERT INTO notices (id, user_id, billing_user_id, notice_type, sub_type, title, input_data) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ),
  // Upfront placeholder for AI-driven notices: status='generating' so a
  // tab-close + reload sees the in-flight notice in the list and the
  // dedup guard refuses a parallel run on the same input fingerprint.
  createPlaceholder: db.prepare(
    `INSERT INTO notices (
      id, user_id, billing_user_id, notice_type, sub_type, title,
      input_data, file_hash, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'generating')`
  ),
  setError: db.prepare(
    `UPDATE notices SET status = 'error', error_message = ?,
       updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ?`
  ),
  inProgressByHashForUser: db.prepare(
    `SELECT * FROM notices
       WHERE user_id = ? AND file_hash = ? AND status = 'generating'
       ORDER BY created_at DESC LIMIT 1`
  ),
  findById: db.prepare('SELECT * FROM notices WHERE id = ?'),
  findByUser: db.prepare(
    'SELECT id, notice_type, sub_type, title, status, error_message, created_at, updated_at FROM notices WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50'
  ),
  updateContent: db.prepare(
    "UPDATE notices SET generated_content = ?, status = 'generated', error_message = NULL, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  updateDraft: db.prepare(
    "UPDATE notices SET generated_content = ?, title = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  deleteById: db.prepare('DELETE FROM notices WHERE id = ? AND user_id = ?'),
  countByUserMonth: db.prepare(`
    SELECT COUNT(*) AS count FROM notices
    WHERE user_id = ? AND created_at >= ?
  `),
  countByBillingUserMonth: db.prepare(`
    SELECT COUNT(*) AS count FROM notices
    WHERE billing_user_id = ? AND created_at >= ?
  `),
};

export const noticeRepo = {
  /**
   * Create a notice row. `billingUserId` identifies the pool owner whose
   * monthly notice quota is charged — defaults to `userId` for standalone
   * users (no inviter).
   */
  create(
    userId: string,
    noticeType: string,
    subType: string | null,
    title: string | null,
    inputData: string | null,
    billingUserId?: string,
  ): string {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(id, userId, billingUserId ?? userId, noticeType, subType, title, inputData);
    return id;
  },

  /** Upfront placeholder created BEFORE the Gemini call. */
  createPlaceholder(
    userId: string,
    noticeType: string,
    subType: string | null,
    title: string | null,
    inputData: string | null,
    fileHash: string | null,
    billingUserId?: string,
  ): string {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.createPlaceholder.run(id, userId, billingUserId ?? userId, noticeType, subType, title, inputData, fileHash);
    return id;
  },

  setError(id: string, userId: string, message: string): boolean {
    return stmts.setError.run(message.slice(0, 500), id, userId).changes > 0;
  },

  findInProgressByHashForUser(userId: string, fileHash: string): Notice | null {
    return (stmts.inProgressByHashForUser.get(userId, fileHash) as Notice) ?? null;
  },

  findById(id: string): Notice | null {
    return (stmts.findById.get(id) as Notice) ?? null;
  },

  findByUser(userId: string): Omit<Notice, 'input_data' | 'generated_content'>[] {
    return stmts.findByUser.all(userId) as Omit<Notice, 'input_data' | 'generated_content'>[];
  },

  updateContent(id: string, content: string): void {
    stmts.updateContent.run(content, id);
  },

  updateDraft(id: string, content: string, title: string | null): void {
    stmts.updateDraft.run(content, title, id);
  },

  deleteById(id: string, userId: string): boolean {
    const result = stmts.deleteById.run(id, userId);
    return result.changes > 0;
  },

  countByUserMonth(userId: string): number {
    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const since = start.toISOString().replace('Z', '');
    const row = stmts.countByUserMonth.get(userId, since) as { count: number };
    return row.count;
  },

  countByBillingUserMonth(billingUserId: string): number {
    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const since = start.toISOString().replace('Z', '');
    const row = stmts.countByBillingUserMonth.get(billingUserId, since) as { count: number };
    return row.count;
  },
};
