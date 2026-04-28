-- Tax Assistant Database Schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
  plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free', 'pro', 'enterprise')),
  suspended_until TEXT,
  google_id TEXT,
  external_id TEXT,
  plugin_plan TEXT,            -- optional override: 'enterprise-shared' or any future tier
  plugin_limits TEXT,          -- optional JSON with per-feature caps (see server/lib/planLimits.ts)
  plugin_role TEXT,            -- 'consultant' | 'staff' | 'client'
  plugin_consultant_id TEXT    -- parent-app consultant id that owns this user
);
-- NOTE: indexes for external_id / plugin_consultant_id are created in
-- server/db/index.ts migrations AFTER the ALTER TABLE ADD COLUMN runs, so
-- existing databases upgrade correctly. Do not add them here.

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Chat',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'model')),
  content TEXT NOT NULL,
  attachment_filename TEXT,
  attachment_mime_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  file_uri TEXT NOT NULL,
  extracted_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE INDEX IF NOT EXISTS idx_documents_chat_id ON documents(chat_id);

CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  is_plugin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE INDEX IF NOT EXISTS idx_api_usage_ip ON api_usage(ip);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_id ON api_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage(created_at);

CREATE TABLE IF NOT EXISTS blocked_ips (
  ip TEXT PRIMARY KEY,
  reason TEXT,
  blocked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notice_type TEXT NOT NULL,
  sub_type TEXT,
  title TEXT,
  input_data TEXT,
  generated_content TEXT,
  -- Status enum: 'draft' (manual draft, no AI), 'generating' (Gemini in
  -- flight; row was created upfront so a tab close + reload re-attaches),
  -- 'generated' (AI completed successfully), 'error' (Gemini failed; see
  -- error_message). The dedup guard refuses parallel runs on the same
  -- file_hash while another is 'generating'.
  status TEXT NOT NULL DEFAULT 'draft',
  file_hash TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE INDEX IF NOT EXISTS idx_notices_user_id ON notices(user_id);

CREATE TABLE IF NOT EXISTS tax_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  fy TEXT NOT NULL,
  gross_salary TEXT NOT NULL DEFAULT '',
  other_income TEXT NOT NULL DEFAULT '',
  age_category TEXT NOT NULL DEFAULT 'below60' CHECK(age_category IN ('below60', 'senior60to80', 'superSenior80plus')),
  deductions_data TEXT NOT NULL DEFAULT '{}',
  hra_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE INDEX IF NOT EXISTS idx_tax_profiles_user_id ON tax_profiles(user_id);

CREATE TABLE IF NOT EXISTS feature_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  -- Credits consumed by this feature run. 1 credit = 5 bank-statement
  -- pages OR 100 CSV rows OR 10 ledger pages. Cancelled runs log the
  -- credits proportional to pages processed before the cancel landed.
  -- Default 1 keeps existing rows reasonable on read (legacy run-count
  -- = 1 credit each), and the migration in server/db/index.ts adds the
  -- column with that default.
  credits_used INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE INDEX IF NOT EXISTS idx_feature_usage_user_feature ON feature_usage(user_id, feature, created_at);

-- Email verification codes for password-based signups AND password resets.
-- code_hash is bcrypt; purpose is validated in application code (see
-- verificationRepo.ts) — no SQLite CHECK so the enum can be widened without
-- destructive table rebuilds.
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);

-- Team invitations for enterprise-plan users. inviter_user_id is the pool owner.
-- invite_token_hash is sha256 of a randomBytes(32) opaque token; the plaintext
-- token is only returned once on POST /api/invitations.
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  inviter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  phone TEXT,
  invite_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'revoked', 'expired')),
  accepted_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);

-- Generic profiles (identity + address + banks + notice defaults + per-AY data).
-- Separate from tax_profiles which stores calculator snapshots. Indexes live in db/index.ts.
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  identity_data TEXT NOT NULL DEFAULT '{}',
  address_data TEXT NOT NULL DEFAULT '{}',
  banks_data TEXT NOT NULL DEFAULT '[]',
  notice_defaults TEXT NOT NULL DEFAULT '{}',
  per_ay_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);

-- ITR drafts (admin-only feature; wizard drafts for ITR-1 / ITR-4).
-- Indexes are created in server/db/index.ts migration block, NOT here.
CREATE TABLE IF NOT EXISTS itr_drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  form_type TEXT NOT NULL CHECK(form_type IN ('ITR1', 'ITR4')),
  assessment_year TEXT NOT NULL,
  name TEXT NOT NULL,
  ui_payload TEXT NOT NULL DEFAULT '{}',
  last_validated_at TEXT,
  last_validation_errors TEXT,
  exported_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);

-- Board resolution drafts (admin-only; Companies Act 2013 resolution templates).
-- Indexes are created in server/db/index.ts migration block, NOT here.
CREATE TABLE IF NOT EXISTS board_resolutions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL CHECK(template_id IN (
    'appointment_of_director',
    'bank_account_opening',
    'borrowing_powers',
    'share_allotment'
  )),
  name TEXT NOT NULL,
  ui_payload TEXT NOT NULL DEFAULT '{}',
  exported_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);

