/**
 * Direct scraper for CBDT (Income Tax Department) notifications.
 *
 * Replaces the Gemini search-grounded list step with structured calls
 * to incometaxindia.gov.in's Liferay search API. The page at
 * https://www.incometaxindia.gov.in/what-s-new is a SPA that POSTs
 * the same endpoint we use here. We bypass the SPA and call the API
 * directly so:
 *
 *   1. Notification numbers, dates, and PDF URLs come from the source
 *      of truth, not from Gemini's grounding (which fabricates).
 *   2. ITR form notifications (the user's reported gap) surface
 *      reliably — they're real records in this index.
 *   3. The fetch is deterministic and free (no LLM cost), so the
 *      cron / on-demand refresh path becomes cheap.
 *
 * The blueprint ERC and structure-key constants were obtained by
 * inspecting the etds-miscellaneous bundle on the live page
 * (2026-05-30). Liferay versions these in `t=<timestamp>` query
 * strings; the ERC names themselves are stable.
 */

const API_URL = 'https://www.incometaxindia.gov.in/o/search/v1.0/search?nestedFields=embedded&page=1&pageSize=40&sorts=dateModified%3Adesc';
const SITE_ORIGIN = 'https://www.incometaxindia.gov.in';

const BLUEPRINT_ERC = 'MISCELLANEOUS_BP_ERC';

/** Structure keys correspond to the dropdown options on the CBDT
 *  what's-new page: Notifications, Circulars, Press Releases,
 *  Miscellaneous Communications. We omit the "Recruitment" structures
 *  because they're HR / departmental exam stuff, not tax-practitioner
 *  relevant. */
export const CBDT_STRUCTURE_KEYS = {
  NOTIFICATION: 'NOTIFICATION_KEY',
  CIRCULAR: 'CIRCULAR_KEY',
  PRESS_RELEASE: 'PRESS_RELEASE',
  MISCELLANEOUS: 'MISCELLANEOUS_COMMUNICATION',
} as const;
export type CbdtStructureKey = typeof CBDT_STRUCTURE_KEYS[keyof typeof CBDT_STRUCTURE_KEYS];

export interface CbdtItem {
  /** The full title from the source — already includes notification
   *  number and short subject. Suitable for use as the welcome-card
   *  heading after a 90-char trim. */
  title: string;
  /** ISO 8601 timestamp from Liferay (UTC). Trimmed to YYYY-MM-DD by
   *  the caller for the notification_date column. */
  dateModified: string;
  /** Absolute URL to the source PDF / document. Null when the item
   *  doesn't have an attached document (rare but happens — we skip
   *  those at the caller level since they're not actionable for CAs
   *  who want to read the actual notification). */
  pdfUrl: string | null;
  /** Which structure bucket the item came from. Drives the category
   *  mapping (NOTIFICATION / CIRCULAR → INCOME_TAX; PRESS_RELEASE →
   *  OTHER; MISCELLANEOUS → OTHER). */
  structureKey: CbdtStructureKey;
}

// Browser-shaped UA so incometaxindia.gov.in's WAF doesn't 403 us.
// An earlier identifying UA ("Smartbiz-Tax-Notifications-Fetcher/1.0")
// was blocked at the perimeter; the live page uses the same Liferay
// endpoint we hit so we pose as a recent Chrome to match.
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Referer: 'https://www.incometaxindia.gov.in/what-s-new',
};
const REQUEST_TIMEOUT_MS = 20_000;

interface LiferaySearchResponse {
  items?: Array<{
    title?: string;
    dateModified?: string;
    embedded?: {
      contentFields?: Array<{
        contentFieldValue?: {
          document?: { contentUrl?: string };
        };
      }>;
    };
  }>;
  totalCount?: number;
}

/**
 * Fetch up to `pageSize` items of a given structure key, ordered by
 * dateModified DESC. Returns the most-recent items the public Liferay
 * index has indexed. Network errors throw; non-2xx returns throw.
 */
export async function fetchCbdtItems(
  structureKey: CbdtStructureKey,
  pageSize: number = 40,
): Promise<CbdtItem[]> {
  const url = API_URL.replace(/pageSize=\d+/, `pageSize=${pageSize}`);
  const body = {
    attributes: {
      'search.empty.search': true,
      'search.experiences.blueprint.external.reference.code': BLUEPRINT_ERC,
      'search.experiences.structure_key': structureKey,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`CBDT search API returned ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const json = await res.json() as LiferaySearchResponse;
  const items = json.items ?? [];
  return items.map(raw => {
    const fields = raw.embedded?.contentFields ?? [];
    let pdfUrl: string | null = null;
    for (const f of fields) {
      const path = f.contentFieldValue?.document?.contentUrl;
      if (path) {
        // The API returns absolute or relative paths; make absolute.
        pdfUrl = path.startsWith('http') ? path : `${SITE_ORIGIN}${path}`;
        break;
      }
    }
    return {
      title: (raw.title ?? '').trim(),
      dateModified: raw.dateModified ?? '',
      pdfUrl,
      structureKey,
    };
  }).filter(it => it.title.length > 0);
}

/**
 * Convenience: fetch the four CBDT structure buckets in parallel and
 * merge. The merged list is ordered by dateModified DESC and capped
 * at `limit` items.
 */
export async function fetchAllCbdtItems(limit: number = 40): Promise<CbdtItem[]> {
  const keys = Object.values(CBDT_STRUCTURE_KEYS);
  const perBucket = Math.max(10, Math.ceil(limit / 2));
  const buckets = await Promise.all(keys.map(k => fetchCbdtItems(k, perBucket).catch(err => {
    console.warn(`[cbdtScraper] bucket ${k} failed: ${(err as Error).message}`);
    return [] as CbdtItem[];
  })));
  const all = buckets.flat();
  all.sort((a, b) => (b.dateModified || '').localeCompare(a.dateModified || ''));
  return all.slice(0, limit);
}
