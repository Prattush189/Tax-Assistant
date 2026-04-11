import crypto from 'crypto';
import db from '../index.js';

export type BoardResolutionTemplateId =
  | 'appointment_of_director'
  | 'bank_account_opening'
  | 'borrowing_powers'
  | 'share_allotment';

export interface BoardResolutionRow {
  id: string;
  user_id: string;
  template_id: BoardResolutionTemplateId;
  name: string;
  ui_payload: string; // JSON string
  exported_at: string | null;
  created_at: string;
  updated_at: string;
}

const stmts = {
  findByUserId: db.prepare(
    'SELECT * FROM board_resolutions WHERE user_id = ? ORDER BY updated_at DESC'
  ),
  findByIdForUser: db.prepare(
    'SELECT * FROM board_resolutions WHERE id = ? AND user_id = ?'
  ),
  create: db.prepare(
    'INSERT INTO board_resolutions (id, user_id, template_id, name, ui_payload) VALUES (?, ?, ?, ?, ?)'
  ),
  updatePayload: db.prepare(
    "UPDATE board_resolutions SET ui_payload = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  updateName: db.prepare(
    "UPDATE board_resolutions SET name = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  markExported: db.prepare(
    "UPDATE board_resolutions SET exported_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  deleteById: db.prepare('DELETE FROM board_resolutions WHERE id = ? AND user_id = ?'),
};

export const boardResolutionRepo = {
  findByUserId(userId: string): BoardResolutionRow[] {
    return stmts.findByUserId.all(userId) as BoardResolutionRow[];
  },

  findByIdForUser(id: string, userId: string): BoardResolutionRow | undefined {
    return stmts.findByIdForUser.get(id, userId) as BoardResolutionRow | undefined;
  },

  create(
    userId: string,
    templateId: BoardResolutionTemplateId,
    name: string,
    uiPayload: string = '{}',
  ): BoardResolutionRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(id, userId, templateId, name, uiPayload);
    return this.findByIdForUser(id, userId)!;
  },

  updatePayload(id: string, userId: string, uiPayload: string): boolean {
    const result = stmts.updatePayload.run(uiPayload, id, userId);
    return result.changes > 0;
  },

  updateName(id: string, userId: string, name: string): boolean {
    const result = stmts.updateName.run(name, id, userId);
    return result.changes > 0;
  },

  markExported(id: string, userId: string): void {
    stmts.markExported.run(id, userId);
  },

  deleteById(id: string, userId: string): boolean {
    const result = stmts.deleteById.run(id, userId);
    return result.changes > 0;
  },
};
