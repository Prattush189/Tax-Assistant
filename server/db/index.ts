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
if (!colNames.includes('google_id')) {
  db.exec("ALTER TABLE users ADD COLUMN google_id TEXT");
}
if (!colNames.includes('external_id')) {
  db.exec("ALTER TABLE users ADD COLUMN external_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_external_id ON users(external_id)");
}
if (!colNames.includes('plugin_plan')) {
  db.exec("ALTER TABLE users ADD COLUMN plugin_plan TEXT");
}
if (!colNames.includes('plugin_limits')) {
  db.exec("ALTER TABLE users ADD COLUMN plugin_limits TEXT");
}
if (!colNames.includes('plugin_role')) {
  db.exec("ALTER TABLE users ADD COLUMN plugin_role TEXT");
}
if (!colNames.includes('plugin_consultant_id')) {
  db.exec("ALTER TABLE users ADD COLUMN plugin_consultant_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_plugin_consultant_id ON users(plugin_consultant_id)");
}

// ITR tab access capability — independent of admin role so non-admin
// users can be granted ITR-only access without the full admin surface.
// Flipped via server/scripts/grant-itr.ts or the admin UI (future).
if (!colNames.includes('itr_enabled')) {
  db.exec("ALTER TABLE users ADD COLUMN itr_enabled INTEGER NOT NULL DEFAULT 0");
}

// Phone login + email verification + team invitations (v2 team features).
// NOTE: `phone` is nullable and unique via partial index (below) — it is only
// set for plugin clients who log in via phone. Existing email-only users
// are grandfathered to email_verified = 1 on first migration so the rollout
// doesn't lock anyone out.
let justAddedEmailVerified = false;
if (!colNames.includes('phone')) {
  db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL");
}
if (!colNames.includes('email_verified')) {
  db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
  justAddedEmailVerified = true;
}
if (!colNames.includes('inviter_id')) {
  db.exec("ALTER TABLE users ADD COLUMN inviter_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_inviter_id ON users(inviter_id)");
}
// Single-session enforcement: each login stamps a random token; old sessions
// are invalidated because the JWT's sessionToken no longer matches.
if (!colNames.includes('session_token')) {
  db.exec("ALTER TABLE users ADD COLUMN session_token TEXT");
}
// Grandfather all pre-existing users as verified exactly once, the first
// time the email_verified column appears. New signups go through the OTP
// flow regardless.
if (justAddedEmailVerified) {
  db.exec("UPDATE users SET email_verified = 1 WHERE email_verified = 0");
}

// billing_user_id column on every usage-counted table. Logged alongside
// user_id so we preserve the audit trail (user_id = actor) while the
// billing/pool owner is identified separately.
function ensureBillingCol(table: string): boolean {
  const cs = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cs.some(c => c.name === 'billing_user_id')) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN billing_user_id TEXT`);
  db.exec(`UPDATE ${table} SET billing_user_id = user_id WHERE billing_user_id IS NULL`);
  return true;
}
for (const t of ['api_usage', 'feature_usage', 'notices', 'tax_profiles', 'profiles', 'itr_drafts']) {
  ensureBillingCol(t);
}
db.exec("CREATE INDEX IF NOT EXISTS idx_api_usage_billing ON api_usage(billing_user_id, created_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_feature_usage_billing ON feature_usage(billing_user_id, feature, created_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_notices_billing ON notices(billing_user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_tax_profiles_billing ON tax_profiles(billing_user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_profiles_billing ON profiles(billing_user_id)");

// Invitations + email verification code tables are created via schema.sql;
// indexes live here for idempotency.
db.exec("CREATE INDEX IF NOT EXISTS idx_invitations_inviter ON invitations(inviter_user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status)");
db.exec("CREATE INDEX IF NOT EXISTS idx_email_codes_user_purpose ON email_verification_codes(user_id, purpose, consumed_at)");

// Drop the legacy CHECK(purpose IN ('signup','resend')) constraint on the
// email_verification_codes table so we can add 'reset' without rebuilding.
// Existing codes are ephemeral (10-min TTL); deleting them is safe.
{
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='email_verification_codes'")
    .get() as { sql?: string } | undefined;
  if (row?.sql && /CHECK\s*\(\s*purpose/i.test(row.sql)) {
    db.exec('DROP TABLE email_verification_codes');
    db.exec(`
      CREATE TABLE email_verification_codes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        purpose TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
      );
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_email_codes_user_purpose ON email_verification_codes(user_id, purpose, consumed_at)");
    console.log('[DB] Rebuilt email_verification_codes without legacy purpose CHECK');
  }
}

