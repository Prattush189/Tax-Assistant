import crypto from 'crypto';
import db from '../index.js';

export interface UserRow {
  id: string;
  email: string;
  password: string;
  name: string;
  role: 'user' | 'admin';
  suspended_until: string | null;
  created_at: string;
  updated_at: string;
}

const stmts = {
  findByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  findById: db.prepare('SELECT * FROM users WHERE id = ?'),
  findAll: db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM chats WHERE user_id = u.id) AS chat_count,
      (SELECT COUNT(*) FROM messages m JOIN chats c ON m.chat_id = c.id WHERE c.user_id = u.id) AS message_count
    FROM users u ORDER BY u.created_at DESC
  `),
  create: db.prepare(
    'INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)'
  ),
  updateRole: db.prepare(
    "UPDATE users SET role = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  suspend: db.prepare(
    "UPDATE users SET suspended_until = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
};

export const userRepo = {
  findByEmail(email: string): UserRow | undefined {
    return stmts.findByEmail.get(email.toLowerCase()) as UserRow | undefined;
  },

  findById(id: string): UserRow | undefined {
    return stmts.findById.get(id) as UserRow | undefined;
  },

  findAll(): (UserRow & { chat_count: number; message_count: number })[] {
    return stmts.findAll.all() as (UserRow & { chat_count: number; message_count: number })[];
  },

  create(email: string, hashedPassword: string, name: string): UserRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(id, email.toLowerCase(), hashedPassword, name);
    return this.findById(id)!;
  },

  updateRole(id: string, role: 'user' | 'admin'): void {
    stmts.updateRole.run(role, id);
  },

  suspend(id: string, until: string | null): void {
    stmts.suspend.run(until, id);
  },
};
