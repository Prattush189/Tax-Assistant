import crypto from 'crypto';
import db from '../index.js';

export interface ChatRow {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

const stmts = {
  findByUserId: db.prepare(
    'SELECT * FROM chats WHERE user_id = ? ORDER BY updated_at DESC'
  ),
  findById: db.prepare('SELECT * FROM chats WHERE id = ?'),
  create: db.prepare(
    'INSERT INTO chats (id, user_id, title) VALUES (?, ?, ?)'
  ),
  updateTitle: db.prepare(
    'UPDATE chats SET title = ?, updated_at = datetime(\'now\', \'+5 hours\', \'+30 minutes\') WHERE id = ?'
  ),
  updateTimestamp: db.prepare(
    'UPDATE chats SET updated_at = datetime(\'now\', \'+5 hours\', \'+30 minutes\') WHERE id = ?'
  ),
  delete: db.prepare('DELETE FROM chats WHERE id = ?'),
};

export const chatRepo = {
  findByUserId(userId: string): ChatRow[] {
    return stmts.findByUserId.all(userId) as ChatRow[];
  },

  findById(id: string): ChatRow | undefined {
    return stmts.findById.get(id) as ChatRow | undefined;
  },

  create(userId: string, title: string = 'New Chat'): ChatRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(id, userId, title);
    return this.findById(id)!;
  },

  updateTitle(id: string, title: string): void {
    stmts.updateTitle.run(title, id);
  },

  touchTimestamp(id: string): void {
    stmts.updateTimestamp.run(id);
  },

  delete(id: string): void {
    stmts.delete.run(id);
  },
};
