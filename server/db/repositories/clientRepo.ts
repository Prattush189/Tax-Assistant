import crypto from 'crypto';
import db from '../index.js';

export interface ClientRow {
  id: string;
  user_id: string;
  billing_user_id: string | null;
  name: string;
  pan: string | null;
  email: string | null;
  phone: string | null;
  profile_id: string | null;
  itr_draft_id: string | null;
  form_type: string;
  assessment_year: string;
  filing_status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const stmts = {
  findByUserId: db.prepare(
    'SELECT * FROM clients WHERE user_id = ? ORDER BY updated_at DESC'
  ),
  findByIdForUser: db.prepare(
    'SELECT * FROM clients WHERE id = ? AND user_id = ?'
  ),
  countByBillingUser: db.prepare(
    'SELECT COUNT(*) as cnt FROM clients WHERE billing_user_id = ?'
  ),
  create: db.prepare(
    'INSERT INTO clients (id, user_id, billing_user_id, name, pan, email, phone, form_type, assessment_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  update: db.prepare(
    "UPDATE clients SET name = ?, pan = ?, email = ?, phone = ?, form_type = ?, assessment_year = ?, filing_status = ?, notes = ?, profile_id = ?, itr_draft_id = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  updateStatus: db.prepare(
    "UPDATE clients SET filing_status = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  linkProfile: db.prepare(
    "UPDATE clients SET profile_id = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  linkDraft: db.prepare(
    "UPDATE clients SET itr_draft_id = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  deleteById: db.prepare('DELETE FROM clients WHERE id = ? AND user_id = ?'),
  statusSummary: db.prepare(
    'SELECT filing_status, COUNT(*) as cnt FROM clients WHERE user_id = ? GROUP BY filing_status'
  ),
};

export const clientRepo = {
  findByUserId(userId: string): ClientRow[] {
    return stmts.findByUserId.all(userId) as ClientRow[];
  },

  findByIdForUser(id: string, userId: string): ClientRow | undefined {
    return stmts.findByIdForUser.get(id, userId) as ClientRow | undefined;
  },

  countByBillingUser(billingUserId: string): number {
    const row = stmts.countByBillingUser.get(billingUserId) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  },

  create(
    userId: string,
    billingUserId: string,
    data: { name: string; pan?: string; email?: string; phone?: string; formType?: string; assessmentYear?: string },
  ): ClientRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(
      id, userId, billingUserId,
      data.name, data.pan ?? null, data.email ?? null, data.phone ?? null,
      data.formType ?? 'ITR1', data.assessmentYear ?? '2025',
    );
    return this.findByIdForUser(id, userId)!;
  },

  update(id: string, userId: string, data: Partial<ClientRow>): boolean {
    const existing = this.findByIdForUser(id, userId);
    if (!existing) return false;
    return stmts.update.run(
      data.name ?? existing.name,
      data.pan ?? existing.pan,
      data.email ?? existing.email,
      data.phone ?? existing.phone,
      data.form_type ?? existing.form_type,
      data.assessment_year ?? existing.assessment_year,
      data.filing_status ?? existing.filing_status,
      data.notes ?? existing.notes,
      data.profile_id ?? existing.profile_id,
      data.itr_draft_id ?? existing.itr_draft_id,
      id, userId,
    ).changes > 0;
  },

  updateStatus(id: string, userId: string, status: string): boolean {
    return stmts.updateStatus.run(status, id, userId).changes > 0;
  },

  linkProfile(id: string, userId: string, profileId: string): boolean {
    return stmts.linkProfile.run(profileId, id, userId).changes > 0;
  },

  linkDraft(id: string, userId: string, draftId: string): boolean {
    return stmts.linkDraft.run(draftId, id, userId).changes > 0;
  },

  deleteById(id: string, userId: string): boolean {
    return stmts.deleteById.run(id, userId).changes > 0;
  },

  statusSummary(userId: string): Record<string, number> {
    const rows = stmts.statusSummary.all(userId) as { filing_status: string; cnt: number }[];
    const result: Record<string, number> = {};
    for (const r of rows) result[r.filing_status] = r.cnt;
    return result;
  },
};
