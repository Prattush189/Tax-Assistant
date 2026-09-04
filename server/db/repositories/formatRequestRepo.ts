import crypto from 'crypto';
import db from '../index.js';

export type FormatRequestKind = 'ledger' | 'bank';
export type FormatRequestStatus = 'new' | 'in_progress' | 'done' | 'rejected';

/** Row as listed for admins — deliberately WITHOUT file_blob so a
 *  listing never drags every sample file into memory (or into a JSON
 *  response). Fetch the bytes explicitly via findFile(). */
export interface FormatRequestSummary {
  id: string;
  user_id: string;
  billing_user_id: string | null;
  kind: FormatRequestKind;
  software_name: string;
  notes: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  status: FormatRequestStatus;
  admin_note: string | null;
  created_at: string;
  /** Joined for the admin list so requests are actionable without a
   *  second lookup per row. */
  user_email?: string;
  user_name?: string;
}

const LIST_COLS = `fr.id, fr.user_id, fr.billing_user_id, fr.kind, fr.software_name,
  fr.notes, fr.file_name, fr.file_mime, fr.file_size, fr.status, fr.admin_note,
  fr.created_at, u.email AS user_email, u.name AS user_name`;

export const formatRequestRepo = {
  create(input: {
    userId: string;
    billingUserId: string | null;
    kind: FormatRequestKind;
    softwareName: string;
    notes: string | null;
    file: { name: string; mime: string; size: number; buffer: Buffer } | null;
  }): string {
    const id = crypto.randomBytes(16).toString('hex');
    db.prepare(
      `INSERT INTO format_requests
       (id, user_id, billing_user_id, kind, software_name, notes, file_name, file_mime, file_size, file_blob)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.userId,
      input.billingUserId,
      input.kind,
      input.softwareName,
      input.notes,
      input.file?.name ?? null,
      input.file?.mime ?? null,
      input.file?.size ?? null,
      input.file?.buffer ?? null,
    );
    return id;
  },

  listAll(filter?: { kind?: FormatRequestKind; status?: FormatRequestStatus }): FormatRequestSummary[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter?.kind) { where.push('fr.kind = ?'); args.push(filter.kind); }
    if (filter?.status) { where.push('fr.status = ?'); args.push(filter.status); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return db.prepare(
      `SELECT ${LIST_COLS} FROM format_requests fr
       LEFT JOIN users u ON u.id = fr.user_id
       ${clause}
       ORDER BY fr.created_at DESC`,
    ).all(...args) as FormatRequestSummary[];
  },

  listForUser(userId: string): FormatRequestSummary[] {
    return db.prepare(
      `SELECT ${LIST_COLS} FROM format_requests fr
       LEFT JOIN users u ON u.id = fr.user_id
       WHERE fr.user_id = ? ORDER BY fr.created_at DESC`,
    ).all(userId) as FormatRequestSummary[];
  },

  /** Sample bytes + metadata. Admin download path only. */
  findFile(id: string): { file_name: string | null; file_mime: string | null; file_blob: Buffer | null } | null {
    return (db.prepare(
      'SELECT file_name, file_mime, file_blob FROM format_requests WHERE id = ?',
    ).get(id) as { file_name: string | null; file_mime: string | null; file_blob: Buffer | null } | undefined) ?? null;
  },

  update(id: string, patch: { status?: FormatRequestStatus; adminNote?: string }): boolean {
    const sets: string[] = [];
    const args: unknown[] = [];
    if (patch.status !== undefined) { sets.push('status = ?'); args.push(patch.status); }
    if (patch.adminNote !== undefined) { sets.push('admin_note = ?'); args.push(patch.adminNote); }
    if (!sets.length) return false;
    args.push(id);
    return db.prepare(`UPDATE format_requests SET ${sets.join(', ')} WHERE id = ?`).run(...args).changes > 0;
  },

  deleteById(id: string): boolean {
    return db.prepare('DELETE FROM format_requests WHERE id = ?').run(id).changes > 0;
  },

  /** Simple abuse guard — how many this user filed in the last 24 h. */
  countRecentForUser(userId: string): number {
    const row = db.prepare(
      `SELECT COUNT(*) AS n FROM format_requests
       WHERE user_id = ? AND created_at >= datetime('now', '+5 hours', '+30 minutes', '-1 day')`,
    ).get(userId) as { n: number };
    return row?.n ?? 0;
  },
};
