import crypto from 'crypto';
import db from '../index.js';

export type PartnershipDeedTemplateId =
  | 'partnership_deed'
  | 'llp_agreement'
  | 'reconstitution_deed'
  | 'retirement_deed'
  | 'dissolution_deed';

export type PartnershipDeedStatus = 'draft' | 'generating' | 'generated' | 'error';

export interface PartnershipDeedRow {
  id: string;
  user_id: string;
  billing_user_id: string | null;
  template_id: PartnershipDeedTemplateId;
  name: string;
  ui_payload: string;            // JSON string — form payload
  generated_content: string | null; // AI-generated Markdown body
  status: PartnershipDeedStatus;
  file_hash: string | null;
  error_message: string | null;
  exported_at: string | null;
  created_at: string;
  updated_at: string;
}

const stmts = {
  findByUserId: db.prepare(
    'SELECT * FROM partnership_deeds WHERE user_id = ? ORDER BY updated_at DESC',
  ),
  findByIdForUser: db.prepare(
    'SELECT * FROM partnership_deeds WHERE id = ? AND user_id = ?',
  ),
  create: db.prepare(
    'INSERT INTO partnership_deeds (id, user_id, billing_user_id, template_id, name, ui_payload) VALUES (?, ?, ?, ?, ?, ?)',
  ),
  updatePayload: db.prepare(
    "UPDATE partnership_deeds SET ui_payload = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?",
  ),
  updateName: db.prepare(
    "UPDATE partnership_deeds SET name = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?",
  ),
  updateGenerated: db.prepare(
    "UPDATE partnership_deeds SET generated_content = ?, status = 'generated', error_message = NULL, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?",
  ),
  markGenerating: db.prepare(
    `UPDATE partnership_deeds SET status = 'generating', file_hash = ?, error_message = NULL,
       updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ?`,
  ),
  setError: db.prepare(
    `UPDATE partnership_deeds SET status = 'error', error_message = ?,
       updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ? AND user_id = ?`,
  ),
  inProgressByHashForUser: db.prepare(
    `SELECT * FROM partnership_deeds
       WHERE user_id = ? AND file_hash = ? AND status = 'generating'
       ORDER BY updated_at DESC LIMIT 1`,
  ),
  markExported: db.prepare(
    "UPDATE partnership_deeds SET exported_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?",
  ),
  deleteById: db.prepare('DELETE FROM partnership_deeds WHERE id = ? AND user_id = ?'),
};

export const partnershipDeedRepo = {
  findByUserId(userId: string): PartnershipDeedRow[] {
    return stmts.findByUserId.all(userId) as PartnershipDeedRow[];
  },

  findByIdForUser(id: string, userId: string): PartnershipDeedRow | undefined {
    return stmts.findByIdForUser.get(id, userId) as PartnershipDeedRow | undefined;
  },

  create(
    userId: string,
    templateId: PartnershipDeedTemplateId,
    name: string,
    uiPayload: string = '{}',
    billingUserId?: string,
  ): PartnershipDeedRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(id, userId, billingUserId ?? userId, templateId, name, uiPayload);
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

  updateGeneratedContent(id: string, userId: string, content: string): boolean {
    const result = stmts.updateGenerated.run(content, id, userId);
    return result.changes > 0;
  },

  /** Flip an existing draft into 'generating' state with the input
   *  fingerprint. Returns true if the row was updated; false (no rows
   *  changed) if the draft doesn't belong to this user. */
  markGenerating(id: string, userId: string, fileHash: string): boolean {
    return stmts.markGenerating.run(fileHash, id, userId).changes > 0;
  },

  setError(id: string, userId: string, message: string): boolean {
    return stmts.setError.run(message.slice(0, 500), id, userId).changes > 0;
  },

  findInProgressByHashForUser(userId: string, fileHash: string): PartnershipDeedRow | undefined {
    return stmts.inProgressByHashForUser.get(userId, fileHash) as PartnershipDeedRow | undefined;
  },

  markExported(id: string, userId: string): void {
    stmts.markExported.run(id, userId);
  },

  deleteById(id: string, userId: string): boolean {
    const result = stmts.deleteById.run(id, userId);
    return result.changes > 0;
  },
};
