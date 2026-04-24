/**
 * Anthropic (Claude) streaming client for the Notice Drafter.
 *
 * Uses Claude Haiku 4.5 — the most cost-efficient current Claude model — as
 * the primary engine for drafting replies to tax notices. Prompt caching is
 * enabled on the system prompt so that the long legal-advocate instructions
 * are billed at 10% on repeat calls (5-minute cache).
 */

import Anthropic from '@anthropic-ai/sdk';
import { withBreaker } from './circuitBreaker.js';
import { registerBucket, tryAcquire } from './rateLimiter.js';

// Anthropic Tier 1 rate limits — see https://docs.anthropic.com/en/api/rate-limits.
// Tier 1 caps Haiku at ~50 RPM; we register a slightly conservative bucket so
// a burst of notice generations queues / fails fast inside our process
// instead of producing a wave of 429s. Adjust upward (via env in future) if
// the project moves to a higher tier.
const ANTHROPIC_RPM_LIMIT = Number(process.env.ANTHROPIC_RPM_LIMIT ?? 45);
registerBucket({ provider: 'anthropic', dimension: 'rpm', label: 'global', limit: ANTHROPIC_RPM_LIMIT, period: 'minute' });

export const CLAUDE_HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Claude Haiku 4.5 pricing (USD per token)
export const CLAUDE_HAIKU_INPUT_COST = 1.00 / 1_000_000;        // $1.00 / M tokens
export const CLAUDE_HAIKU_OUTPUT_COST = 5.00 / 1_000_000;       // $5.00 / M tokens
export const CLAUDE_HAIKU_CACHE_WRITE_COST = 1.25 / 1_000_000;  // 1.25× input  (5-min cache)
export const CLAUDE_HAIKU_CACHE_READ_COST = 0.10 / 1_000_000;   // 0.10× input

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

export const anthropicConfigured = !!ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.warn('[anthropic] ANTHROPIC_API_KEY is not set. Notice drafter will fall back to Gemini until you add it to .env.');
}

export const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY || 'missing-anthropic-key-placeholder',
  timeout: 90_000,
});

export interface ClaudeChatChunk {
  text?: string;
  done?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

/**
 * Stream a Claude chat response. The system prompt is marked with
 * `cache_control: ephemeral` so Anthropic serves it from the 5-minute prompt
 * cache on repeat calls — this matters for the Notice Drafter because the
 * legal-advocate instructions are long (>2k tokens) and identical per call.
 */
export async function* streamClaudeChat(
  systemPrompt: string,
  userMessage: string,
  maxOutputTokens: number = 8192,
): AsyncGenerator<ClaudeChatChunk> {
  const stream = anthropic.messages.stream({
    model: CLAUDE_HAIKU_MODEL,
    max_tokens: maxOutputTokens,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta' &&
      event.delta.text
    ) {
      yield { text: event.delta.text };
    }
  }

  const finalMessage = await stream.finalMessage();
  const usage = finalMessage.usage;
  yield {
    done: true,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  };
}

/**
 * Retry-wrapped streaming wrapper. Forwards every text chunk to `onText`
 * synchronously and returns the final usage envelope. Retries the initial
 * request up to `MAX_ATTEMPTS` times on 429 (rate-limit), 529 (overloaded),
 * and 5xx errors with exponential backoff (2s, 4s, 6s).
 *
 * Once a stream has started yielding tokens we do NOT retry — partial output
 * has already been sent to the client, so a retry would duplicate text.
 */
export async function streamClaudeChatWithRetry(
  systemPrompt: string,
  userMessage: string,
  onText: (text: string) => void,
  maxOutputTokens: number = 8192,
): Promise<Required<Pick<ClaudeChatChunk, 'inputTokens' | 'outputTokens' | 'cacheCreationTokens' | 'cacheReadTokens'>>> {
  const MAX_ATTEMPTS = 3;
  const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);

  // Pre-flight rate-limit check: if we've hit our self-imposed RPM ceiling,
  // fail fast with a clear error before even calling Anthropic. This keeps
  // burst traffic from producing a wave of upstream 429s.
  if (!tryAcquire('anthropic', 'rpm', 'global')) {
    const err = new Error('Anthropic RPM limit reached. Please retry in a minute.') as Error & { status: number };
    err.status = 429;
    throw err;
  }

