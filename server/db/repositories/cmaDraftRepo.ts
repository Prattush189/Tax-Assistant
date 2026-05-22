/**
 * CMA (Credit Monitoring Arrangement) drafts repository.
 *
 * Simpler than partnershipDeedRepo because CMA generation is pure
 * computation (Excel emit) rather than streamed AI text — so no
 * template_id enum, no `status` lifecycle, no file_hash dedup, no
 * generated_content blob. Plain CRUD over a JSON ui_payload, mirrored
 * to/from the wizard UI client-side.
 *
 * Scoping: user_id owns the row, billing_user_id is the firm-scope
 * marker used for usage accounting (matches every other feature).
 * findByIdForUser enforces user-level access; routes never look up
 * by id alone.
 */
import crypto from 'crypto';
import db from '../index.js';

export interface CmaDraftRow {
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
    'SELECT * FROM cma_drafts WHERE user_id = ? ORDER BY updated_at DESC',
  ),
  findByIdForUser: db.prepare(
    'SELECT * FROM cma_drafts WHERE id = ? AND user_id = ?',
  ),
  create: db.prepare(
    'INSERT INTO cma_drafts (id, user_id, billing_user_id, name, ui_payload) VALUES (?, ?, ?, ?, ?)',
  ),
  updatePayload: db.prepare(
    "UPDATE cma_drafts SET ui_payload = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?",
  ),
  updateName: db.prepare(
    "UPDATE cma_drafts SET name = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?",
  ),
  markExported: db.prepare(
    "UPDATE cma_drafts SET exported_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?",
  ),
  deleteById: db.prepare('DELETE FROM cma_drafts WHERE id = ? AND user_id = ?'),
};

export const cmaDraftRepo = {
  findByUserId(userId: string): CmaDraftRow[] {
    return stmts.findByUserId.all(userId) as CmaDraftRow[];
  },

  findByIdForUser(id: string, userId: string): CmaDraftRow | undefined {
    return stmts.findByIdForUser.get(id, userId) as CmaDraftRow | undefined;
  },

  create(
    userId: string,
    name: string,
    uiPayload: string = '{}',
    billingUserId?: string,
  ): CmaDraftRow {
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
