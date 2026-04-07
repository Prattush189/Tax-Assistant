-- Tax Assistant Database Schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);

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
