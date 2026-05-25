/**
 * TB → BS draft repository. Identical lifecycle to cmaDraftRepo
 * (form-driven, synchronous Excel emit, no AI streaming) so the
 * shape is intentionally a near-clone. Separate table because the
 * payload schema differs (TB upload + Schedule III mapping vs CMA's
 * projection assumptions) and keeping them apart avoids confusing
 * cross-feature queries.
 */
import crypto from 'crypto';
import db from '../index.js';

export interface TbBsDraftRow {
  id: string;
  user_id: string;
  billing_user_id: string | null;
  name: string;
  ui_payload: string;
  exported_at: string | null;
  created_at: string;
  updated_at: string;
}

const stmts = {
  findByUserId: db.prepare(
    'SELECT * FROM tb_bs_drafts WHERE user_id = ? ORDER BY updated_at DESC',
  ),
  findByIdForUser: db.prepare(
    'SELECT * FROM tb_bs_drafts WHERE id = ? AND user_id = ?',
  ),
  create: db.prepare(
    'INSERT INTO tb_bs_drafts (id, user_id, billing_user_id, name, ui_payload) VALUES (?, ?, ?, ?, ?)',
  ),
  updatePayload: db.prepare(
    "UPDATE tb_bs_drafts SET ui_payload = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?",
  ),
  updateName: db.prepare(
    "UPDATE tb_bs_drafts SET name = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?",
  ),
  markExported: db.prepare(
    "UPDATE tb_bs_drafts SET exported_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?",
  ),
  deleteById: db.prepare('DELETE FROM tb_bs_drafts WHERE id = ? AND user_id = ?'),
};

export const tbBsDraftRepo = {
  findByUserId(userId: string): TbBsDraftRow[] {
    return stmts.findByUserId.all(userId) as TbBsDraftRow[];
  },
  findByIdForUser(id: string, userId: string): TbBsDraftRow | undefined {
    return stmts.findByIdForUser.get(id, userId) as TbBsDraftRow | undefined;
  },
  create(userId: string, name: string, uiPayload: string = '{}', billingUserId?: string): TbBsDraftRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(id, userId, billingUserId ?? userId, name, uiPayload);
    return this.findByIdForUser(id, userId)!;
  },
  updatePayload(id: string, userId: string, uiPayload: string): boolean {
    return stmts.updatePayload.run(uiPayload, id, userId).changes > 0;
  },
  updateName(id: string, userId: string, name: string): boolean {
    return stmts.updateName.run(name, id, userId).changes > 0;
  },
  markExported(id: string, userId: string): boolean {
    return stmts.markExported.run(id, userId).changes > 0;
  },
  deleteById(id: string, userId: string): boolean {
    return stmts.deleteById.run(id, userId).changes > 0;
  },
};
