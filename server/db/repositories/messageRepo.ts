import db from '../index.js';

export interface MessageRow {
  id: number;
  chat_id: string;
  role: 'user' | 'model';
  content: string;
  attachment_filename: string | null;
  attachment_mime_type: string | null;
  created_at: string;
}

const stmts = {
  findByChatId: db.prepare(
    'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC, id ASC'
  ),
  create: db.prepare(
    'INSERT INTO messages (chat_id, role, content, attachment_filename, attachment_mime_type) VALUES (?, ?, ?, ?, ?)'
  ),
};

export const messageRepo = {
  findByChatId(chatId: string): MessageRow[] {
    return stmts.findByChatId.all(chatId) as MessageRow[];
  },

  create(
    chatId: string,
    role: 'user' | 'model',
    content: string,
    attachmentFilename?: string,
    attachmentMimeType?: string
  ): MessageRow {
    const info = stmts.create.run(
      chatId,
      role,
      content,
      attachmentFilename ?? null,
      attachmentMimeType ?? null
    );
    return {
      id: Number(info.lastInsertRowid),
      chat_id: chatId,
      role,
      content,
      attachment_filename: attachmentFilename ?? null,
      attachment_mime_type: attachmentMimeType ?? null,
      created_at: new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().replace('Z', ''),
    };
  },
};
