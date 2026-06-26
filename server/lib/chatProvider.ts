/**
 * ChatProvider abstraction for streaming-text LLM calls.
 *
 * Used today by the notice route. Gemini-only, Deep-reasoning, on the same
 * model ladder as chat — Gemini 3 Flash (Flex → Standard) → 3.1 Flash-Lite
 * → 2.5 Flash-Lite — with Google Search grounding enabled.
 *
 * We keep the interface and the single-implementation `pickChatProvider()`
 * shim so the notice route's call-site stays unchanged and future providers
 * can be slotted back in without route surgery.
 */

import {
  GEMINI_API_KEYS,
  GEMINI_CHAT_MODEL_PRIMARY,
  GEMINI_CHAT_MODEL_T1,
  GEMINI_CHAT_MODEL_T2,
  GEMINI_PRIMARY_INPUT_COST,
  GEMINI_PRIMARY_OUTPUT_COST,
  GEMINI_T1_INPUT_COST,
  GEMINI_T1_OUTPUT_COST,
  GEMINI_T2_INPUT_COST,
  GEMINI_T2_OUTPUT_COST,
  GEMINI_FLEX,
  GEMINI_FLEX_SERVICE_TIER,
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
    // Notice drafting is complex legal work → Deep reasoning. (Not passed
    // to 2.5 Flash-Lite, which uses a different thinking config.)
    const THINKING: 'low' | 'high' = 'high';

    // Same model ladder as chat: Gemini 3 Flash (Flex → Standard) →
    // 3.1 Flash-Lite → 2.5 Flash-Lite. Flex only when GEMINI_FLEX=1; a Flex
    // 503 (capacity) drops to 3 Flash Standard before any weaker model.
    const flexTier = GEMINI_FLEX ? GEMINI_FLEX_SERVICE_TIER : null;
    const ladder: Array<{ model: string; tier: string | null; thinking: 'low' | 'high' | null }> = [
      ...(flexTier ? [{ model: GEMINI_CHAT_MODEL_PRIMARY, tier: flexTier, thinking: THINKING }] : []),
      { model: GEMINI_CHAT_MODEL_PRIMARY, tier: null, thinking: THINKING },
      { model: GEMINI_CHAT_MODEL_T1, tier: null, thinking: THINKING },
      { model: GEMINI_CHAT_MODEL_T2, tier: null, thinking: null },
    ];

    let emittedAnyText = false;

    const tryModel = async (
      model: string,
      tier: string | null,
      thinking: 'low' | 'high' | null,
    ): Promise<{ inputTokens: number; outputTokens: number }> => {
      const selection = selectTier(true);
      const apiKey = GEMINI_API_KEYS[selection.keyIndex] ?? '';
      let inputTokens = 0;
      let outputTokens = 0;

      const stream = streamGeminiChat(
        model,
        req.systemPrompt,
        [],
        req.userMessage,
        apiKey,
        req.maxTokens,
        true,
        false, // no context cache — notice prompts vary per-call
        thinking,
        tier,
      );

      for await (const chunk of stream) {
        if (chunk.text) { emittedAnyText = true; onText(chunk.text); }
        if (chunk.done) {
          inputTokens = chunk.inputTokens ?? 0;
          outputTokens = chunk.outputTokens ?? 0;
          const tag = model === GEMINI_CHAT_MODEL_T2 ? 'gemini-2.5' : 'gemini-3';
          confirmUsed(tag, selection.keyIndex, true);
        }
      }
      return { inputTokens, outputTokens };
    };

    let used: { model: string; tier: string | null } | null = null;
    let result = { inputTokens: 0, outputTokens: 0 };
    let firstFallbackFired = false;

    for (let i = 0; i < ladder.length; i++) {
      const rung = ladder[i];
      // Tell the caller once, the first time we leave the 3-Flash primary
      // for a weaker model (Flex→Standard stays on 3 Flash, so no notice).
      if (rung.model !== GEMINI_CHAT_MODEL_PRIMARY && !firstFallbackFired) {
        firstFallbackFired = true;
        try { req.onFallback?.({ from: GEMINI_CHAT_MODEL_PRIMARY, to: rung.model }); }
        catch (e) { console.warn('[chatProvider] onFallback hook threw:', (e as Error).message); }
      }
      try {
        result = await tryModel(rung.model, rung.tier, rung.thinking);
        used = { model: rung.model, tier: rung.tier };
        break;
      } catch (err) {
        // Mid-stream failure — partial draft already streamed; don't retry
        // (would duplicate). Surface as a truncation to the caller.
        if (emittedAnyText) throw err;
        const lastRung = i === ladder.length - 1;
        console.warn(`[chatProvider] ${rung.model}${rung.tier ? ` (${rung.tier})` : ''} failed${lastRung ? '' : ', trying next'}:`, (err as Error).message?.slice(0, 120));
      }
    }

    if (!used) throw new Error('All notice models failed to produce output');

    // Cost + logged model string, with the Flex half-rate + "(Flex)" label.
    const ranFlex = used.model === GEMINI_CHAT_MODEL_PRIMARY && !!used.tier;
    let inCost: number, outCost: number, modelUsed: string;
    if (used.model === GEMINI_CHAT_MODEL_PRIMARY) {
      const mul = ranFlex ? 0.5 : 1;
      inCost = GEMINI_PRIMARY_INPUT_COST * mul;
      outCost = GEMINI_PRIMARY_OUTPUT_COST * mul;
      modelUsed = ranFlex ? `${GEMINI_CHAT_MODEL_PRIMARY}-flex` : GEMINI_CHAT_MODEL_PRIMARY;
    } else if (used.model === GEMINI_CHAT_MODEL_T1) {
      inCost = GEMINI_T1_INPUT_COST; outCost = GEMINI_T1_OUTPUT_COST; modelUsed = GEMINI_CHAT_MODEL_T1;
    } else {
      inCost = GEMINI_T2_INPUT_COST; outCost = GEMINI_T2_OUTPUT_COST; modelUsed = GEMINI_CHAT_MODEL_T2;
    }

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
