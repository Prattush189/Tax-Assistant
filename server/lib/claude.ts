/**
 * Claude backend for every AI feature except tax chat (Gemini only,
 * since 2026-11-13: an Opus answer cost ~185 credits against a 25-credit
 * Free trial): notices, deeds, ledger scrutiny and reading, bank
 * statements (reading and classifying), document extraction, financial
 * mapping, CMA narrative, notification summaries.
 *
 * Routing rule, applied by the callers: when the admin switch is ON and
 * ANTHROPIC_API_KEY is set, Claude is tried first; if it fails before
 * producing output the call drops onto the existing Gemini ladder pinned
 * to Gemini key 1.
 *
 * Every call gets web search and an instruction to check current facts
 * (since 2026-11-12). Calls can pass their own search settings (notices
 * limit it to official and judgment sites) or `webSearch: false`. Users
 * are charged the model's real weight (lib/modelWeights.ts).
 *
 * The switch lives in app_config ('claude_enabled'), defaults ON, and
 * is flipped from the admin Model Usage tab — no redeploy needed when
 * the Claude credits run out.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import db from '../db/index.js';
import { costForClaude, CLAUDE_WEB_SEARCH_USD } from './claudePricing.js';

// All three tiers are Sonnet 5.5 since 2026-11-13 (owner: "use sonnet
// with search for now instead of opus"; Opus 5.5 ran 2026-11-12/13).
// Opus is meant only for features where Gemini matches or beats Sonnet.
// The tiers stay separate so any one can move by env alone.
/** Judgment work: ledger scrutiny observations, scanned ledgers, deeds. */
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
/** Mechanical work: statement and document reads, financial mapping, CMA
 *  narrative, and notice drafting (chatProvider's economy calls). */
export const CLAUDE_MODEL_FAST = process.env.CLAUDE_MODEL_FAST || 'claude-sonnet-5-5';
/** Reading a ledger no software rule maps (rows → TSV, column roles).
 *  Every row has to be right: in a 2026-10-30 bake-off on 7 ledgers only
 *  Opus copied every row exactly (two runs out of two); Sonnet and Haiku
 *  dropped, flipped or misread rows on 3-5 of them. Sonnet for now on
 *  the owner's call; the balance checks and side repair still run.
 *  CLAUDE_MODEL_BEST=claude-opus-5-5 restores Opus here. */
export const CLAUDE_MODEL_BEST = process.env.CLAUDE_MODEL_BEST || 'claude-sonnet-5-5';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
export const claudeConfigured = !!ANTHROPIC_API_KEY;
if (!claudeConfigured) {
  console.warn('[claude] ANTHROPIC_API_KEY is not set — every AI feature stays on Gemini.');
}

// One SDK retry only: a Claude failure has a ready fallback (Gemini),
// so burning the SDK's default backoff budget just delays the user.
const client = new Anthropic({
  apiKey: ANTHROPIC_API_KEY || 'missing-anthropic-key-placeholder',
  maxRetries: 1,
  timeout: 300_000,
});

// ── Admin switch (persisted) ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
  );
