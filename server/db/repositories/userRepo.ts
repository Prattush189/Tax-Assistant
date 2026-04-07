import crypto from 'crypto';
import db from '../index.js';

export interface UserRow {
  id: string;
  email: string;
  password: string;
  name: string;
  created_at: string;
  updated_at: string;
}

const stmts = {
  findByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  findById: db.prepare('SELECT * FROM users WHERE id = ?'),
  create: db.prepare(
    'INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)'
  ),
};

export const userRepo = {
  findByEmail(email: string): UserRow | undefined {
    return stmts.findByEmail.get(email.toLowerCase()) as UserRow | undefined;
  },

  findById(id: string): UserRow | undefined {
    return stmts.findById.get(id) as UserRow | undefined;
  },

  create(email: string, hashedPassword: string, name: string): UserRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(id, email.toLowerCase(), hashedPassword, name);
    return this.findById(id)!;
  },
};
