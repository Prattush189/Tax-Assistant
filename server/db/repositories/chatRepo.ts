import crypto from 'crypto';
import db from '../index.js';

export interface ChatRow {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** IST timestamp when pinned; null when not pinned. */
  pinned_at: string | null;
}

const stmts = {
  findByUserId: db.prepare(
    // Pinned first (most recently pinned on top), then by activity.
    'SELECT * FROM chats WHERE user_id = ? ORDER BY pinned_at IS NULL, pinned_at DESC, updated_at DESC'
  ),
  findById: db.prepare('SELECT * FROM chats WHERE id = ?'),
  create: db.prepare(
    'INSERT INTO chats (id, user_id, title) VALUES (?, ?, ?)'
  ),
  updateTitle: db.prepare(
    'UPDATE chats SET title = ?, updated_at = datetime(\'now\', \'+5 hours\', \'+30 minutes\') WHERE id = ?'
  ),
  // User-initiated rename: leaves updated_at alone so the chat keeps its
  // place in the Recent list.
  rename: db.prepare('UPDATE chats SET title = ? WHERE id = ?'),
  updateTimestamp: db.prepare(
    'UPDATE chats SET updated_at = datetime(\'now\', \'+5 hours\', \'+30 minutes\') WHERE id = ?'
  ),
  // Like rename, pinning leaves updated_at alone.
  setPinned: db.prepare(
    "UPDATE chats SET pinned_at = CASE WHEN @pinned = 1 THEN datetime('now', '+5 hours', '+30 minutes') ELSE NULL END WHERE id = @id"
  ),
  delete: db.prepare('DELETE FROM chats WHERE id = ?'),
  // Title or any message body matches. The correlated subquery picks the
  // most recent matching message so the sidebar can show a snippet.
  search: db.prepare(`
    SELECT c.id, c.title, c.created_at, c.updated_at, c.pinned_at,
      (SELECT m.content FROM messages m
         WHERE m.chat_id = c.id AND m.content LIKE @pattern ESCAPE '\\'
         ORDER BY m.id DESC LIMIT 1) AS match_content
    FROM chats c
    WHERE c.user_id = @userId
      AND (c.title LIKE @pattern ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM messages m
                     WHERE m.chat_id = c.id AND m.content LIKE @pattern ESCAPE '\\'))
    ORDER BY c.updated_at DESC
    LIMIT 50
  `),
};

export interface ChatSearchRow extends Omit<ChatRow, 'user_id'> {
  match_content: string | null;
}

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

  rename(id: string, title: string): void {
    stmts.rename.run(title, id);
  },

  setPinned(id: string, pinned: boolean): void {
    stmts.setPinned.run({ id, pinned: pinned ? 1 : 0 });
  },

  touchTimestamp(id: string): void {
    stmts.updateTimestamp.run(id);
  },

  delete(id: string): void {
    stmts.delete.run(id);
  },

  search(userId: string, query: string): ChatSearchRow[] {
    const escaped = query.replace(/[\\%_]/g, ch => `\\${ch}`);
    return stmts.search.all({ userId, pattern: `%${escaped}%` }) as ChatSearchRow[];
  },
};
