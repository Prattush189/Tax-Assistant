import crypto from 'crypto';
import db from '../index.js';

export interface StyleProfileRow {
  id: string;
  user_id: string;
  name: string;
  source_filename: string | null;
  raw_sample_text: string | null;
  style_rules: string;          // JSON
  created_at: string;
  updated_at: string;
}

const stmts = {
  findByUserId: db.prepare(
    'SELECT * FROM style_profiles WHERE user_id = ? LIMIT 1'
  ),
  upsert: db.prepare(`
    INSERT INTO style_profiles (id, user_id, name, source_filename, raw_sample_text, style_rules)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      name = excluded.name,
      source_filename = excluded.source_filename,
      raw_sample_text = excluded.raw_sample_text,
      style_rules = excluded.style_rules,
      updated_at = datetime('now', '+5 hours', '+30 minutes')
  `),
  deleteByUserId: db.prepare(
    'DELETE FROM style_profiles WHERE user_id = ?'
  ),
};

export const styleProfileRepo = {
  findByUserId(userId: string): StyleProfileRow | undefined {
    return stmts.findByUserId.get(userId) as StyleProfileRow | undefined;
  },

  upsert(
    userId: string,
    name: string,
    sourceFilename: string | null,
    rawSampleText: string | null,
    styleRules: string,
  ): StyleProfileRow {
    const id = crypto.randomBytes(16).toString('hex');
    stmts.upsert.run(id, userId, name, sourceFilename, rawSampleText, styleRules);
    return this.findByUserId(userId)!;
  },

  deleteByUserId(userId: string): boolean {
    return stmts.deleteByUserId.run(userId).changes > 0;
  },
};
