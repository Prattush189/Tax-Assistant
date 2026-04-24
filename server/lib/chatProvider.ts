/**
 * ChatProvider abstraction for streaming-text LLM calls.
 *
 * Used today by the notice route. Previously this file also offered an
 * Anthropic/Claude provider behind a cascade — that path has been removed;
 * the route is now Gemini-only on `gemini-3-flash-preview`.
 *
 * We keep the interface and the single-implementation `pickChatProvider()`
 * shim so the notice route's call-site stays unchanged and future providers
 * can be slotted back in without route surgery.
 */

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

/** Pick the best available provider. Gemini-only today. */
export function pickChatProvider(): ChatProvider {
  return geminiChatProvider;
}
