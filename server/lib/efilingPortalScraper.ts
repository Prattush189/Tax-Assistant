/**
 * Direct scraper for the e-Filing Portal "Latest News" page.
 *
 * The page at https://www.incometax.gov.in/iec/foportal/latest-news is
 * a Drupal-rendered server-side HTML view. The Latest News items
 * appear as `<div class="views-row">` blocks with a `<div class="up-date">`
 * holding the date and a `<p>` holding the description + (optional)
 * "Click here" anchor with the source URL.
 *
 * This is the THIRD source on top of CBDT what's-new and GST Council
 * what's-new. It carries ITR utility releases ("Online filing of
 * ITR-2 is enabled", "Offline Utility for ITR-2 available"), AIS /
 * Form 26AS clarifications, and other e-filing-portal-specific
 * announcements that CBDT's notification stream doesn't capture.
 *
 * Without this source, the welcome list misses every "your ITR-2
 * utility is live" type item, which is what the user expects to see
 * during ITR season.
 */

const PAGE_URL = 'https://www.incometax.gov.in/iec/foportal/latest-news';
const FALLBACK_SOURCE_URL = 'https://www.incometax.gov.in/iec/foportal/latest-news';

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html',
  'Accept-Language': 'en-IN,en;q=0.9',
};
const REQUEST_TIMEOUT_MS = 20_000;

export interface EfilingItem {
  /** Description text from the row's `<p>` element. Tags stripped. */
  title: string;
  /** ISO YYYY-MM-DD parsed from the "DD-MMM-YYYY" up-date string. */
  dateModified: string;
  /** Source URL — the anchor href in the row when present, otherwise
   *  the page URL itself. */
  url: string;
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Parse "29-May-2026" → "2026-05-29". Returns empty string on
 *  unrecognised input so downstream filters drop the item. */
function parseEfilingDate(s: string): string {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(s.trim());
  if (!m) return '';
  const mm = MONTH_MAP[m[2].toLowerCase()];
  if (!mm) return '';
  return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
}

/** Strip HTML tags and decode the handful of entities that appear in
 *  the e-filing portal markup (&nbsp;, &amp;, &quot;, &#39;). */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const MAX_ATTEMPTS = 3;

async function fetchEfilingHtmlOnce(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(PAGE_URL, {
      method: 'GET',
      headers: REQUEST_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`e-Filing portal returned ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and parse. Returns items in the order they appear on the page
 * (the site sorts by publication date DESC; we don't re-sort).
 *
 * The portal 503s / times out intermittently (it sits behind a WAF that
 * rate-limits and occasionally sheds load). A single failure used to
 * drop the WHOLE e-Filing source for that run — and because the feed is
 * rebuilt with replaceLatest, the ITR-utility releases (which ONLY come
 * from here) vanished until the next good run. So retry transient
 * failures (5xx / 429 / network / timeout) a few times with backoff
 * before giving up; a 4xx is not retried (it won't recover).
 */
export async function fetchEfilingItems(): Promise<EfilingItem[]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return parseEfilingHtml(await fetchEfilingHtmlOnce());
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      const retryable = status === undefined || status >= 500 || status === 429; // undefined = network/abort/timeout
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const backoffMs = 1500 * attempt; // 1.5s, 3s
      console.warn(`[efilingPortalScraper] attempt ${attempt}/${MAX_ATTEMPTS} failed (${(err as Error).message}) — retrying in ${backoffMs}ms`);
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

/**
 * Extract Latest-News rows from the Drupal views markup. Each row
 * follows the pattern:
 *
 *   <div class="views-row">
 *     ... <div class="up-date">DD-MMM-YYYY</div> ...
 *     ... <p>Description text [<a href="URL">link</a>]</p> ...
 *   </div>
 *
 * We match the `views-row` block, then within it pull the up-date
 * value, the `<p>` content, and the first anchor href.
 */
export function parseEfilingHtml(html: string): EfilingItem[] {
  const items: EfilingItem[] = [];
  const rowPattern = /<div class="views-row">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  // The outer regex isn't perfectly nested (Drupal output has varying
  // closing tag depths), so we use a tolerant inner-field extractor
  // that doesn't depend on exact row boundaries: pair up each up-date
  // with the next <p> that follows it.
  const upDatePattern = /<div class="up-date">\s*([^<]+)<\/div>([\s\S]{0,1200}?)<p>([\s\S]*?)<\/p>/gi;
  // Suppress unused warning for rowPattern — it's documentary for
  // future maintainers who want to understand the source layout.
  void rowPattern;
  let m: RegExpExecArray | null;
  while ((m = upDatePattern.exec(html)) !== null) {
    const dateRaw = m[1];
    const pInner = m[3];
    const dateModified = parseEfilingDate(dateRaw);
    if (!dateModified) continue;
    // Pull the first anchor href as the source link, if any.
    const hrefMatch = /<a[^>]+href=["']([^"']+)["']/i.exec(pInner);
    const rawHref = hrefMatch ? hrefMatch[1].trim() : '';
    const url = rawHref
      ? (rawHref.startsWith('http') ? rawHref : `https://www.incometax.gov.in${rawHref.startsWith('/') ? '' : '/'}${rawHref}`)
      : FALLBACK_SOURCE_URL;
    // Strip the "Click here" anchor text from the description so the
    // welcome card heading doesn't end in "... Click here".
    const description = stripHtml(
      pInner.replace(/<a[^>]+>[\s\S]*?<\/a>/gi, '').replace(/&nbsp;/g, ' '),
    );
    if (!description) continue;
    items.push({ title: description, dateModified, url });
  }
  return items;
}
