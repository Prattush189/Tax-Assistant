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

WHAT QUALIFIES (include):
  - Numbered Notifications (e.g. "Notification No. 12/2026-Central Tax")
  - Numbered Circulars (e.g. "Circular No. 234/26/2026-GST")
  - Instructions, Order, Office Memorandum issued by CBDT/CBIC
  - GST Council resolution or circular
  - Income Tax Department notifications under §139, §194-series, §195, §44AB rules etc.
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

ABSOLUTE RULES:
- Every source_url MUST be on a government domain. The server rejects items whose URL is not on the allowlist; a non-official URL means one fewer notification reaches the user.
- TDS items can be CBDT rate-change circulars, §194-series threshold revisions, or Finance-Act-implementing notifications. These DO exist almost every month.
- Do NOT invent URLs. If grounding can't surface the listing-page or PDF URL, omit that item — but then keep searching for more.
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

/** One-shot daily fetcher. Runs grounded Gemini call → parses → persists.
 *  Idempotent in the sense that calling it twice in a row simply produces
 *  two batches; the welcome screen only ever shows the latest. */
export async function fetchLatestNotifications(opts: { dryRun?: boolean; logUsage?: boolean; pregenerate?: boolean } = {}): Promise<FetchResult> {
  const errors: string[] = [];
  const rejectedUrls: string[] = [];
  const apiKey = pickApiKey();
  if (!apiKey) {
    errors.push('No GEMINI_API_KEY configured');
    return { ok: false, inserted: 0, pruned: 0, rejectedNonOfficial: 0, rejectedUrls, pregenerated: 0, pregenerateFailed: 0, inputTokens: 0, outputTokens: 0, cost: 0, errors };
  }

  // Primary: Gemini 3.x family (T1) — the user explicitly asked for
  // "Gemini 3 Flash" and the 3.x family produces better-grounded
  // summaries on the news-search workload from spot checks. Tier-2
  // fallback (Gemini 2.5 Flash-Lite) fires automatically on 429 /
  // 5xx upstream errors (gemini-3.1-flash-lite-preview occasionally
  // 503s with "This model is currently experiencing high demand" —
  // the case that triggered adding fallback here).
  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof consumeStreamWithFallback>>;
  try {
    result = await consumeStreamWithFallback(FETCH_PROMPT, apiKey, 8192);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Gemini call failed (both tiers): ${msg}`);
    return { ok: false, inserted: 0, pruned: 0, rejectedNonOfficial: 0, rejectedUrls, pregenerated: 0, pregenerateFailed: 0, inputTokens: 0, outputTokens: 0, cost: 0, errors };
  }
  const model = result.modelUsed;
  const durationMs = Date.now() - startedAt;
  const fetchCost = costForModel(model, result.inputTokens, result.outputTokens);
  // Token + cost totals will accumulate the pregeneration step too;
  // start from the fetch-call values and add to them as detail
  // generations complete so the script's reported total reflects the
  // entire run.
  let totalInputTokens = result.inputTokens;
  let totalOutputTokens = result.outputTokens;
  let totalCost = fetchCost;

  // Log to api_usage so the admin dashboard's recent-API-calls table picks
  // it up. user_id and billing_user_id are 'system' since the daily fetch
  // is not attributable to any human user — the admin dashboard's IP
  // grouping treats 'system' rows as a separate row labelled "system job".
  if (opts.logUsage !== false) {
    try {
      usageRepo.logWithBilling(
        '0.0.0.0',
        null,
        null,
        result.inputTokens,
        result.outputTokens,
        fetchCost,
        false,
        model,
        true,
        'notifications_fetch',
        1,
        result.text.trim().length > 0 ? 'success' : 'failed',
        0,
        durationMs,
      );
    } catch (e) {
      console.warn('[notificationFetcher] usage log failed:', e instanceof Error ? e.message : e);
    }
  }

  const json = extractJsonObject(result.text);
  if (!json) {
    errors.push(`Gemini returned no parseable JSON. finishReason=${result.finishReason ?? 'unknown'}, length=${result.text.length}, head="${result.text.slice(0, 200).replace(/\s+/g, ' ')}"`);
    return { ok: false, inserted: 0, pruned: 0, rejectedNonOfficial: 0, rejectedUrls, pregenerated: 0, pregenerateFailed: 0, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost, errors };
  }
  let parsed: { items?: RawNotification[] };
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    errors.push(`JSON.parse failed: ${e instanceof Error ? e.message : e}`);
    return { ok: false, inserted: 0, pruned: 0, rejectedNonOfficial: 0, rejectedUrls, pregenerated: 0, pregenerateFailed: 0, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost, errors };
  }
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    errors.push(`Empty items array in response (text head="${result.text.slice(0, 160)}")`);
    return { ok: false, inserted: 0, pruned: 0, rejectedNonOfficial: 0, rejectedUrls, pregenerated: 0, pregenerateFailed: 0, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost, errors };
  }

  // Validate each item before insertion. The user explicitly required
  // every notification to be sourced from an official Indian government
  // website, so an item without an official source_url is dropped
  // entirely — we do NOT show items with a null source on the welcome
  // screen since they can't be verified by the practitioner.
  const items: TaxNotificationCreateInput[] = [];
  let rejectedNonOfficial = 0;
  for (const it of parsed.items) {
    if (!it || typeof it.heading !== 'string' || !it.heading.trim()) continue;
    const rawUrl = typeof it.source_url === 'string' ? it.source_url.trim() : '';
    if (!rawUrl || !isOfficialSource(rawUrl)) {
      rejectedNonOfficial += 1;
      if (rejectedUrls.length < 5 && rawUrl) rejectedUrls.push(rawUrl);
      continue;
    }
    items.push({
      category: pickCategory(it.category),
      heading: it.heading.trim(),
      summary: typeof it.summary === 'string' && it.summary.trim() ? it.summary.trim() : null,
      notificationDate: isIsoDate(it.notification_date) ? it.notification_date!.trim() : null,
      sourceUrl: rawUrl,
    });
  }
  if (rejectedNonOfficial > 0) {
    console.warn(`[notificationFetcher] dropped ${rejectedNonOfficial} item(s) with non-official source URLs: ${rejectedUrls.join(', ')}${rejectedNonOfficial > rejectedUrls.length ? ', …' : ''}`);
  }
  if (items.length === 0) {
    errors.push(`Parsed ${parsed.items.length} items but none had a usable heading + official source URL (${rejectedNonOfficial} rejected for non-official source)`);
    return { ok: false, inserted: 0, pruned: 0, rejectedNonOfficial, rejectedUrls, pregenerated: 0, pregenerateFailed: 0, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost, errors };
  }

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

  console.log(`[notificationFetcher] OK · inserted=${inserted} pruned=${pruned} rejectedNonOfficial=${rejectedNonOfficial} pregenerated=${pregenerated}/${pregenerated + pregenerateFailed} model=${model} totalInput=${totalInputTokens} totalOutput=${totalOutputTokens} totalCost=$${totalCost.toFixed(5)} durationMs=${durationMs}`);
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
