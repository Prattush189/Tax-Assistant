/** Verify the e-Filing scraper retries transient failures (503/429/
 *  network) but not a 4xx, and parses on eventual success. Mocks fetch.
 *  Run: npx tsx scripts/smoke-efiling-retry.mts
 */
import { fetchEfilingItems, parseEfilingHtml } from '../server/lib/efilingPortalScraper.ts';

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`); };

const HTML = `<div class="views-row">
  <div class="up-date">19-Jun-2026</div>
  <p>Excel Utility of ITR-3 for AY 2026-27 is now available. <a href="/downloads/itr3.zip">Click here</a></p>
</div></div></div>`;

const realFetch = globalThis.fetch;
function mockFetch(seq: Array<number | 'network'>) {
  let i = 0;
  globalThis.fetch = (async () => {
    const v = seq[Math.min(i, seq.length - 1)]; i++;
    if (v === 'network') throw new Error('ECONNRESET');
    const status = v as number;
    return { ok: status >= 200 && status < 300, status, text: async () => HTML } as Response;
  }) as typeof fetch;
}

// 1. Parser sanity (no network).
{
  const items = parseEfilingHtml(HTML);
  check('parser pulls ITR-3 item with date', items.length === 1 && items[0].dateModified === '2026-06-19' && /ITR-3/.test(items[0].title), JSON.stringify(items[0]));
}

// 2. 503 twice then 200 → recovers (this is the user's exact case).
{
  mockFetch([503, 503, 200]);
  const items = await fetchEfilingItems();
  check('503,503,200 → recovers and returns the item', items.length === 1 && /ITR-3/.test(items[0].title));
}

// 3. Permanent 503 → throws after retries.
{
  mockFetch([503]);
  let threw = false;
  try { await fetchEfilingItems(); } catch (e) { threw = /503/.test((e as Error).message); }
  check('permanent 503 → throws (after 3 attempts)', threw);
}

// 4. 404 → NOT retried (would never recover), throws immediately.
{
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return { ok: false, status: 404, text: async () => '' } as Response; }) as typeof fetch;
  let threw = false;
  try { await fetchEfilingItems(); } catch { threw = true; }
  check('404 → throws without retrying', threw && calls === 1, `(calls=${calls})`);
}

// 5. network error then success → retried.
{
  mockFetch(['network', 200]);
  const items = await fetchEfilingItems();
  check('network error then 200 → recovers', items.length === 1);
}

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
