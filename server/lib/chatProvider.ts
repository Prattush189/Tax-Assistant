/**
 * ChatProvider abstraction for streaming-text LLM calls.
 *
 * Used today by the notice route. Gemini-only, Deep-reasoning, on the same
 * model ladder as chat — 3.8 Flash (Flex) → 3.7 Flash (Flex → Standard)
 * → 2.5 Flash-Lite — with Google Search grounding enabled.
 *
 * The rungs are referenced through the GEMINI_CHAT_MODEL_* constants, so
 * this ladder follows a chat-model swap automatically; the names above are
 * documentation only. Keep them in step with lib/gemini.ts.
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
  GEMINI_FLEX,
  GEMINI_FLEX_SERVICE_TIER,
  costForModel,
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
  /** Economy ladder: start at 2.5 Flash-Lite with thinking OFF instead
   *  of the 3.x primary with Deep thinking. 3.x bills thinking tokens
   *  as OUTPUT, and Deep reasoning on a long legal letter burns far
   *  more of them than the letter itself — which is what made notice
   *  drafting expensive. Opt-in per call so ledger scrutiny and deed
   *  drafting keep the full-quality ladder. */
  economy?: boolean;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  /** Portion of inputTokens that was served from context cache. It is
   *  a SUBSET of inputTokens (Gemini's promptTokenCount already includes
   *  it) — never add it on top; pass it as the cached-input argument to
   *  logWithBilling / costForModel so it bills at the cache rate. */
  cacheReadTokens: number;
  /** Always 0 on Gemini — kept for source compatibility. */
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

    // Default ladder is "Deep" → the chat PRIMARY on top; there is no Fast
    // path here. Flex rungs (~50% price) are exhausted first, then the
    // Standard rungs. 3.8 Standard sits ABOVE 3.7 Standard because the two
    // are priced identically — no reason to step down to the weaker model
    // before we have to:
    //   3.8 (Flex) → 3.7 (Flex) → 3.8 (Std) → 3.7 (Std) → 2.5 Flash-Lite
    // With Flex off the ladder is simply 3.8 (Std) → 3.7 (Std) → 2.5.
    //
    // NOTE: since 2026-09, 3.8 and 3.7 are priced identically, so the T1
    // rungs buy availability rather than savings. Only the final 2.5
    // Flash-Lite rung is materially cheaper.
    const flexTier = GEMINI_FLEX ? GEMINI_FLEX_SERVICE_TIER : null;
    // Economy: 2.5 Flash-Lite first, thinking off. 3.x stays underneath
    // purely as a rescue if 2.5 fails outright, so a bad day still
    // produces a letter — it just is not the normal path any more.
    const ladder: Array<{ model: string; tier: string | null; thinking: 'low' | 'high' | null }> = req.economy
      ? [
          { model: GEMINI_CHAT_MODEL_T2, tier: null, thinking: null },
          ...(flexTier ? [{ model: GEMINI_CHAT_MODEL_T1, tier: flexTier, thinking: THINKING }] : []),
          { model: GEMINI_CHAT_MODEL_T1, tier: null, thinking: THINKING },
        ]
      : [
          { model: GEMINI_CHAT_MODEL_PRIMARY, tier: flexTier, thinking: THINKING },
          ...(flexTier ? [{ model: GEMINI_CHAT_MODEL_T1, tier: flexTier, thinking: THINKING }] : []),
          // Same price as 3.7 Standard, better model — only when the top
          // rung was Flex (otherwise it IS the top rung already).
          ...(flexTier ? [{ model: GEMINI_CHAT_MODEL_PRIMARY, tier: null, thinking: THINKING }] : []),
          { model: GEMINI_CHAT_MODEL_T1, tier: null, thinking: THINKING },
          { model: GEMINI_CHAT_MODEL_T2, tier: null, thinking: null },
        ];
    // The "we dropped to a weaker model" signal must compare against
    // THIS ladder's own top rung. Comparing against the global primary
    // fired onFallback on the very first economy attempt, so the user
    // saw "Server busy, retrying..." on every single notice.
    const topRung = ladder[0].model;

    let emittedAnyText = false;

    const tryModel = async (
      model: string,
      tier: string | null,
      thinking: 'low' | 'high' | null,
    ): Promise<{ inputTokens: number; outputTokens: number; cachedInputTokens: number }> => {
      const selection = selectTier(true);
      const apiKey = GEMINI_API_KEYS[selection.keyIndex] ?? '';
      let inputTokens = 0;
      let outputTokens = 0;
      let cachedInputTokens = 0;

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
        // streaming idle / first byte. 2.5 answers in seconds; the 3.x
        // rungs get 30 s to think before we move on.
        20_000,
        model === GEMINI_CHAT_MODEL_T2 ? 15_000 : 30_000,
      );

      for await (const chunk of stream) {
        if (chunk.text) { emittedAnyText = true; onText(chunk.text); }
        if (chunk.done) {
          inputTokens = chunk.inputTokens ?? 0;
          outputTokens = chunk.outputTokens ?? 0;
          cachedInputTokens = chunk.cachedInputTokens ?? 0;
          const tag = model === GEMINI_CHAT_MODEL_T2 ? 'gemini-2.5' : 'gemini-3';
          confirmUsed(tag, selection.keyIndex, true);
        }
      }
      return { inputTokens, outputTokens, cachedInputTokens };
    };

    let used: { model: string; tier: string | null } | null = null;
    let result = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
    let firstFallbackFired = false;

    for (let i = 0; i < ladder.length; i++) {
      const rung = ladder[i];
      // Tell the caller once, the first time we leave this ladder's top
      // rung (a Flex→Standard retry of the SAME model is not a drop).
      if (rung.model !== topRung && !firstFallbackFired) {
        firstFallbackFired = true;
        try { req.onFallback?.({ from: topRung, to: rung.model }); }
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

    // Logged model string carries a "-flex" suffix when the winning rung
    // ran on the Flex tier (primary + T1 only; T2 never runs Flex), so the
    // admin dashboard and quota weighting see the discount. Cost goes
    // through costForModel so this stays in lockstep with lib/gemini.ts,
    // including the context-cache rate for cached prompt tokens.
    // result.outputTokens already includes thinking tokens.
    const ranFlex = !!used.tier
      && (used.model === GEMINI_CHAT_MODEL_PRIMARY || used.model === GEMINI_CHAT_MODEL_T1);
    const modelUsed = ranFlex ? `${used.model}-flex` : used.model;

    return {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cachedInputTokens,
      cacheCreationTokens: 0,
      costUsd: costForModel(modelUsed, result.inputTokens, result.outputTokens, result.cachedInputTokens),
      modelUsed,
      withSearch: true,
    };
  },
};

/** Pick the best available provider. Gemini-only today. */
export function pickChatProvider(): ChatProvider {
  return geminiChatProvider;
}
