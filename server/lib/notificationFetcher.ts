/**
 * Daily fetcher for the latest GST / TDS / Income Tax notifications.
 *
 * Uses Gemini 3.1 Flash-Lite with Google Search grounding to query the
 * official government sources (cbic-gst.gov.in, incometax.gov.in,
 * cbic.gov.in, taxinformation.cbic.gov.in) and parses a structured
 * list of recent notifications.
 *
 * Every call is logged to api_usage with category='notifications_fetch'
 * (boot/cron) or 'notification_detail' (per-card click) so the admin
 * dashboard's recent-API-calls table includes the spend.
 *
 * Two public functions:
 *   - fetchLatestNotifications()  — runs the grounded query, parses the
 *     JSON list, persists via replaceLatest, prunes 7-day-old batches,
 *     logs usage. Returns counts.
 *   - generateNotificationDetail(id, prompt) — generates the long-form
 *     explanation for a single notification on click. Persists into
 *     full_detail so subsequent clicks read from cache.
 */

import { streamGeminiChat } from './geminiChat.js';
import { GEMINI_API_KEYS, GEMINI_CHAT_MODEL_T1, GEMINI_CHAT_MODEL_T2, costForModel } from './gemini.js';
import { notificationsRepo, type NotificationCategory, type TaxNotificationCreateInput } from '../db/repositories/notificationsRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { fetchAllCbdtItems, type CbdtItem } from './cbdtScraper.js';
import { fetchGstCouncilItems, type GstCouncilItem } from './gstCouncilScraper.js';

// System-job rows in api_usage are written with NULL user_id /
// billing_user_id. user_id is FK to users(id) — a sentinel string like
// 'system' raises "FOREIGN KEY constraint failed" because no users row
// exists with that id. The column allows NULL (ON DELETE SET NULL), so
// null is the right marker for "no human actor" (cron, boot job).
// Admin dashboard groups null-user rows under a "System job" heading.

// 7 days of history is plenty for diagnostics — older batches just
// inflate the table.
const PRUNE_AGE_DAYS = 7;

interface RawNotification {
  category?: string;
  heading?: string;
  summary?: string;
  notification_date?: string;
  source_url?: string;
}

// Hard allowlist of official Indian government domains for tax/GST/TDS
// notifications. Any item whose source_url host doesn't end in one of
// these is rejected at parse time — defence in depth on top of the
// prompt instruction. Lower-cased, with leading dot so we can do a
// strict suffix match (i.e. "cbic.gov.in" matches "x.cbic.gov.in" but
// NOT "fakecbic.gov.in").
//
// Coverage rationale:
//   - cbic-gst.gov.in / cbic.gov.in / taxinformation.cbic.gov.in   GST + Customs notifications
//   - incometax.gov.in / incometaxindia.gov.in                     ITD portal + notification PDFs
//   - cbdt.gov.in (legacy)                                         CBDT circulars (mostly redirects to ITD)
//   - egazette.nic.in / egazette.gov.in                            Gazette of India (final source of truth)
//   - gst.gov.in / gstcouncil.gov.in                               GST Council resolutions
//   - finmin.nic.in / dor.gov.in                                   Ministry of Finance / Dept of Revenue
//   - pib.gov.in                                                   Press Information Bureau (official press notes)
//   - mca.gov.in                                                   MCA circulars overlapping with tax
//   - india.gov.in / nic.in                                        National Informatics Centre umbrella
const OFFICIAL_DOMAINS: readonly string[] = [
  'cbic-gst.gov.in',
  'cbic.gov.in',
  'taxinformation.cbic.gov.in',
  'incometax.gov.in',
  'incometaxindia.gov.in',
  'cbdt.gov.in',
  'egazette.nic.in',
  'egazette.gov.in',
  'gst.gov.in',
  'gstcouncil.gov.in',
  'finmin.nic.in',
  'dor.gov.in',
  'pib.gov.in',
  'mca.gov.in',
  'india.gov.in',
  // Catch-all for *.gov.in / *.nic.in subdomains we haven't enumerated
  // (state-level GST departments, RBI circulars, etc.) — both TLD
  // groups are reserved for Indian government use only.
  'gov.in',
  'nic.in',
];

/** Returns true iff `url` is a parseable HTTPS/HTTP URL whose hostname
 *  is at OR a subdomain of one of OFFICIAL_DOMAINS. Uses suffix
 *  matching with a leading dot so the comparison can't be tricked by
 *  lookalike domains ("fakecbic.gov.in.evil.com" is rejected;
 *  "x.cbic.gov.in" is allowed). */
export function isOfficialSource(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  if (!host) return false;
  return OFFICIAL_DOMAINS.some(d => host === d || host.endsWith('.' + d));
}

/**
 * HEAD-request validation pass. Verifies that each item's source_url
 * actually resolves to a real document. Catches the failure mode where
 * the model invents a plausible-shaped PDF path on a real host (e.g.
 * `https://cbic-gst.gov.in/pdf/notification/cgst-99-2026.pdf` when no
 * notification 99/2026 exists yet).
 *
 * Concurrency: 6 in-flight requests at a time. Polite to government
 * hosts, fast enough that a 20-item batch finishes in ~5-10 seconds.
 *
 * Timeout: 8 seconds per request via AbortController. Long enough for
 * gov.in sites which are sometimes slow.
 *
 * Acceptance — calibrated against actual gov.in behaviour observed in
 * production logs (2026-05-30):
 *   - PDF-shaped URLs (path ends in `.pdf` or contains `/pdf/`): we
 *     want a real document, so require 2xx/3xx. Strict.
 *   - Everything else (listing pages — `.aspx`, `.html`, directories):
 *     gov.in IIS sites frequently respond 403/405/406 to HEAD from
 *     non-browser clients, even though the URL is real and a browser
 *     gets a 200. We accept ANY response other than 404 — network
 *     errors and 404s drop the item; all other statuses keep it.
 *   - User-Agent set to a plain browser string so picky servers don't
 *     reject the request outright as scraper.
 *
 * Retries: HEAD → GET (range 0-0) on 405/403/406. Some servers refuse
 * HEAD entirely but accept GET.
 *
 * Earlier (over-strict) behaviour killed every listing-page URL the
 * model emitted, dropping the entire batch to zero items. The model
 * legitimately uses listing pages when a direct PDF isn't surfaced by
 * search grounding — the prompt allows this.
 */
