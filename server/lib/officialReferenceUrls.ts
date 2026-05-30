/**
 * Canonical official-source URLs the AI features should defer to.
 *
 * Centralised here so every feature (chat, notice drafter, ledger
 * scrutiny, CMA narrative, etc.) refers to the same authoritative
 * pages instead of each prompt inlining its own list. When a URL
 * changes (e.g. CBDT migrates a listing-page path again, like the
 * 2026-05-30 incometaxindia.gov.in/Pages/communications/* breakage),
 * we update it here once and every consumer picks it up.
 *
 * Two main exports:
 *   - OFFICIAL_REFERENCE_URLS — typed map of named references
 *   - referenceUrlsBlock()    — pre-formatted multi-line block to
 *     drop into a system prompt. Returns a stable string each call
 *     so it cache-keys consistently with Gemini cached content.
 */

export interface ReferenceUrl {
  /** Stable identifier used by feature-specific filters when they
   *  only want a subset (e.g. notice drafting cares about Acts and
   *  case law; ledger scrutiny cares about rate charts). */
  key: string;
  /** Short label included in the rendered reference block. */
  label: string;
  /** Authoritative URL on a gov.in / nic.in domain. */
  url: string;
  /** One-line description of what the URL covers, included in the
   *  prompt so the model knows when to defer to it. */
  description: string;
  /** Feature tags — used by feature-specific helpers to filter
   *  the reference block (e.g. exclude TDS rate charts from a CMA
   *  narrative prompt where they're irrelevant). */
  tags: ReadonlyArray<'chat' | 'notice' | 'ledger' | 'tds' | 'gst' | 'income_tax' | 'cma'>;
}

/**
 * The canonical reference list. Order matters — items at the top
 * appear first in the rendered block so the model sees the most-
 * important sources first.
 */
export const OFFICIAL_REFERENCE_URLS: ReadonlyArray<ReferenceUrl> = [
  // ── Income Tax — primary sources ──────────────────────────────
  {
    key: 'incometaxindia_whats_new',
    label: 'CBDT What\'s New (Notifications + Circulars + Press Releases)',
    url: 'https://www.incometaxindia.gov.in/what-s-new',
    description: 'Latest CBDT notifications, circulars, press releases, and miscellaneous communications. Use for current notification-number lookups.',
    tags: ['chat', 'notice', 'income_tax'],
  },
  {
    key: 'incometax_efiling_latest_news',
    label: 'e-Filing Portal Latest News',
    url: 'https://www.incometax.gov.in/iec/foportal/latest-news',
    description: 'CBDT e-filing portal latest news — ITR utility releases, return-filing utilities, AY-specific announcements.',
    tags: ['chat', 'notice', 'income_tax'],
  },
  {
    key: 'incometax_act_2025',
    label: 'Income Tax Act, 1961 / 2025 (recodification)',
    url: 'https://www.incometaxindia.gov.in/Pages/acts/income-tax-act.aspx',
    description: 'Bare Act text. Use to verify section numbers, sub-sections, and statutory quotations.',
    tags: ['chat', 'notice', 'income_tax'],
  },

  // ── TDS — TRACES references (used as AI references rather than
  //    scraped; the TRACES Flutter app is not list-scrapeable but
  //    the rate-chart and form pages have stable URLs) ───────────
  {
    key: 'traces_rate_charts',
    label: 'TRACES Rate Charts',
    url: 'https://traces.tdscpc.gov.in/thingsToKnow/ratecharts',
    description: 'Authoritative TDS / TCS rate charts maintained by CPC-TDS. Use to verify §194-series rates, threshold limits, and applicability windows BEFORE quoting any TDS rate in a reply or analysis.',
    tags: ['chat', 'notice', 'ledger', 'tds'],
  },
  {
    key: 'traces_forms',
    label: 'TRACES Forms',
    url: 'https://traces.tdscpc.gov.in/thingsToKnow/forms',
    description: 'Official TDS / TCS forms (Form 16, 16A, 26AS, 27D, 27EQ, 24Q, 26Q, etc.). Use as the source of truth for form names, format references, and applicability.',
    tags: ['chat', 'notice', 'ledger', 'tds'],
  },
  {
    key: 'traces_notifications',
    label: 'TRACES Notifications (CPC-TDS)',
    url: 'https://traces.tdscpc.gov.in/thingsToKnow/notifications',
    description: 'CPC-TDS notifications and procedural advisories. Used in addition to CBDT for TDS-specific compliance updates.',
    tags: ['chat', 'notice', 'tds'],
  },

  // ── GST ─────────────────────────────────────────────────────────
  {
    key: 'gst_council_whats_new',
    label: 'GST Council What\'s New',
    url: 'https://gstcouncil.gov.in/what-s-new',
    description: 'GST Council meeting recommendations, newsletters, and circulars. Use for GST policy and Council-level decisions.',
    tags: ['chat', 'notice', 'gst'],
  },
  {
    key: 'cbic_gst_notifications',
    label: 'CBIC GST Notifications (CGST / IGST / Rate)',
    url: 'https://cbic-gst.gov.in/',
    description: 'CBIC-issued GST notifications, rate-change notifications, and circulars. Primary source for notification numbers in the CGST / IGST series.',
    tags: ['chat', 'notice', 'gst'],
  },
  {
    key: 'gst_portal',
    label: 'GST Portal (Taxpayer Login + Returns)',
    url: 'https://www.gst.gov.in/',
    description: 'Official taxpayer-facing GST portal. Use for GSTR form references, return-filing utility links, and HSN code lookups.',
    tags: ['chat', 'gst'],
  },
];

/**
 * Render the reference URLs as a system-prompt block. Optionally
 * filter to a feature's tag set so irrelevant references don't bloat
 * the prompt.
 *
 * Output shape:
 *
 *   AUTHORITATIVE REFERENCES.
 *   Defer to these official sources when verifying any specific
 *   reference (section number, notification, rate, form, etc.):
 *     - <label> (<url>) — <description>
 *     - ...
 *
 * The block is intentionally short and instruction-shaped so the
 * model treats it as guidance, not data to repeat.
 */
export function referenceUrlsBlock(filterTag?: ReferenceUrl['tags'][number]): string {
  const entries = filterTag
    ? OFFICIAL_REFERENCE_URLS.filter(r => r.tags.includes(filterTag))
    : OFFICIAL_REFERENCE_URLS;
  if (entries.length === 0) return '';
  const lines = entries.map(r => `  - ${r.label} (${r.url}) — ${r.description}`);
  return `AUTHORITATIVE REFERENCES.
Defer to these official sources when verifying any specific reference (section number, notification, rate, form, etc.). When the user asks about a TDS rate, FIRST consult the TRACES rate chart. When verifying a notification number, FIRST consult the CBDT what's-new or CBIC GST pages. Never fabricate URLs — only cite URLs from this list or from grounded search results:
${lines.join('\n')}`;
}
