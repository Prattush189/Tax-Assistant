/**
 * Build the deduped payee list for a labeling pass — shared by the CLI
 * export script and the admin download endpoint.
 *
 * Groups bank_transactions by their (noise-stripped) fingerprint and
 * returns one entry per distinct payee with frequency, dominant
 * direction, current most-common category, and a sample narration,
 * most-frequent first (so the top of the list covers the most volume).
 *
 * PRIVACY: entries contain payee names. Keep any file written from this
 * local + gitignored; the admin endpoint streams it straight to the
 * authenticated admin's browser and persists nothing server-side.
 */
import db from '../db/index.js';

export interface PayeeReviewRow {
  fingerprint: string;
  count: number;
  direction: 'credit' | 'debit';
  mixed: boolean;
  current_category: string;
  sample_narration: string;
  // ── filled in by the labeling pass ──
  label: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  needs_human: boolean;
}

interface TxnRow { fingerprint: string | null; category: string | null; amount: number; narration: string | null; }
interface Group { count: number; credits: number; debits: number; cats: Map<string, number>; sample: string; }

export function buildPayeeReview(minCount: number): PayeeReviewRow[] {
  const all = db.prepare(
    `SELECT fingerprint, category, amount, narration FROM bank_transactions WHERE COALESCE(fingerprint, '') <> ''`,
  ).all() as TxnRow[];

  const groups = new Map<string, Group>();
  for (const r of all) {
    const fp = r.fingerprint as string;
    let g = groups.get(fp);
    if (!g) { g = { count: 0, credits: 0, debits: 0, cats: new Map(), sample: '' }; groups.set(fp, g); }
    g.count++;
    if (r.amount >= 0) g.credits++; else g.debits++;
    const cat = r.category ?? 'Other';
    g.cats.set(cat, (g.cats.get(cat) ?? 0) + 1);
    const narr = r.narration ?? '';
    if (narr.length > g.sample.length) g.sample = narr;
  }

  return [...groups.entries()]
    .filter(([, g]) => g.count >= minCount)
    .map(([fingerprint, g]) => ({
      fingerprint,
      count: g.count,
      direction: (g.credits >= g.debits ? 'credit' : 'debit') as 'credit' | 'debit',
      mixed: g.credits > 0 && g.debits > 0,
      current_category: [...g.cats.entries()].sort((a, b) => b[1] - a[1])[0][0],
      sample_narration: g.sample.slice(0, 160),
      label: null,
      confidence: null,
      needs_human: false,
    }))
    .sort((a, b) => b.count - a.count);
}
