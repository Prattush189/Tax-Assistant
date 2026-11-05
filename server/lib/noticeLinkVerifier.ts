/**
 * Live verification of the links in a notice draft.
 *
 * A link in a reply filed with the department has to be real AND be the
 * page the letter says it is. The host allowlist alone let through
 * well-formed but invented addresses (indiankanoon.org/doc/<made-up id>),
 * and a live page alone does not prove it is the right judgment. So a
 * link counts as verified only when:
 *
 *   1. it is on an authoritative host (AUTHORITATIVE_HOST_PATTERN);
 *   2. the page exists: the model's own web search returned it in this
 *      call, or we fetch it now (2xx, not bounced to the site's home page
 *      or an error page); and
 *   3. the page is the one cited: when the letter names parties next to
 *      the link ("X v. Y"), at least two of their distinctive words (one,
 *      if that is all the name has) appear in what we have of the page:
 *      the search result's title, the passages the model cited from it,
 *      or the top of the fetched page. Next to a section, rule, circular
 *      or notification, its number must appear instead. A judgment cited
 *      with a year before the page's decision date ("[2000] 82 ITD 1" for
 *      an order of 2002) fails too: the case is right but the citation
 *      is misquoted, and a filed reply cannot carry that.
 *
 * Our curated reference list (officialReferenceUrls) is checked by hand
 * and passes as is. Links the caller already holds as verified (those in
 * a saved draft being revised) pass too.
 *
 * Fetching is a fallback, not the main proof: incometaxindia.gov.in
 * answers 403 to servers and itat.gov.in serves an incomplete TLS chain,
 * so links there verify only through the search evidence.
 */

import type { ClaudeSearchSource } from './claude.js';
import { AUTHORITATIVE_HOST_PATTERN, isKnownLiveUrl, normalizeUrl } from './noticeCitationSanitizer.js';

const FETCH_TIMEOUT_MS = 8_000;
const FETCH_CONCURRENCY = 6;
/** Party names sit in the title and opening of a judgment page; matching
 *  the whole page would let a passing mention in a long judgment count. */
const PAGE_HEAD_CHARS = 8_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** Words in party names that say nothing about WHICH case it is. */
const PARTY_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'through', 'shri', 'smt', 'ms', 'mr', 'mrs',
  'commissioner', 'income', 'tax', 'taxes', 'deputy', 'assistant', 'additional', 'joint',
  'principal', 'chief', 'officer', 'officers', 'director', 'directorate', 'general',
  'union', 'india', 'indian', 'state', 'government', 'govt', 'department', 'revenue',
  'limited', 'private', 'company', 'corporation', 'bank', 'ltd', 'pvt', 'others', 'another',
  'appellant', 'respondent', 'petitioner', 'assessee', 'bench', 'tribunal', 'court', 'high',
  'supreme', 'appellate', 'central', 'goods', 'services', 'service', 'customs', 'excise',
  'cpc', 'dcit', 'acit', 'pcit', 'ito', 'cit', 'ward', 'circle', 'range', 'bangalore',
  'bengaluru', 'mumbai', 'delhi', 'chennai', 'kolkata', 'hyderabad', 'ahmedabad', 'pune',
]);

export interface LinkCheck {
  url: string;
  ok: boolean;
  /** What proved it, or what failed. */
  how: 'reference list' | 'already verified' | 'search result' | 'fetched page' | 'rejected';
  reason?: string;
}

export interface LinkVerification {
  checks: LinkCheck[];
  /** For sanitizeNoticeCitations: true for a link that passed. */
  isVerified: (url: string) => boolean;
}

