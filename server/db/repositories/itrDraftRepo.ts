import crypto from 'crypto';
import db from '../index.js';

export type ItrFormType = 'ITR1' | 'ITR4';

export interface ItrDraftRow {
  id: string;
  user_id: string;
  form_type: ItrFormType;
  assessment_year: string;
  name: string;
  ui_payload: string;              // JSON string
  last_validated_at: string | null;
  last_validation_errors: string | null; // JSON array string, or null if valid
  exported_at: string | null;
  created_at: string;
  updated_at: string;
}

const stmts = {
  findByUserId: db.prepare(
    'SELECT * FROM itr_drafts WHERE user_id = ? ORDER BY updated_at DESC'
  ),
  findByIdForUser: db.prepare(
    'SELECT * FROM itr_drafts WHERE id = ? AND user_id = ?'
  ),
  create: db.prepare(
    'INSERT INTO itr_drafts (id, user_id, billing_user_id, form_type, assessment_year, name, ui_payload) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ),
  updatePayload: db.prepare(
    "UPDATE itr_drafts SET ui_payload = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  updateName: db.prepare(
    "UPDATE itr_drafts SET name = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  markValidated: db.prepare(
    "UPDATE itr_drafts SET last_validated_at = datetime('now', '+5 hours', '+30 minutes'), last_validation_errors = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  markExported: db.prepare(
    "UPDATE itr_drafts SET exported_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  deleteById: db.prepare('DELETE FROM itr_drafts WHERE id = ? AND user_id = ?'),
};

export const itrDraftRepo = {
  findByUserId(userId: string): ItrDraftRow[] {
    return stmts.findByUserId.all(userId) as ItrDraftRow[];
  },

  findByIdForUser(id: string, userId: string): ItrDraftRow | undefined {
    return stmts.findByIdForUser.get(id, userId) as ItrDraftRow | undefined;
  },

  create(
    userId: string,
    formType: ItrFormType,
    assessmentYear: string,
    name: string,
    uiPayload: string = '{}',
    billingUserId?: string,
  ): ItrDraftRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(id, userId, billingUserId ?? userId, formType, assessmentYear, name, uiPayload);
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

  markValidated(id: string, userId: string, errorsJson: string | null): void {
    stmts.markValidated.run(errorsJson, id, userId);
  },

  markExported(id: string, userId: string): void {
    stmts.markExported.run(id, userId);
  },

  deleteById(id: string, userId: string): boolean {
    const result = stmts.deleteById.run(id, userId);
    return result.changes > 0;
  },
};
