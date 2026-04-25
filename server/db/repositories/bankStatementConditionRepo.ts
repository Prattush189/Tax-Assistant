import crypto from 'crypto';
import db from '../index.js';

export interface BankStatementConditionRow {
  id: string;
  user_id: string;
  text: string;
  created_at: string;
}

const stmts = {
  listByUser: db.prepare(
    'SELECT * FROM bank_statement_conditions WHERE user_id = ? ORDER BY created_at DESC'
  ),
  insert: db.prepare(
    `INSERT INTO bank_statement_conditions (id, user_id, text)
     VALUES (?, ?, ?)`
  ),
  deleteByIdForUser: db.prepare(
    'DELETE FROM bank_statement_conditions WHERE id = ? AND user_id = ?'
  ),
};

export const bankStatementConditionRepo = {
  listByUser(userId: string): BankStatementConditionRow[] {
    return stmts.listByUser.all(userId) as BankStatementConditionRow[];
  },

  create(userId: string, text: string): BankStatementConditionRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.insert.run(id, userId, text);
    return this.listByUser(userId).find((r) => r.id === id)!;
  },

  delete(userId: string, id: string): boolean {
    return stmts.deleteByIdForUser.run(id, userId).changes > 0;
  },
};
