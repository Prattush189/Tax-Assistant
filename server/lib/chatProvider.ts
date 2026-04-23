/**
 * ChatProvider abstraction for streaming-text LLM calls.
 *
 * Used today by the notice route, where the previous if (anthropicConfigured)
 * { ... } else { ... } block was duplicated logic. With this interface:
 *   const provider = pickChatProvider();          // picks Anthropic or Gemini
 *   const usage = await provider.streamChat(req, onText);
 *
 * Adding a new provider (say, Claude Sonnet for an enterprise tier) means
 * adding one file and one branch in pickChatProvider — no route surgery.
 *
 * Scope note: the chat route is intentionally NOT refactored to use this
 * interface. Chat needs Gemini-specific features (multi-key rotation via
 * searchQuota, dual-mode cascade with per-tier quota tracking, conditional
 * Google Search) that don't generalize across providers; the abstraction
 * would either be Gemini-leaky or hide important quota state. Notices —
 * which has none of that — is the ideal client.
 */

import {
  CLAUDE_HAIKU_MODEL,
  anthropicConfigured,
  claudeHaikuCost,
  streamClaudeChatWithRetry,
} from './anthropic.js';
import { BreakerOpenError } from './circuitBreaker.js';
import {
  GEMINI_API_KEYS,
  GEMINI_CHAT_MODEL_THINK_FB,
  GEMINI_THINK_FB_INPUT_COST,
  GEMINI_THINK_FB_OUTPUT_COST,
} from './gemini.js';
import { streamGeminiChat } from './geminiChat.js';
import { selectTier, confirmUsed } from './searchQuota.js';

export interface ChatRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** USD cost for this call, factoring in caching. */
  costUsd: number;
  /** Concrete model name used (so callers can log it without knowing the provider). */
  modelUsed: string;
  /** True if this provider counts as a "search-grounded" call (for usage logs). */
  withSearch: boolean;
}

export interface ChatProvider {
  readonly name: string;
  streamChat(req: ChatRequest, onText: (text: string) => void): Promise<ChatUsage>;
}

// ── Anthropic (Claude Haiku 4.5) implementation ───────────────────────────

export const anthropicChatProvider: ChatProvider = {
  name: 'anthropic',
  async streamChat(req, onText) {
    const usage = await streamClaudeChatWithRetry(req.systemPrompt, req.userMessage, onText, req.maxTokens);
    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      costUsd: claudeHaikuCost(usage.inputTokens, usage.outputTokens, usage.cacheCreationTokens, usage.cacheReadTokens),
      modelUsed: CLAUDE_HAIKU_MODEL,
      withSearch: false,
    };
  },
};

// ── Gemini (3 Flash Preview, with Google Search grounding) implementation ─

export const geminiChatProvider: ChatProvider = {
  name: 'gemini',
  async streamChat(req, onText) {
    const selection = selectTier(true);
    const apiKey = GEMINI_API_KEYS[selection.keyIndex] ?? '';
    let inputTokens = 0;
    let outputTokens = 0;

    const stream = streamGeminiChat(
      GEMINI_CHAT_MODEL_THINK_FB,
      req.systemPrompt,
      [],
      req.userMessage,
      apiKey,
      req.maxTokens,
      true,
      false, // no context cache — notice prompts vary per-call
    );

    for await (const chunk of stream) {
      if (chunk.text) onText(chunk.text);
      if (chunk.done) {
        inputTokens = chunk.inputTokens ?? 0;
        outputTokens = chunk.outputTokens ?? 0;
        confirmUsed('gemini-3', selection.keyIndex, true);
      }
    }

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: inputTokens * GEMINI_THINK_FB_INPUT_COST + outputTokens * GEMINI_THINK_FB_OUTPUT_COST,
      modelUsed: GEMINI_CHAT_MODEL_THINK_FB,
      withSearch: true,
    };
  },
};

/**
 * Cascade provider: tries Anthropic first (when configured), automatically
 * falls back to Gemini if the Anthropic circuit breaker is open or if no
 * Anthropic key is present. Non-breaker errors from Anthropic are re-thrown
 * so the caller can surface them (e.g. auth failures, invalid requests).
 */
export const cascadeChatProvider: ChatProvider = {
  name: 'cascade',
  async streamChat(req, onText) {
    if (anthropicConfigured) {
      try {
        return await anthropicChatProvider.streamChat(req, onText);
      } catch (err) {
        const status = (err as { status?: number })?.status ?? 0;
        const isAuthError = status === 401 || status === 403;
        if (err instanceof BreakerOpenError) {
          console.warn(`[chatProvider] Anthropic breaker open — falling back to Gemini`);
        } else if (isAuthError) {
          console.warn(`[chatProvider] Anthropic auth error (${status}) — falling back to Gemini. Check ANTHROPIC_API_KEY.`);
        } else {
          throw err;
        }
        // Fall through to Gemini
      }
    }
    return geminiChatProvider.streamChat(req, onText);
  },
};

/**
 * Pick the best available provider. Returns the cascade provider which tries
 * Anthropic first and automatically falls back to Gemini when the Anthropic
 * circuit breaker is open.
 */
export function pickChatProvider(): ChatProvider {
  return cascadeChatProvider;
}