-- Partnership deed drafts (Indian Partnership Act 1932 + LLP Act 2008 templates).
-- Hybrid of board_resolutions (form payload) and notices (AI-generated body) —
-- ui_payload is the form JSON, generated_content is the streamed Markdown.
-- Indexes are created in server/db/index.ts migration block, NOT here.
CREATE TABLE IF NOT EXISTS partnership_deeds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  billing_user_id TEXT,
  template_id TEXT NOT NULL CHECK(template_id IN (
    'partnership_deed',
    'llp_agreement',
    'reconstitution_deed',
    'retirement_deed',
    'dissolution_deed'
  )),
  name TEXT NOT NULL,
  ui_payload TEXT NOT NULL DEFAULT '{}',
  generated_content TEXT,
  exported_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);

-- Clients table for CA bulk ITR filing management
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  billing_user_id TEXT,
  name TEXT NOT NULL,
  pan TEXT,
  email TEXT,
  phone TEXT,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  itr_draft_id TEXT REFERENCES itr_drafts(id) ON DELETE SET NULL,
  form_type TEXT DEFAULT 'ITR1',
  assessment_year TEXT DEFAULT '2025',
  filing_status TEXT NOT NULL DEFAULT 'pending' CHECK(filing_status IN (
    'pending', 'draft', 'validated', 'exported', 'filed', 'verified'
  )),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);

-- Bank statement analyzer: one row per uploaded statement.
-- Indexes are created in server/db/index.ts migration block.
CREATE TABLE IF NOT EXISTS bank_statements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  billing_user_id TEXT,
  name TEXT NOT NULL,
  bank_name TEXT,
  account_number_masked TEXT,
  period_from TEXT,
  period_to TEXT,
  source_filename TEXT,
  source_mime TEXT,
  total_inflow REAL NOT NULL DEFAULT 0,
  total_outflow REAL NOT NULL DEFAULT 0,
  tx_count INTEGER NOT NULL DEFAULT 0,
  raw_extracted TEXT,
  -- Reload-resume tracking. Row is created upfront with status='analyzing'
  -- so the user can see the in-flight statement (and the dedup guard can
  -- match against a re-upload of the same file_hash). Updated to 'done' on
  -- success or 'error' on failure with error_message populated.
  status TEXT NOT NULL DEFAULT 'done',
  file_hash TEXT,
  error_message TEXT,
  -- Credit accounting. pages_total is the file's page count (or
  -- CSV row count for the CSV path) computed up front; pages_processed
  -- ticks up as chunks complete so a cancel debits only the pages
  -- already processed. Both stay 0 for legacy rows that finished
  -- before the credit policy existed — they cost 1 credit each by
  -- default in feature_usage.
  pages_total INTEGER NOT NULL DEFAULT 0,
  pages_processed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);

-- Bank transactions: one row per parsed transaction. amount is signed
-- (positive = credit / inflow, negative = debit / outflow). user_override = 1
-- when a human has reassigned the category away from the AI-inferred one.
CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  tx_date TEXT,
  narration TEXT,
  amount REAL NOT NULL,
  balance REAL,
  category TEXT NOT NULL,
  subcategory TEXT,
  counterparty TEXT,
  reference TEXT,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  user_override INTEGER NOT NULL DEFAULT 0,
  sort_index INTEGER NOT NULL DEFAULT 0
);

-- User-defined rules: if a narration contains `match_text` (case-insensitive),
-- override the AI category and/or stamp a custom counterparty label. Applied
-- during /analyze before bulk insert.
CREATE TABLE IF NOT EXISTS bank_statement_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_text TEXT NOT NULL,
  category TEXT,
  counterparty_label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);

-- Free-form per-user conditions appended to the bank-statement parse prompt.
-- Used for filter / include / exclude / tagging instructions the user wants
-- the AI to follow ("ignore txns under ₹100", "treat ZOMATO as Personal").
-- Each row is one instruction, capped to 50 words server-side.
CREATE TABLE IF NOT EXISTS bank_statement_conditions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);

-- Ledger Scrutiny: AI audit of multi-account ledger PDFs (Tally/Busy/Marg
-- exports). One job per uploaded ledger; each job has many accounts and
-- many observations (audit flags grouped by severity).
CREATE TABLE IF NOT EXISTS ledger_scrutiny_jobs (
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
  -- Credit accounting (10 pages = 1 credit). Same shape as bank_statements.
  pages_total INTEGER NOT NULL DEFAULT 0,
  pages_processed INTEGER NOT NULL DEFAULT 0,
  total_flags_high INTEGER NOT NULL DEFAULT 0,
  total_flags_warn INTEGER NOT NULL DEFAULT 0,
  total_flags_info INTEGER NOT NULL DEFAULT 0,
  total_flagged_amount REAL NOT NULL DEFAULT 0,
  raw_extracted TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);

-- Per-account rows extracted from the ledger. opening/closing are signed
-- (positive = debit balance, negative = credit balance).
CREATE TABLE IF NOT EXISTS ledger_accounts (
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

-- Audit observations / flags raised by the LLM rubric. status flips between
-- 'open' and 'resolved' when the user marks an issue addressed.
CREATE TABLE IF NOT EXISTS ledger_observations (
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
