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
import { GEMINI_API_KEYS, GEMINI_CHAT_MODEL_T1, costForModel } from './gemini.js';
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

Your job: produce a JSON list of the LATEST notifications, circulars, and instructions issued by Indian tax authorities. Use Google Search.

HARD CONSTRAINT — OFFICIAL SOURCES ONLY.

Every source_url MUST point to a page or PDF hosted on one of these government domains (or a subdomain thereof):
  - cbic-gst.gov.in            (CBIC GST notifications)
  - cbic.gov.in                (CBIC Customs / Central Excise)
  - taxinformation.cbic.gov.in (CBIC tax information portal)
  - incometax.gov.in           (Income Tax e-filing portal)
  - incometaxindia.gov.in      (Income Tax Department portal — notifications, circulars)
  - cbdt.gov.in                (CBDT, where active)
  - egazette.nic.in            (Gazette of India — final-source)
  - gst.gov.in / gstcouncil.gov.in
  - finmin.nic.in / dor.gov.in (Ministry of Finance / Dept of Revenue)
  - pib.gov.in                 (Press Information Bureau, official press notes)
  - any *.gov.in or *.nic.in (state-level GST departments etc.)

If you cannot find an OFFICIAL source URL for a notification, OMIT THE ITEM ENTIRELY.

DO NOT include items whose source_url points to:
  - third-party tax-news sites (taxguru.in, taxscan.in, taxmann.com, cleartax.in, livemint.com, economictimes, business-standard, moneycontrol, etc.)
  - law-firm blogs, consulting firms, social media (LinkedIn, Twitter), Substack, Medium, news aggregators
  - PDF mirrors hosted by anyone other than the authority that issued the notification

A third-party article MAY tip you off to a recent notification — but the source_url you write must be the authority's own URL, not the article's.

DATE WINDOW. Pull only notifications dated within the LAST 60 DAYS. Skip anything older.

CONTENT FILTER. Skip:
  - GST monthly collection-figure press releases
  - Budget-day commentary / explanatory memos
  - Anything that's a press release without a corresponding numbered notification or circular

For each item, return:
  - category: one of "GST" | "TDS" | "INCOME_TAX" | "OTHER"
  - heading: ≤ 90 chars, includes the notification number (e.g. "GST Notification 12/2025-CT — RCM extended to metal scrap")
  - summary: 1-2 sentences (≤ 250 chars) on what changed and who it affects
  - notification_date: YYYY-MM-DD of the notification's stamped date (NOT today's date)
  - source_url: the direct URL to the official notification PDF or notice page on one of the domains above

OUTPUT FORMAT — STRICT JSON, no markdown fences, no prose:
{
  "items": [
    { "category": "...", "heading": "...", "summary": "...", "notification_date": "YYYY-MM-DD", "source_url": "https://..." }
  ]
}

ABSOLUTE RULES:
- Every source_url MUST be on the allowlist above. The server rejects any item whose URL is not on that list — wasting a slot on a non-official URL means one fewer notification reaches the user.
- Aim for 8-12 items total, with a healthy mix across categories — at least 2 GST, 2 TDS-related, 2 Income Tax. Fewer is fine if recent items genuinely don't exist in a category.
- TDS items can be CBDT TDS-rate-change circulars, §194-series threshold revisions, or Finance-Act-implementing notifications.
- Do NOT invent URLs. Verifiable on the official site or omit the item.
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
  return { text: buffer, inputTokens, outputTokens, sources, finishReason };
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
  inputTokens: number;
  outputTokens: number;
  cost: number;
  errors: string[];
}

/** One-shot daily fetcher. Runs grounded Gemini call → parses → persists.
 *  Idempotent in the sense that calling it twice in a row simply produces
 *  two batches; the welcome screen only ever shows the latest. */
