import db from '../index.js';

export interface MessageRow {
  id: number;
  chat_id: string;
  role: 'user' | 'model';
  content: string;
  attachment_filename: string | null;
  attachment_mime_type: string | null;
  /** Grounding sources behind a model reply (parsed from the JSON column). */
  sources: Array<{ title: string; url: string }> | null;
  created_at: string;
}

export interface QAPair {
  /** id of the model's answer message */
  answer_id: number;
  chat_id: string;
  /** the user's question (nearest preceding user message in the same chat) */
  question: string;
  /** the model's reply */
  answer: string;
  /** whether the answer carried a document attachment (context the judge lacks) */
  had_attachment: 0 | 1;
  asked_at: string;
}

/** Tolerant JSON parse for the sources column — a bad row must never
 *  take the whole chat history down with it. */
function parseSources(raw: string | null): Array<{ title: string; url: string }> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.length ? v : null;
  } catch {
    return null;
  }
}

const stmts = {
  findByChatId: db.prepare(
    'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC, id ASC'
  ),
  create: db.prepare(
    'INSERT INTO messages (chat_id, role, content, attachment_filename, attachment_mime_type, sources) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  // Recent (question, answer) pairs for the chat-QA audit export. Each
  // model reply is matched with the nearest preceding user message in the
  // same chat (chats alternate user/model, so this is the question it
  // answered). Bounded by recency + a hard row cap so the export — and the
  // downstream judge run it feeds — stay cheap. Newest first.
  recentQAPairs: db.prepare(`
    SELECT
      m.id                       AS answer_id,
      m.chat_id                  AS chat_id,
      m.content                  AS answer,
      m.created_at               AS asked_at,
      CASE WHEN q.attachment_filename IS NOT NULL THEN 1 ELSE 0 END AS had_attachment,
      q.content                  AS question
    FROM messages m
    JOIN messages q ON q.id = (
      SELECT u.id FROM messages u
      WHERE u.chat_id = m.chat_id
        AND u.role = 'user'
        AND (u.created_at < m.created_at OR (u.created_at = m.created_at AND u.id < m.id))
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT 1
    )
    WHERE m.role = 'model'
      AND m.created_at >= datetime('now', '-' || ? || ' days')
    ORDER BY m.created_at DESC
    LIMIT ?
  `),
};

export const messageRepo = {
  findByChatId(chatId: string): MessageRow[] {
    const rows = stmts.findByChatId.all(chatId) as Array<Omit<MessageRow, 'sources'> & { sources: string | null }>;
    return rows.map(r => ({ ...r, sources: parseSources(r.sources) }));
  },

  /** Recent (question, answer) pairs for the chat-QA audit export. */
  getRecentQAPairs(sinceDays: number, limit: number): QAPair[] {
    return stmts.recentQAPairs.all(sinceDays, limit) as QAPair[];
  },

  create(
    chatId: string,
    role: 'user' | 'model',
    content: string,
    attachmentFilename?: string,
    attachmentMimeType?: string,
    sources?: Array<{ title: string; url: string }>,
  ): MessageRow {
    const info = stmts.create.run(
      chatId,
      role,
      content,
      attachmentFilename ?? null,
      attachmentMimeType ?? null,
      sources && sources.length ? JSON.stringify(sources) : null,
    );
    return {
      id: Number(info.lastInsertRowid),
      chat_id: chatId,
      role,
      content,
      attachment_filename: attachmentFilename ?? null,
      attachment_mime_type: attachmentMimeType ?? null,
      sources: sources && sources.length ? sources : null,
      created_at: new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().replace('Z', ''),
    };
  },
};