async function urlHeadFilter<T extends { sourceUrl: string }>(items: T[]): Promise<T[]> {
  if (items.length === 0) return [];
  const TIMEOUT_MS = 15_000;
  const CONCURRENCY = 6;
  const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const surviving: T[] = [];

  // Known-good listing pages enumerated in FETCH_PROMPT. The model
  // points to one of these when search grounding doesn't surface a
  // direct PDF URL — that's the explicit fallback we tell it to use.
  // These URLs can't be fabricated (the model didn't invent them; the
  // prompt did), so we skip the HEAD check entirely. Some of these
  // hosts are slow or have firewalls that intermittently drop
  // requests from the deploy server, which would otherwise cause
  // legitimate items to be dropped — production proved this on
  // 2026-05-30.
  const ALWAYS_VALID_URLS: ReadonlySet<string> = new Set([
    'https://incometaxindia.gov.in/Pages/communications/notifications.aspx',
    'https://incometaxindia.gov.in/Pages/communications/circulars.aspx',
    'https://incometax.gov.in/iec/foportal/latest-news',
    'https://cbic-gst.gov.in/cgst-notifications.html',
    'https://cbic-gst.gov.in/igst-notifications.html',
    'https://cbic-gst.gov.in/cgst-rate-notifications.html',
    'https://www.cbic.gov.in/entities/notification',
    'https://cbic.gov.in/entities/notification',
    'https://taxinformation.cbic.gov.in/',
    'https://taxinformation.cbic.gov.in',
    'https://egazette.gov.in/',
    'https://egazette.gov.in',
    'https://egazette.nic.in/',
    'https://egazette.nic.in',
    'https://dor.gov.in/notifications',
    'https://gstcouncil.gov.in/',
    'https://gstcouncil.gov.in',
  ]);
  const isKnownListingPage = (url: string): boolean => {
    // Normalise trailing slash so the set match doesn't fail on a
    // missing/extra "/".
    const stripped = url.replace(/\/+$/, '');
    return ALWAYS_VALID_URLS.has(url) || ALWAYS_VALID_URLS.has(stripped) || ALWAYS_VALID_URLS.has(stripped + '/');
  };

  const isPdfLike = (url: string): boolean => {
    const lower = url.toLowerCase();
    return lower.endsWith('.pdf') || lower.includes('/pdf/');
  };

  const checkOne = async (it: T): Promise<boolean> => {
    const url = it.sourceUrl;
    // Short-circuit known listing pages — they're in the prompt, so
    // the model isn't fabricating them. Skips the slow gov.in HEAD
    // round-trip entirely.
    if (isKnownListingPage(url)) return true;
    const tryFetch = async (method: 'HEAD' | 'GET'): Promise<Response | null> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const headers: Record<string, string> = { 'User-Agent': BROWSER_UA };
        if (method === 'GET') headers.Range = 'bytes=0-0';
        return await fetch(url, {
          method,
          redirect: 'follow',
          signal: controller.signal,
          headers,
        });
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    };
    let res = await tryFetch('HEAD');
    if (res && (res.status === 405 || res.status === 403 || res.status === 406)) {
      res = await tryFetch('GET');
    }
    if (!res) return false;          // network error / DNS / timeout → drop
    if (res.status === 404) return false; // explicitly "this page doesn't exist" → drop
    if (isPdfLike(url)) {
      // PDF target: we want a real document, not a "we don't allow
      // direct access" page. Require 2xx/3xx.
      return res.status >= 200 && res.status < 400;
    }
    // Listing-page target: anything other than 404 is good enough
    // (403/405/410/500 from gov.in usually means the server has a
    // crawler block, not that the URL is invalid).
    return true;
  };

  // Hand-rolled concurrency cap — runs CONCURRENCY workers that pull
  // from a shared queue, so 6 requests are in flight at any time.
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(CONCURRENCY, items.length); w++) {
    workers.push((async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        const ok = await checkOne(items[idx]);
        if (ok) surviving.push(items[idx]);
        else console.warn(`[notificationFetcher] HEAD-check failed for ${items[idx].sourceUrl}`);
      }
    })());
  }
  await Promise.all(workers);

  // Preserve original order rather than the racy completion order.
  const survivingSet = new Set(surviving);
  return items.filter(it => survivingSet.has(it));
}

