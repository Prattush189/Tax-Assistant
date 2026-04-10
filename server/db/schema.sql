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
  status TEXT NOT NULL DEFAULT 'draft',
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
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE INDEX IF NOT EXISTS idx_feature_usage_user_feature ON feature_usage(user_id, feature, created_at);