  // Circuit-breaker wraps the retry ladder so a real Anthropic outage opens
  // the breaker and the next 60s of requests fail fast with BreakerOpenError.
  return withBreaker('anthropic', async () => {
    let lastErr: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let started = false;
      try {
        const stream = streamClaudeChat(systemPrompt, userMessage, maxOutputTokens);
        for await (const chunk of stream) {
          if (chunk.text) {
            started = true;
            onText(chunk.text);
          }
          if (chunk.done) {
            return {
              inputTokens: chunk.inputTokens ?? 0,
              outputTokens: chunk.outputTokens ?? 0,
              cacheCreationTokens: chunk.cacheCreationTokens ?? 0,
              cacheReadTokens: chunk.cacheReadTokens ?? 0,
            };
          }
        }
        // Stream ended without a `done` chunk — treat as success with zero usage.
        return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number })?.status ?? 0;
        if (started || !RETRYABLE.has(status) || attempt === MAX_ATTEMPTS - 1) break;
        console.warn(`[anthropic] retry ${attempt + 1}/${MAX_ATTEMPTS} after status ${status}`);
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  });
}

export interface ClaudeTsvResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * Non-streaming Claude call tuned for bank-statement TSV extraction.
 *
 * Why non-streaming: the caller parses the whole TSV + `---END:N---` trailer
 * at once, so there's nothing to gain from streaming here. A single
 * `messages.create` keeps the parsing path identical to the Gemini-based
 * path it replaces.
 *
 * Why the system prompt is cached: the TSV prompt is ~3KB of static
 * instructions that we send once per chunk. A 46-page statement produces
 * 7-8 chunks that fire inside a ~60s window, comfortably inside Anthropic's
 * 5-minute ephemeral cache. Chunk 1 pays full price on the prompt; chunks
 * 2-N pay 10% — turning what would be a 13-17× premium over Gemini into
 * roughly 6-8×, for dramatically better reliability.
 *
 * Retries: we reuse the same ladder as the notice drafter (429/5xx/529,
 * exponential backoff, circuit breaker) so a real Anthropic outage opens
 * the breaker and the caller can fall through to Gemini.
 */
export async function extractTsvWithClaude(
  systemPrompt: string,
  userContent: string,
  maxOutputTokens: number = 16_384,
): Promise<ClaudeTsvResult> {
  const MAX_ATTEMPTS = 3;
  const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);

  if (!tryAcquire('anthropic', 'rpm', 'global')) {
    const err = new Error('Anthropic RPM limit reached. Please retry in a minute.') as Error & { status: number };
    err.status = 429;
    throw err;
  }

  return withBreaker('anthropic', async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const msg = await anthropic.messages.create({
          model: CLAUDE_HAIKU_MODEL,
          max_tokens: maxOutputTokens,
          system: [
            { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: userContent }],
        });

        // Claude responses are content blocks — for a plain-text extraction we
        // concatenate any text blocks and ignore tool_use blocks (there won't
        // be any, but be defensive).
        const text = msg.content
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('');

        return {
          text,
          inputTokens: msg.usage.input_tokens ?? 0,
          outputTokens: msg.usage.output_tokens ?? 0,
          cacheCreationTokens: msg.usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
        };
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number })?.status ?? 0;
        if (!RETRYABLE.has(status) || attempt === MAX_ATTEMPTS - 1) break;
        console.warn(`[anthropic:tsv] retry ${attempt + 1}/${MAX_ATTEMPTS} after status ${status}`);
        // 1.5s, 3s — faster than the notice-drafter ladder because TSV
        // extraction is user-blocking with a progress bar and 2s+4s+6s feels
        // laggy per chunk. Three attempts still straddle most 5xx blips.
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  });
}

/** Compute the USD cost for a Claude Haiku call, factoring in prompt caching. */
export function claudeHaikuCost(
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
): number {
  return (
    inputTokens * CLAUDE_HAIKU_INPUT_COST +
    outputTokens * CLAUDE_HAIKU_OUTPUT_COST +
    cacheCreationTokens * CLAUDE_HAIKU_CACHE_WRITE_COST +
    cacheReadTokens * CLAUDE_HAIKU_CACHE_READ_COST
  );
}
