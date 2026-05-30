/**
 * Direct scraper for the GST Council "What's New" page.
 *
 * The page at https://gstcouncil.gov.in/what-s-new is a Drupal-rendered
 * HTML table — each row is a notification / newsletter / circular with
 * an anchor pointing to a PDF on `/sites/default/files/YYYY-MM/...`.
 * The year-month embedded in the file path is our canonical publication
 * date (the page itself doesn't render an explicit date column).
 *
 * This is the GST-side parallel to cbdtScraper.ts. Same contract:
 * structured items with title, dateModified (ISO YYYY-MM-01 derived from
 * the URL path), and an absolute pdfUrl pointing to the official source.
 */

const PAGE_URL = 'https://gstcouncil.gov.in/what-s-new';
const SITE_ORIGIN = 'https://gstcouncil.gov.in';

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html',
};
const REQUEST_TIMEOUT_MS = 20_000;

export interface GstCouncilItem {
  title: string;
  /** ISO YYYY-MM-DD. We approximate to YYYY-MM-01 because the file URL
   *  encodes year + month but not the day. The downstream 90-day
   *  filter is forgiving enough that this is fine. */
  dateModified: string;
  pdfUrl: string;
}

/**
 * Fetch and parse the GST Council what's-new page. Returns items
 * ordered as they appear on the page (which the site sorts by
 * publication date desc).
 */
export async function fetchGstCouncilItems(): Promise<GstCouncilItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(PAGE_URL, {
      method: 'GET',
      headers: REQUEST_HEADERS,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`GST Council page returned ${res.status}`);
  }
  const html = await res.text();
  return parseGstCouncilHtml(html);
}

/**
 * Extract items from the Drupal views-table HTML. The page wraps each
 * row in `<tr>`...`</tr>` with two `<td>` cells: a counter and the
 * title (an anchor). We pull anchor text + href, then derive the date
 * from the file path's YYYY-MM prefix. Items whose href doesn't
 * resemble a file URL are dropped (page navigation, etc.).
 */
export function parseGstCouncilHtml(html: string): GstCouncilItem[] {
  const items: GstCouncilItem[] = [];
  // Each views-row contains an anchor with href and title text.
  // We grep all matching anchors inside the "views-field-title" cell.
  const cellPattern = /views-field-title[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = cellPattern.exec(html)) !== null) {
    const href = m[1].trim();
    let title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!href || !title) continue;
    const pdfUrl = href.startsWith('http') ? href : `${SITE_ORIGIN}${href}`;
    // Derive date from `/sites/default/files/YYYY-MM/...`. Items
    // without this shape (rare — usually external links) get a null
    // date and the downstream filter will drop them if they fall
    // outside the 90-day window.
    const dateMatch = /\/files\/(\d{4})-(\d{2})\//.exec(href);
    const dateModified = dateMatch
      ? `${dateMatch[1]}-${dateMatch[2]}-01`
      : '';
    items.push({ title, dateModified, pdfUrl });
  }
  return items;
}