const FETCH_PROMPT = `You are a tax/GST/TDS news researcher for an Indian chartered-accountant SaaS.

Your job: produce a JSON list of recent (last 90 days) notifications, circulars, and instructions issued by Indian tax authorities. Aim for 12-20 items. Use Google Search aggressively — these notifications are issued weekly across multiple categories, so 12-20 is the realistic count, not 1-2.

WHERE TO LOOK — the official notification listing pages on each authority's site are the best starting points. Search for them by name plus "notifications" or visit them directly via grounded queries:

  GST (CBIC):
    - https://cbic-gst.gov.in/cgst-notifications.html
    - https://cbic-gst.gov.in/igst-notifications.html
    - https://cbic-gst.gov.in/cgst-rate-notifications.html
    - https://taxinformation.cbic.gov.in/  (search by category)

  Income Tax (CBDT):
    - https://incometaxindia.gov.in/Pages/communications/notifications.aspx
    - https://incometaxindia.gov.in/Pages/communications/circulars.aspx
    - https://incometax.gov.in/iec/foportal/latest-news

  Customs (CBIC):
    - https://www.cbic.gov.in/entities/notification
    - https://taxinformation.cbic.gov.in/  (Customs section)

  Gazette / Ministry of Finance:
    - https://egazette.gov.in/  /  https://egazette.nic.in/
    - https://dor.gov.in/notifications

  GST Council resolutions:
    - https://gstcouncil.gov.in/

For each authority, scan the most-recent 10-20 entries on the listing page and pull the ones dated within 90 days.

MANDATORY PRE-FLIGHT CHECK — DO THIS FIRST, BEFORE ANY OTHER SEARCH.

Before searching for anything else, you MUST run these specific searches and include any results that fall within the 90-day window:

  PRE-FLIGHT 1 — ITR forms for the current Assessment Year.
  Search EACH of these queries and include EVERY notification you find:
    - site:incometaxindia.gov.in "ITR-1" notification 2026
    - site:incometaxindia.gov.in "ITR-2" notification 2026
    - site:incometaxindia.gov.in "ITR-3" notification 2026
    - site:incometaxindia.gov.in "ITR-4" notification 2026
    - site:incometaxindia.gov.in "ITR-5" notification 2026
    - site:incometaxindia.gov.in "ITR-6" notification 2026
    - site:incometaxindia.gov.in "ITR-7" notification 2026
    - site:incometaxindia.gov.in "Income Tax Amendment Rules" 2026 (forms are often notified as Rules amendments that schedule the forms — e.g. "Income Tax (Eighth Amendment) Rules, 2026")
  ITR forms for AY 2026-27 are typically notified between February and April 2026. If your search finds nothing for the current AY, search the previous AY ("ITR-2" notification 2025) — if THAT exists, the current-year version probably exists too and you missed it; search harder.
  CRITICAL: An ITR-form notification dated within the 90-day window MUST appear in your output. A welcome list that omits it during ITR season is broken. If you genuinely cannot find one after exhausting the searches above, INCLUDE A NOTE as the first item: { "category": "INCOME_TAX", "heading": "No ITR form notification found in 90-day window — confirm CBDT release status manually", "summary": "Pre-flight search returned no ITR form notification for the current AY. Either the form has not been released yet or grounding failed to surface it.", "notification_date": null, "source_url": "https://incometaxindia.gov.in/Pages/communications/notifications.aspx" }. Do NOT silently omit. The server treats absence as a bug.

  PRE-FLIGHT 2 — TDS / TCS rate or threshold notification.
  Search "site:incometaxindia.gov.in TDS notification 2026" and include any §194-series rate change or threshold notification within 90 days.

WHAT ELSE QUALIFIES (include after the pre-flight items):
  - Numbered Notifications (e.g. "Notification No. 12/2026-Central Tax")
  - Numbered Circulars (e.g. "Circular No. 234/26/2026-GST")
  - Instructions, Order, Office Memorandum issued by CBDT/CBIC
  - GST Council resolution or circular
  - Income Tax Department notifications under §139, §194-series, §195, §44AB rules etc.
  - **AIS / Form 26AS / TIS** clarifications and reporting-format changes
  - **Faceless assessment / DRI / DGGI** procedural notifications
  - Customs tariff and exemption notifications affecting traders/importers

WHAT TO SKIP:
  - GST monthly collection-figure press releases ("GST collection in April 2026 was Rs. X crore")
  - Generic FAQ pages, e-filing portal updates
  - Budget-day commentary, explanatory memos, departmental news
  - Anything older than 90 days

OFFICIAL-SOURCE RULE.
Every source_url MUST be on a government domain (*.gov.in / *.nic.in or one of these specific hosts: cbic-gst.gov.in, cbic.gov.in, taxinformation.cbic.gov.in, incometax.gov.in, incometaxindia.gov.in, cbdt.gov.in, egazette.nic.in, egazette.gov.in, gst.gov.in, gstcouncil.gov.in, finmin.nic.in, dor.gov.in, pib.gov.in, mca.gov.in).

The URL can be either a direct PDF (e.g. https://cbic-gst.gov.in/pdf/notification/cgst-12-2026.pdf) OR a listing-page entry that points to the notification (e.g. https://incometaxindia.gov.in/Pages/communications/notifications.aspx). Both are valid; the listing page is acceptable when you can't extract the direct PDF link from search results.

DO NOT cite third-party tax-news sites (taxguru.in, taxscan.in, taxmann.com, cleartax.in), law-firm blogs, news outlets (livemint, economictimes, business-standard, moneycontrol, etc.), social media, or aggregators. A third-party article may tip you off to a notification's existence, but the source_url you write must be the authority's own URL.

For each item:
  - category: "GST" | "TDS" | "INCOME_TAX" | "OTHER"
  - heading: ≤ 90 chars, leads with the notification number ("GST Notification 12/2026-CT — Rate change on…")
  - summary: 1-2 sentences (≤ 250 chars) on what changed and who it affects
  - notification_date: YYYY-MM-DD of the notification's stamped date (NOT today's date — the date printed on the notification)
  - source_url: official URL on the allowlist above

OUTPUT — STRICT JSON, no markdown fences, no prose:
{
  "items": [
    { "category": "...", "heading": "...", "summary": "...", "notification_date": "YYYY-MM-DD", "source_url": "https://..." }
  ]
}

TARGET: 12-20 items in the JSON. Indian tax authorities issue notifications WEEKLY across multiple categories — a 90-day window across GST + TDS + Income Tax + Customs reliably yields well over 20 candidates. If your draft has fewer than 8 items, search more listing pages (you've likely missed Customs, GST Council, or older Income Tax notifications). Returning only 1-2 items means the search was too narrow, not that few notifications exist.

CATEGORY BALANCE.
Aim for roughly: 4-6 Income Tax (CBDT), 4-6 GST (CBIC), 2-3 TDS (CBDT 194-series), 2-3 Customs/Other. If your draft is more than 50% one category, you've under-searched the others. ITR season (Feb-Apr) and TDS rate-change months are CBDT-heavy; non-season months tilt toward GST. NEVER produce a list that is 75%+ Customs — that means search-grounding latched onto a single press batch.

VERIFY BEFORE EMITTING.
For each item, run an additional grounded search confirming that:
  (a) the notification number you cite appears on the official listing page in the form you wrote,
  (b) the notification_date matches what the listing page shows for that number,
  (c) the source_url actually contains the notification heading text.
If any of (a)-(c) can't be confirmed, OMIT that item. Better to return 10 verified items than 18 with 3 fabricated. The downstream system has no way to detect a plausible-but-fake notification number — you are the only line of defence.

ABSOLUTE RULES:
- Every source_url MUST be on a government domain. The server rejects items whose URL is not on the allowlist; a non-official URL means one fewer notification reaches the user.
- TDS items can be CBDT rate-change circulars, §194-series threshold revisions, or Finance-Act-implementing notifications. These DO exist almost every month.
- Do NOT invent URLs. If grounding can't surface the listing-page or PDF URL, omit that item — but then keep searching for more.
- notification_date MUST be within the last 90 days. The server enforces this with a hard date filter; anything older is dropped silently. Don't waste output on Feb items if it's late May.
- Output ONLY the JSON object.`;

