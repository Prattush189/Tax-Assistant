// server/lib/sweepStuckJobs.ts
//
// Server-side timeout for AI features. Long-running rows (ledger
// extract+audit, bank statement analyzer, notice drafter, partnership
// deed generator) persist a status='generating'/'extracting'/etc. flag
// upfront so a tab close + reload re-attaches. Most runs settle to
// 'done' or 'error' inside their natural budget, but two cases leave
// rows stuck:
//
//   1. The Node process crashed or was redeployed mid-run. The Promise
//      chain is gone but the DB row still says 'generating'.
//   2. A Gemini call hangs past its 90 s ceiling and the retry ladder
//      keeps doing this for longer than expected (observed: a job
//      running since the previous evening on a 503-storm day).
//
// In either case the user is staring at a "queued" or "analyzing"
// banner forever. This sweep catches them: every row in an in-progress
// state whose `updated_at` is older than the per-feature timeout gets
// flipped to 'error' with a "Timed out" message so the polling loop
// stops and the user sees the failure clearly.
//
// Runs once on server startup AND every 5 minutes thereafter.
import db from '../db/index.js';

interface SweepRule {
  table: string;
  // The status values that indicate "still running on the server".
  // Anything in this set whose updated_at is older than `timeoutMinutes`
  // gets flipped to 'error'.
  inProgressStatuses: readonly string[];
  timeoutMinutes: number;
  errorMessage: string;
}

const RULES: readonly SweepRule[] = [
  // Ledger: extract can take up to 15 min, audit another 5. 30 min cap
  // catches anything past the client's 20 min frontend timeout with
  // some breathing room. After this the user should retry.
  {
    table: 'ledger_scrutiny_jobs',
    inProgressStatuses: ['pending', 'extracting', 'scrutinizing'],
    timeoutMinutes: 30,
    errorMessage: 'Timed out: the audit ran longer than 30 minutes. Retry, or split the year and try again.',
  },
  // Bank statements: 50+ pages on the chunked TSV pipeline tops out
  // around 5 min. 15 min is a generous cap.
  {
    table: 'bank_statements',
    inProgressStatuses: ['analyzing'],
    timeoutMinutes: 15,
    errorMessage: 'Timed out: the analysis ran longer than 15 minutes. Retry, or use a CSV export.',
  },
  // Notices: a single Gemini call. 5 min is already 10× the typical
  // budget — anything past that is definitely stuck.
  {
    table: 'notices',
    inProgressStatuses: ['generating'],
    timeoutMinutes: 5,
    errorMessage: 'Timed out: the draft took longer than 5 minutes. Retry.',
  },
  // Partnership deeds: same pattern as notices.
  {
    table: 'partnership_deeds',
    inProgressStatuses: ['generating'],
    timeoutMinutes: 5,
    errorMessage: 'Timed out: the draft took longer than 5 minutes. Retry.',
  },
] as const;

/** Fire one sweep across every feature's in-progress rows. Returns the
 *  number of rows flipped to 'error' so the caller can log it. */
export function sweepStuckJobs(): number {
  let total = 0;
  for (const rule of RULES) {
    try {
      const placeholders = rule.inProgressStatuses.map(() => '?').join(',');
      // updated_at is stored as IST `datetime('now','+5 hours','+30 minutes')`
      // so we compare against the same expression minus the timeout. SQLite
      // keeps these as ISO-8601 strings which sort lexicographically.
      const stmt = db.prepare(`
        UPDATE ${rule.table}
           SET status = 'error',
               error_message = ?,
               updated_at = datetime('now', '+5 hours', '+30 minutes')
         WHERE status IN (${placeholders})
           AND updated_at < datetime('now', '+5 hours', '+30 minutes', ?)
      `);
      const result = stmt.run(rule.errorMessage, ...rule.inProgressStatuses, `-${rule.timeoutMinutes} minutes`);
      const changed = result.changes;
      if (changed > 0) {
        console.log(`[sweep] marked ${changed} stuck row(s) in ${rule.table} as 'error' (>${rule.timeoutMinutes} min)`);
        total += changed;
      }
    } catch (err) {
      // A bad CHECK constraint or missing column would error here. Log
      // and continue so one feature's misconfiguration doesn't stop the
      // others from sweeping.
      console.error(`[sweep] failed to sweep ${rule.table}:`, err);
    }
  }
  return total;
}

/** Start the periodic sweep. Returns the interval handle so tests /
 *  shutdown paths can clear it. Idempotent — safe to call multiple
 *  times; only the last call's interval is active. */
let activeInterval: NodeJS.Timeout | null = null;
export function startStuckJobSweeper(): NodeJS.Timeout {
  if (activeInterval) return activeInterval;
  // Sweep once at startup so a process restart doesn't leave the user
  // staring at a row that's been 'generating' since the previous run.
  try { sweepStuckJobs(); } catch (e) { console.error('[sweep] startup sweep failed:', e); }
  // Then every 5 minutes. Cheap UPDATEs scoped by status; the
  // user_id+status indexes already exist (we added them with the
  // file_hash migrations) so this stays fast even with many rows.
  activeInterval = setInterval(() => {
    try { sweepStuckJobs(); } catch (e) { console.error('[sweep] periodic sweep failed:', e); }
  }, 5 * 60 * 1000);
  return activeInterval;
}
