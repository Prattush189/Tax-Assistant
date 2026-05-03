/**
 * Pre-flight token estimators for the routes that hit Gemini hardest
 * (bank statements + ledger scrutiny). Used by the quota gate to
 * decide whether a request fits in the user's remaining budget BEFORE
 * any tokens are spent.
 *
 * Heuristics, not measurements. Goals:
 *   - Cheap (no model round-trip).
 *   - Conservative-leaning: overestimating is fine (the run still
 *     succeeds, the user just sees a slightly tighter "remaining"
 *     mid-flight). Underestimating is the failure mode that pushes
 *     a user past their cap, so apply a safety margin.
 *   - Aligned with how each route actually consumes tokens, not a
 *     one-size estimate.
 *
 * Margin: 10% applied to every estimator. Empirically, char/4 lines
 * up with Gemini's tokenizer on English-heavy content within ~5%;
 * 10% covers the long tail (Hindi narrations, special chars, the
 * fixed prompt overhead per chunk).
 */

const SAFETY_MARGIN = 1.10;
const TOKENS_PER_CHAR = 1 / 4;

/** Tokens for a chunk of plain text input (prompt + payload). */
export function estimateFromChars(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars * TOKENS_PER_CHAR * SAFETY_MARGIN);
}

/**
 * Estimate for the bank-statement TEXT path (digital PDFs the client
 * pre-extracted). Input is rawText; output is TSV (~70 chars/row, one
 * row per transaction). Empirically ~1 transaction per 35 chars of
 * raw input on dense statements.
 *
 *   input_tokens  ≈ chars / 4
 *   output_tokens ≈ (chars / 35) × 70 / 4   ≈ chars / 2 / 4
 *
 * Plus per-chunk prompt overhead — the 8K-char chunks add ~1500
 * chars of fixed prompt each, which dominates on small statements.
 */
export function estimateBankStatementText(rawTextChars: number): number {
  if (rawTextChars <= 0) return 0;
  const CHUNK_CHARS = 8_000;
  const PROMPT_CHARS_PER_CHUNK = 1_500;
  const chunks = Math.max(1, Math.ceil(rawTextChars / CHUNK_CHARS));
  const inputChars = rawTextChars + chunks * PROMPT_CHARS_PER_CHUNK;
  // Output ≈ ~half the input chars on a typical TSV extraction.
  const outputChars = Math.ceil(rawTextChars * 0.5);
  return Math.ceil((inputChars + outputChars) * TOKENS_PER_CHAR * SAFETY_MARGIN);
}

/**
 * Estimate for the bank-statement VISION path (scanned PDFs / images).
 * Vision input is dominated by image tokens — Gemini bills roughly
 * 250-300 tokens per image-page tile. Use file size as a rough page
 * count proxy: scanned PDFs trend ~150-300 KB/page.
 *
 * Output is the full JSON ExtractedStatement at maxTokens=16K — vision
 * runs go big because dense scans surface a lot of transactions and
 * the JSON serialization adds 3-4x overhead vs TSV.
 */
export function estimateBankStatementVision(fileSizeBytes: number): number {
  if (fileSizeBytes <= 0) return 0;
  const KB_PER_PAGE = 200;
  const TOKENS_PER_PAGE = 280;
  const PAGES_PER_BATCH = 3; // matches splitPdfIntoBatches default
  const pages = Math.max(1, Math.ceil(fileSizeBytes / 1024 / KB_PER_PAGE));
  // Vision now runs as N batches of ~3 pages each, not one giant
  // call. Each batch repeats the full prompt (~800 tokens of overhead)
  // so the per-page input cost is the same, plus a per-batch
  // multiplier for prompt repetition. Output stays proportional to
  // page count overall but caps at 8K per batch (no longer 32K
  // single-shot).
  const batches = pages <= 4 ? 1 : Math.ceil(pages / PAGES_PER_BATCH);
  const inputTokens = pages * TOKENS_PER_PAGE + batches * 800;
  const outputTokens = Math.min(8_192 * batches, pages * 600);
  return Math.ceil((inputTokens + outputTokens) * SAFETY_MARGIN);
}

/**
 * Estimate for the ledger-scrutiny TEXT path. Same shape as bank
 * statements but with a heavier scrutiny pass on top — every chunk
 * runs the audit prompt over the same rows.
 */
export function estimateLedgerText(rawTextChars: number): number {
  if (rawTextChars <= 0) return 0;
  // Extract pass is the dominant cost; scrutiny replays a smaller
  // structured payload but with a longer prompt.
  const extractEstimate = estimateBankStatementText(rawTextChars);
  const SCRUTINY_PROMPT_CHARS = 3_500;
  const SCRUTINY_OUTPUT_FACTOR = 0.35; // observations + reasoning
  const scrutinyTokens = Math.ceil(
    (rawTextChars * SCRUTINY_OUTPUT_FACTOR + SCRUTINY_PROMPT_CHARS) *
    TOKENS_PER_CHAR *
    SAFETY_MARGIN,
  );
  return extractEstimate + scrutinyTokens;
}

/** Vision path for ledger PDFs. Two-pass (extract + scrutinize) like text. */
export function estimateLedgerVision(fileSizeBytes: number): number {
  if (fileSizeBytes <= 0) return 0;
  const visionEstimate = estimateBankStatementVision(fileSizeBytes);
  // Scrutiny pass after extraction — runs on the structured output,
  // not the raw image, so it's text-cost-shaped.
  const KB_PER_PAGE = 200;
  const pages = Math.max(1, Math.ceil(fileSizeBytes / 1024 / KB_PER_PAGE));
  const SCRUTINY_TOKENS_PER_PAGE = 1_800;
  const scrutinyTokens = Math.ceil(pages * SCRUTINY_TOKENS_PER_PAGE * SAFETY_MARGIN);
  return visionEstimate + scrutinyTokens;
}
