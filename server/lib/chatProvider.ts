/**
 * ChatProvider abstraction for streaming-text LLM calls.
 *
 * Used today by the notice route. Gemini-only on `gemini-2.5-flash-lite`
 * with Google Search grounding enabled.
 *
 * We keep the interface and the single-implementation `pickChatProvider()`
 * shim so the notice route's call-site stays unchanged and future providers
 * can be slotted back in without route surgery.
 */

import {
  GEMINI_API_KEYS,
  GEMINI_CHAT_MODEL_T1,
  GEMINI_CHAT_MODEL_T2,
  GEMINI_T1_INPUT_COST,
  GEMINI_T1_OUTPUT_COST,
  GEMINI_T2_INPUT_COST,
  GEMINI_T2_OUTPUT_COST,
} from './gemini.js';
import { streamGeminiChat } from './geminiChat.js';
import { selectTier, confirmUsed } from './searchQuota.js';

export interface ChatRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  /** Called once the FIRST time the provider drops from the primary
   *  model to a fallback tier (i.e. the primary failed before yielding
   *  any text). Lets the route surface a "Server busy, retrying…"
   *  notice. Mid-stream failures don't fire this — they're surfaced as
   *  a truncation instead. */
  onFallback?: (input: { from: string; to: string }) => void;
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

// ── Gemini 2.5 Flash-Lite (with Google Search grounding) implementation ──

export const geminiChatProvider: ChatProvider = {
  name: 'gemini',
  async streamChat(req, onText) {
    const tryModel = async (model: string): Promise<{ inputTokens: number; outputTokens: number; emittedAny: boolean }> => {
      const selection = selectTier(true);
      const apiKey = GEMINI_API_KEYS[selection.keyIndex] ?? '';
      let inputTokens = 0;
      let outputTokens = 0;
      let emittedAny = false;

      const stream = streamGeminiChat(
        model,
        req.systemPrompt,
        [],
        req.userMessage,
        apiKey,
        req.maxTokens,
        true,
        false, // no context cache — notice prompts vary per-call
      );

      for await (const chunk of stream) {
        if (chunk.text) { emittedAny = true; onText(chunk.text); }
        if (chunk.done) {
          inputTokens = chunk.inputTokens ?? 0;
          outputTokens = chunk.outputTokens ?? 0;
          const tag = model === GEMINI_CHAT_MODEL_T2 ? 'gemini-2.5' : 'gemini-3';
          confirmUsed(tag, selection.keyIndex, true);
        }
      }
      return { inputTokens, outputTokens, emittedAny };
    };

    // Primary: T2. If it throws BEFORE any text was emitted, drop to
    // T1 and tell the caller. If it throws mid-stream, the caller's
    // already seen partial output — surface it as a truncation rather
    // than re-running and concatenating two replies.
    let modelUsed = GEMINI_CHAT_MODEL_T2;
    let result: { inputTokens: number; outputTokens: number; emittedAny: boolean };
    try {
      result = await tryModel(GEMINI_CHAT_MODEL_T2);
    } catch (err) {
      console.warn(`[chatProvider] ${GEMINI_CHAT_MODEL_T2} failed, falling back to ${GEMINI_CHAT_MODEL_T1}:`, (err as Error).message?.slice(0, 120));
      try {
        req.onFallback?.({ from: GEMINI_CHAT_MODEL_T2, to: GEMINI_CHAT_MODEL_T1 });
      } catch (e) { console.warn('[chatProvider] onFallback hook threw:', (e as Error).message); }
      modelUsed = GEMINI_CHAT_MODEL_T1;
      result = await tryModel(GEMINI_CHAT_MODEL_T1);
    }

    const isT1 = modelUsed === GEMINI_CHAT_MODEL_T1;
    const inCost = isT1 ? GEMINI_T1_INPUT_COST : GEMINI_T2_INPUT_COST;
    const outCost = isT1 ? GEMINI_T1_OUTPUT_COST : GEMINI_T2_OUTPUT_COST;

    return {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: result.inputTokens * inCost + result.outputTokens * outCost,
      modelUsed,
      withSearch: true,
    };
  },
};

/** Pick the best available provider. Gemini-only today. */
export function pickChatProvider(): ChatProvider {
  return geminiChatProvider;
}