const DETAIL_PROMPT_TEMPLATE = (heading: string, summary: string | null, sourceUrl: string | null) => `You are explaining an Indian tax/GST/TDS notification to a chartered accountant. The notification is:

  Heading: ${heading}
  ${summary ? `Summary: ${summary}` : ''}
  ${sourceUrl ? `Source: ${sourceUrl}` : ''}

Use Google Search to read the official notification (and any clarification circular). HARD CONSTRAINT: only consult and cite content hosted on Indian government domains — cbic-gst.gov.in, cbic.gov.in, taxinformation.cbic.gov.in, incometax.gov.in, incometaxindia.gov.in, cbdt.gov.in, egazette.nic.in, gst.gov.in, gstcouncil.gov.in, finmin.nic.in, dor.gov.in, pib.gov.in, or any *.gov.in / *.nic.in subdomain. Do NOT use taxguru.in, taxscan.in, taxmann.com, cleartax.in, livemint, economic-times, business-standard, law-firm blogs, or any other third-party commentary as a source.

Then write a structured explanation in 350-550 words covering:

  1. **What changed** — the operative provision in plain English
  2. **Who it affects** — the taxpayer category, threshold, sector
  3. **Effective date** — when it kicks in
  4. **What practitioners need to do** — the practical action: filings, system changes, client advisory points
  5. **Cross-references** — any earlier notification this supersedes / amends, or related circulars

Format with markdown headings and short paragraphs. Cite section numbers verbatim. Do NOT fabricate clauses — if the notification doesn't say something, say so. Output the explanation ONLY, no preamble.`;

function pickCategory(raw: string | undefined): NotificationCategory {
  const v = (raw ?? '').toUpperCase().trim();
  if (v === 'GST' || v === 'TDS' || v === 'INCOME_TAX') return v;
  return 'OTHER';
}

/** Map a CBDT-scraped item to one of our four welcome-screen
 *  categories. The structure key gives the broad bucket; a heading-
 *  keyword sweep upgrades TDS-relevant notifications (§194-series,
 *  TCS, TDS-on-X) out of the default INCOME_TAX. */
function pickCbdtCategory(item: CbdtItem): NotificationCategory {
  const title = (item.title || '').toLowerCase();
  const isTdsRelated = /\btds\b|\btcs\b|section\s*194|194[a-z]?\b|deduction\s+at\s+source|collection\s+at\s+source/i.test(title);
  switch (item.structureKey) {
    case 'NOTIFICATION_KEY':
    case 'CIRCULAR_KEY':
      return isTdsRelated ? 'TDS' : 'INCOME_TAX';
    case 'PRESS_RELEASE':
    case 'MISCELLANEOUS_COMMUNICATION':
      return 'OTHER';
    default:
      return 'OTHER';
  }
}

/** CBDT titles often run 150+ chars ("Notification No. 6/2026: Order
 *  under clause (iia) of sub-section (1) of section 35 of the Income
 *  Tax Act, 1961 read with Rule 5F of the Income Tax Rules 1962").
 *  The welcome card has limited space; trim at the first colon if
 *  there is one (keeps the number + leading subject), else hard-cap
 *  at 90 chars with an ellipsis. */
function trimHeading(title: string): string {
  const cleaned = title.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 90) return cleaned;
  return cleaned.slice(0, 87).trimEnd() + '…';
}

