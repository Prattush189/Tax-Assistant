/**
 * Gemini vision extractor — sends a PDF / image inline as base64 to
 * Gemini's native generateContent API and returns parsed JSON.
 *
 * Model selection: callers default to GEMINI_CHAT_MODEL_T1 (the 3.x
 * Flash-Lite preview, cheaper than Sonnet and good enough on most
 * Tally / Busy ledger layouts). Sonnet remains the fallback via
 * extractVisionWithFallback() below.
 *
 * Hard request-size limit: Gemini accepts up to 20 MB per inline-data
 * request. We don't enforce that here — pdf-lib counts pages and
 * the multer 10 MB cap on the route layer keeps payloads well under.
 */

import { GEMINI_API_KEYS, GEMINI_CHAT_MODEL_T1 } from './gemini.js';
import { safeParseJson, type GeminiJsonOptions, type GeminiJsonResult } from './geminiJson.js';
import { withBreaker } from './circuitBreaker.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiVisionOptions {
  /** Output token cap. Defaults to 8192. */
  maxTokens?: number;
  /** Override the Gemini model. Defaults to T1 (3.x Flash-Lite preview). */
  model?: string;
  /** Pass-through usage logging callback. */
  recordAttempt?: GeminiJsonOptions['recordAttempt'];
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

/**
 * Extract structured data from a PDF or image via Gemini vision.
 * Returns the same { data, inputTokens, outputTokens, modelUsed }
 * shape as extractClaudeVision so callers can swap freely.
 */
export async function extractGeminiVision<T = unknown>(
  buffer: Buffer,
  mimeType: string,
  prompt: string,
  opts: GeminiVisionOptions = {},
): Promise<GeminiJsonResult<T>> {
  const model = opts.model ?? GEMINI_CHAT_MODEL_T1;
  const maxTokens = opts.maxTokens ?? 8192;
  const recordAttempt = opts.recordAttempt;
  const apiKey = GEMINI_API_KEYS[0] ?? '';
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const inlineData = {
    mime_type: mimeType,
    data: buffer.toString('base64'),
  };

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inline_data: inlineData },
        { text: prompt },
      ],
    }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
      // 3.x Flash-Lite Preview burns most of max_tokens on internal
      // reasoning tokens by default — explicitly zero the thinking
      // budget so the entire output budget goes to the JSON we want.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  return withBreaker('gemini', async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let succeeded = false;
      let inputTokens = 0;
      let outputTokens = 0;
      try {
        const url = `${BASE_URL}/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text();
          const status = res.status;
          const err = new Error(`Gemini ${model} vision error ${status}: ${text.slice(0, 300)}`);
          (err as { status?: number }).status = status;
          throw err;
        }
        const json = await res.json() as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        inputTokens = json.usageMetadata?.promptTokenCount ?? 0;
        outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0;

        const raw = (json.candidates?.[0]?.content?.parts ?? [])
          .map(p => p.text ?? '')
          .join('');
        if (!raw) throw new Error('Gemini returned empty response');
        const parsed = safeParseJson<T>(raw);
        if (parsed === null) throw new Error('Failed to parse AI response');
        succeeded = true;
        return { data: parsed, inputTokens, outputTokens, modelUsed: model };
      } catch (err) {
        lastErr = err;
        recordAttempt?.({ failed: !succeeded, inputTokens, outputTokens, model });
        const status = (err as { status?: number })?.status ?? 0;
        if (!RETRYABLE_STATUSES.has(status)) break;
        if (attempt < MAX_ATTEMPTS - 1) {
          console.warn(`[geminiVision] ${model} retry ${attempt + 1}/${MAX_ATTEMPTS} after status ${status}`);
          await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt)));
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  });
}
