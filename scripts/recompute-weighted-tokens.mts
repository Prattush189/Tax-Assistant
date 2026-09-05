/** Recompute api_usage.weighted_tokens for existing rows using the
 *  CURRENT weight table (thinking-as-output aware, cache-rate aware).
 *
 *  What this fixes: rows whose weights were computed under an older
 *  table, and rows where the cached portion of the prompt was charged
 *  at full input rate.
 *
 *  What it cannot fix: rows logged before 2026-09 never had thinking
 *  tokens STORED in output_tokens (the old parser dropped them), so
 *  those rows stay under-counted. This script only re-weights what is
 *  on disk; it does not invent tokens.
 *
 *  Usage (on the VPS):
 *    DB_PATH=/var/lib/tax-assistant/tax-assistant.db npx tsx scripts/recompute-weighted-tokens.mts --dry-run
 *    DB_PATH=/var/lib/tax-assistant/tax-assistant.db npx tsx scripts/recompute-weighted-tokens.mts
 *    ... --since 2026-09-01           (only rows created on/after)
 */
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const sinceIdx = argv.indexOf('--since');
const since = sinceIdx >= 0 ? argv[sinceIdx + 1] : undefined;

if (!process.env.DB_PATH) {
  console.warn('[recompute] DB_PATH not set — using the default database path.');
}

const { usageRepo } = await import('../server/db/repositories/usageRepo.js');

const r = usageRepo.recomputeAllWeightedTokens({ dryRun, since });
const fmt = (n: number) => n.toLocaleString('en-IN');
const pct = (a: number, b: number) => (a === 0 ? '—' : ((100 * (b - a)) / a).toFixed(1) + '%');

console.log(`${dryRun ? '[DRY RUN] ' : ''}weighted_tokens recompute${since ? ` (since ${since})` : ''}`);
console.log(`  rows scanned : ${fmt(r.scanned)}`);
console.log(`  rows changed : ${fmt(r.changed)}`);
console.log(`  total before : ${fmt(r.weightedBefore)}`);
console.log(`  total after  : ${fmt(r.weightedAfter)}   (${pct(r.weightedBefore, r.weightedAfter)})`);
console.log('');
console.log('  model                              rows   changed        before         after    delta');
for (const [model, m] of Object.entries(r.byModel).sort((a, b) => b[1].after - a[1].after)) {
  console.log(
    '  ' + model.padEnd(32) + String(m.rows).padStart(7) + String(m.changed).padStart(10)
    + fmt(m.before).padStart(14) + fmt(m.after).padStart(14) + ('  ' + pct(m.before, m.after)).padStart(9),
  );
}
if (dryRun) console.log('\nNothing written. Re-run without --dry-run to apply.');