/** Every link in the text, in order, without trailing punctuation. */
export function linksIn(text: string): string[] {
  return (text.match(/https?:\/\/[^\s)\]>]+/g) ?? []).map(u => u.replace(/[.,;:'"]+$/, ''));
}

/** `citedYears`: the bracketed years on the citation line ("[2000] 82 ITD 1",
 *  "(2023) 456 ITR 78"). A report cannot predate the decision, so a year
 *  earlier than the page's decision date marks a misquoted citation. */
type Claim =
  | { kind: 'parties'; words: string[]; citedYears: number[] }
  | { kind: 'numbers'; numbers: string[] }
  | { kind: 'none' };

/** What the text next to a link says the page is. Parties come from the
 *  last "X v. Y" before the link, cut to the name itself: the principle
 *  around it ("adjustment without intimation...") would match any page
 *  on the same point. */
export function claimNear(paragraph: string, url = ''): Claim {
  const at = url ? paragraph.indexOf(url) : -1;
  const before = at > 0 ? paragraph.slice(0, at) : paragraph;
  const vs = [...before.matchAll(/\s(?:v|vs|versus)\.?\s/gi)].pop();
  if (vs?.index !== undefined) {
    const left = before.slice(0, vs.index).split(/[:;—–*()\[\]\n]|\s-\s/).pop() ?? '';
    const right = before.slice(vs.index + vs[0].length).split(/[,;:—–()\[\]\n]/)[0] ?? '';
    const words = [...new Set(
      `${left.trim().split(/\s+/).slice(-8).join(' ')} ${right.slice(0, 80)}`
        .toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4 && !PARTY_STOPWORDS.has(w)),
    )];
    const citationLine = before.slice(before.lastIndexOf('\n') + 1);
    const citedYears = [...citationLine.matchAll(/[(\[]((?:19|20)\d{2})[)\]]/g)].map(y => Number(y[1]));
    if (words.length) return { kind: 'parties', words, citedYears };
  }
  const numbers = new Set<string>();
  const re = /\b(?:sections?|sec\.|s\.|u\/s\.?|rules?|circular|notification)\s*(?:no\.?\s*)?(\d{1,4}[A-Z]{0,3}(?:\/\d{2,4})?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paragraph)) !== null) numbers.add(m[1].toLowerCase());
  if (numbers.size) return { kind: 'numbers', numbers: [...numbers] };
  return { kind: 'none' };
}

/** Does what we have of the page support the claim? */
export function pageMatches(claim: Claim, page: string): boolean {
  const hay = page.toLowerCase();
  if (claim.kind === 'none') return true;
  if (claim.kind === 'parties') {
    const hits = claim.words.filter(w => new RegExp(`\\b${w}\\b`).test(hay)).length;
    return hits >= Math.min(2, claim.words.length);
  }
  return claim.numbers.some(n => new RegExp(`(?<![0-9])${n.replace(/[/]/g, '\\/')}(?![0-9])`).test(hay));
}

/** Why the citation's year cannot be right for this page, if it can't:
 *  every bracketed year on the citation line is before the decision date
 *  in the page title ("... vs Joint Cit on 31 January, 2002"). */
export function yearConflict(claim: Claim, page: string): string | null {
  if (claim.kind !== 'parties' || !claim.citedYears.length) return null;
  const decided = /\bon\s+\d{1,2}\s+[A-Za-z]+,?\s+((?:19|20)\d{2})\b/.exec(page);
  if (!decided) return null;
  const year = Number(decided[1]);
  return claim.citedYears.every(y => y < year) ? `cited as ${claim.citedYears.join('/')} but decided in ${year}` : null;
}

/** The paragraph a link sits in, plus the one before it when that is
 *  where the claim is (a `Source:` line under a quoted section). */
function paragraphAround(text: string, url: string): string {
  const paras = text.split(/\n\s*\n/);
  const i = paras.findIndex(p => p.includes(url));
  if (i < 0) return '';
  return claimNear(paras[i], url).kind === 'none' && i > 0 ? `${paras[i - 1]}\n${paras[i]}` : paras[i];
}

function htmlText(html: string): { title: string; text: string } {
  const title = (/<title[^>]*>([^<]*)/i.exec(html)?.[1] ?? '').trim();
  const text = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
  return { title, text };
}

