import crypto from 'crypto';
import db from '../index.js';

export interface BankTransactionRow {
  id: string;
  statement_id: string;
  tx_date: string | null;
  narration: string | null;
  amount: number;          // signed: positive=credit, negative=debit
  balance: number | null;
  category: string;
  subcategory: string | null;
  counterparty: string | null;
  reference: string | null;
  is_recurring: number;
  user_override: number;
  sort_index: number;
}

export interface BankTransactionInput {
  date: string | null;
  narration: string | null;
  amount: number;
  balance: number | null;
  category: string;
  subcategory: string | null;
  counterparty: string | null;
  reference: string | null;
  isRecurring: boolean;
}

const stmts = {
  listByStatement: db.prepare(
    'SELECT * FROM bank_transactions WHERE statement_id = ? ORDER BY sort_index ASC'
  ),
  insert: db.prepare(
    `INSERT INTO bank_transactions (
      id, statement_id, tx_date, narration, amount, balance,
      category, subcategory, counterparty, reference, is_recurring, user_override, sort_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ),
  deleteByStatement: db.prepare(
    'DELETE FROM bank_transactions WHERE statement_id = ?'
  ),
  // updateCategory scopes by statement_id joined to user_id — callers pass both
  updateCategory: db.prepare(
    `UPDATE bank_transactions
        SET category = ?, subcategory = ?, user_override = 1
      WHERE id = ?
        AND statement_id IN (SELECT id FROM bank_statements WHERE id = ? AND user_id = ?)`
  ),
};

const insertMany = db.transaction((stmtId: string, txs: BankTransactionInput[]) => {
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    const id = crypto.randomBytes(16).toString('hex');
    stmts.insert.run(
      id,
      stmtId,
      tx.date,
      tx.narration,
      tx.amount,
      tx.balance,
      tx.category,
      tx.subcategory,
      tx.counterparty,
      tx.reference,
      tx.isRecurring ? 1 : 0,
      i,
    );
  }
});

export const bankTransactionRepo = {
  listByStatement(statementId: string): BankTransactionRow[] {
    return stmts.listByStatement.all(statementId) as BankTransactionRow[];
  },

  bulkInsert(statementId: string, txs: BankTransactionInput[]): void {
    insertMany(statementId, txs);
  },

  replaceAll(statementId: string, txs: BankTransactionInput[]): void {
    const replace = db.transaction(() => {
      stmts.deleteByStatement.run(statementId);
      insertMany(statementId, txs);
    });
    replace();
  },

  updateCategory(txId: string, statementId: string, userId: string, category: string, subcategory: string | null): boolean {
    return stmts.updateCategory.run(category, subcategory, txId, statementId, userId).changes > 0;
  },
};
