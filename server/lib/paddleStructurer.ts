/**
 * Stage 2 of the scanned-PDF pipeline: take the raw, page-segmented
 * OCR text from PaddleOCR and structure it into transaction rows.
 *
 * Why a Gemini text call (not a deterministic parser):
 *   Indian bank statements have ~20 commonly-encountered formats
 *   (ICICI savings, HDFC current, SBI, Axis, Kotak, J&K Bank, BoB,
 *   PNB, plus 5-6 PSU variants and Cash Credit / OD layouts). Hand-
 *   maintaining 20 per-bank regex parsers is a maintenance burden
 *   and each bank tweaks its print format every 12-18 months.
 *
 *   A single text-only Gemini 3.1 Flash-Lite call sees the OCR text
 *   (~5-8K input tokens) and emits JSON rows (~10-20K output tokens).
 *   At $0.25/M in + $1.50/M out, that's ~$0.015-0.020 per statement
 *   — roughly half what Gemini Vision was costing per upload, and
 *   the model has the OCR text already row-aligned so it just needs
 *   to STRUCTURE, not extract.
 *
 * Output schema mirrors what `extractVisionWithFallback` returned so
 * the downstream classifier / validator path doesn't need to change.
 */

import { streamGeminiChat } from './geminiChat.js';
import { GEMINI_CHAT_MODEL_T1, GEMINI_CHAT_MODEL_T2, GEMINI_API_KEYS } from './gemini.js';

export interface StructuredOcrRow {
  date: string | null;            // YYYY-MM-DD
  narration: string;
  type: 'credit' | 'debit';
  balance: number | null;
}

export interface StructuredOcrResult {
  transactions: StructuredOcrRow[];
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  /** Per-model token usage. The tiered chunk strategy (T2 first, T1
   *  on retry) can mix models within one statement — usage logging
   *  needs the per-model split so the quota gate weights each call
   *  by the model that actually ran it. */
  usages?: Array<{ inputTokens: number; outputTokens: number; modelUsed: string }>;
}

/**
 * Pages per Gemini call. The original implementation sent the WHOLE
 * statement in one call with a 32K output cap — on a 21-page scanned
 * ICICI statement (~600 rows with long UPI narrations ≈ 28-30K output
 * tokens) the model hit output-density pressure and silently dropped
 * ~150 rows (the dropped credits/debits nearly cancelled, so totals
 * looked only ~1% off while ₹76K was missing from each side). Same
 * failure mode we already fixed for the vision path via chunking.
 *
 * 4 pages ≈ 100-120 rows ≈ 5-7K output tokens per call — far below
 * any pressure point. Chunks run with bounded concurrency; results
 * merge in page order so the downstream balance-delta deriver sees
 * rows in statement order.
 */
const PAGES_PER_CHUNK = 4;
/** Parallel Gemini calls. Modest — these are cheap T1 calls but we
 *  don't want a 40-page statement to burst 10 concurrent requests
 *  into the per-key rate limit. */
const CHUNK_CONCURRENCY = 3;
/** Retry threshold: if a chunk returns fewer than this fraction of
 *  the date-line estimate, re-ask once with an explicit row-count
 *  hint before accepting the short result. */
const MIN_YIELD_RATIO = 0.7;

/**
 * Cheap deterministic estimate of how many transaction rows a page's
 * OCR text contains: lines that START with a date token. Indian bank
 * prints use DD-MM-YYYY / DD/MM/YYYY / DD-MMM-YY(YY). Used to (a)
 * give the model an explicit target count and (b) detect short
 * yields worth retrying. An estimate, not ground truth — wrapped
 * narrations never start with a date, and some banks repeat the date
 * on continuation lines, so we only act on LARGE shortfalls.
 */
export function estimateTxnRows(text: string): number {
  const datePat = /^\s*\d{1,2}[-/](?:\d{1,2}|[A-Za-z]{3})[-/]\d{2,4}\b/;
  return text.split('\n').filter(l => datePat.test(l)).length;
}