export async function fetchLatestNotifications(opts: { dryRun?: boolean; logUsage?: boolean } = {}): Promise<FetchResult> {
  const errors: string[] = [];
  const rejectedUrls: string[] = [];
  const apiKey = pickApiKey();
  if (!apiKey) {
    errors.push('No GEMINI_API_KEY configured');
    return { ok: false, inserted: 0, pruned: 0, rejectedNonOfficial: 0, rejectedUrls, inputTokens: 0, outputTokens: 0, cost: 0, errors };
  }

  // Use the Gemini 3.x family model (T1) — the user explicitly asked for
  // "Gemini 3 Flash". The closest available model in the line-up is
  // gemini-3.1-flash-lite-preview; T2 (2.5-flash-lite) would also work
  // but the 3.x family generates better-grounded summaries on the news
  // search workload from spot checks.
  const model = GEMINI_CHAT_MODEL_T1;
  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof consumeStream>>;
  try {
    result = await consumeStream(model, FETCH_PROMPT, apiKey, 8192);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Gemini call failed: ${msg}`);
    return { ok: false, inserted: 0, pruned: 0, rejectedNonOfficial: 0, rejectedUrls, inputTokens: 0, outputTokens: 0, cost: 0, errors };
  }
  const durationMs = Date.now() - startedAt;
  const cost = costForModel(model, result.inputTokens, result.outputTokens);

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
        cost,
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
    return { ok: false, inserted: 0, pruned: 0, rejectedNonOfficial: 0, rejectedUrls, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cost, errors };
  }
  let parsed: { items?: RawNotification[] };
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    errors.push(`JSON.parse failed: ${e instanceof Error ? e.message : e}`);
    return { ok: false, inserted: 0, pruned: 0, rejectedNonOfficial: 0, rejectedUrls, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cost, errors };
  }
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    errors.push(`Empty items array in response (text head="${result.text.slice(0, 160)}")`);
    return { ok: false, inserted: 0, pruned: 0, rejectedNonOfficial: 0, rejectedUrls, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cost, errors };
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
    return { ok: false, inserted: 0, pruned: 0, rejectedNonOfficial, rejectedUrls, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cost, errors };
  }

  if (opts.dryRun) {
    console.log(`[notificationFetcher] DRY RUN — would insert ${items.length} items (${rejectedNonOfficial} rejected for non-official source):`);
    for (const it of items) {
      console.log(`  [${it.category}] ${it.heading} (${it.notificationDate ?? 'no date'}) ${it.sourceUrl ?? ''}`);
    }
    return { ok: true, inserted: 0, pruned: 0, rejectedNonOfficial, rejectedUrls, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cost, errors };
  }

  const { inserted } = notificationsRepo.replaceLatest(items);
  // Prune previous batches older than PRUNE_AGE_DAYS — keeps the table
  // bounded while leaving a few days of history for diagnostics. The
  // cutoff is built in the same IST shift used by replaceLatest so the
  // string comparison against fetched_at is apples-to-apples.
  const offsetMs = (5 * 60 + 30) * 60 * 1000;
  const cutoff = new Date(Date.now() + offsetMs - PRUNE_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const pruned = notificationsRepo.pruneOlderThan(cutoff);

  console.log(`[notificationFetcher] OK · inserted=${inserted} pruned=${pruned} rejectedNonOfficial=${rejectedNonOfficial} model=${model} input=${result.inputTokens} output=${result.outputTokens} cost=$${cost.toFixed(5)} durationMs=${durationMs}`);
  return { ok: true, inserted, pruned, rejectedNonOfficial, rejectedUrls, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cost, errors };
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
): Promise<DetailResult> {
  const apiKey = pickApiKey();
  if (!apiKey) return { ok: false, detail: null, cached: false, inputTokens: 0, outputTokens: 0, cost: 0, error: 'No GEMINI_API_KEY configured' };

  const model = GEMINI_CHAT_MODEL_T1;
  const startedAt = Date.now();
  const prompt = DETAIL_PROMPT_TEMPLATE(heading, summary, sourceUrl);
  let result;
  try {
    result = await consumeStream(model, prompt, apiKey, 4096);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: null, cached: false, inputTokens: 0, outputTokens: 0, cost: 0, error: msg };
  }
  const cost = costForModel(model, result.inputTokens, result.outputTokens);
  const durationMs = Date.now() - startedAt;

  // Append a Sources block so the user can verify against the real PDFs.
  let detailText = result.text.trim();
  if (result.sources.length > 0) {
    const sourceLines = result.sources.slice(0, 5).map(s => `- [${s.title}](${s.url})`).join('\n');
    detailText += `\n\n**Sources**\n${sourceLines}`;
  }

  if (detailText.length === 0) {
    return { ok: false, detail: null, cached: false, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cost, error: `Empty response (finishReason=${result.finishReason})` };
  }

  notificationsRepo.setDetail(id, detailText);

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

  return { ok: true, detail: detailText, cached: false, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cost };
}
