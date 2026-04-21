/**
 * Anthropic (Claude) streaming client for the Notice Drafter.
 *
 * Uses Claude Haiku 4.5 — the most cost-efficient current Claude model — as
 * the primary engine for drafting replies to tax notices. Prompt caching is
 * enabled on the system prompt so that the long legal-advocate instructions
 * are billed at 10% on repeat calls (5-minute cache).
 */

import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_HAIKU_MODEL = 'claude-haiku-4-5';

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
