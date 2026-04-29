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

// Surface the resolved DB path on boot so deploys that wipe state are easy
// to diagnose. If this path lives inside the deploy directory and the deploy
// pipeline reclones / cleans on each push, every counter (search quota,
// usage, etc.) will reset on push — fix is to set DB_PATH outside the repo.
console.log(`[db] using SQLite file: ${dbPath}`);

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
for (const t of ['api_usage', 'feature_usage', 'notices', 'tax_profiles', 'profiles', 'itr_drafts', 'partnership_deeds']) {
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

// Indexes for partnership_deeds — same idempotency rule.
db.exec("CREATE INDEX IF NOT EXISTS idx_partnership_deeds_user_id ON partnership_deeds(user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_partnership_deeds_updated_at ON partnership_deeds(updated_at DESC)");
db.exec("CREATE INDEX IF NOT EXISTS idx_partnership_deeds_billing ON partnership_deeds(billing_user_id)");

// Indexes for clients table (CA bulk ITR filing)
db.exec("CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_clients_pan ON clients(pan)");
db.exec("CREATE INDEX IF NOT EXISTS idx_clients_filing_status ON clients(filing_status)");

// Indexes for generic profiles table (identity, address, banks, per-AY data)
db.exec("CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_profiles_updated_at ON profiles(updated_at DESC)");

// Indexes for bank_statements / bank_transactions (AI statement analyzer)
db.exec("CREATE INDEX IF NOT EXISTS idx_bank_statements_user_id ON bank_statements(user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_bank_statements_updated_at ON bank_statements(updated_at DESC)");
db.exec("CREATE INDEX IF NOT EXISTS idx_bank_statements_billing ON bank_statements(billing_user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_bank_tx_statement_id ON bank_transactions(statement_id, sort_index)");
db.exec("CREATE INDEX IF NOT EXISTS idx_bank_tx_category ON bank_transactions(category)");
db.exec("CREATE INDEX IF NOT EXISTS idx_bank_rules_user_id ON bank_statement_rules(user_id)");

// Reload-resume support for bank_statements: status / file_hash / error_message
// columns so a row can be created upfront with status='analyzing', survive
// tab close, and be picked up via the same hash on retry. Mirrors the ledger
// scrutiny pattern. Existing rows default to 'done' so they show up as
// finished in the list view immediately.
{
  const cs = db.prepare("PRAGMA table_info(bank_statements)").all() as Array<{ name: string }>;
  const names = cs.map(c => c.name);
  if (!names.includes('status')) {
    db.exec("ALTER TABLE bank_statements ADD COLUMN status TEXT NOT NULL DEFAULT 'done'");
  }
  if (!names.includes('file_hash')) {
    db.exec("ALTER TABLE bank_statements ADD COLUMN file_hash TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_bank_statements_user_hash ON bank_statements(user_id, file_hash)");
  }
  if (!names.includes('error_message')) {
    db.exec("ALTER TABLE bank_statements ADD COLUMN error_message TEXT");
  }
  // Credit accounting columns (added together so existing DBs pick
  // both up on the same restart). pages_total stays 0 for runs that
  // started before this migration — they fall through to the legacy
  // 1-credit-per-run accounting path.
  if (!names.includes('pages_total')) {
    db.exec("ALTER TABLE bank_statements ADD COLUMN pages_total INTEGER NOT NULL DEFAULT 0");
  }
  if (!names.includes('pages_processed')) {
    db.exec("ALTER TABLE bank_statements ADD COLUMN pages_processed INTEGER NOT NULL DEFAULT 0");
  }
  // CSV-batch progress (separate from page-based billing math). Lets
  // the frontend poll show "3 of 5 batches done" while the wizard's
  // categorisation runs.
  if (!names.includes('analyze_chunks_total')) {
    db.exec("ALTER TABLE bank_statements ADD COLUMN analyze_chunks_total INTEGER NOT NULL DEFAULT 0");
  }
  if (!names.includes('analyze_chunks_done')) {
    db.exec("ALTER TABLE bank_statements ADD COLUMN analyze_chunks_done INTEGER NOT NULL DEFAULT 0");
  }
}

// Credit accounting for ledger_scrutiny_jobs (10 pages = 1 credit).
{
  const cs = db.prepare("PRAGMA table_info(ledger_scrutiny_jobs)").all() as Array<{ name: string }>;
  const names = cs.map(c => c.name);
  if (!names.includes('pages_total')) {
    db.exec("ALTER TABLE ledger_scrutiny_jobs ADD COLUMN pages_total INTEGER NOT NULL DEFAULT 0");
  }
  if (!names.includes('pages_processed')) {
    db.exec("ALTER TABLE ledger_scrutiny_jobs ADD COLUMN pages_processed INTEGER NOT NULL DEFAULT 0");
  }
  // Chunked-scrutiny progress fields. Frontend polls /api/ledger-scrutiny/:id
  // every 5s while a job is running; these columns let the inline auto-chain
  // path in /upload surface "5 of 46 chunks audited" without needing a
  // dedicated SSE stream. Updated by ledgerScrutinyRepo.setScrutinyChunkProgress
  // from runChunkedScrutiny.onChunkDone after each chunk finishes.
  if (!names.includes('scrutiny_chunks_total')) {
    db.exec("ALTER TABLE ledger_scrutiny_jobs ADD COLUMN scrutiny_chunks_total INTEGER NOT NULL DEFAULT 0");
  }
  if (!names.includes('scrutiny_chunks_done')) {
    db.exec("ALTER TABLE ledger_scrutiny_jobs ADD COLUMN scrutiny_chunks_done INTEGER NOT NULL DEFAULT 0");
  }
  // Extract-phase chunk progress (dedicated, not the page-billing
  // counters). Set when the TSV chunked path starts; bumped per
  // chunk. Lets the frontend show "Reading ledger structure — chunk
  // 5 of 33 · 15%" instead of the indeterminate sliver. Page-billing
  // counters (pages_total / pages_processed) stay reserved for
  // credit math.
  if (!names.includes('extract_chunks_total')) {
    db.exec("ALTER TABLE ledger_scrutiny_jobs ADD COLUMN extract_chunks_total INTEGER NOT NULL DEFAULT 0");
  }
  if (!names.includes('extract_chunks_done')) {
    db.exec("ALTER TABLE ledger_scrutiny_jobs ADD COLUMN extract_chunks_done INTEGER NOT NULL DEFAULT 0");
  }
}

// Credits column on feature_usage so the quota check can sum credits
// rather than counting rows. Legacy rows default to 1 credit each.
{
  const cs = db.prepare("PRAGMA table_info(feature_usage)").all() as Array<{ name: string }>;
  if (!cs.some(c => c.name === 'credits_used')) {
    db.exec("ALTER TABLE feature_usage ADD COLUMN credits_used INTEGER NOT NULL DEFAULT 1");
  }
}

// Reload-resume support for notices: file_hash + error_message (status
// already exists). Lets a tab close + reload mid-AI-draft re-attach to
// the in-flight notice and the dedup guard refuse a parallel run with
// the same input fingerprint.
{
  const cs = db.prepare("PRAGMA table_info(notices)").all() as Array<{ name: string }>;
  const names = cs.map(c => c.name);
  if (!names.includes('file_hash')) {
    db.exec("ALTER TABLE notices ADD COLUMN file_hash TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_notices_user_hash ON notices(user_id, file_hash)");
  }
  if (!names.includes('error_message')) {
    db.exec("ALTER TABLE notices ADD COLUMN error_message TEXT");
  }
}

// Reload-resume support for partnership_deeds: status / file_hash /
// error_message. Same shape as bank_statements / notices — placeholder
// upfront, dedup by input fingerprint, status surfaced in the sidebar.
{
  const cs = db.prepare("PRAGMA table_info(partnership_deeds)").all() as Array<{ name: string }>;
  const names = cs.map(c => c.name);
  if (!names.includes('status')) {
    db.exec("ALTER TABLE partnership_deeds ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'");
  }
  if (!names.includes('file_hash')) {
    db.exec("ALTER TABLE partnership_deeds ADD COLUMN file_hash TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_partnership_deeds_user_hash ON partnership_deeds(user_id, file_hash)");
  }
  if (!names.includes('error_message')) {
    db.exec("ALTER TABLE partnership_deeds ADD COLUMN error_message TEXT");
  }
}

// Indexes for ledger_scrutiny_* (AI ledger scrutiny analyzer)
db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_jobs_user_id ON ledger_scrutiny_jobs(user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_jobs_billing ON ledger_scrutiny_jobs(billing_user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_jobs_updated_at ON ledger_scrutiny_jobs(updated_at DESC)");
db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_accounts_job_id ON ledger_accounts(job_id, sort_index)");
db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_obs_job_id ON ledger_observations(job_id, severity)");
db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_obs_account_id ON ledger_observations(account_id)");

// Add 'cancelled' to the ledger_scrutiny_jobs CHECK constraint. SQLite
// doesn't let us ALTER a CHECK in place, so we rebuild the table.
//
// CRITICAL: An earlier version of this migration used the naive
// `ALTER RENAME old → _old, CREATE new, COPY, DROP _old` recipe.
// SQLite auto-updates FK references when a table is renamed, so the
// FKs in ledger_accounts / ledger_observations followed the rename to
// `_ledger_scrutiny_jobs_old`, then went dangling when that table was
// dropped — failing prepare-time at `INSERT INTO ledger_accounts` on
// startup. The repair below detects that state and rebuilds the FK
// tables before re-running the parent rebuild via the official
// "create new under a temp name, swap" pattern with foreign_keys=OFF
// (https://www.sqlite.org/lang_altertable.html — recipe step 4-9).
{
  const accountsTbl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ledger_accounts'").get() as { sql: string } | undefined;
  const obsTbl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ledger_observations'").get() as { sql: string } | undefined;
  const accountsBroken = !!(accountsTbl && accountsTbl.sql.includes('_ledger_scrutiny_jobs_old'));
  const obsBroken = !!(obsTbl && obsTbl.sql.includes('_ledger_scrutiny_jobs_old'));

  if (accountsBroken || obsBroken) {
    console.warn('[db] detected dangling FK pointing at _ledger_scrutiny_jobs_old; rebuilding ledger_accounts / ledger_observations');
    db.pragma('foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      if (accountsBroken) {
        db.exec(`
          CREATE TABLE _ledger_accounts_new (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL REFERENCES ledger_scrutiny_jobs(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            account_type TEXT,
            opening REAL NOT NULL DEFAULT 0,
            closing REAL NOT NULL DEFAULT 0,
            total_debit REAL NOT NULL DEFAULT 0,
            total_credit REAL NOT NULL DEFAULT 0,
            tx_count INTEGER NOT NULL DEFAULT 0,
            sort_index INTEGER NOT NULL DEFAULT 0
          );
          INSERT INTO _ledger_accounts_new SELECT
            id, job_id, name, account_type, opening, closing, total_debit, total_credit, tx_count, sort_index
          FROM ledger_accounts;
          DROP TABLE ledger_accounts;
          ALTER TABLE _ledger_accounts_new RENAME TO ledger_accounts;
        `);
      }
      if (obsBroken) {
        db.exec(`
          CREATE TABLE _ledger_observations_new (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL REFERENCES ledger_scrutiny_jobs(id) ON DELETE CASCADE,
            account_id TEXT REFERENCES ledger_accounts(id) ON DELETE CASCADE,
            account_name TEXT,
            code TEXT NOT NULL,
            severity TEXT NOT NULL CHECK(severity IN ('info', 'warn', 'high')),
            message TEXT NOT NULL,
            amount REAL,
            date_ref TEXT,
            suggested_action TEXT,
            status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
            source TEXT NOT NULL DEFAULT 'ai',
            created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
          );
          INSERT INTO _ledger_observations_new SELECT
            id, job_id, account_id, account_name, code, severity, message, amount,
            date_ref, suggested_action, status, source, created_at
          FROM ledger_observations;
          DROP TABLE ledger_observations;
          ALTER TABLE _ledger_observations_new RENAME TO ledger_observations;
        `);
      }
      db.exec('COMMIT');
      // Indexes follow tables on DROP — recreate.
      db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_accounts_job_id ON ledger_accounts(job_id, sort_index)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_obs_job_id ON ledger_observations(job_id, severity)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_obs_account_id ON ledger_observations(account_id)");
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    db.pragma('foreign_keys = ON');
    console.log('[db] dangling FK repair complete');
  }
}

// Now run the actual CHECK migration on ledger_scrutiny_jobs, but use the
// official SQLite recipe — create-new-with-temp-name → copy → drop-old →
// rename — wrapped in PRAGMA foreign_keys=OFF so child-table FKs don't
// follow the intermediate names.
{
  const tbl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ledger_scrutiny_jobs'").get() as { sql: string } | undefined;
  if (tbl && !tbl.sql.includes("'cancelled'")) {
    db.pragma('foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE _ledger_scrutiny_jobs_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          billing_user_id TEXT,
          name TEXT NOT NULL,
          party_name TEXT,
          gstin TEXT,
          period_from TEXT,
          period_to TEXT,
          source_filename TEXT,
          source_mime TEXT,
          file_hash TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'extracting', 'scrutinizing', 'done', 'error', 'cancelled')),
          total_flags_high INTEGER NOT NULL DEFAULT 0,
          total_flags_warn INTEGER NOT NULL DEFAULT 0,
          total_flags_info INTEGER NOT NULL DEFAULT 0,
          total_flagged_amount REAL NOT NULL DEFAULT 0,
          raw_extracted TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
        );
        INSERT INTO _ledger_scrutiny_jobs_new SELECT
          id, user_id, billing_user_id, name, party_name, gstin, period_from, period_to,
          source_filename, source_mime, file_hash, status,
          total_flags_high, total_flags_warn, total_flags_info, total_flagged_amount,
          raw_extracted, error_message, created_at, updated_at
        FROM ledger_scrutiny_jobs;
        DROP TABLE ledger_scrutiny_jobs;
        ALTER TABLE _ledger_scrutiny_jobs_new RENAME TO ledger_scrutiny_jobs;
      `);
      db.exec('COMMIT');
      db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_jobs_user_id ON ledger_scrutiny_jobs(user_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_jobs_billing ON ledger_scrutiny_jobs(billing_user_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_jobs_updated_at ON ledger_scrutiny_jobs(updated_at DESC)");
      console.log("[db] migrated ledger_scrutiny_jobs.status CHECK to include 'cancelled'");
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    db.pragma('foreign_keys = ON');
  }
}

// Add counterparty/reference columns if upgrading from an earlier feature-branch build.
{
  const txCols = (db.prepare("PRAGMA table_info(bank_transactions)").all() as { name: string }[]).map(c => c.name);
  if (!txCols.includes('counterparty')) {
    db.exec("ALTER TABLE bank_transactions ADD COLUMN counterparty TEXT");
  }
  if (!txCols.includes('reference')) {
    db.exec("ALTER TABLE bank_transactions ADD COLUMN reference TEXT");
  }
}

// Add model + search tracking columns to api_usage
{
  const usageCols = (db.prepare("PRAGMA table_info(api_usage)").all() as { name: string }[]).map(c => c.name);
  if (!usageCols.includes('model')) {
    db.exec("ALTER TABLE api_usage ADD COLUMN model TEXT");
  }
  if (!usageCols.includes('search_used')) {
    db.exec("ALTER TABLE api_usage ADD COLUMN search_used INTEGER NOT NULL DEFAULT 0");
  }
  if (!usageCols.includes('category')) {
    // 'chat' | 'notice' | 'suggestion' | null (legacy rows)
    db.exec("ALTER TABLE api_usage ADD COLUMN category TEXT");
  }
  // input_units: the size of the user's input in the unit that
  // matters for that category. Bank/ledger = transaction count;
  // notice/document = page count; chat/suggestion = message count
  // (usually 1). Lets the admin dashboard compute "cost per row" or
  // "cost per page" for unit-pricing validation. Legacy rows stay
  // at 0 — admin UI shows '—' for those.
  if (!usageCols.includes('input_units')) {
    db.exec("ALTER TABLE api_usage ADD COLUMN input_units INTEGER NOT NULL DEFAULT 0");
  }
  // status: 'success' | 'cancelled' | 'failed'. Token-budget quota
  // counts success + cancelled (both consumed real Gemini tokens),
  // but excludes failed (network errors, timeouts, content-filter
  // rejections — typically retried successfully and shouldn't double-
  // bill the user). Admin dashboard surfaces all three so the operator
  // sees wasted spend on failed/cancelled paths. Legacy rows default
  // to 'success' which preserves their token contribution to the
  // monthly budget.
  if (!usageCols.includes('status')) {
    db.exec("ALTER TABLE api_usage ADD COLUMN status TEXT NOT NULL DEFAULT 'success'");
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
if (!colNames.includes('billing_details')) {
  db.exec("ALTER TABLE users ADD COLUMN billing_details TEXT");
  // JSON: { name, addressLine1, addressLine2?, city, state, pincode, gstin? }
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

// Gemini search-grounding quota — persisted per API key so counters survive
// server restarts. Reset keys stored as:
//   t1_reset_ym   = year*12 + month (e.g. 2026*12+3 for Apr 2026) — monthly rollover
//   t2_reset_date = local date string (new Date().toDateString()) — daily rollover
db.exec(`CREATE TABLE IF NOT EXISTS search_quota (
  key_index INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  t1_count INTEGER NOT NULL DEFAULT 0,
  t1_reset_ym INTEGER NOT NULL,
  t2_count INTEGER NOT NULL DEFAULT 0,
  t2_reset_date TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
)`);

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
