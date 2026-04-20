import crypto from 'crypto';
import db from '../index.js';

export interface BankStatementRow {
  id: string;
  user_id: string;
  billing_user_id: string | null;
  name: string;
  bank_name: string | null;
  account_number_masked: string | null;
  period_from: string | null;
  period_to: string | null;
  source_filename: string | null;
  source_mime: string | null;
  total_inflow: number;
  total_outflow: number;
  tx_count: number;
  raw_extracted: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankStatementCreateInput {
  name: string;
  bankName: string | null;
  accountNumberMasked: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  sourceFilename: string | null;
  sourceMime: string | null;
  rawExtracted: string | null;
}

const stmts = {
  findByUserId: db.prepare(
    'SELECT * FROM bank_statements WHERE user_id = ? ORDER BY updated_at DESC'
  ),
  findByIdForUser: db.prepare(
    'SELECT * FROM bank_statements WHERE id = ? AND user_id = ?'
  ),
  create: db.prepare(
    `INSERT INTO bank_statements (
      id, user_id, billing_user_id, name,
      bank_name, account_number_masked, period_from, period_to,
      source_filename, source_mime, raw_extracted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateName: db.prepare(
    "UPDATE bank_statements SET name = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ? AND user_id = ?"
  ),
  updateTotals: db.prepare(
    `UPDATE bank_statements
       SET total_inflow = ?, total_outflow = ?, tx_count = ?,
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ?`
  ),
  deleteById: db.prepare('DELETE FROM bank_statements WHERE id = ? AND user_id = ?'),
  countByBillingUser: db.prepare(
    'SELECT COUNT(*) as count FROM bank_statements WHERE billing_user_id = ?'
  ),
};

export const bankStatementRepo = {
  findByUserId(userId: string): BankStatementRow[] {
    return stmts.findByUserId.all(userId) as BankStatementRow[];
  },

  findByIdForUser(id: string, userId: string): BankStatementRow | undefined {
    return stmts.findByIdForUser.get(id, userId) as BankStatementRow | undefined;
  },

  create(userId: string, billingUserId: string, input: BankStatementCreateInput): BankStatementRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(
      id,
      userId,
      billingUserId,
      input.name,
      input.bankName,
      input.accountNumberMasked,
      input.periodFrom,
      input.periodTo,
      input.sourceFilename,
      input.sourceMime,
      input.rawExtracted,
    );
    return this.findByIdForUser(id, userId)!;
  },

  updateName(id: string, userId: string, name: string): boolean {
    return stmts.updateName.run(name, id, userId).changes > 0;
  },

  updateTotals(id: string, inflow: number, outflow: number, txCount: number): void {
    stmts.updateTotals.run(inflow, outflow, txCount, id);
  },

  deleteById(id: string, userId: string): boolean {
    return stmts.deleteById.run(id, userId).changes > 0;
  },

  countByBillingUser(billingUserId: string): number {
    return (stmts.countByBillingUser.get(billingUserId) as { count: number }).count;
  },
};
