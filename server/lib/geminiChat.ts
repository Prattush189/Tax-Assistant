/**
 * Gemini native REST API client for streaming chat with Google Search grounding.
 *
 * Uses the native Gemini API (NOT the OpenAI-compatible endpoint) because
 * grounding with Google Search is only available via the native endpoint.
 *
 * Endpoint: POST /v1beta/models/{model}:streamGenerateContent?alt=sse&key={key}
 *
 * Optional context caching (useCache=true): the system prompt is uploaded to
 * Gemini's cachedContents API once per (model, key, prompt-hash) and
 * referenced by name on subsequent calls. Cache reads bill at ~25% of fresh
 * input and shave 50–150ms off first-token latency.
 */

import { getOrCreateCachedContent, invalidateCache } from './geminiCache.js';
import { buildGeminiUserError } from './geminiUserError.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiChatChunk {
  text?: string;
  done?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  sources?: Array<{ title: string; url: string }>;
  /** STOP | MAX_TOKENS | SAFETY | RECITATION | OTHER. Only set on done chunks. */
  finishReason?: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

/**
 * Stream a Gemini chat response with Google Search grounding enabled.
 *
 * Maps from OpenAI-style messages (role: system/user/assistant) to
 * Gemini format (systemInstruction + contents with role: user/model).
 */
