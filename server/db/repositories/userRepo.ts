import crypto from 'crypto';
import db from '../index.js';

export interface UserRow {
  id: string;
  email: string;
  password: string;
  name: string;
  role: 'user' | 'admin';
  plan: 'free' | 'pro' | 'enterprise';
  suspended_until: string | null;
  google_id: string | null;
  created_at: string;
  updated_at: string;
}

const stmts = {
  findByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  findById: db.prepare('SELECT * FROM users WHERE id = ?'),
  findByGoogleId: db.prepare('SELECT * FROM users WHERE google_id = ?'),
  findAll: db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM chats WHERE user_id = u.id) AS chat_count,
      (SELECT COUNT(*) FROM messages m JOIN chats c ON m.chat_id = c.id WHERE c.user_id = u.id) AS message_count,
      (SELECT MAX(created_at) FROM api_usage WHERE user_id = u.id) AS last_api_call
    FROM users u
    ORDER BY last_api_call IS NULL, last_api_call DESC, u.created_at DESC
  `),
  create: db.prepare(
    'INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)'
  ),
  updatePlan: db.prepare(
    "UPDATE users SET plan = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  updateRole: db.prepare(
    "UPDATE users SET role = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  suspend: db.prepare(
    "UPDATE users SET suspended_until = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  createFromGoogle: db.prepare(
    "INSERT INTO users (id, email, password, name, google_id) VALUES (?, ?, '', ?, ?)"
  ),
  linkGoogle: db.prepare(
    "UPDATE users SET google_id = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  updateEmail: db.prepare(
    "UPDATE users SET email = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  updatePassword: db.prepare(
    "UPDATE users SET password = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  updateName: db.prepare(
    "UPDATE users SET name = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?"
  ),
  deleteById: db.prepare('DELETE FROM users WHERE id = ?'),
};

export const userRepo = {
  findByEmail(email: string): UserRow | undefined {
    return stmts.findByEmail.get(email.toLowerCase()) as UserRow | undefined;
  },

  findById(id: string): UserRow | undefined {
    return stmts.findById.get(id) as UserRow | undefined;
  },

  findAll(): (UserRow & { chat_count: number; message_count: number; last_api_call: string | null })[] {
    return stmts.findAll.all() as (UserRow & { chat_count: number; message_count: number; last_api_call: string | null })[];
  },

  create(email: string, hashedPassword: string, name: string): UserRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(id, email.toLowerCase(), hashedPassword, name);
    return this.findById(id)!;
  },

  updatePlan(id: string, plan: 'free' | 'pro' | 'enterprise'): void {
    stmts.updatePlan.run(plan, id);
  },

  updateRole(id: string, role: 'user' | 'admin'): void {
    stmts.updateRole.run(role, id);
  },

  suspend(id: string, until: string | null): void {
    stmts.suspend.run(until, id);
  },

  findByGoogleId(googleId: string): UserRow | undefined {
    return stmts.findByGoogleId.get(googleId) as UserRow | undefined;
  },

  createFromGoogle(email: string, name: string, googleId: string): UserRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.createFromGoogle.run(id, email.toLowerCase(), name, googleId);
    return this.findById(id)!;
  },

  linkGoogle(userId: string, googleId: string): void {
    stmts.linkGoogle.run(googleId, userId);
  },

  updateEmail(id: string, email: string): void {
    stmts.updateEmail.run(email.toLowerCase(), id);
  },

  updatePassword(id: string, hashedPassword: string): void {
    stmts.updatePassword.run(hashedPassword, id);
  },

  updateName(id: string, name: string): void {
    stmts.updateName.run(name, id);
  },

  deleteById(id: string): void {
    stmts.deleteById.run(id);
  },
};
