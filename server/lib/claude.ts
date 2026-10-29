/**
 * Claude backend for the work that does NOT use web search: books
 * (ledger scrutiny, CMA narrative, financial mapping) and notice /
 * deed drafting when grounding is off.
 *
 * Routing rule, applied by the callers (chatProvider, callGeminiJson,
 * ledgerScrutiny): when the admin switch is ON and ANTHROPIC_API_KEY is
 * set, Claude is tried first; if it fails before producing output the
 * call drops onto the existing Gemini ladder pinned to Gemini key 1.
 * Anything that needs Google Search grounding never comes here — tax
 * chat and deeds/rent agreements stay on Gemini for the free search pool.
 *
 * The switch lives in app_config ('claude_enabled'), defaults ON, and
 * is flipped from the admin Model Usage tab — no redeploy needed when
 * the Claude credits run out.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import db from '../db/index.js';

/** Judgment work: ledger scrutiny observations, notice / deed drafting. */
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
/** Mechanical work: ledger TSV transcription, row classification, CMA
 *  narrative. Bulk of the tokens, so it gets the cheap model. */
export const CLAUDE_MODEL_FAST = process.env.CLAUDE_MODEL_FAST || 'claude-haiku-5-5';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
export const claudeConfigured = !!ANTHROPIC_API_KEY;
if (!claudeConfigured) {
  console.warn('[claude] ANTHROPIC_API_KEY is not set — books and notice drafting stay on Gemini.');
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

export function getClaudeConfig(): { enabled: boolean; configured: boolean; active: boolean; model: string; fastModel: string } {
  return { enabled, configured: claudeConfigured, active: isClaudeActive(), model: CLAUDE_MODEL, fastModel: CLAUDE_MODEL_FAST };
}

// ── Calls ─────────────────────────────────────────────────────────────────

export interface ClaudeCompletion {
  text: string;
  /** OpenAI-style: 'stop' | 'length' | 'refusal' | raw stop_reason. */
  finishReason: string;
  /** Includes cached tokens (same convention as the Gemini helpers). */
  inputTokens: number;
  /** Billable output: answer + thinking. */
  outputTokens: number;
  cachedInputTokens: number;
  model: string;
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
}

const THINKING_HEADROOM = 8_192;

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
  const stream = client.messages.stream({
    model,
    max_tokens: opts.maxTokens + THINKING_HEADROOM,
    ...(system ? { system } : {}),
    messages: claudeMessages,
    output_config: { effort: opts.effort ?? 'low' },
  }, { timeout: opts.timeoutMs ?? 300_000 });
  if (opts.onText) stream.on('text', opts.onText);

  const msg = await stream.finalMessage();
  const text = msg.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  const cacheRead = msg.usage.cache_read_input_tokens ?? 0;
  const cacheWrite = msg.usage.cache_creation_input_tokens ?? 0;
  const result: ClaudeCompletion = {
    text,
    finishReason: msg.stop_reason === 'end_turn' || msg.stop_reason === 'stop_sequence'
      ? 'stop'
      : msg.stop_reason === 'max_tokens' ? 'length' : String(msg.stop_reason),
    inputTokens: msg.usage.input_tokens + cacheRead + cacheWrite,
    outputTokens: msg.usage.output_tokens,
    cachedInputTokens: cacheRead,
    model,
  };
  if (msg.stop_reason === 'refusal') {
    throw Object.assign(new Error(`Claude declined (${msg.stop_details?.category ?? 'no category'})`), { claudeUsage: result });
  }
  if (!text.trim()) {
    throw Object.assign(new Error(`Claude returned no text (stop_reason=${msg.stop_reason})`), { claudeUsage: result });
  }
  return result;
}
