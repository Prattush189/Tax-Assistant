import crypto from 'crypto';
import db from '../index.js';

export interface DocumentRow {
  id: string;
  chat_id: string;
  message_id: number | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  file_uri: string;
  extracted_data: string | null;
  created_at: string;
}

const stmts = {
  create: db.prepare(
    'INSERT INTO documents (id, chat_id, message_id, filename, mime_type, size_bytes, file_uri, extracted_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  findByChatId: db.prepare(
    'SELECT * FROM documents WHERE chat_id = ? ORDER BY created_at DESC'
  ),
};

export const documentRepo = {
  create(
    chatId: string,
    filename: string,
    mimeType: string,
    sizeBytes: number,
    fileUri: string,
    extractedData?: Record<string, unknown>,
    messageId?: number
  ): DocumentRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.create.run(
      id,
      chatId,
      messageId ?? null,
      filename,
      mimeType,
      sizeBytes,
      fileUri,
      extractedData ? JSON.stringify(extractedData) : null
    );
    return {
      id,
      chat_id: chatId,
      message_id: messageId ?? null,
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      file_uri: fileUri,
      extracted_data: extractedData ? JSON.stringify(extractedData) : null,
      created_at: new Date().toISOString(),
    };
  },

  findByChatId(chatId: string): DocumentRow[] {
    return stmts.findByChatId.all(chatId) as DocumentRow[];
  },
};
