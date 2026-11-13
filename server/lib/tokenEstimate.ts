/**
 * Pre-flight token estimators for the routes that hit AI services
 * hardest (bank statements + ledger scrutiny). Used by the quota gate
 * to decide whether a request fits in the user's remaining WEIGHTED
 * budget BEFORE any tokens are spent.
 *
 * Returns are in WEIGHTED tokens so they can be compared directly
 * against weighted_tokens summed from api_usage.
 *
 * MODEL ANCHOR (2026-11-13). The raw token counts below were calibrated
 * on Gemini 3.1 Flash-Lite; they are priced with computeWeightedTokens()
 * for the model the gated route runs on RIGHT NOW (routeModel): Claude
 * while the admin switch is on, Gemini T2 when it is off. So a model
 * swap (env or code) re-prices the estimates automatically, and any
 * charging rule in computeWeightedTokens applies to them too. Claude
 * calls also carry the web-search tool definition (~2.8K input tokens
 * per call), added per estimated call. Until 2026-11-13 these were
 * hard-anchored to Flash-Lite weights (2.5x / 15x), which under-quoted
 * the Claude routes by ~8x (Sonnet) to ~16x (Opus).
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

import { computeWeightedTokens } from './modelWeights.js';
import { isClaudeActive, CLAUDE_MODEL, CLAUDE_MODEL_FAST } from './claude.js';
import { GEMINI_MODEL } from './gemini.js';

/** The model a gated route will run on: Claude while the admin switch is
 *  on ('smart' = ledger scrutiny and scanned ledgers, 'fast' = statement
 *  reads and classification), else Gemini T2. */
function routeModel(tier: 'fast' | 'smart'): string {
  if (!isClaudeActive()) return GEMINI_MODEL;
  return tier === 'smart' ? CLAUDE_MODEL : CLAUDE_MODEL_FAST;
}

/** Claude's basic web-search tool definition, sent on every call
 *  (measured ~2.7K input tokens on Opus 2026-11-12). */
const CLAUDE_SEARCH_TOOL_TOKENS = 2_800;

/** Price raw input/output tokens for the route's model. `calls` adds the
 *  per-call search-tool overhead on Claude. */
function weigh(tier: 'fast' | 'smart', inputTokens: number, outputTokens: number, calls = 1): number {
  const model = routeModel(tier);
  const toolTokens = model.startsWith('claude-') ? Math.max(1, calls) * CLAUDE_SEARCH_TOOL_TOKENS : 0;
  return computeWeightedTokens(model, Math.ceil(inputTokens + toolTokens), Math.ceil(outputTokens));
}

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
// (Ledger scrutiny has its own input/output split, by estimateLedgerScrutinyOnly.)
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

// Rows per model call, for the per-call search-tool overhead: the
// statement CSV classifier batches 40 rows; ledger scrutiny chunks are
// capped at 8,000 characters (~110 rows).
const ROWS_PER_CALL = 100;

// Vision raw tokens per page — calibrated on Gemini (it bills image /
// PDF document blocks at ~260 input tokens per page); priced for the
// route's model by weigh(). bank_statement_ocr estimates matched the
// actuals within 1% on Gemini (Oct 2026).
const GEMINI_VISION_TOKENS_PER_PAGE_INPUT = 260;
const GEMINI_VISION_TOKENS_PER_PAGE_OUTPUT = 800;

/**
 * Weighted-token estimate for a scanned-PDF / image read (bank-statement
 * scans, scanned ledgers). The name is historical: the read runs on
 * Claude first now (6-page chunks), Gemini as the rescue; weigh() prices
 * it for whichever runs.
 */
export function estimateGeminiVision(fileSizeBytes: number, opts: { pageCount?: number } = {}): number {
  if (fileSizeBytes <= 0) return 0;
  const KB_PER_PAGE = 200;
  const pages = opts.pageCount ?? Math.max(1, Math.ceil(fileSizeBytes / 1024 / KB_PER_PAGE));
  const inputTokens = pages * GEMINI_VISION_TOKENS_PER_PAGE_INPUT + 500; // + prompt overhead
  const outputTokens = pages * GEMINI_VISION_TOKENS_PER_PAGE_OUTPUT;
  return Math.ceil(weigh('fast', inputTokens, outputTokens, Math.ceil(pages / 6)) * SAFETY_MARGIN);
}

/** Weighted tokens for a chunk of plain text input (prompt + payload).
 *  Treated as input-only (no output produced from the input alone). */
export function estimateFromChars(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(weigh('fast', chars * TOKENS_PER_CHAR, 0) * SAFETY_MARGIN);
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
  return Math.ceil(weigh('fast', inputTokens, outputTokens, Math.ceil(rows / ROWS_PER_CALL)) * RETRY_HEAVY_MARGIN);
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
  return Math.ceil(weigh('fast', inputTokens, outputTokens, batches) * RETRY_HEAVY_MARGIN);
}

/**
 * Weighted-token estimate for ONLY the ledger scrutiny audit pass —
 * no preceding extract pass. Used by pre-extracted upload (the
 * client-side wizard already extracted), the side-by-side compare
 * (both ledgers come pre-structured), and the resume-after-failure
 * path (raw_extracted is already on disk).
 *
 * Scrutiny is INPUT-heavy: the observations it writes are short. In
 * production (Jul-Sep 2026, 9 runs) output was 1-4% of input (avg 66K
 * in / 1.8K out); small ledgers used 33-56 input tokens per row. The old
 * 30/70 input/output split of ~75 tokens/row (shared with the bank text
 * path, where the model really does echo every row) priced ~50 output
 * tokens per row, which at Claude's output weight (5x its input) would
 * quote several times the real cost and block runs the user can afford.
 *
 * Priced for the scrutiny model ('smart' tier on Claude).
 */
const LEDGER_SCRUTINY_INPUT_TOKENS_PER_ROW = 55;  // observed 33-56 on small ledgers, less on big ones
const LEDGER_SCRUTINY_OUTPUT_TOKENS_PER_ROW = 4;  // observed ~1; kept high for long observation lists
export function estimateLedgerScrutinyOnly(rawTextChars: number): number {
  if (rawTextChars <= 0) return 0;
  const rows = Math.max(1, Math.ceil(rawTextChars / CHARS_PER_ROW));
  const inputTokens = rows * LEDGER_SCRUTINY_INPUT_TOKENS_PER_ROW;
  const outputTokens = rows * LEDGER_SCRUTINY_OUTPUT_TOKENS_PER_ROW;
  return Math.ceil(weigh('smart', inputTokens, outputTokens, Math.ceil(rows / ROWS_PER_CALL)) * RETRY_HEAVY_MARGIN);
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
  // Scrutiny pass over structured output — text-cost shape.
  const KB_PER_PAGE = 200;
  const pages = Math.max(1, Math.ceil(fileSizeBytes / 1024 / KB_PER_PAGE));
  const SCRUTINY_TOKENS_PER_PAGE = 1_800;
  // Half input / half output as a rough split.
  const scrutinyInputTokens = pages * SCRUTINY_TOKENS_PER_PAGE * 0.5;
  const scrutinyOutputTokens = pages * SCRUTINY_TOKENS_PER_PAGE * 0.5;
  const scrutinyWeighted = Math.ceil(weigh('smart', scrutinyInputTokens, scrutinyOutputTokens, Math.ceil(pages / 4)) * RETRY_HEAVY_MARGIN);
  return visionEstimate + scrutinyWeighted;
}