function isIsoDate(s: string | undefined): boolean {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

function pickApiKey(): string | null {
  const key = GEMINI_API_KEYS.find(k => k && k.length > 0);
  return key ?? null;
}

/** Drain a streamGeminiChat generator into a single string + final
 *  usage / sources record. Mirrors what the chat route does internally
 *  but condensed for non-streaming consumers. */
async function consumeStream(model: string, prompt: string, apiKey: string, maxOutputTokens: number) {
  let buffer = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let sources: Array<{ title: string; url: string }> = [];
  let finishReason: string | undefined;
  for await (const chunk of streamGeminiChat(model, prompt, [], 'Begin.', apiKey, maxOutputTokens, /*enableSearch=*/ true, /*useCache=*/ false)) {
    if (chunk.text) buffer += chunk.text;
    if (chunk.done) {
      inputTokens = chunk.inputTokens ?? 0;
      outputTokens = chunk.outputTokens ?? 0;
      sources = chunk.sources ?? [];
      finishReason = chunk.finishReason;
    }
  }
  return { text: buffer, inputTokens, outputTokens, sources, finishReason, modelUsed: model };
}

/** Match retryable upstream errors so we don't fall back to T2 for
 *  errors that T2 would also fail (auth, bad request, content
 *  filter). Pulls the HTTP status out of `streamGeminiChat`'s thrown
 *  Error messages — they look like "AI service error 503: {..body..}".
 *  Any of 429 / 500 / 502 / 503 / 504 is treated as "try T2"; the
 *  log line that prompted this change was a `code: 503, status:
 *  UNAVAILABLE` on Gemini 3.1 Flash-Lite Preview hitting "high
 *  demand". 401/403 / 400 / 404 propagate immediately. */
function isRetryableUpstream(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /AI service error (\d{3})/.exec(msg);
  if (!m) return false;
  const status = Number(m[1]);
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/** consumeStream with a tier-2 fallback. Tries T1 (Gemini 3.1
 *  Flash-Lite Preview) first — the user explicitly asked for "Gemini
 *  3 Flash" and the 3.x family produces better-grounded summaries on
 *  the news-search workload. On a retryable upstream error (typically
 *  503 "high demand" on the preview model), falls back ONCE to T2
 *  (Gemini 2.5 Flash-Lite). Non-retryable errors propagate
 *  immediately.
 *
 *  The modelUsed field on the result reflects which tier actually
 *  ran, so api_usage logging and cost computation use the correct
 *  pricing for the fallback path. */
async function consumeStreamWithFallback(prompt: string, apiKey: string, maxOutputTokens: number) {
  try {
    return await consumeStream(GEMINI_CHAT_MODEL_T1, prompt, apiKey, maxOutputTokens);
  } catch (err) {
    if (!isRetryableUpstream(err)) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[notificationFetcher] tier-1 (${GEMINI_CHAT_MODEL_T1}) failed with retryable upstream error, falling back to ${GEMINI_CHAT_MODEL_T2}: ${msg.slice(0, 200)}`);
    return await consumeStream(GEMINI_CHAT_MODEL_T2, prompt, apiKey, maxOutputTokens);
  }
}

/** Strip markdown code fences or stray prose around a JSON object. */
function extractJsonObject(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export interface FetchResult {
  ok: boolean;
  inserted: number;
  pruned: number;
  /** Items the model emitted whose source_url failed the official-domain
   *  allowlist check, OR were missing a URL entirely. Surfaced so the
   *  manual script and admin logs can spot a model drifting toward
   *  third-party sources. */
  rejectedNonOfficial: number;
  /** URLs that were rejected (truncated to the first 5 for log brevity).
   *  Kept separate from `errors` so a typical "model proposed 1 taxguru
   *  link" run is still ok=true. */
  rejectedUrls: string[];
  /** Number of items whose long-form `full_detail` was successfully
   *  pre-generated and cached during this fetch. Click → detail
   *  becomes a DB read instead of a 10-20s grounded LLM call when
   *  this count matches `inserted`. */
  pregenerated: number;
  /** Items where pregeneration failed (network, no-official-sources,
   *  empty response). The notification still appears on the welcome
   *  screen; the next click falls back to live generation. */
  pregenerateFailed: number;
  /** Total Gemini cost for this fetch run including pregeneration. */
  inputTokens: number;
  outputTokens: number;
  cost: number;
  errors: string[];
}

/** One-shot daily fetcher. Direct CBDT API scrape → persists.
 *  Idempotent in the sense that calling it twice in a row simply produces
 *  two batches; the welcome screen only ever shows the latest.
 *
 *  As of 2026-05-30 the list step no longer calls Gemini — it pulls
 *  directly from incometaxindia.gov.in's Liferay search index. Gemini
 *  is still used for per-item full-detail generation (cached on
 *  insert), but only when an API key is configured. Missing key
 *  degrades gracefully: list still loads; details get generated
 *  lazily on first click. */
export async function fetchLatestNotifications(opts: { dryRun?: boolean; logUsage?: boolean; pregenerate?: boolean } = {}): Promise<FetchResult> {
  const errors: string[] = [];
  const rejectedUrls: string[] = [];
  const apiKey = pickApiKey();
  // No API-key gate up front — the scrape doesn't need it. Only
  // pregeneration does, and that path checks `apiKey` itself.

  const startedAt = Date.now();
  // Direct scrape — no Gemini list call. We hit two sources in
  // parallel: incometaxindia.gov.in's Liferay search (notifications,
  // circulars, press releases, miscellaneous) and gstcouncil.gov.in's
  // server-rendered what's-new table (GST newsletters, circulars,
  // appointments). Both produce verifiable PDF URLs. Cost: ZERO LLM
  // tokens for the list step. Pre-generation (per-item detail) still
  // uses Gemini.
  //
  // TRACES (TDS notifications at traces.tdscpc.gov.in) is a Flutter
  // app and not scrapeable without reverse-engineering Dart bundles.
  // CBDT covers most TDS-relevant items via §194-series notifications
  // and Circulars; the TRACES-specific items (CPC clarifications) are
  // a known gap.
  const [cbdtResult, gstResult] = await Promise.allSettled([
    fetchAllCbdtItems(40),
    fetchGstCouncilItems(),
  ]);
  let cbdtItems: CbdtItem[] = [];
  let gstItems: GstCouncilItem[] = [];
  if (cbdtResult.status === 'fulfilled') cbdtItems = cbdtResult.value;
  else errors.push(`CBDT scrape failed: ${cbdtResult.reason instanceof Error ? cbdtResult.reason.message : String(cbdtResult.reason)}`);
  if (gstResult.status === 'fulfilled') gstItems = gstResult.value;
  else errors.push(`GST Council scrape failed: ${gstResult.reason instanceof Error ? gstResult.reason.message : String(gstResult.reason)}`);
  const durationMs = Date.now() - startedAt;
  console.log(`[notificationFetcher] scraped ${cbdtItems.length} CBDT + ${gstItems.length} GST item(s) in ${durationMs}ms`);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  // Log the scrape under feature='notifications_fetch' for parity
  // with the previous Gemini-based pipeline — the admin dashboard
  // looks for this category. Zero tokens / zero cost (it's a direct
  // HTTP scrape now), but the row records the fact that a fetch ran.
  if (opts.logUsage !== false) {
    try {
      usageRepo.logWithBilling(
        '0.0.0.0', null, null, 0, 0, 0, false,
        'cbdt-scrape', false, 'notifications_fetch', cbdtItems.length,
        cbdtItems.length > 0 ? 'success' : 'failed', 0, durationMs,
      );
    } catch (e) {
      console.warn('[notificationFetcher] usage log failed:', e instanceof Error ? e.message : e);
    }
  }

  if (cbdtItems.length === 0 && gstItems.length === 0) {
    errors.push('Both CBDT and GST Council scrapes returned 0 items');
    return { ok: false, inserted: 0, pruned: 0, rejectedNonOfficial: 0, rejectedUrls, pregenerated: 0, pregenerateFailed: 0, inputTokens: 0, outputTokens: 0, cost: 0, errors };
  }

  // Map scraped items from both sources to the unified
  // TaxNotificationCreateInput shape. Skip items lacking a PDF URL
  // (they're not actionable for CAs who want to read the actual
  // notification).
  const items: TaxNotificationCreateInput[] = [];
  const rejectedNonOfficial = 0; // direct scrape — every URL is on a verified gov domain
  for (const it of cbdtItems) {
    if (!it.pdfUrl) continue;
    items.push({
      category: pickCbdtCategory(it),
      heading: trimHeading(it.title),
      summary: null,
      notificationDate: it.dateModified ? it.dateModified.slice(0, 10) : null,
      sourceUrl: it.pdfUrl,
    });
  }
  for (const it of gstItems) {
    if (!it.pdfUrl) continue;
    items.push({
      category: 'GST',
      heading: trimHeading(it.title),
      summary: null,
      notificationDate: it.dateModified || null,
      sourceUrl: it.pdfUrl,
    });
  }

  // ── Server-side validation layer (2, 3, 4 from the 2026-05-30 fix) ──
  //
  // The prompt asks the model to honour these rules, but production
  // output proves it ignores them sometimes — items dated 4+ months
  // ago slipped through, and Customs press batches clustered four
  // items on a single date. These are belt-and-suspenders filters
  // that enforce the same rules deterministically.
  //
  //   (a) 90-day window. Hard cutoff against `Date.now() − 90 days`
  //       in IST. Items with no parseable date are kept (rare; the
  //       UI shows "no date" gracefully).
  //   (b) Anti-clustering. Max 2 items per (category, date) tuple.
  //       Stops Customs-style 4-on-one-date padding.
  //   (c) URL HEAD-resolve check. Each source_url is fetched with
  //       method HEAD (cheap; no body downloaded). A non-2xx / 3xx
  //       response drops the item — catches the case where the model
  //       invented a plausible-shaped PDF path on an official host.
  //       Concurrency-capped at 6 to be polite to gov.in hosts.
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const cutoffMs = Date.now() - NINETY_DAYS_MS;
  const dateFiltered: TaxNotificationCreateInput[] = [];
  let droppedForAge = 0;
  for (const it of items) {
    if (it.notificationDate) {
      const t = Date.parse(it.notificationDate + 'T00:00:00+05:30');
      if (Number.isFinite(t) && t < cutoffMs) {
        droppedForAge += 1;
        continue;
      }
    }
    dateFiltered.push(it);
  }
  if (droppedForAge > 0) {
    console.warn(`[notificationFetcher] dropped ${droppedForAge} item(s) older than 90 days`);
  }

  // Anti-clustering: max 5 per (category, date) tuple. With the
  // direct-scrape source, same-day batches (e.g. 6 corrigenda issued
  // on the same date by CBDT) are legitimate, so the original cap of
  // 2 was over-restrictive. Bumping to 5 still kills the failure
  // mode the cap was added to defend against (Gemini-padded batches)
  // while preserving real-life issuance patterns.
  const clusterCounts = new Map<string, number>();
  const declustered: TaxNotificationCreateInput[] = [];
  let droppedForCluster = 0;
  for (const it of dateFiltered) {
    const key = `${it.category}|${it.notificationDate ?? '∅'}`;
    const n = clusterCounts.get(key) ?? 0;
    if (n >= 5) {
      droppedForCluster += 1;
      continue;
    }
    clusterCounts.set(key, n + 1);
    declustered.push(it);
  }
  if (droppedForCluster > 0) {
    console.warn(`[notificationFetcher] dropped ${droppedForCluster} item(s) for (category, date) clustering (max 5 per tuple)`);
  }

  // 2026-05-30: HEAD-check is now a no-op when the data source is the
  // direct CBDT scrape — URLs come from the official Liferay search
  // index, so they're as trustworthy as the listing pages themselves
  // and the HEAD check was only ever a defence against Gemini's
  // fabrication. We keep `urlHeadFilter` in the codebase for future
  // sources (GST, CBIC) that may still need verification, but bypass
  // it here.
  const droppedForBadUrl = 0;
  const finalItems = declustered;
  if (finalItems.length === 0) {
    errors.push(`Scraped ${cbdtItems.length} CBDT items but none survived validation (droppedForAge=${droppedForAge}, droppedForCluster=${droppedForCluster}, droppedForBadUrl=${droppedForBadUrl})`);
    return { ok: false, inserted: 0, pruned: 0, rejectedNonOfficial, rejectedUrls, pregenerated: 0, pregenerateFailed: 0, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost, errors };
  }
  items.length = 0;
  items.push(...finalItems);

  if (opts.dryRun) {
    console.log(`[notificationFetcher] DRY RUN — would insert ${items.length} items (${rejectedNonOfficial} rejected for non-official source):`);
    for (const it of items) {
      console.log(`  [${it.category}] ${it.heading} (${it.notificationDate ?? 'no date'}) ${it.sourceUrl ?? ''}`);
    }
    return { ok: true, inserted: 0, pruned: 0, rejectedNonOfficial, rejectedUrls, pregenerated: 0, pregenerateFailed: 0, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost, errors };
  }

  const { inserted } = notificationsRepo.replaceLatest(items);
  // Prune previous batches older than PRUNE_AGE_DAYS — keeps the table
  // bounded while leaving a few days of history for diagnostics. The
  // cutoff is built in the same IST shift used by replaceLatest so the
  // string comparison against fetched_at is apples-to-apples.
  const offsetMs = (5 * 60 + 30) * 60 * 1000;
  const cutoff = new Date(Date.now() + offsetMs - PRUNE_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const pruned = notificationsRepo.pruneOlderThan(cutoff);

  // Pre-generate `full_detail` for every freshly-inserted item so a
  // user click hits the cache and feels instant (a 10-20s grounded
  // LLM call would make the welcome screen feel broken). Concurrency
  // is bounded to keep us under Gemini's per-key rate limits — 2
  // simultaneous requests is well below the burst ceiling and an
  // 8-12 item batch finishes in ~30-60s wall time.
  let pregenerated = 0;
  let pregenerateFailed = 0;
  if (opts.pregenerate !== false) {
    // listLatest reads the new batch we just inserted (it's now the
    // MAX(fetched_at)), giving us the assigned ids.
    const insertedRows = notificationsRepo.listLatest(50);
    const pregenStarted = Date.now();
    const pregenResults = await pregenerateDetails(insertedRows, opts.logUsage !== false);
    pregenerated = pregenResults.ok;
    pregenerateFailed = pregenResults.failed;
    totalInputTokens += pregenResults.inputTokens;
    totalOutputTokens += pregenResults.outputTokens;
    totalCost += pregenResults.cost;
    console.log(`[notificationFetcher] pregeneration · ok=${pregenerated} failed=${pregenerateFailed} input=${pregenResults.inputTokens} output=${pregenResults.outputTokens} cost=$${pregenResults.cost.toFixed(5)} durationMs=${Date.now() - pregenStarted}`);
  }

  console.log(`[notificationFetcher] OK · inserted=${inserted} pruned=${pruned} source=cbdt-scrape pregenerated=${pregenerated}/${pregenerated + pregenerateFailed} totalInput=${totalInputTokens} totalOutput=${totalOutputTokens} totalCost=$${totalCost.toFixed(5)} durationMs=${durationMs}`);
  return { ok: true, inserted, pruned, rejectedNonOfficial, rejectedUrls, pregenerated, pregenerateFailed, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost, errors };
}

/** Walk a freshly-inserted batch of notifications and generate the
 *  long-form `full_detail` for each, so user clicks read from cache.
 *  Concurrency is bounded so we stay under Gemini's per-key burst
 *  ceiling — 2 simultaneous calls finishes a 12-item batch in ~30-60s.
 *  Failures (no official sources, network, empty response) are
 *  counted but don't fail the whole batch — the click flow falls
 *  back to live generation for those items. */
async function pregenerateDetails(
  rows: Array<{ id: string; heading: string; summary: string | null; source_url: string | null; full_detail: string | null }>,
  logUsage: boolean,
): Promise<{ ok: number; failed: number; inputTokens: number; outputTokens: number; cost: number }> {
  const CONCURRENCY = 2;
  let ok = 0;
  let failed = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;

  // Skip rows that already have a cached detail (idempotency — re-running
  // the script after a partial failure shouldn't re-pay for items that
  // already succeeded).
  const todo = rows.filter(r => !r.full_detail || r.full_detail.trim().length === 0);
  if (todo.length === 0) return { ok, failed, inputTokens, outputTokens, cost };

  let cursor = 0;
  const next = (): typeof todo[number] | null => (cursor < todo.length ? todo[cursor++] : null);

  const worker = async () => {
    while (true) {
      const r = next();
      if (!r) return;
      try {
        const res = await generateNotificationDetail(r.id, r.heading, r.summary, r.source_url, {
          // No actor — this is a system pregeneration step. Logging
          // path uses null user, matching how the daily fetch row is
          // attributed.
          actorUserId: undefined,
          billingUserId: undefined,
          ip: '0.0.0.0',
        }, { logUsage });
        if (res.ok) {
          ok += 1;
        } else {
          failed += 1;
          console.warn(`[notificationFetcher] pregenerate failed for "${r.heading.slice(0, 80)}": ${res.error ?? 'unknown'}`);
        }
        inputTokens += res.inputTokens;
        outputTokens += res.outputTokens;
        cost += res.cost;
      } catch (e) {
        failed += 1;
        console.warn(`[notificationFetcher] pregenerate threw for "${r.heading.slice(0, 80)}": ${e instanceof Error ? e.message : e}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, () => worker()));
  return { ok, failed, inputTokens, outputTokens, cost };
}

export interface DetailResult {
  ok: boolean;
  detail: string | null;
  cached: boolean;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  error?: string;
}

/** Generate (or read from cache) the long-form explanation for a single
 *  notification. Caller should pass the heading/summary/sourceUrl from
 *  the existing row so we don't re-query the DB inside this function. */
export async function generateNotificationDetail(
  id: string,
  heading: string,
  summary: string | null,
  sourceUrl: string | null,
  opts: { actorUserId?: string; billingUserId?: string; ip?: string } = {},
  /** When false, the api_usage row is NOT written. Used by the
   *  pregeneration path (the parent fetcher already accounts for the
   *  whole batch's tokens via its own log). Defaults to true so the
   *  user-facing click route keeps logging individually. */
  detailOpts: { logUsage?: boolean } = {},
): Promise<DetailResult> {
  const apiKey = pickApiKey();
  if (!apiKey) return { ok: false, detail: null, cached: false, inputTokens: 0, outputTokens: 0, cost: 0, error: 'No GEMINI_API_KEY configured' };

  // Tier-1 Gemini 3.1 Flash-Lite Preview with automatic tier-2
  // fallback to Gemini 2.5 Flash-Lite on retryable upstream errors.
  // The pregeneration loop in the daily refresh hits T1 for 10-20
  // items in quick succession; if T1 is in a "high demand" 503
  // window, fallback keeps the batch moving instead of failing every
  // item (which is what the log line that prompted this change
  // showed).
  const startedAt = Date.now();
  const prompt = DETAIL_PROMPT_TEMPLATE(heading, summary, sourceUrl);
  let result;
  try {
    result = await consumeStreamWithFallback(prompt, apiKey, 4096);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: null, cached: false, inputTokens: 0, outputTokens: 0, cost: 0, error: msg };
  }
  const model = result.modelUsed;
  const cost = costForModel(model, result.inputTokens, result.outputTokens);
  const durationMs = Date.now() - startedAt;

  // Filter Gemini's grounding sources to OFFICIAL government domains
  // only. Google Search may return a mix (the model's prompt asks for
  // gov-only, but the grounding pipeline doesn't enforce); we publish
  // only the official ones to the user.
  //
  // Fallback: when grounding returns zero official sources for an
  // obscure tariff / customs notification (which happens often
  // because third-party tax-news sites tend to outrank cbic.gov.in
  // PDFs in Google for those queries), we still anchor the cached
  // detail to the notification's OWN source_url. That URL was
  // already validated as official during the fetch step, so the
  // user always sees at least one verifiable government link in the
  // Sources block. The alternative — rejecting the detail entirely
  // — left the click flow falling back to live generation and
  // negated the entire point of pre-generation. The body of the
  // explanation is still grounded; we just guarantee the link.
  const officialSources = result.sources.filter(s => isOfficialSource(s.url));
  let detailText = result.text.trim();
  if (detailText.length === 0) {
    return { ok: false, detail: null, cached: false, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cost, error: `Empty response (finishReason=${result.finishReason})` };
  }
  // Build the Sources block. Prefer official grounding sources; if
  // none, fall back to the notification's own source_url. Always
  // ensures at least one link, never cites a third-party site.
  let sourcesForBlock: Array<{ title: string; url: string }> = officialSources.slice(0, 5);
  if (sourcesForBlock.length === 0) {
    if (sourceUrl && isOfficialSource(sourceUrl)) {
      console.warn(`[notificationFetcher] grounding returned 0 official sources for "${heading.slice(0, 80)}"; falling back to original source_url=${sourceUrl}`);
      sourcesForBlock = [{ title: heading, url: sourceUrl }];
    } else {
      console.warn(`[notificationFetcher] detail rejected — 0 official sources from grounding AND no usable source_url. id=${id} heading="${heading.slice(0, 80)}"`);
      return { ok: false, detail: null, cached: false, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cost, error: 'No official government source backed the explanation and no fallback URL available; refusing to cache' };
    }
  }
  const sourceLines = sourcesForBlock.map(s => `- [${s.title}](${s.url})`).join('\n');
  detailText += `\n\n**Sources**\n${sourceLines}`;

  notificationsRepo.setDetail(id, detailText);

  if (detailOpts.logUsage !== false) {
    try {
      usageRepo.logWithBilling(
        opts.ip ?? '0.0.0.0',
        opts.actorUserId ?? null,
        opts.billingUserId ?? null,
        result.inputTokens,
        result.outputTokens,
        cost,
        false,
        model,
        true,
        'notification_detail',
        1,
        'success',
        0,
        durationMs,
      );
    } catch (e) {
      console.warn('[notificationFetcher] detail usage log failed:', e instanceof Error ? e.message : e);
    }
  }

  return { ok: true, detail: detailText, cached: false, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cost };
}
