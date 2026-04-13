/**
 * Gemini native REST API client for streaming chat with Google Search grounding.
 *
 * Uses the native Gemini API (NOT the OpenAI-compatible endpoint) because
 * grounding with Google Search is only available via the native endpoint.
 *
 * Endpoint: POST /v1beta/models/{model}:streamGenerateContent?alt=sse&key={key}
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiChatChunk {
  text?: string;
  done?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  sources?: Array<{ title: string; url: string }>;
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

  const body: Record<string, unknown> = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
    generationConfig: {
      maxOutputTokens,
    },
  };

  // Only enable Google Search grounding when needed — preserves free quota
  if (enableSearch) {
    body.tools = [{ google_search: {} }];
  }

  const url = `${BASE_URL}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

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
  };
}
