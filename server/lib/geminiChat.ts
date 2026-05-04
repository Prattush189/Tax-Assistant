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

  // Build the request body. Extracted so we can retry without the cache
  // reference if Gemini rejects the combination (e.g. some preview models
  // reject `cachedContent + tools` in the same call).
  const buildBody = (withCache: boolean) => {
    const b: Record<string, unknown> = { contents, generationConfig: { maxOutputTokens } };
    if (withCache && cachedContentName) {
      b.cachedContent = cachedContentName;
    } else {
      b.systemInstruction = { parts: [{ text: systemPrompt }] };
    }
    if (enableSearch) {
      b.tools = [{ google_search: {} }];
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

  if (!response.ok && cachedContentName) {
    // Peek at the error — if it's cache-related (Gemini usually returns
    // "CachedContent can not be ..." or "NOT_FOUND"), drop our local cache
    // entry and retry once with the inline systemInstruction. This keeps
    // chat working when a specific (model, search, cache) combination is
    // unsupported by a preview model, without taking caching down entirely.
    const errText = await response.text();
    const cacheRelated =
      response.status === 404 ||
      /not.?found/i.test(errText) ||
      /cached\s*content/i.test(errText);
    if (cacheRelated) {
      console.warn(`[geminiChat] cache rejected by ${model} (${response.status}); retrying inline. ${errText.slice(0, 160)}`);
      invalidateCache(model, systemPrompt, apiKey);
      cachedContentName = null;
      response = await postBody(false);
    } else {
      // Non-cache error — throw with the text we already consumed.
      throw new Error(`AI service error ${response.status}: ${errText.slice(0, 300)}`);
    }
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini ${model} error ${response.status}: ${errText.slice(0, 300)}`);
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
