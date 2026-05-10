/**
 * Repository for the daily-refreshed list of tax / GST / TDS notifications
 * shown on the chat welcome screen.
 *
 * The fetcher (lib/notificationFetcher.ts) calls Gemini 3.1 Flash-Lite with
 * Google Search grounding once a day and writes the parsed list here via
 * `replaceLatest`. The chat welcome card list reads via `listLatest`.
 * Per-notification detail (the long-form explanation a user sees on click)
 * is lazy: the first click goes through the detail route which generates
 * via grounding and persists `full_detail` so subsequent clicks are
 * free-on-our-side DB reads.
 */

import crypto from 'crypto';
import db from '../index.js';

export type NotificationCategory = 'GST' | 'TDS' | 'INCOME_TAX' | 'OTHER';

export interface TaxNotificationRow {
  id: string;
  category: NotificationCategory;
  heading: string;
  summary: string | null;
  notification_date: string | null;
  source_url: string | null;
  full_detail: string | null;
  full_detail_generated_at: string | null;
  fetched_at: string;
  created_at: string;
}

export interface TaxNotificationCreateInput {
  category: NotificationCategory;
  heading: string;
  summary: string | null;
  notificationDate: string | null;
  sourceUrl: string | null;
}

const stmts = {
  insert: db.prepare(
    `INSERT INTO tax_notifications (id, category, heading, summary, notification_date, source_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ),
  // The welcome screen shows the most recently fetched list. We want every
  // chat user to see the SAME set, so the list query returns the latest
  // batch by fetched_at — bounded by `limit` so older runs don't bleed in
  // when a refresh dropped a category to zero.
  listLatest: db.prepare(
    `SELECT * FROM tax_notifications
     WHERE fetched_at = (SELECT MAX(fetched_at) FROM tax_notifications)
     ORDER BY
       CASE category WHEN 'GST' THEN 1 WHEN 'TDS' THEN 2 WHEN 'INCOME_TAX' THEN 3 ELSE 4 END,
       notification_date DESC NULLS LAST,
       heading
     LIMIT ?`,
  ),
  byId: db.prepare('SELECT * FROM tax_notifications WHERE id = ?'),
  setDetail: db.prepare(
    `UPDATE tax_notifications
       SET full_detail = ?,
           full_detail_generated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ?`,
  ),
  deleteOlderThan: db.prepare(
    `DELETE FROM tax_notifications WHERE fetched_at < ?`,
  ),
  countAll: db.prepare('SELECT COUNT(*) AS n FROM tax_notifications'),
  countLatest: db.prepare(
    `SELECT COUNT(*) AS n FROM tax_notifications
     WHERE fetched_at = (SELECT MAX(fetched_at) FROM tax_notifications)`,
  ),
};

export const notificationsRepo = {
  /** Replace the welcome-screen list with a freshly-fetched batch.
   *  Inserts every item with the same fetched_at timestamp so listLatest
   *  reads them as one batch. The previous batch is left in place; the
   *  next listLatest call picks the new batch automatically. Older batches
   *  are pruned by `pruneOlderThan` so the table doesn't grow unbounded. */
  replaceLatest(items: TaxNotificationCreateInput[]): { inserted: number } {
    if (items.length === 0) return { inserted: 0 };
    const tx = db.transaction((rows: TaxNotificationCreateInput[]) => {
      let inserted = 0;
      for (const r of rows) {
        const id = crypto.randomUUID();
        stmts.insert.run(id, r.category, r.heading.slice(0, 500), r.summary?.slice(0, 2000) ?? null, r.notificationDate ?? null, r.sourceUrl?.slice(0, 1000) ?? null);
        inserted += 1;
      }
      return inserted;
    });
    return { inserted: tx(items) };
  },

  listLatest(limit: number = 12): TaxNotificationRow[] {
    return stmts.listLatest.all(limit) as TaxNotificationRow[];
  },

  byId(id: string): TaxNotificationRow | null {
    return (stmts.byId.get(id) as TaxNotificationRow | undefined) ?? null;
  },

  setDetail(id: string, fullDetail: string): void {
    stmts.setDetail.run(fullDetail.slice(0, 20_000), id);
  },

  /** Remove batches older than `cutoffIso`. Called by the daily refresh
   *  after a successful insert to keep the table small — we only need
   *  the latest batch for the welcome screen, but we keep ~7 days of
   *  history for debugging and to avoid wiping the list if a refresh
   *  fails. Returns the number of rows removed. */
  pruneOlderThan(cutoffIso: string): number {
    const res = stmts.deleteOlderThan.run(cutoffIso);
    return res.changes;
  },

  stats(): { total: number; latestBatch: number } {
    const total = (stmts.countAll.get() as { n: number }).n;
    const latest = (stmts.countLatest.get() as { n: number }).n;
    return { total, latestBatch: latest };
  },
};
