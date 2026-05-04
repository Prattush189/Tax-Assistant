/**
 * Claude Sonnet 4.5 vision extractor.
 *
 * Used for every "we need AI to read a PDF or image" path that
 * previously routed to Gemini vision (geminiVisionPdf.ts +
 * pdfPageChunks.ts). Anthropic's API natively handles multi-page
 * PDFs as `document` content blocks up to 100 pages — single call,
 * no chunking, no per-batch merge logic.
 *
 * Why we swapped off Gemini vision:
 *   - Gemini's OpenAI-compatible shim silently truncated PDFs to
 *     page 1 ("AI vision only analyzed page 1 of 17").
 *   - The native Gemini generateContent endpoint worked but its
 *     thinking-token model ate the output budget and forced us
 *     into 6-batch chunking with per-batch merging — fragile
 *     plumbing for what should be a single API call.
 *   - Sonnet handles all of that natively at a higher per-token
 *     cost. The weighting system (lib/modelWeights.ts) charges
 *     Sonnet at 30× input / 150× output against the user's
 *     quota, so cost economics stay sane.
 *
 * Hard limit: 100 pages per request. We block client-side and
 * server-side; user message points them at CSV / digital PDF.
 */

import Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';
import { safeParseJson, type GeminiJsonOptions, type GeminiJsonResult } from './geminiJson.js';
import { withBreaker } from './circuitBreaker.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
if (!ANTHROPIC_API_KEY) {
  console.warn('[claude] ANTHROPIC_API_KEY is not set. Vision-on-Sonnet paths will fail until you add it to .env.');
}

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY || 'missing-anthropic-key-placeholder',
});

export const SONNET_MODEL = 'claude-sonnet-4-5-20250929';
export const PDF_PAGE_LIMIT = 100;

export class ClaudePageLimitError extends Error {
  constructor(public readonly pageCount: number) {
    super(`PDF has ${pageCount} pages, exceeds the ${PDF_PAGE_LIMIT}-page limit for AI vision. Please upload a CSV export or split the file.`);
    this.name = 'ClaudePageLimitError';
  }
}

export interface ClaudeVisionOptions {
  /** Output token cap. Defaults to 8192. */
  maxTokens?: number;
  /** Optional override (e.g. claude-sonnet-4-5-20250929 vs floating
   *  alias). Defaults to the pinned dated snapshot in SONNET_MODEL. */
  model?: string;
  /** Pass-through usage logging callback — mirrors callGeminiJson's
   *  recordAttempt so cost-tracking call sites stay symmetric. */
  recordAttempt?: GeminiJsonOptions['recordAttempt'];
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

/**
 * Count the page count of a PDF buffer using pdf-lib (already in
 * deps for the chunked-vision code we're about to delete). Used to
 * block oversized uploads before burning a Sonnet call on something
 * Anthropic will reject anyway.
 */
export async function countPdfPages(buffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return doc.getPageCount();
}

/**
 * Extract structured data from a PDF or image via Sonnet 4.5. PDFs
 * over PDF_PAGE_LIMIT pages throw ClaudePageLimitError BEFORE the
 * API call so we don't waste tokens on a request that'll fail.
 *
 * Returns the same shape as the Gemini extractWithRetry contract
 * (data + token usage + modelUsed) so call sites can swap with a
 * one-line change.
 */
export async function extractClaudeVision<T = unknown>(
  buffer: Buffer,
  mimeType: string,
  prompt: string,
  opts: ClaudeVisionOptions = {},
): Promise<GeminiJsonResult<T>> {
  const isPdf = mimeType === 'application/pdf';
  if (isPdf) {
    const pages = await countPdfPages(buffer);
    if (pages > PDF_PAGE_LIMIT) {
      throw new ClaudePageLimitError(pages);
    }
  }

  const model = opts.model ?? SONNET_MODEL;
  const maxTokens = opts.maxTokens ?? 8192;
  const recordAttempt = opts.recordAttempt;

  // Anthropic's content blocks: image vs document mime mapping.
  // Documents (PDFs) use `type: 'document'`; images use `type:
  // 'image'`. Both source on a base64 payload.
  const contentBlock = isPdf
    ? {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: buffer.toString('base64') },
      }
    : {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
          data: buffer.toString('base64'),
        },
      };

  return withBreaker('anthropic', async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let succeeded = false;
      let inputTokens = 0;
      let outputTokens = 0;
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          messages: [{
            role: 'user',
            content: [contentBlock, { type: 'text', text: prompt }],
          }],
        });
        inputTokens = response.usage.input_tokens;
        outputTokens = response.usage.output_tokens;

        // Concat all text blocks (Sonnet may emit multiple). The
        // safeParseJson helper handles markdown-fence stripping +
        // truncation recovery, same as Gemini paths.
        const raw = response.content
          .filter((c): c is Anthropic.TextBlock => c.type === 'text')
          .map(c => c.text)
          .join('');
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
          console.warn(`[claudeVision] ${model} retry ${attempt + 1}/${MAX_ATTEMPTS} after status ${status}`);
          await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt)));
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  });
}