const pathOf = (u: URL) => u.pathname.replace(/\/+$/, '');

/** Fetch the page: its title and opening text, or why it failed. */
async function fetchPage(url: string): Promise<{ ok: boolean; head?: string; reason?: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as { cause?: { code?: string }; name?: string };
    return { ok: false, reason: `could not open (${err.cause?.code ?? err.name ?? 'error'})` };
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  const from = new URL(url);
  const to = new URL(res.url || url);
  if (!AUTHORITATIVE_HOST_PATTERN.test(to.href)) return { ok: false, reason: `redirected off-site to ${to.host}` };
  if (pathOf(from) !== '' && pathOf(to) === '') return { ok: false, reason: 'redirected to the home page' };
  if (/pdf/i.test(res.headers.get('content-type') ?? '')) return { ok: true, head: '' };
  const { title, text } = htmlText(await res.text());
  if (/not found|\b404\b|access denied|\berror\b/i.test(title)) return { ok: false, reason: `error page ("${title.slice(0, 60)}")` };
  return { ok: true, head: `${title}\n${text.slice(0, PAGE_HEAD_CHARS)}` };
}

async function checkLink(
  url: string,
  draft: string,
  sources: Map<string, ClaudeSearchSource>,
  preVerified: Set<string>,
): Promise<LinkCheck> {
  if (isKnownLiveUrl(url)) return { url, ok: true, how: 'reference list' };
  if (preVerified.has(normalizeUrl(url))) return { url, ok: true, how: 'already verified' };
  if (!AUTHORITATIVE_HOST_PATTERN.test(url)) return { url, ok: false, how: 'rejected', reason: 'not an authoritative site' };

  const claim = claimNear(paragraphAround(draft, url), url);
  const src = sources.get(normalizeUrl(url));
  const evidence = src ? `${src.title}\n${src.citedText.join('\n')}` : '';
  if (src && pageMatches(claim, evidence)) {
    const conflict = yearConflict(claim, src.title);
    if (conflict) return { url, ok: false, how: 'rejected', reason: conflict };
    return { url, ok: true, how: 'search result' };
  }

  const page = await fetchPage(url);
  if (!page.ok) {
    return { url, ok: false, how: 'rejected', reason: src ? `search result does not name the cited ${claim.kind}; ${page.reason}` : page.reason };
  }
  if (pageMatches(claim, `${evidence}\n${page.head ?? ''}`)) {
    // The title carries the decision date; the body has other dates.
    const conflict = yearConflict(claim, `${src?.title ?? ''}\n${(page.head ?? '').split('\n')[0]}`);
    if (conflict) return { url, ok: false, how: 'rejected', reason: conflict };
    return { url, ok: true, how: 'fetched page' };
  }
  const wanted = claim.kind === 'parties' ? claim.words.join(', ') : claim.kind === 'numbers' ? claim.numbers.join(', ') : '';
  return { url, ok: false, how: 'rejected', reason: `page does not mention ${wanted}` };
}

/**
 * Check every link in `draft`. `sources`: the pages the model's web
 * search returned for this draft. `preVerified`: links already proven
 * (the saved draft a revision starts from).
 */
export async function verifyNoticeLinks(
  draft: string,
  sources: ClaudeSearchSource[] = [],
  preVerified: string[] = [],
): Promise<LinkVerification> {
  const bySource = new Map(sources.map(s => [normalizeUrl(s.url), s]));
  const pre = new Set(preVerified.map(normalizeUrl));
  const unique = [...new Map(linksIn(draft).map(u => [normalizeUrl(u), u])).values()];

  const checks: LinkCheck[] = new Array(unique.length);
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const i = next++;
      checks[i] = await checkLink(unique[i], draft, bySource, pre);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, unique.length) }, worker));

  const passed = new Set(checks.filter(c => c.ok).map(c => normalizeUrl(c.url)));
  return { checks, isVerified: (url: string) => passed.has(normalizeUrl(url)) };
}
