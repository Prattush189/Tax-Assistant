import crypto from 'crypto';
import db from '../index.js';

export interface BankStatementRuleRow {
  id: string;
  user_id: string;
  match_text: string;
  category: string | null;
  counterparty_label: string | null;
  created_at: string;
}

const stmts = {
  listByUser: db.prepare(
    'SELECT * FROM bank_statement_rules WHERE user_id = ? ORDER BY created_at DESC'
  ),
  insert: db.prepare(
    `INSERT INTO bank_statement_rules (id, user_id, match_text, category, counterparty_label)
     VALUES (?, ?, ?, ?, ?)`
  ),
  deleteByIdForUser: db.prepare(
    'DELETE FROM bank_statement_rules WHERE id = ? AND user_id = ?'
  ),
};

export const bankStatementRuleRepo = {
  listByUser(userId: string): BankStatementRuleRow[] {
    return stmts.listByUser.all(userId) as BankStatementRuleRow[];
  },

  create(userId: string, matchText: string, category: string | null, counterpartyLabel: string | null): BankStatementRuleRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.insert.run(id, userId, matchText, category, counterpartyLabel);
    return this.listByUser(userId).find((r) => r.id === id)!;
  },

  delete(userId: string, id: string): boolean {
    return stmts.deleteByIdForUser.run(id, userId).changes > 0;
  },
};