export async function structureOcrTextIntoRows(
  pages: string[],
): Promise<StructuredOcrResult> {
  const apiKey = GEMINI_API_KEYS[0] ?? '';
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set — cannot structure OCR text');
  }

  // Drop blank pages up front (some scan containers report phantom
  // pages that rasterize to nothing — they'd just dilute the chunks).
  const realPages = pages.map((p, i) => ({ text: p?.trim() ?? '', pageNo: i + 1 }))
    .filter(p => p.text.length > 0);

  // Build page-group chunks, preserving original page numbers in the
  // tags so diagnostics can point at the source page.
  const chunks: Array<Array<{ text: string; pageNo: number }>> = [];
  for (let i = 0; i < realPages.length; i += PAGES_PER_CHUNK) {
    chunks.push(realPages.slice(i, i + PAGES_PER_CHUNK));
  }

  const results: StructuredOcrRow[][] = new Array(chunks.length);
  let inputTokens = 0;
  let outputTokens = 0;
  // Per-model token tallies for quota logging. T2 output weighs 4×
  // vs T1's 15× in the cross-feature quota — lumping a mixed-tier
  // statement under one model string would mis-weight the user's
  // budget by up to ~3.7×.
  const usageByModel = new Map<string, { inputTokens: number; outputTokens: number }>();
  const addUsage = (model: string, inTok: number, outTok: number) => {
    inputTokens += inTok;
    outputTokens += outTok;
    const u = usageByModel.get(model) ?? { inputTokens: 0, outputTokens: 0 };
    u.inputTokens += inTok;
    u.outputTokens += outTok;
    usageByModel.set(model, u);
  };

  let cursor = 0;
  const workers = Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= chunks.length) return;
      const chunk = chunks[idx];
      const pageRange = `pages ${chunk[0].pageNo}-${chunk[chunk.length - 1].pageNo}`;
      const estimate = chunk.reduce((a, p) => a + estimateTxnRows(p.text), 0);
      // Tiered models: T2 (2.5 flash-lite) first — structuring is a
      // mechanical parse, and T2's output tokens weigh 4× in the
      // quota vs T1's 15×, so the statement costs ~3.5× less when T2
      // holds. The per-chunk estimate guard is the safety net: if T2
      // drops rows (its known weakness on dense batches) or returns
      // bad JSON, the retry escalates to T1. Same tier-order pattern
      // as the vision path.
      let res: StructuredOcrResult | null = null;
      try {
        res = await structureChunk(chunk, estimate, apiKey, GEMINI_CHAT_MODEL_T2);
        addUsage(GEMINI_CHAT_MODEL_T2, res.inputTokens, res.outputTokens);
      } catch (e) {
        console.warn(`[paddleStructurer] chunk ${idx + 1}/${chunks.length} (${pageRange}) failed on T2: ${(e as Error).message.slice(0, 200)} — retrying on T1`);
      }
      // One retry for either failure mode: a thrown error (bad JSON)
      // or a short yield. Short yields matter because a truncated
      // JSON that still parses is indistinguishable from a complete
      // one — the date-line estimate is the only tell.
      const short = res !== null && estimate >= 10 && res.transactions.length < estimate * MIN_YIELD_RATIO;
      if (res === null || short) {
        if (short) console.warn(`[paddleStructurer] chunk ${idx + 1}/${chunks.length} (${pageRange}) returned ${res!.transactions.length} rows vs ~${estimate} date-lines on T2 — retrying on T1`);
        const retry = await structureChunk(chunk, estimate, apiKey, GEMINI_CHAT_MODEL_T1); // throws → whole structurer fails → route falls back to vision
        addUsage(GEMINI_CHAT_MODEL_T1, retry.inputTokens, retry.outputTokens);
        if (res === null || retry.transactions.length > res.transactions.length) res = retry;
      }
      results[idx] = res.transactions;
      console.log(`[paddleStructurer] chunk ${idx + 1}/${chunks.length} (${pageRange}): ${res.transactions.length} rows (est ${estimate})`);
    }
  });
  await Promise.all(workers);

  const usages = [...usageByModel.entries()].map(([modelUsed, u]) => ({
    modelUsed,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
  }));
  return {
    transactions: results.flat(),
    inputTokens,
    outputTokens,
    // Headline model = whichever processed more output tokens.
    // Display-only; the per-model `usages` array is what billing
    // and the quota gate should consume.
    modelUsed: usages.length > 0
      ? usages.reduce((a, b) => (b.outputTokens > a.outputTokens ? b : a)).modelUsed
      : GEMINI_CHAT_MODEL_T2,
    usages,
  };
}

