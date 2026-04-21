// server/lib/documentExtract.ts
//
// Shared Gemini document-extraction helpers. Used by the generic /api/upload
// route and by the bank statement analyzer route. Both routes call Gemini with
// a JSON schema prompt and need the same retry-with-fallback-model behavior.
import { gemini, GEMINI_MODEL, GEMINI_FALLBACK_MODEL } from './gemini.js';

export interface ExtractOptions {
  /** Gemini max_tokens cap. Defaults to 4096. Bank statements bump this to 8192. */
  maxTokens?: number;
  /** Override the primary model (e.g. use flash directly for complex tasks). */
  primaryModel?: string;
  /** Override the fallback model. */
  fallbackModel?: string;
}

/** Parse JSON safely — strips markdown fences and attempts recovery on truncated strings. */
export function safeParseJson(raw: string): any {
  let cleaned = raw
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through to recovery
  }

  try {
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      else if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth--;
    }

    if (inString) cleaned += '"';
    while (bracketDepth > 0) { cleaned += ']'; bracketDepth--; }
    while (braceDepth > 0) { cleaned += '}'; braceDepth--; }

    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function callGemini(dataUrl: string, prompt: string, model: string, maxTokens: number): Promise<any> {
  const response = await gemini.chat.completions.create({
    model,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: prompt },
      ],
    }],
  });
  const raw = response.choices[0]?.message?.content ?? '{}';
  const parsed = safeParseJson(raw);
  if (!parsed) throw new Error('Failed to parse extraction JSON');
  return parsed;
}

/**
 * Extract structured data from a PDF/image data URL by calling Gemini with the
 * provided prompt. Retries the primary model up to 3 times on transient
 * errors, then falls back to the larger model once before giving up.
 */
export async function extractWithRetry(dataUrl: string, prompt: string, opts: ExtractOptions = {}): Promise<any> {
  const maxTokens = opts.maxTokens ?? 4096;
  const primary = opts.primaryModel ?? GEMINI_MODEL;
  const fallback = opts.fallbackModel ?? GEMINI_FALLBACK_MODEL;
  const MAX_PRIMARY_ATTEMPTS = 3;
  let lastErr: any;

  for (let attempt = 0; attempt < MAX_PRIMARY_ATTEMPTS; attempt++) {
    try {
      return await callGemini(dataUrl, prompt, primary, maxTokens);
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? 0;
      const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (!retryable) break;
      if (attempt < MAX_PRIMARY_ATTEMPTS - 1) {
        console.warn(`[documentExtract] ${primary} retry ${attempt + 1}/${MAX_PRIMARY_ATTEMPTS} after status ${status}`);
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  console.warn(`[documentExtract] ${primary} failed, falling back to ${fallback}`);
  try {
    return await callGemini(dataUrl, prompt, fallback, maxTokens);
  } catch (err) {
    lastErr = err;
  }

  throw lastErr;
}