`);
const cfgGetStmt = db.prepare('SELECT value FROM app_config WHERE key = ?');
const cfgSetStmt = db.prepare(`
  INSERT INTO app_config (key, value, updated_at)
  VALUES (?, ?, datetime('now', '+5 hours', '+30 minutes'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

let enabled = (() => {
  try {
    const row = cfgGetStmt.get('claude_enabled') as { value: string } | undefined;
    return row ? row.value === '1' : true;
  } catch {
    return true;
  }
})();

/** True when non-search work should try Claude first. */
export function isClaudeActive(): boolean {
  return claudeConfigured && enabled;
}

export function setClaudeEnabled(on: boolean): void {
  enabled = on;
  try {
    cfgSetStmt.run('claude_enabled', on ? '1' : '0');
  } catch (e) {
    console.warn('[claude] persist app_config[claude_enabled] failed:', (e as Error).message);
  }
}

export function getClaudeConfig(): { enabled: boolean; configured: boolean; active: boolean; model: string; fastModel: string; bestModel: string } {
  return { enabled, configured: claudeConfigured, active: isClaudeActive(), model: CLAUDE_MODEL, fastModel: CLAUDE_MODEL_FAST, bestModel: CLAUDE_MODEL_BEST };
}

// ── Calls ─────────────────────────────────────────────────────────────────

/** One page Claude's web search returned, with the passages Claude cited
 *  from it: evidence for checking the links in its answer. */
export interface ClaudeSearchSource {
  url: string;
  title: string;
  citedText: string[];
}

export interface ClaudeCompletion {
  /** The answer. With web search on, only the text after the last search
   *  result: anything written before or between searches is commentary
   *  ("Let me look up section 143..."), not part of the answer. */
  text: string;
  /** OpenAI-style: 'stop' | 'length' | 'refusal' | raw stop_reason. */
  finishReason: string;
  /** Includes cached tokens (same convention as the Gemini helpers). */
  inputTokens: number;
  /** Billable output: answer + thinking. */
  outputTokens: number;
  cachedInputTokens: number;
  model: string;
  /** Billed separately from tokens (CLAUDE_WEB_SEARCH_USD each). */
  webSearchRequests: number;
  /** Every page the searches returned. Empty without web search. */
  sources: ClaudeSearchSource[];
  /** USD: tokens at the model's rates plus the search fees. */
  costUsd: number;
}

/** Let Claude search the web during the call. */
export interface ClaudeWebSearch {
  /** Most searches in one call (each is billed). */
  maxUses: number;
  /** Sites searched, subdomains included. Empty = the whole web. */
  allowedDomains: string[];
  /** The dynamic-filtering tool (Opus / Sonnet): it trims results before
   *  they reach the context, but its definition costs ~5.9K input tokens
   *  on every call against ~2.7K for the basic tool (measured on Opus
   *  2026-11-12). Worth it only where searching is the norm. */
  dynamic?: boolean;
}

export interface ClaudeCallOptions {
  /** CLAUDE_MODEL (default) or CLAUDE_MODEL_FAST. */
  model?: string;
  /** Room for the ANSWER. Thinking comes out of max_tokens on Claude,
   *  so we add headroom on top rather than let it eat the answer. */
  maxTokens: number;
  effort?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
  onText?: (text: string) => void;
  /** Defaults to DEFAULT_WEB_SEARCH; false turns searching off. */
  webSearch?: ClaudeWebSearch | false;
}

const THINKING_HEADROOM = 8_192;

/** Every call can search unless it says otherwise: the whole web, a few
 *  searches, the cheaper basic tool. The current-facts note below decides
 *  when a search is worth it. */
const DEFAULT_WEB_SEARCH: ClaudeWebSearch = { maxUses: 3, allowedDomains: [] };
/** For calls where searching is the norm (tax chat, drafting, the
 *  notification fetcher). */
export const RESEARCH_WEB_SEARCH: ClaudeWebSearch = { maxUses: 3, allowedDomains: [], dynamic: true };

/** The server's tool loop stops after ~10 steps with `pause_turn`;
 *  sending the turn back resumes it. */
const MAX_PAUSE_RESUMES = 3;

/** Appended to the system prompt of every searching call. The date is
 *  what makes "current" mean something; the read-only carve-out keeps
 *  statement and ledger transcription from burning searches. */
function currentFactsNote(): string {
  const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' });
  return `CURRENT FACTS
Today is ${today} (India). You have a web search tool. When your answer depends on facts that change — tax rates, slabs, thresholds, due dates, section numbers (including the Income-tax Act, 2025 renumbering), forms, notifications, circulars or case law — search for the current position before relying on memory, prefer official sources (incometaxindia.gov.in, incometax.gov.in, cbic-gst.gov.in, gst.gov.in, egazette.gov.in, sci.gov.in, itat.gov.in, indiankanoon.org) and answer from what you find. When the task is only to read, copy, map or classify the document or data you were given, work from it and do not search.
Write nothing before or between searches: your reply is only the final answer, in the format asked for.`;
}

/** Dynamic filtering exists for Opus and Sonnet only. */
function searchToolType(model: string, dynamic = false): 'web_search_20260209' | 'web_search_20250305' {
  return dynamic && /^claude-(opus|sonnet)-/.test(model) ? 'web_search_20260209' : 'web_search_20250305';
}

type ClaudeContent = Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam;

type ContentPart = { type: string; text?: string; image_url?: { url: string }; file?: { file_data?: string } };

function toClaudeContent(content: string | ContentPart[]): string | ClaudeContent[] {
  if (typeof content === 'string') return content;
  const blocks: ClaudeContent[] = [];
  for (const part of content) {
    if (part.type === 'text' && part.text) {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_url' && part.image_url?.url) {
      const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(part.image_url.url);
      if (!m) throw new Error('Claude adapter: only base64 data-URL images are supported');
      blocks.push({ type: 'image', source: { type: 'base64', media_type: m[1] as 'image/png', data: m[2] } });
    } else if (part.type === 'file' && part.file?.file_data) {
      // OpenAI-shaped file part carrying a PDF (statement pages read directly).
      const m = /^data:application\/pdf;base64,(.+)$/.exec(part.file.file_data);
      if (!m) throw new Error('Claude adapter: only base64 PDF file parts are supported');
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: m[1] } });
    } else {
      throw new Error(`Claude adapter: unsupported content part "${part.type}"`);
    }
  }
  return blocks;
}

