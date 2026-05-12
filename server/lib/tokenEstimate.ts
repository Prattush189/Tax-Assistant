/**
 * Pre-flight token estimators for the routes that hit AI services
 * hardest (bank statements + ledger scrutiny). Used by the quota gate
 * to decide whether a request fits in the user's remaining WEIGHTED
 * budget BEFORE any tokens are spent.
 *
 * Returns are in WEIGHTED tokens (input × wIn + output × wOut for
 * the target model) so they can be compared directly against
 * weighted_tokens summed from api_usage. All callers below assume
 * the cheapest active path (Gemini T2: wIn=1, wOut=4). Vision paths
 * (estimateGeminiVision / estimateBankStatementVision / etc.) use
 * the same Gemini weights — the Anthropic / Sonnet provider was
 * removed from the project entirely.
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
// Heavier multiplier for routes that occasionally retry/bisect/
// fallback. Earlier this was set at 3.5× to avoid a "you'd exceed
// your quota" pre-flight rejection on dense statements. Empirically
// that produced massive negative deviations on the dashboard
// (estimate 3.3M vs actual 350K → -89%): bank/ledger calls almost
// always run once cleanly, the T1 fallback (2.5× weights) only
// fires on a Gemini outage, and bisection only triggers on
// Gemini-3 MAX_TOKENS truncation. 1.5× covers the small-tail of
// retries while keeping average-case deviations in the ±25% band.
const RETRY_HEAVY_MARGIN = 1.5;
const TOKENS_PER_CHAR = 1 / 4;

// ── Per-row calibration (2026-05) ──────────────────────────────────
// Empirical observation from production runs: a single bank-statement
// transaction row consumes ~80-100 raw tokens end-to-end (input row
// chars + amortized system-prompt overhead + verbose TSV output that
// echoes the narration). A ledger scrutiny row averages ~60-80 raw
// tokens on top of the extract pass (chunked audit prompt over rows
// + observation JSON output).
//
// The previous char-ratio formula (input = chars × 0.25, output = chars
// × 0.18 × 0.25) underestimated this by ~3×: a 50-row chunk landed at
// ~25 raw tokens/row in the estimator vs ~90 in actuals. That pushed
// pre-flight estimates 5-13× under the real spend on the admin
// dashboard's deviation tile.
//
// Numbers below are pinned to the user's observed range; pick the top
// of each band so the estimator leans conservative (overestimating is
// safe — underestimating is what lets users blow past their cap).
const BANK_RAW_TOKENS_PER_ROW = 95;            // observed 80-100; pick 95
const LEDGER_SCRUTINY_RAW_TOKENS_PER_ROW = 75; // observed 60-80; pick 75
// Typical Tally / Busy / bank row width (date + voucher/ref + narration
// + amount cols). 60-80 chars per row in real exports; 70 is a
// reasonable middle for converting rawTextChars → rows.
const CHARS_PER_ROW = 70;
// Per-row split between input and output (raw tokens). Empirical:
// output dominates because the model echoes narrations verbatim into
// TSV/JSON and emits per-row fields (date/voucher/debit/credit/
// balance/classification). With T2's 4× output weight, getting this
// split right matters more than the total — input-heavy bias would
// under-weight the final estimate.
const ROW_INPUT_FRAC = 0.30;
const ROW_OUTPUT_FRAC = 0.70;

// T2 (gemini-2.5-flash-lite) weights — the cheapest active model
// and the anchor of the weighting system. Most estimators below
// assume the call will run on T2.
const T2_W_IN = 1.0;
const T2_W_OUT = 4.0;

// Gemini vision weights (T2 anchor) — used by estimateGeminiVision()
// for the scanned-PDF and image vision paths. Gemini bills image /
// PDF document blocks at ~260 input tokens per page and emits the
// structured JSON output at the T2 output rate. The whole vision
// chain (extractVisionWithFallback: T1 → T2) is anchored to T2
// weights for the estimator since T2 is the floor of what the
// caller will actually be charged.
const GEMINI_VISION_TOKENS_PER_PAGE_INPUT = 260;
const GEMINI_VISION_TOKENS_PER_PAGE_OUTPUT = 800;

/**
 * Weighted-token estimate for a Gemini vision call (scanned-PDF /
 * image path). The vision chain runs T1 (Gemini 3.1 Flash-Lite
 * Preview) with T2 fallback; cost is anchored to T2 weights for
 * pre-flight quoting because that's the floor — the gate stays
 * generous on the actual T1 happy path.
 *
 * Previously named `estimateClaudeVision` and used Sonnet's 30×/150×
 * weights for the same routes. The Anthropic provider was removed
 * from the project (the 2026-05 prod key went inactive); recalibrated
 * to Gemini weights so the pre-flight quota gate no longer over-
 * quotes vision uploads by ~25–40×.
 */
