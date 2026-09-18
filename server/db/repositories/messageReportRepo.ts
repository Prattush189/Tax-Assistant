import db from '../index.js';

export const REPORT_REASONS = ['wrong_info', 'not_answered', 'confusing', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface ReportedAnswer {
  id: number;
  message_id: number;
  chat_id: string;
  reason: ReportReason;
  note: string | null;
  created_at: string;
  user_email: string | null;
  user_name: string | null;
  question: string | null;
  answer: string;
  answered_at: string;
}

const stmts = {
  upsert: db.prepare(`
    INSERT INTO message_reports (message_id, user_id, reason, note) VALUES (?, ?, ?, ?)
    ON CONFLICT(message_id, user_id) DO UPDATE SET
      reason = excluded.reason, note = excluded.note,
      created_at = datetime('now', '+5 hours', '+30 minutes')
  `),
  recent: db.prepare(`
    SELECT r.id, r.message_id, m.chat_id, r.reason, r.note, r.created_at,
           u.email AS user_email, u.name AS user_name,
           m.content AS answer, m.created_at AS answered_at,
           (SELECT q.content FROM messages q
             WHERE q.chat_id = m.chat_id AND q.role = 'user'
               AND (q.created_at < m.created_at OR (q.created_at = m.created_at AND q.id < m.id))
             ORDER BY q.created_at DESC, q.id DESC LIMIT 1) AS question
    FROM message_reports r
    JOIN messages m ON m.id = r.message_id
    LEFT JOIN users u ON u.id = r.user_id
    ORDER BY r.created_at DESC
    LIMIT ?
  `),
  reasonsFor: db.prepare(`SELECT message_id, GROUP_CONCAT(reason) AS reasons FROM message_reports GROUP BY message_id`),
};

export const messageReportRepo = {
  upsert(messageId: number, userId: string, reason: ReportReason, note: string | null): void {
    stmts.upsert.run(messageId, userId, reason, note);
  },
  recent(limit: number): ReportedAnswer[] {
    return stmts.recent.all(limit) as ReportedAnswer[];
  },
  /** message_id → comma-joined reasons, for tagging audit-export pairs. */
  reasonsByMessage(): Map<number, string> {
    const rows = stmts.reasonsFor.all() as Array<{ message_id: number; reasons: string }>;
    return new Map(rows.map(r => [r.message_id, r.reasons]));
  },
};
