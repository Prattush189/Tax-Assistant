import crypto from 'crypto';
import db from '../index.js';

/**
 * Repository for the new generic `profiles` table — stores identity, address,
 * banks, notice defaults, and per-AY data as JSON slices. Separate from the
 * calculator-focused `tax_profiles` table (see profileRepo.ts).
 */

export interface ProfileRow {
  id: string;
  user_id: string;
  name: string;
  identity_data: string;     // JSON
  address_data: string;      // JSON
  banks_data: string;        // JSON array
  notice_defaults: string;   // JSON
  per_ay_data: string;       // JSON map by AY
  filing_status: string;     // pending | draft | validated | exported | filed | verified
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ProfileSlice =
  | 'identity_data'
  | 'address_data'
  | 'banks_data'
  | 'notice_defaults'
  | 'per_ay_data';

const stmts = {
  findByUserId: db.prepare(
    'SELECT * FROM profiles WHERE user_id = ? ORDER BY updated_at DESC'
  ),
  countByBillingUser: db.prepare(
    'SELECT COUNT(*) as cnt FROM profiles WHERE billing_user_id = ?'
  ),
  findByIdForUser: db.prepare(
    'SELECT * FROM profiles WHERE id = ? AND user_id = ?'
  ),
  create: db.prepare(
    'INSERT INTO profiles (id, user_id, billing_user_id, name) VALUES (?, ?, ?, ?)'
  ),
  updateName: db.prepare(
    "UPDATE profiles SET name = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  updateIdentity: db.prepare(
    "UPDATE profiles SET identity_data = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  updateAddress: db.prepare(
    "UPDATE profiles SET address_data = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  updateBanks: db.prepare(
    "UPDATE profiles SET banks_data = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  updateNoticeDefaults: db.prepare(
    "UPDATE profiles SET notice_defaults = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  updatePerAy: db.prepare(
    "UPDATE profiles SET per_ay_data = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  updateFilingStatus: db.prepare(
    "UPDATE profiles SET filing_status = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  updateNotes: db.prepare(
    "UPDATE profiles SET notes = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  deleteById: db.prepare('DELETE FROM profiles WHERE id = ? AND user_id = ?'),
};

export const profileRepoV2 = {
  findByUserId(userId: string): ProfileRow[] {
    return stmts.findByUserId.all(userId) as ProfileRow[];
  },

  countByBillingUser(billingUserId: string): number {
    const row = stmts.countByBillingUser.get(billingUserId) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  },

  findByIdForUser(id: string, userId: string): ProfileRow | undefined {
    return stmts.findByIdForUser.get(id, userId) as ProfileRow | undefined;
  },

  create(userId: string, name: string, billingUserId?: string): ProfileRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(id, userId, billingUserId ?? userId, name);
    return this.findByIdForUser(id, userId)!;
  },

  updateName(id: string, userId: string, name: string): boolean {
    return stmts.updateName.run(name, id, userId).changes > 0;
  },

  updateSlice(
    id: string,
    userId: string,
    slice: ProfileSlice,
    jsonString: string,
  ): boolean {
    switch (slice) {
      case 'identity_data':
        return stmts.updateIdentity.run(jsonString, id, userId).changes > 0;
      case 'address_data':
        return stmts.updateAddress.run(jsonString, id, userId).changes > 0;
      case 'banks_data':
        return stmts.updateBanks.run(jsonString, id, userId).changes > 0;
      case 'notice_defaults':
        return stmts.updateNoticeDefaults.run(jsonString, id, userId).changes > 0;
      case 'per_ay_data':
        return stmts.updatePerAy.run(jsonString, id, userId).changes > 0;
    }
  },

  /**
   * Merges a patch into the existing per_ay_data JSON for a single AY.
   * Keeps other years untouched.
   */
  updatePerAyYear(
    id: string,
    userId: string,
    year: string,
    yearPatch: Record<string, unknown>,
  ): boolean {
    const row = this.findByIdForUser(id, userId);
    if (!row) return false;
    let current: Record<string, Record<string, unknown>> = {};
    try {
      current = JSON.parse(row.per_ay_data) as Record<string, Record<string, unknown>>;
    } catch {
      current = {};
    }
    const existingYear = current[year] ?? {};
    current[year] = { ...existingYear, ...yearPatch };
    return stmts.updatePerAy.run(JSON.stringify(current), id, userId).changes > 0;
  },

  updateFilingStatus(id: string, userId: string, status: string): boolean {
    return stmts.updateFilingStatus.run(status, id, userId).changes > 0;
  },

  updateNotes(id: string, userId: string, notes: string): boolean {
    return stmts.updateNotes.run(notes, id, userId).changes > 0;
  },

  deleteById(id: string, userId: string): boolean {
    return stmts.deleteById.run(id, userId).changes > 0;
  },
};
