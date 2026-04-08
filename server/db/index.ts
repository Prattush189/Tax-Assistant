import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DB_PATH ?? path.join(__dirname, '..', '..', 'data', 'tax-assistant.db');

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run schema (CREATE IF NOT EXISTS — safe for existing DBs)
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// Migrate: add new columns to existing users table if missing
const cols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
const colNames = cols.map(c => c.name);
if (!colNames.includes('role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin'))");
}
if (!colNames.includes('plan')) {
  db.exec("ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free', 'pro', 'enterprise'))");
}
if (!colNames.includes('suspended_until')) {
  db.exec("ALTER TABLE users ADD COLUMN suspended_until TEXT");
}

// Seed admin account
const ADMIN_EMAIL = 'prattyush.jain@gmail.com';
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
if (!existing) {
  // Lazy import bcrypt to avoid top-level await
  const bcrypt = await import('bcryptjs');
  const password = crypto.randomBytes(8).toString('hex'); // 16-char random
  const hashed = bcrypt.hashSync(password, 12);
  const id = crypto.randomBytes(16).toString('hex');
  db.prepare(
    "INSERT INTO users (id, email, password, name, role) VALUES (?, ?, ?, ?, 'admin')"
  ).run(id, ADMIN_EMAIL, hashed, 'Admin');
  console.log(`[ADMIN] Created admin account: ${ADMIN_EMAIL}`);
  console.log(`[ADMIN] Password: ${password}`);
  console.log(`[ADMIN] ⚠️  Save this password — it won't be shown again.`);
}

// Ensure admin has enterprise plan
db.prepare("UPDATE users SET plan = 'enterprise' WHERE email = ? AND role = 'admin'").run(ADMIN_EMAIL);

console.log(`[DB] SQLite initialized at ${dbPath}`);

export default db;
