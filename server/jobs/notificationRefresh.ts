/**
 * Daily refresh of the chat welcome-screen notifications list.
 *
 * Calls fetchLatestNotifications() once at boot and once every 24 hours
 * thereafter. The fetcher itself logs to api_usage with category
 * 'notifications_fetch' so the admin recent-API-calls table picks up
 * each run with full token + cost attribution.
 *
 * If a refresh fails (Gemini outage, parse error, etc.) the previous
 * batch stays in the DB — listLatest reads the most recent successful
 * fetched_at so the welcome screen doesn't go blank.
 */

import { fetchLatestNotifications } from '../lib/notificationFetcher.js';

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Wait this long after server boot before the first run. We don't want
// to block the import-time of the server; running 90s after boot keeps
// startup snappy and gives the rest of the system (DB, JWT keys, plan
// cache) time to settle in.
const STARTUP_DELAY_MS = 90 * 1000;

async function runOnce(): Promise<void> {
  try {
    const result = await fetchLatestNotifications();
    if (result.ok) {
      console.log(`[notificationRefresh] OK · inserted=${result.inserted} pruned=${result.pruned} cost=$${result.cost.toFixed(5)}`);
    } else {
      console.warn(`[notificationRefresh] failed: ${result.errors.join('; ').slice(0, 400)}`);
    }
  } catch (err) {
    // Defence in depth — fetchLatestNotifications already returns
    // ok:false on error rather than throwing, but this catches anything
    // that slips through.
    console.error('[notificationRefresh] unexpected error:', err instanceof Error ? err.stack : err);
  }
}

export function startNotificationRefreshJob(): void {
  setTimeout(() => {
    void runOnce();
    setInterval(() => void runOnce(), INTERVAL_MS);
  }, STARTUP_DELAY_MS);
  console.log(`[notificationRefresh] Scheduled (first run in ${Math.round(STARTUP_DELAY_MS / 1000)}s, then every 24h)`);
}
