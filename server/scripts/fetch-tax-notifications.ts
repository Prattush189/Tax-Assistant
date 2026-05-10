/**
 * Manual run of the daily tax-notifications fetcher.
 *
 * Calls the same fetchLatestNotifications() entry point the cron job
 * uses, but lets you preview without writing (--dry-run), see the full
 * Gemini response (--verbose), or skip usage logging (--no-log) when
 * you're testing prompt changes and don't want to poison admin
 * dashboards.
 *
 * USAGE
 *
 *   npx tsx server/scripts/fetch-tax-notifications.ts                 # normal run
 *   npx tsx server/scripts/fetch-tax-notifications.ts --dry-run       # parse + print, no DB write
 *   npx tsx server/scripts/fetch-tax-notifications.ts --no-log        # write but don't log to api_usage
 *   npx tsx server/scripts/fetch-tax-notifications.ts --show-latest   # print the current welcome-screen list, no fetch
 *
 * The cron job runs at boot + every 24h via startNotificationRefreshJob
 * (server/jobs/notificationRefresh.ts). This script is for ad-hoc runs
 * when you want a fresh batch outside the schedule.
 */

// Load .env BEFORE any module that reads process.env at import time.
// gemini.ts captures GEMINI_API_KEY in a top-level const, so importing it
// before dotenv runs leaves the SDK with an empty key. server/index.ts
// already does this for the running app; we replicate it here so the
// standalone script picks up the same .env without needing CLI exports.
import 'dotenv/config';
import { fetchLatestNotifications } from '../lib/notificationFetcher.js';
import { notificationsRepo } from '../db/repositories/notificationsRepo.js';

interface Flags {
  dryRun: boolean;
  noLog: boolean;
  showLatest: boolean;
  help: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { dryRun: false, noLog: false, showLatest: false, help: false };
  for (const a of argv) {
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--no-log') flags.noLog = true;
    else if (a === '--show-latest') flags.showLatest = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else console.warn(`[fetch-tax-notifications] unknown flag: ${a}`);
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    console.log('USAGE');
    console.log('  npx tsx server/scripts/fetch-tax-notifications.ts');
    console.log('  npx tsx server/scripts/fetch-tax-notifications.ts --dry-run');
    console.log('  npx tsx server/scripts/fetch-tax-notifications.ts --no-log');
    console.log('  npx tsx server/scripts/fetch-tax-notifications.ts --show-latest');
    process.exit(0);
  }

  if (flags.showLatest) {
    const items = notificationsRepo.listLatest(50);
    const stats = notificationsRepo.stats();
    console.log(`Welcome-screen list — ${items.length} item(s) in latest batch (${stats.total} total rows in DB):`);
    for (const it of items) {
      console.log(`  [${it.category}] (${it.notification_date ?? 'no date'}) ${it.heading}`);
      if (it.summary) console.log(`     ${it.summary}`);
      if (it.source_url) console.log(`     ↪ ${it.source_url}`);
      if (it.full_detail) console.log(`     (full_detail cached, ${it.full_detail.length} chars)`);
    }
    process.exit(0);
  }

  console.log(`[fetch-tax-notifications] starting${flags.dryRun ? ' (DRY RUN)' : ''}${flags.noLog ? ' (NO LOG)' : ''} ...`);
  const startedAt = Date.now();
  const result = await fetchLatestNotifications({
    dryRun: flags.dryRun,
    logUsage: !flags.noLog,
  });
  const durationMs = Date.now() - startedAt;

  console.log('');
  console.log(`[fetch-tax-notifications] done in ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  ok        : ${result.ok}`);
  console.log(`  inserted  : ${result.inserted}`);
  console.log(`  pruned    : ${result.pruned}`);
  console.log(`  tokens    : ${result.inputTokens} in / ${result.outputTokens} out`);
  console.log(`  cost      : $${result.cost.toFixed(5)}`);
  if (result.errors.length > 0) {
    console.log('  errors    :');
    for (const e of result.errors) console.log(`    - ${e}`);
  }

  if (!flags.dryRun && result.ok) {
    const items = notificationsRepo.listLatest(50);
    console.log('');
    console.log(`Welcome-screen list (${items.length} item(s)):`);
    for (const it of items) {
      console.log(`  [${it.category}] (${it.notification_date ?? 'no date'}) ${it.heading}`);
    }
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch(err => {
  console.error('[fetch-tax-notifications] FATAL:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
