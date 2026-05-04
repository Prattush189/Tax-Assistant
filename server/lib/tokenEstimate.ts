/**
 * Pre-flight token estimators for the routes that hit AI services
 * hardest (bank statements + ledger scrutiny). Used by the quota gate
 * to decide whether a request fits in the user's remaining WEIGHTED
 * budget BEFORE any tokens are spent.
 *
 * Returns are in WEIGHTED tokens (input × wIn + output × wOut for
 * the target model) so they can be compared directly against
 * weighted_tokens summed from api_usage. All callers below assume
 * the cheapest active path (Gemini T2: wIn=1, wOut=4); routes that
 * specifically target Sonnet vision should use estimateClaudeVision()
 * instead.
 *
 * Heuristics, not measurements. Goals:
 *   - Cheap (no model round-trip).
 *   - Conservative-leaning: overestimating is fine; underestimating
 *     is the failure mode that pushes a user past their cap.
 *   - Aligned with how each route actually consumes tokens.
 *
 * Margin: 10% applied to every estimator. Empirically, char/4 lines
 * up with Gemini's tokenizer on English-heavy content within ~5%;
 * 10% covers the long tail (Hindi narrations, special chars, fixed
 * prompt overhead per chunk).
 */

const SAFETY_MARGIN = 1.10;
const TOKENS_PER_CHAR = 1 / 4;

// T2 (gemini-2.5-flash-lite) weights — the cheapest active model
// and the anchor of the weighting system. Most estimators below
// assume the call will run on T2.
const T2_W_IN = 1.0;
const T2_W_OUT = 4.0;

/** Weighted tokens for a chunk of plain text input (prompt + payload).
 *  Treated as input-only (no output produced from the input alone),
 *  so the weight collapses to T2 input × 1.0. */
export function estimateFromChars(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars * TOKENS_PER_CHAR * T2_W_IN * SAFETY_MARGIN);
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
  const inputTokens = (rawTextChars + chunks * PROMPT_CHARS_PER_CHUNK) * TOKENS_PER_CHAR;
  // Output ≈ ~half the input chars on a typical TSV extraction.
  const outputTokens = rawTextChars * 0.5 * TOKENS_PER_CHAR;
  return Math.ceil((inputTokens * T2_W_IN + outputTokens * T2_W_OUT) * SAFETY_MARGIN);
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
  const PAGES_PER_BATCH = 3;
  const pages = Math.max(1, Math.ceil(fileSizeBytes / 1024 / KB_PER_PAGE));
  const batches = pages <= 4 ? 1 : Math.ceil(pages / PAGES_PER_BATCH);
  const inputTokens = pages * TOKENS_PER_PAGE + batches * 800;
  const outputTokens = Math.min(16_384 * batches, pages * 600);
  // Vision currently runs on Gemini T2 (chunked). The next commit
  // swaps this path to Sonnet 4.5 — at that point the caller should
  // switch to estimateClaudeVision() (30×/150× weights vs T2's 1×/4×).
  // For now the estimator stays anchored at T2 weights, which mirrors
  // the actual model running today.
  return Math.ceil((inputTokens * T2_W_IN + outputTokens * T2_W_OUT) * SAFETY_MARGIN);
}

/**
 * Estimate for the ledger-scrutiny TEXT path. Same shape as bank
 * statements but with a heavier scrutiny pass on top — every chunk
 * runs the audit prompt over the same rows.
 */
export function estimateLedgerText(rawTextChars: number): number {
  if (rawTextChars <= 0) return 0;
  const extractEstimate = estimateBankStatementText(rawTextChars);
  const SCRUTINY_PROMPT_CHARS = 3_500;
  const SCRUTINY_OUTPUT_FACTOR = 0.35;
  const scrutinyInputTokens = (rawTextChars + SCRUTINY_PROMPT_CHARS) * TOKENS_PER_CHAR;
  const scrutinyOutputTokens = rawTextChars * SCRUTINY_OUTPUT_FACTOR * TOKENS_PER_CHAR;
  const scrutinyWeighted = Math.ceil((scrutinyInputTokens * T2_W_IN + scrutinyOutputTokens * T2_W_OUT) * SAFETY_MARGIN);
  return extractEstimate + scrutinyWeighted;
}

/** Vision path for ledger PDFs. Two-pass (extract + scrutinize). */
export function estimateLedgerVision(fileSizeBytes: number): number {
  if (fileSizeBytes <= 0) return 0;
  const visionEstimate = estimateBankStatementVision(fileSizeBytes);
  // Scrutiny pass runs on T2 over structured output — text-cost shape.
  const KB_PER_PAGE = 200;
  const pages = Math.max(1, Math.ceil(fileSizeBytes / 1024 / KB_PER_PAGE));
  const SCRUTINY_TOKENS_PER_PAGE = 1_800;
  // Half input / half output as a rough split.
  const scrutinyInputTokens = pages * SCRUTINY_TOKENS_PER_PAGE * 0.5;
  const scrutinyOutputTokens = pages * SCRUTINY_TOKENS_PER_PAGE * 0.5;
  const scrutinyWeighted = Math.ceil((scrutinyInputTokens * T2_W_IN + scrutinyOutputTokens * T2_W_OUT) * SAFETY_MARGIN);
  return visionEstimate + scrutinyWeighted;
}