/** Translate the OpenAI-shaped messages the Gemini helpers already build. */
function toClaudeRequest(messages: ChatCompletionMessageParam[]): { system: string; messages: Anthropic.MessageParam[] } {
  const system: string[] = [];
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'developer') {
      system.push(typeof m.content === 'string' ? m.content : m.content.map(p => p.text).join('\n'));
    } else if (m.role === 'user' || m.role === 'assistant') {
      out.push({ role: m.role, content: toClaudeContent((m.content ?? '') as string | ContentPart[]) });
    } else {
      throw new Error(`Claude adapter: unsupported message role "${m.role}"`);
    }
  }
  return { system: system.join('\n\n'), messages: out };
}

/**
 * One Claude call (streamed under the hood so large max_tokens never
 * hits the SDK's non-streaming timeout guard). Throws on API errors —
 * `.status` is preserved so caller retry ladders can inspect it — and
 * on refusals / empty answers so the caller falls back to Gemini.
 */
export async function claudeComplete(
  messages: ChatCompletionMessageParam[],
  opts: ClaudeCallOptions,
): Promise<ClaudeCompletion> {
  const { system, messages: claudeMessages } = toClaudeRequest(messages);
  const model = opts.model ?? CLAUDE_MODEL;
  const search = opts.webSearch === false ? null : (opts.webSearch ?? DEFAULT_WEB_SEARCH);
  const fullSystem = search ? [system, currentFactsNote()].filter(Boolean).join('\n\n') : system;
  const tools = search ? [{
    type: searchToolType(model, search.dynamic),
    name: 'web_search' as const,
    max_uses: search.maxUses,
    ...(search.allowedDomains.length ? { allowed_domains: search.allowedDomains } : {}),
    user_location: { type: 'approximate' as const, country: 'IN', timezone: 'Asia/Kolkata' },
  }] : undefined;

  const content: Anthropic.ContentBlock[] = [];
  let inputTokens = 0, outputTokens = 0, cacheRead = 0, webSearchRequests = 0;
  let stopReason: Anthropic.Message['stop_reason'] = null;
  let stopCategory: string | undefined;
  for (let resume = 0; resume <= MAX_PAUSE_RESUMES; resume++) {
    const stream = client.messages.stream({
      model,
      max_tokens: opts.maxTokens + THINKING_HEADROOM,
      ...(fullSystem ? { system: fullSystem } : {}),
      // A paused turn goes back as the assistant message so far.
      messages: content.length ? [...claudeMessages, { role: 'assistant', content: content as Anthropic.ContentBlockParam[] }] : claudeMessages,
      output_config: { effort: opts.effort ?? 'low' },
      ...(tools ? { tools } : {}),
    }, { timeout: opts.timeoutMs ?? 300_000 });
    if (opts.onText) stream.on('text', opts.onText);
    const msg = await stream.finalMessage();
    content.push(...msg.content);
    const read = msg.usage.cache_read_input_tokens ?? 0;
    inputTokens += msg.usage.input_tokens + read + (msg.usage.cache_creation_input_tokens ?? 0);
    outputTokens += msg.usage.output_tokens;
    cacheRead += read;
    webSearchRequests += msg.usage.server_tool_use?.web_search_requests ?? 0;
    stopReason = msg.stop_reason;
    stopCategory = msg.stop_details?.category ?? undefined;
    if (stopReason !== 'pause_turn') break;
  }

  // Only the text after the last tool result is the answer (searches and
  // the dynamic filter's code runs both end in a *_tool_result block).
  let lastToolResult = -1;
  const sources = new Map<string, ClaudeSearchSource>();
  content.forEach((b, i) => {
    if (b.type.endsWith('tool_result')) lastToolResult = i;
    if (b.type === 'web_search_tool_result') {
      // An error result is an object, a success a list of pages.
      if (Array.isArray(b.content)) {
        for (const r of b.content) {
          if (!sources.has(r.url)) sources.set(r.url, { url: r.url, title: r.title ?? '', citedText: [] });
        }
      }
    } else if (b.type === 'text') {
      for (const c of b.citations ?? []) {
        if (c.type === 'web_search_result_location') sources.get(c.url)?.citedText.push(c.cited_text);
      }
    }
  });
  const text = content.slice(lastToolResult + 1).map(b => (b.type === 'text' ? b.text : '')).join('');
  const result: ClaudeCompletion = {
    text,
    finishReason: stopReason === 'end_turn' || stopReason === 'stop_sequence'
      ? 'stop'
      : stopReason === 'max_tokens' ? 'length' : String(stopReason),
    inputTokens,
    outputTokens,
    cachedInputTokens: cacheRead,
    model,
    webSearchRequests,
    sources: [...sources.values()],
    costUsd: costForClaude(model, inputTokens, outputTokens, cacheRead) + webSearchRequests * CLAUDE_WEB_SEARCH_USD,
  };
  if (stopReason === 'refusal') {
    throw Object.assign(new Error(`Claude declined (${stopCategory ?? 'no category'})`), { claudeUsage: result });
  }
  if (!text.trim()) {
    throw Object.assign(new Error(`Claude returned no text (stop_reason=${stopReason})`), { claudeUsage: result });
  }
  return result;
}