async function structureChunk(
  chunk: Array<{ text: string; pageNo: number }>,
  estimatedRows: number,
  apiKey: string,
  model: string,
): Promise<StructuredOcrResult> {
  // Tag each page so the model can resolve repeated narrations
  // (e.g. recurring UPI to the same VPA) and so we can spot which
  // page the model dropped rows from if diagnostics are needed.
  const combinedText = chunk
    .map(p => `=== PAGE ${p.pageNo} ===\n${p.text}`)
    .join('\n\n');

  const prompt = `You receive the OCR text of ${chunk.length} page(s) of an Indian bank statement. An OCR engine has already extracted the text page-by-page; your job is to PARSE this text into structured transaction rows.

These pages contain approximately ${estimatedRows} transaction rows (counted from date-prefixed lines). Extract ALL of them — a result far below that count means you skipped rows.

CRITICAL RULES:
- DO NOT INVENT data. Only output rows that are clearly visible in the OCR text.
- Extract EVERY transaction row you can see. Do not skip rows that look repetitive (recurring UPI, identical amounts) — the user wants the full ledger.
- Skip non-transaction lines: column headers, page headers/footers, "BROUGHT FORWARD" / "B/F" / "OPENING BALANCE" stubs, page totals, watermarks.
- OCR text may have minor errors (rupee symbol mistaken for 7, lowercase l vs digit 1). Apply minimal correction only when the bank-statement context makes the right value obvious (e.g. "balance" column should be a number).
- If a row's date or balance is unreadable, skip the row entirely. Do not guess.

OUTPUT — STRICT JSON, no markdown fences, no prose:
{"transactions": [{"date": "YYYY-MM-DD", "narration": "...", "type": "credit"|"debit", "balance": <number>}, ...]}

FIELD RULES:
- date: ISO YYYY-MM-DD. Convert from the bank's printed format (DD/MM/YYYY, DD-MMM-YY, DD-MMM-YYYY).
- narration: the transaction description, cleaned. Preserve banking codes (UPI/NEFT/IMPS/RTGS/MMT/CAM/CHEQUE/BIL/TRFR) and counterparty names. Drop OCR garbage characters that aren't word characters or common punctuation.
- type: "credit" if money came INTO the account, "debit" if money went OUT. Read the deposit/withdrawal column placement. On a Cash Credit / OD account, "By Cash" / "By Transfer" lines are credits (reducing dr balance) and "To" lines are debits.
- balance: the running balance AFTER this transaction, as a plain number (no commas, no rupee symbol). null only if truly unreadable.
- Do NOT emit "amount" — the server derives it from balance gaps.

OCR TEXT:
${combinedText}`;

  let buffer = '';
  let inputTokens = 0;
  let outputTokens = 0;
  for await (const part of streamGeminiChat(
    model,
    '',
    [],
    prompt,
    apiKey,
    // Per-chunk output cap. A 4-page chunk tops out around 120 rows
    // × ~50 tokens (long UPI narrations) ≈ 6K tokens — 16K leaves a
    // wide margin without inviting the output-density row-dropping
    // that the old single-call 32K design suffered on dense
    // statements (~600 rows ≈ 28-30K tokens, right at the cap).
    16384,
    false,
    false,
  )) {
    if (part.text) buffer += part.text;
    if (typeof part.inputTokens === 'number') inputTokens = part.inputTokens;
    if (typeof part.outputTokens === 'number') outputTokens = part.outputTokens;
  }

  const cleaned = buffer
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(
      `Structurer returned no JSON object; first 200 chars: ${cleaned.slice(0, 200)}`,
    );
  }
  let parsed: { transactions?: unknown };
  try {
    parsed = JSON.parse(match[0]) as { transactions?: unknown };
  } catch (e) {
    throw new Error(`Structurer JSON parse failed: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed.transactions)) {
    throw new Error('Structurer output missing "transactions" array');
  }

  const transactions: StructuredOcrRow[] = [];
  for (const row of parsed.transactions as Array<Record<string, unknown>>) {
    if (typeof row !== 'object' || row === null) continue;
    const date = typeof row.date === 'string' ? row.date : null;
    const narration = typeof row.narration === 'string' ? row.narration : '';
    const type = row.type === 'credit' || row.type === 'debit' ? row.type : null;
    const balance =
      typeof row.balance === 'number'
        ? row.balance
        : typeof row.balance === 'string' && row.balance.trim() !== ''
          ? Number(row.balance.replace(/[,\s]/g, ''))
          : null;
    if (!narration || !type) continue;
    transactions.push({
      date,
      narration,
      type,
      balance: balance !== null && Number.isFinite(balance) ? balance : null,
    });
  }

  return {
    transactions,
    inputTokens,
    outputTokens,
    modelUsed: model,
  };
}