export async function* streamGeminiChat(
  model: string,
  systemPrompt: string,
  history: Array<{ role: string; content: string }>,
  userMessage: string,
  apiKey: string,
  maxOutputTokens: number = 4096,
  enableSearch: boolean = false,
  useCache: boolean = false,
  /** Gemini 3 configurable thinking: 'low' (snappy) | 'high' (deep). Omit
   *  for the model default. Ignored by non-thinking models. */
  thinkingLevel: 'low' | 'high' | null = null,
  /** Service tier — e.g. 'flex' (~50% price, relaxed latency). Omit for
   *  Standard. If the endpoint rejects the field the caller's try/catch
   *  falls back to the next model. */
  serviceTier: string | null = null,
): AsyncGenerator<GeminiChatChunk> {
  // Build Gemini contents array
  const contents: GeminiContent[] = [];

  for (const msg of history) {
    if (msg.role === 'system') continue; // system goes to systemInstruction
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }

  // Add the current user message
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }],
  });

  // Optional context cache: if the caller opts in and the prompt is large
  // enough to qualify, send `cachedContent: cachedContents/...` instead of
  // the inline systemInstruction. Falls back to inline on any cache failure.
  //
  // Gemini rejects `cachedContent + tools` in the same call ("CachedContent
  // can not be used with GenerateContent request setting system_instruction,
  // tools or tool_config") — across all current models, not just previews.
  // So when the caller wants Google-Search grounding we skip the cache path
  // entirely; otherwise we'd waste a cache-create HTTP call and a failed 400
  // on every search-enabled request.
  let cachedContentName: string | null = null;
  if (useCache && !enableSearch) {
    cachedContentName = await getOrCreateCachedContent(model, systemPrompt, apiKey);
  }

  // Service tier (e.g. Flex) is mutable so the recovery pass below can
  // drop it and retry on Standard if the endpoint rejects the field —
  // keeps us on THIS model instead of cascading to a weaker one.
  let activeTier = serviceTier;

  // Build the request body. Extracted so we can retry without the cache
  // reference if Gemini rejects the combination (e.g. some preview models
  // reject `cachedContent + tools` in the same call).
  const buildBody = (withCache: boolean) => {
    const generationConfig: Record<string, unknown> = { maxOutputTokens };
    // Gemini 3 configurable thinking. Internal "thought" parts are filtered
    // out of the stream below, so this only affects answer quality/latency.
    if (thinkingLevel) {
      generationConfig.thinkingConfig = { thinkingLevel };
    }
    const b: Record<string, unknown> = { contents, generationConfig };
    if (withCache && cachedContentName) {
      b.cachedContent = cachedContentName;
    } else {
      b.systemInstruction = { parts: [{ text: systemPrompt }] };
    }
    if (enableSearch) {
      b.tools = [{ google_search: {} }];
    }
    // Flex/Priority service tier (opt-in). Dropped + retried on Standard
    // by the recovery pass below if the endpoint rejects the field.
    if (activeTier) {
      b.serviceTier = activeTier;
    }
    return b;
  };

  const url = `${BASE_URL}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const postBody = async (withCache: boolean) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBody(withCache)),
  });

  let response = await postBody(cachedContentName !== null);

  if (!response.ok && (cachedContentName || activeTier)) {
    // One inline recovery pass. A 4xx here is usually an unsupported
    // COMBINATION rather than a fatal error: a preview model may reject
    // `cachedContent + tools`, or this endpoint may not know the
    // `serviceTier` (Flex) field. Drop whichever the error points at and
    // retry once on the SAME model — far better than cascading to a
    // weaker model just because Flex isn't accepted on streaming.
    const errText = await response.text();
    const cacheRelated = !!cachedContentName && (
      response.status === 404 ||
      /not.?found/i.test(errText) ||
      /cached\s*content/i.test(errText));
    // Tier rejections show up as 400 INVALID_ARGUMENT / "unknown name
    // serviceTier" / "unrecognized field". Treat any 4xx while a tier is
    // set as tier-related so a bad-field rejection never downgrades us.
    const tierRelated = !!activeTier && (
      (response.status >= 400 && response.status < 500) ||
      /service.?tier|unknown name|unrecognized|invalid/i.test(errText));
    if (cacheRelated || tierRelated) {
      console.warn(`[geminiChat] ${model} retry (cache=${cacheRelated}, tier=${tierRelated}) after ${response.status}: ${errText.slice(0, 160)}`);
      if (cacheRelated) { invalidateCache(model, systemPrompt, apiKey); cachedContentName = null; }
      if (tierRelated) { activeTier = null; }
      response = await postBody(cachedContentName !== null);
    } else {
      // Unrecoverable — log full upstream body for ops, throw the
      // sanitised user-facing message.
      console.warn(`[geminiChat] ${model} HTTP ${response.status}: ${errText.slice(0, 300)}`);
      throw buildGeminiUserError(response.status, errText);
    }
  }

  if (!response.ok) {
    const errText = await response.text();
    console.warn(`[geminiChat] ${model} HTTP ${response.status}: ${errText.slice(0, 300)}`);
    throw buildGeminiUserError(response.status, errText);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let sources: Array<{ title: string; url: string }> = [];
  let finishReason: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process SSE lines
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;

      let event: any;
      try {
        event = JSON.parse(jsonStr);
      } catch {
        continue; // skip malformed chunks
      }

      // Extract text from candidates — skip "thought" parts from thinking models
      const candidate = event.candidates?.[0];
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.thought) continue; // Gemini 3.x thinking models emit internal reasoning; hide it
          if (part.text) {
            yield { text: part.text };
          }
        }
      }
      if (candidate?.finishReason) {
        finishReason = candidate.finishReason;
      }

      // Extract grounding metadata (sources)
      const grounding = candidate?.groundingMetadata;
      if (grounding?.groundingChunks) {
        for (const chunk of grounding.groundingChunks) {
          if (chunk.web?.uri && chunk.web?.title) {
            sources.push({ title: chunk.web.title, url: chunk.web.uri });
          }
        }
      }

      // Extract usage metadata (usually in the last chunk)
      if (event.usageMetadata) {
        totalInputTokens = event.usageMetadata.promptTokenCount ?? totalInputTokens;
        totalOutputTokens = event.usageMetadata.candidatesTokenCount ?? totalOutputTokens;
      }
    }
  }

  // Deduplicate sources
  const uniqueSources = sources.filter(
    (s, i, arr) => arr.findIndex(x => x.url === s.url) === i,
  );

  yield {
    done: true,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    sources: uniqueSources.length > 0 ? uniqueSources : undefined,
    finishReason,
  };
}
