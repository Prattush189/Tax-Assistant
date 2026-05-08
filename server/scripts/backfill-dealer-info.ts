/**
 * Backfill dealer / sub-dealer attribution for users who signed up
 * before the GetDealerInfo lookup was wired into the login flow (see
 * server/lib/assistNotify.ts), or whose attribution was never
 * persisted because the lookup failed transiently.
 *
 * The runtime path notifyAssistOfLogin is fire-and-forget; this
 * script does the same call SYNCHRONOUSLY for every existing user
 * whose dealer is still NULL/empty, so admin dashboards can stop
 * showing them as "unattributed". Idempotent — safe to re-run; users
 * with a non-empty dealer column are skipped.
 *
 * USAGE
 *
 *   npx tsx server/scripts/backfill-dealer-info.ts                   # all users with no dealer
 *   npx tsx server/scripts/backfill-dealer-info.ts --all              # also re-check users who already have dealer set
 *   npx tsx server/scripts/backfill-dealer-info.ts --dry-run          # show who would be called, don't hit the API
 *   npx tsx server/scripts/backfill-dealer-info.ts --limit 50         # cap to first 50 candidates
 *   npx tsx server/scripts/backfill-dealer-info.ts --email user@ex    # single user
 *
 * The endpoint is rate-friendly but not free; default cadence is one
 * call every 250 ms (4 req/sec). Override with --delay 1000 if you
 * see HTTP 5xx from upstream.
 */

import db from '../db/index.js';

const ASSIST_DEALER_INFO_URL = 'http://smartbizin.com/checking/assistservices.svc/GetDealerInfo';
const TIMEOUT_MS = 5_000;
const DEFAULT_DELAY_MS = 250;

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  dealer: string | null;
  sub_dealer: string | null;
}

interface DealerLookupResult {
  ok: boolean;
  dealer: string | null;
  subDealer: string | null;
  msg: string;
  status?: number;
}

function parseFlags(argv: string[]): {
  all: boolean;
  dryRun: boolean;
  limit: number | null;
  delayMs: number;
  email: string | null;
} {
  const flags = {
    all: false,
    dryRun: false,
    limit: null as number | null,
    delayMs: DEFAULT_DELAY_MS,
    email: null as string | null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') flags.all = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--limit') flags.limit = Math.max(1, parseInt(argv[++i] ?? '0', 10) || 0);
    else if (a === '--delay') flags.delayMs = Math.max(0, parseInt(argv[++i] ?? '0', 10) || 0);
    else if (a === '--email') flags.email = (argv[++i] ?? '').trim().toLowerCase();
  }
  return flags;
}

function selectCandidates(opts: { all: boolean; email: string | null; limit: number | null }): UserRow[] {
  const conditions: string[] = ["role IS NULL OR LOWER(role) <> 'admin'"];
  const params: (string | number)[] = [];
  if (opts.email) {
    conditions.push('LOWER(email) = ?');
    params.push(opts.email);
  } else if (!opts.all) {
    conditions.push("(dealer IS NULL OR TRIM(dealer) = '')");
  }
  conditions.push('email IS NOT NULL');
  conditions.push("TRIM(email) <> ''");
  const sql = `
    SELECT id, email, name, role, dealer, sub_dealer
    FROM users
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at ASC
    ${opts.limit ? `LIMIT ${opts.limit}` : ''}
  `;
  return db.prepare(sql).all(...params) as UserRow[];
}

async function lookupDealer(email: string): Promise<DealerLookupResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ASSIST_DEALER_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Same shape notifyAssistOfLogin uses — '0.0.0.0' as a placeholder
      // when we don't have a captured login IP. The endpoint accepts it.
      body: JSON.stringify({ email, ipAddress: '0.0.0.0' }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, dealer: null, subDealer: null, msg: `HTTP ${res.status}`, status: res.status };
    }
    const body = await res.json().catch(() => null) as { GetDealerInfoResult?: string } | null;
    if (!body?.GetDealerInfoResult) {
      return { ok: false, dealer: null, subDealer: null, msg: 'empty response' };
    }
    let inner: { status?: number; msg?: string; dealer?: string; subDealer?: string };
    try {
      inner = JSON.parse(body.GetDealerInfoResult);
    } catch {
      return { ok: false, dealer: null, subDealer: null, msg: 'malformed inner JSON' };
    }
    const isSuccess = (inner.msg ?? '').trim().toLowerCase().startsWith('success');
    return {
      ok: isSuccess,
      dealer: (inner.dealer ?? '').trim() || null,
      subDealer: (inner.subDealer ?? '').trim() || null,
      msg: inner.msg ?? '(no msg)',
      status: inner.status,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, dealer: null, subDealer: null, msg: msg.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

function persistAttribution(userId: string, dealer: string | null, subDealer: string | null): void {
  db.prepare('UPDATE users SET dealer = ?, sub_dealer = ? WHERE id = ?').run(dealer, subDealer, userId);
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const candidates = selectCandidates(flags);

  if (candidates.length === 0) {
    console.log('[backfill-dealer-info] no candidates — nothing to do.');
    return;
  }

  console.log(`[backfill-dealer-info] ${candidates.length} candidate user(s)${flags.dryRun ? ' (dry run)' : ''}`);
  if (flags.dryRun) {
    for (const u of candidates) {
      console.log(`  - ${u.email}  current dealer="${u.dealer ?? '-'}"  sub="${u.sub_dealer ?? '-'}"`);
    }
    return;
  }

  let updated = 0;
  let success = 0;
  let unchanged = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const u = candidates[i];
    const prefix = `[${i + 1}/${candidates.length}] ${u.email}`;
    try {
      const result = await lookupDealer(u.email);
      if (result.ok) {
        success += 1;
        const changed = (u.dealer ?? '') !== (result.dealer ?? '') || (u.sub_dealer ?? '') !== (result.subDealer ?? '');
        if (changed) {
          persistAttribution(u.id, result.dealer, result.subDealer);
          updated += 1;
          console.log(`${prefix} → dealer="${result.dealer ?? '-'}" sub="${result.subDealer ?? '-'}" (UPDATED)`);
        } else {
          unchanged += 1;
          console.log(`${prefix} → dealer="${result.dealer ?? '-'}" sub="${result.subDealer ?? '-'}" (no change)`);
        }
      } else {
        failed += 1;
        console.warn(`${prefix} → SKIPPED: ${result.msg}`);
      }
    } catch (err) {
      failed += 1;
      console.warn(`${prefix} → ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (i < candidates.length - 1 && flags.delayMs > 0) {
      await sleep(flags.delayMs);
    }
  }

  console.log('');
  console.log('[backfill-dealer-info] done');
  console.log(`  success:    ${success}`);
  console.log(`  updated:    ${updated}`);
  console.log(`  unchanged:  ${unchanged}`);
  console.log(`  failed:     ${failed}`);
}

main().catch(err => {
  console.error('[backfill-dealer-info] fatal', err);
  process.exit(1);
});