export function estimateGeminiVision(fileSizeBytes: number, opts: { pageCount?: number } = {}): number {
  if (fileSizeBytes <= 0) return 0;
  const KB_PER_PAGE = 200;
  const pages = opts.pageCount ?? Math.max(1, Math.ceil(fileSizeBytes / 1024 / KB_PER_PAGE));
  const inputTokens = pages * GEMINI_VISION_TOKENS_PER_PAGE_INPUT + 500; // + prompt overhead
  const outputTokens = pages * GEMINI_VISION_TOKENS_PER_PAGE_OUTPUT;
  return Math.ceil((inputTokens * T2_W_IN + outputTokens * T2_W_OUT) * SAFETY_MARGIN);
}

/** Weighted tokens for a chunk of plain text input (prompt + payload).
 *  Treated as input-only (no output produced from the input alone),
 *  so the weight collapses to T2 input × 1.0. */
export function estimateFromChars(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars * TOKENS_PER_CHAR * T2_W_IN * SAFETY_MARGIN);
}

/**
 * Estimate for the bank-statement TEXT path (digital PDFs the client
 * pre-extracted). Input is rawText; output is TSV — one row per
 * transaction.
 *
 * Calibrated to the BANK_RAW_TOKENS_PER_ROW empirical constant
 * (~95 raw tokens / row, observed 80-100 in production). The
 * previous char-ratio formula (input = chars × 0.25, output = chars
 * × 0.18 × 0.25) under-counted by ~3× because it missed:
 *   - amortized system-prompt overhead per chunk
 *   - the TSV output echoing full narrations verbatim (not the
 *     "~45 chars per row" the older comment claimed)
 *   - per-row classification + balance columns
 *
 * The per-row approach also makes the dependency explicit: estimate
 * scales with row count, which matches how Gemini's tokenizer
 * actually consumes the chunk.
 */
export function estimateBankStatementText(rawTextChars: number): number {
  if (rawTextChars <= 0) return 0;
  const rows = Math.max(1, Math.ceil(rawTextChars / CHARS_PER_ROW));
  const inputTokens = rows * BANK_RAW_TOKENS_PER_ROW * ROW_INPUT_FRAC;
  const outputTokens = rows * BANK_RAW_TOKENS_PER_ROW * ROW_OUTPUT_FRAC;
  return Math.ceil((inputTokens * T2_W_IN + outputTokens * T2_W_OUT) * RETRY_HEAVY_MARGIN);
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
  // Vision runs on Gemini (T1 with T2 fallback). Anchored to T2
  // weights here since that's the floor — the T1 happy path costs
  // marginally more per token but the gate already includes a 1.5×
  // retry margin that covers the difference.
  return Math.ceil((inputTokens * T2_W_IN + outputTokens * T2_W_OUT) * RETRY_HEAVY_MARGIN);
}

/**
 * Weighted-token estimate for ONLY the ledger scrutiny audit pass —
 * no preceding extract pass. Used by pre-extracted upload (the
 * client-side wizard already extracted), the side-by-side compare
 * (both ledgers come pre-structured), and the resume-after-failure
 * path (raw_extracted is already on disk).
 *
 * Calibrated to LEDGER_SCRUTINY_RAW_TOKENS_PER_ROW (~75 raw tokens /
 * row, observed 60-80 in production). The previous char-ratio formula
 * under-estimated by ~3× — same root cause as the bank text path:
 * the audit output JSON includes observation messages, amounts, and
 * suggested actions that scale with the row count, not just the
 * input chars.
 *
 * Anchored to T2 weights because that's where the scrutiny prompt
 * always runs.
 */
export function estimateLedgerScrutinyOnly(rawTextChars: number): number {
  if (rawTextChars <= 0) return 0;
  const rows = Math.max(1, Math.ceil(rawTextChars / CHARS_PER_ROW));
  const inputTokens = rows * LEDGER_SCRUTINY_RAW_TOKENS_PER_ROW * ROW_INPUT_FRAC;
  const outputTokens = rows * LEDGER_SCRUTINY_RAW_TOKENS_PER_ROW * ROW_OUTPUT_FRAC;
  return Math.ceil((inputTokens * T2_W_IN + outputTokens * T2_W_OUT) * RETRY_HEAVY_MARGIN);
}

/**
 * Estimate for the ledger-scrutiny TEXT path. Same shape as bank
 * statements but with a heavier scrutiny pass on top — every chunk
 * runs the audit prompt over the same rows.
 */
export function estimateLedgerText(rawTextChars: number): number {
  if (rawTextChars <= 0) return 0;
  return estimateBankStatementText(rawTextChars) + estimateLedgerScrutinyOnly(rawTextChars);
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
  const scrutinyWeighted = Math.ceil((scrutinyInputTokens * T2_W_IN + scrutinyOutputTokens * T2_W_OUT) * RETRY_HEAVY_MARGIN);
  return visionEstimate + scrutinyWeighted;
}