// Indexes for itr_drafts — table is created in schema.sql, indexes live here so
// they're idempotent across existing DBs (matches the rule: schema.sql stays
// side-effect free for new column additions).
db.exec("CREATE INDEX IF NOT EXISTS idx_itr_drafts_user_id ON itr_drafts(user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_itr_drafts_updated_at ON itr_drafts(updated_at DESC)");

// Indexes for board_resolutions — same idempotency rule.
db.exec("CREATE INDEX IF NOT EXISTS idx_board_resolutions_user_id ON board_resolutions(user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_board_resolutions_updated_at ON board_resolutions(updated_at DESC)");

// Indexes for clients table (CA bulk ITR filing)
db.exec("CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_clients_pan ON clients(pan)");
db.exec("CREATE INDEX IF NOT EXISTS idx_clients_filing_status ON clients(filing_status)");

// Indexes for generic profiles table (identity, address, banks, per-AY data)
db.exec("CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_profiles_updated_at ON profiles(updated_at DESC)");

// Add model + search tracking columns to api_usage
{
  const usageCols = (db.prepare("PRAGMA table_info(api_usage)").all() as { name: string }[]).map(c => c.name);
  if (!usageCols.includes('model')) {
    db.exec("ALTER TABLE api_usage ADD COLUMN model TEXT");
  }
  if (!usageCols.includes('search_used')) {
    db.exec("ALTER TABLE api_usage ADD COLUMN search_used INTEGER NOT NULL DEFAULT 0");
  }
}

// Add filing_status + notes to profiles (merge clients into profiles)
{
  const profileCols = (db.prepare("PRAGMA table_info(profiles)").all() as { name: string }[]).map(c => c.name);
  if (!profileCols.includes('filing_status')) {
    db.exec("ALTER TABLE profiles ADD COLUMN filing_status TEXT NOT NULL DEFAULT 'pending'");
  }
  if (!profileCols.includes('notes')) {
    db.exec("ALTER TABLE profiles ADD COLUMN notes TEXT");
  }
}

// plan_expires_at — set when a paid subscription is activated; auto-downgrade
// to free when this timestamp passes. NULL means no active paid subscription.
if (!colNames.includes('plan_expires_at')) {
  db.exec("ALTER TABLE users ADD COLUMN plan_expires_at TEXT");
}
// Razorpay Subscription tracking
if (!colNames.includes('razorpay_subscription_id')) {
  db.exec("ALTER TABLE users ADD COLUMN razorpay_subscription_id TEXT");
}
if (!colNames.includes('subscription_status')) {
  // 'active' | 'halted' | 'cancelled' | 'completed' | NULL
  db.exec("ALTER TABLE users ADD COLUMN subscription_status TEXT");
}
if (!colNames.includes('renewal_reminder_sent_at')) {
  db.exec("ALTER TABLE users ADD COLUMN renewal_reminder_sent_at TEXT");
}

// razorpay_plan_cache — stores the 4 Razorpay Plan IDs so we only create them once.
// Key: e.g. 'pro_monthly' | 'pro_yearly' | 'enterprise_monthly' | 'enterprise_yearly'
db.exec(`CREATE TABLE IF NOT EXISTS razorpay_plan_cache (
  key TEXT PRIMARY KEY,
  razorpay_plan_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
)`);


// Payments — full audit trail of every Razorpay order attempt.
db.exec(`CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  razorpay_order_id TEXT NOT NULL UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  plan TEXT NOT NULL,
  billing TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
  paid_at TEXT,
  expires_at TEXT
)`);
db.exec("CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(razorpay_order_id)");

// Style profiles — one per user, stores LLM-extracted writing style rules
db.exec(`CREATE TABLE IF NOT EXISTS style_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'My Style',
  source_filename TEXT,
  raw_sample_text TEXT,
  style_rules TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
)`);

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
