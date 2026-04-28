// server/routes/bankStatements.ts
import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import Papa from 'papaparse';
import { extractWithRetry } from '../lib/documentExtract.js';
import { callGeminiJson } from '../lib/geminiJson.js';
import { BANK_STATEMENT_PROMPT, BANK_STATEMENT_TSV_PROMPT, BANK_STATEMENT_CATEGORIES, buildConditionsBlock, countWords, MAX_CONDITION_WORDS } from '../lib/bankStatementPrompt.js';
import { gemini, GEMINI_CHAT_MODEL_THINK_FB, costForModel } from '../lib/gemini.js';
import { creditsForPages, creditsForCsvRows, PAGES_PER_CREDIT, CSV_ROWS_PER_CREDIT } from '../lib/creditPolicy.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { bankStatementRepo } from '../db/repositories/bankStatementRepo.js';
import { bankTransactionRepo, BankTransactionInput } from '../db/repositories/bankTransactionRepo.js';
import { bankStatementRuleRepo, BankStatementRuleRow } from '../db/repositories/bankStatementRuleRepo.js';
import { bankStatementConditionRepo, BankStatementConditionRow } from '../db/repositories/bankStatementConditionRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { getBillingUser } from '../lib/billing.js';
import { getUserLimits } from '../lib/planLimits.js';
import { AuthRequest } from '../types.js';

const router = Router();

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 },
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_MIME_TYPE'));
    }
  },
});

type ExtractedStatement = {
  bankName: string | null;
  accountNumberMasked: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  currency: string | null;
  transactions: unknown[];
};

// ── TSV extraction helper for pre-extracted PDF text ──────────────────────
// See BANK_STATEMENT_TSV_PROMPT. We send one raw text chunk per call, get
// back a header line + N transaction lines + trailer `---END:<N>---`, and
// verify the trailer count matches the parsed row count so we never
// silently drop transactions.

interface TsvExtractResult {
  bankName: string | null;
  accountNumberMasked: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  transactions: unknown[];
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  declaredCount: number;
  actualCount: number;
}

function cleanTsvCell(s: string): string {
  const t = s.trim();
  if (t === '' || t.toLowerCase() === 'null') return '';
  return t;
}

function parseTsvResponse(raw: string): Omit<TsvExtractResult, 'inputTokens' | 'outputTokens' | 'modelUsed'> & { droppedReasons: string[] } {
  // Strip accidental code fences — the prompt forbids them but models slip.
  const text = raw.replace(/^```[a-z]*\n?/im, '').replace(/\n?```\s*$/m, '').trim();
  const lines = text.split(/\r?\n/);

  let bankName: string | null = null;
  let accountNumberMasked: string | null = null;
  let periodFrom: string | null = null;
  let periodTo: string | null = null;
  const rows: unknown[] = [];
  const droppedReasons: string[] = [];
  let declaredCount = -1;

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith('HEADER\t')) {
      const h = line.split('\t');
      bankName = cleanTsvCell(h[1] ?? '') || null;
      accountNumberMasked = cleanTsvCell(h[2] ?? '') || null;
      periodFrom = cleanTsvCell(h[3] ?? '') || null;
      periodTo = cleanTsvCell(h[4] ?? '') || null;
      continue;
    }
    const endMatch = /^---END:(\d+)---$/.exec(line.trim());
    if (endMatch) {
      declaredCount = parseInt(endMatch[1], 10);
      break; // trailer — ignore anything after
    }
    const parts = line.split('\t');
    // Required fields: date + narration + (debit OR credit). Gemini empirically
    // trims trailing empty cells (production: 43 rows in one chunk dropped
    // because the model omitted the trailing isRecurring column when it was
    // false). Accept rows down to 5 fields and treat missing trailing cells
    // as empty — matches the leniency we already extended to the ledger TSV
    // parser.
    if (parts.length < 5) {
      droppedReasons.push(`fields=${parts.length}`);
      continue;
    }
    // debit & credit are separate columns so the model never has to decide
    // sign — it just copies the numbers it sees. Exactly one should be
    // populated per row; we compute signed amount server-side.
    const debitStr = cleanTsvCell(parts[2] ?? '');
    const creditStr = cleanTsvCell(parts[3] ?? '');
    const debit = debitStr === '' ? 0 : Number(debitStr.replace(/[,\s]/g, ''));
    const credit = creditStr === '' ? 0 : Number(creditStr.replace(/[,\s]/g, ''));
    if (!Number.isFinite(debit) || !Number.isFinite(credit)) {
      droppedReasons.push('NaN-amount');
      continue;
    }
    // If both populated, take the larger one as the actual amount (the
    // other is almost always a misplaced balance/reference). Drops were
    // accumulating fast enough on Tally-style exports to fail entire
    // chunks; salvaging is far cheaper than retrying.
    let signedAmount: number;
    if (debit > 0 && credit > 0) {
      droppedReasons.push('both-debit-and-credit-salvaged');
      signedAmount = debit >= credit ? -debit : credit;
    } else if (debit === 0 && credit === 0) {
      droppedReasons.push('no-amount');
      continue;
    } else {
      signedAmount = credit - debit; // positive = inflow, negative = outflow
    }
    const balanceStr = cleanTsvCell(parts[4] ?? '');
    const balance = balanceStr === '' ? null : Number(balanceStr.replace(/[,\s]/g, ''));
    rows.push({
      date: cleanTsvCell(parts[0] ?? ''),
      narration: cleanTsvCell(parts[1] ?? ''),
      amount: signedAmount,
      type: signedAmount >= 0 ? 'credit' : 'debit',
      balance: Number.isFinite(balance as number) ? balance : null,
      category: cleanTsvCell(parts[5] ?? '') || 'Other',
      subcategory: cleanTsvCell(parts[6] ?? '') || null,
      counterparty: cleanTsvCell(parts[7] ?? '') || null,
      reference: cleanTsvCell(parts[8] ?? '') || null,
      isRecurring: cleanTsvCell(parts[9] ?? '') === '1',
    });
  }

  return {
    bankName,
    accountNumberMasked,
    periodFrom,
    periodTo,
    transactions: rows,
    declaredCount,
    actualCount: rows.length,
    droppedReasons,
  };
}

type BankRecordAttempt = (input: { failed: boolean; inputTokens: number; outputTokens: number; model: string }) => void;
const BANK_NOOP_RECORD: BankRecordAttempt = () => {};

async function extractBankStatementTsvOnce(
  chunkText: string,
  model: string,
  maxTokens: number,
  reasoningEffort: 'none' | 'low' | 'medium' | 'high',
  conditionsBlock: string,
  recordAttempt: BankRecordAttempt = BANK_NOOP_RECORD,
): Promise<TsvExtractResult> {
  const messages: ChatCompletionMessageParam[] = [{
    role: 'user',
    content: `${conditionsBlock}${BANK_STATEMENT_TSV_PROMPT}\n\nINPUT_TEXT:\n${chunkText}`,
  }];
  // `reasoning_effort` is the OpenAI-compat knob for Gemini's thinking budget.
  // Both gemini-2.5-flash and gemini-3-flash-preview are thinking models: by
  // default they burn a large fraction of `max_tokens` on internal reasoning
  // before emitting a single TSV row, which was producing finish_reason=length
  // at 1-59 rows. Transcribing rows from already-extracted text needs no
  // reasoning, so we drop the budget to the floor for each model.
  //
  // `temperature: 0` makes the extraction deterministic — without it, the
  // same statement run twice produced different categorizations, amount
  // signs, and counterparty strings (total inflow varied by ~₹30K across
  // runs). Transcription + rule-based categorization has no creative
  // component; sampling just adds noise.
  const response = await gemini.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages,
    stream: false,
    reasoning_effort: reasoningEffort,
    temperature: 0,
  });
  const raw = response.choices[0]?.message?.content ?? '';
  const finishReason = response.choices[0]?.finish_reason ?? 'unknown';
  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;
  // Capture usage immediately so a parse-failure throw still reports
  // wasted spend via recordAttempt. Without this, retries / truncations
  // / trailer mismatches burned billable tokens that never landed in
  // usageRepo (the same blind spot as ledger extract).
  let succeeded = false;
  try {
    const parsed = parseTsvResponse(raw);

    // Integrity check #1: trailer MUST be present. Its absence means either
    // the model's output was truncated mid-stream (hit max_tokens) OR the
    // model returned a short prose reply / refusal that happens to contain
    // a couple of tab-separated lines. Log the raw preview + finish_reason
    // so the logs tell us which case it is on the next occurrence.
    if (parsed.declaredCount < 0) {
      const preview = raw.slice(0, 300).replace(/\n/g, '\\n');
      console.warn(`[bank-statements] ${model} truncated (finish_reason=${finishReason}, got ${parsed.actualCount} rows). Raw preview: ${preview}`);
      throw new Error(`TSV response was truncated: missing ---END:N--- trailer (got ${parsed.actualCount} rows, finish_reason=${finishReason})`);
    }

    // Integrity check #2: parsed rows MUST NOT be fewer than the trailer count.
    // If we parsed fewer rows than the model says it emitted, we silently dropped
    // some (malformed lines, wrong field count) — fail loudly. If we parsed MORE
    // than declared, the model miscounted its own trailer (an empirically common
    // Gemini quirk on dense statements); the rows themselves are fine so accept
    // the parsed count. The statement-level countLikelyDates cross-check still
    // catches wholesale row loss.
    if (parsed.actualCount < parsed.declaredCount) {
      // Summarize why rows were dropped so the logs tell us whether to relax
      // the parser, retune the prompt, or investigate a specific statement.
      const reasonCounts = parsed.droppedReasons.reduce<Record<string, number>>((acc, r) => {
        acc[r] = (acc[r] ?? 0) + 1;
        return acc;
      }, {});
      const reasonStr = Object.entries(reasonCounts).map(([k, v]) => `${k}=${v}`).join(',') || 'unknown';
      throw new Error(`TSV row-count mismatch: trailer claims ${parsed.declaredCount}, parsed ${parsed.actualCount} (dropped: ${reasonStr})`);
    }
    if (parsed.actualCount > parsed.declaredCount) {
      console.warn(`[bank-statements] ${model} trailer undercount: claimed ${parsed.declaredCount}, parsed ${parsed.actualCount} — accepting parsed count`);
    }

    succeeded = true;
    return {
      ...parsed,
      inputTokens,
      outputTokens,
      modelUsed: model,
    };
  } finally {
    recordAttempt({ failed: !succeeded, inputTokens, outputTokens, model });
  }
}

/**
 * Retry + fallback wrapper around the TSV extraction.
 *
 * Two-tier Gemini cascade:
 *   - Primary : `gemini-2.5-flash`        — stable GA model, the most reliable
 *                                           flash-tier option for a long
 *                                           JSON-adjacent extraction.
 *   - Fallback: `gemini-3-flash-preview`  — stronger on dense chunks but
 *                                           flakier (400/503 bursts); only
 *                                           asked when the GA model fails.
 *
 * Earlier versions had these reversed. Empirically the preview model was
 * producing intermittent 400 (no body) and 503 (no body) errors that the
 * retry loop couldn't recover from inside one request, while the GA model
 * has been boringly reliable. Putting the reliable one first gets far more
 * statements across the line on the first try, and the preview model still
 * acts as an escape hatch.
 *
 * Retry shape:
 *   - Primary  × 4 attempts, exp backoff 2s/5s/12s with jitter, on 429/5xx.
 *   - Fallback × 3 attempts, flat backoff ~3s with jitter, on 429/5xx.
 *   - 400 from either tier: skip the rest of that tier's retries (retrying
 *     a 400 doesn't help) and escalate. Most 400s from Gemini's OpenAI-
 *     compatible endpoint come from preview-model quirks, which the other
 *     model usually doesn't share.
 *   - Validation failures (truncation / trailer mismatch) break out
 *     immediately at each tier — the fallback's doubled output ceiling is
 *     exactly what resolves truncation, so we don't waste another 30-50s
 *     retrying the same params on the same model.
 */
async function extractBankStatementTsv(chunkText: string, maxTokens: number, conditionsBlock: string, recordAttempt: BankRecordAttempt = BANK_NOOP_RECORD): Promise<TsvExtractResult> {
  const MAX_PRIMARY_ATTEMPTS = 4;
  const MAX_FALLBACK_ATTEMPTS = 3;
  let lastErr: unknown;

  // Jitter on retries: when multiple chunks land on the same upstream blip,
  // lock-stepped backoffs all reawake in the same window and slam Gemini
  // together. 300-900ms of noise desynchronises them.
  const jitter = () => 300 + Math.floor(Math.random() * 600);
  const isRetryableStatus = (s: number) =>
    s === 429 || s === 500 || s === 502 || s === 503 || s === 504;
  const tierDone = (err: unknown): boolean => {
    const msg = (err as Error).message ?? '';
    const status = (err as { status?: number })?.status ?? 0;
    if (/trailer|mismatch|truncated/i.test(msg)) return true;   // retry won't help
    if (status === 400) return true;                            // 400 = client error, escalate
    if (!isRetryableStatus(status) && status !== 0) return true; // unknown non-retryable
    return false;
  };

  // Exponential backoff tuned for 503 recovery: Gemini usually recovers in
  // 5-30s, so waiting 2s / 5s / 12s before giving up on the primary is more
  // productive than 3 quick retries that all land during the same blip.
  const PRIMARY_BACKOFFS_MS = [2_000, 5_000, 12_000];
  for (let attempt = 0; attempt < MAX_PRIMARY_ATTEMPTS; attempt++) {
    try {
      // gemini-2.5-flash supports thinking_budget=0 (reasoning_effort='none').
      return await extractBankStatementTsvOnce(chunkText, 'gemini-2.5-flash', maxTokens, 'none', conditionsBlock, recordAttempt);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status ?? 0;
      const msg = (err as Error).message?.slice(0, 140) ?? '';
      if (tierDone(err)) {
        console.warn(`[bank-statements] primary gemini-2.5-flash giving up after attempt ${attempt + 1}: ${status || 'no status'} — ${msg}`);
        break;
      }
      if (attempt < MAX_PRIMARY_ATTEMPTS - 1) {
        const wait = (PRIMARY_BACKOFFS_MS[attempt] ?? 12_000) + jitter();
        console.warn(`[bank-statements] primary attempt ${attempt + 1}/${MAX_PRIMARY_ATTEMPTS} failed (${status || 'no status'}); retrying in ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }

  // Fallback: gemini-3-flash-preview with 2× the output ceiling. Handles the
  // two failure modes the primary can't cheaply escape — a GA-model blip
  // that outlasts the primary's 19s retry window, and truncation on dense
  // chunks that exceed the primary's 8K-token output ceiling.
  for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS; attempt++) {
    try {
      // gemini-3-flash-preview can't fully disable thinking but accepts 'low',
      // which is still dramatically cheaper than the default 'medium' budget.
      return await extractBankStatementTsvOnce(chunkText, GEMINI_CHAT_MODEL_THINK_FB, maxTokens * 2, 'low', conditionsBlock, recordAttempt);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status ?? 0;
      const msg = (err as Error).message?.slice(0, 140) ?? '';
      if (tierDone(err)) {
        console.warn(`[bank-statements] fallback ${GEMINI_CHAT_MODEL_THINK_FB} giving up after attempt ${attempt + 1}: ${status || 'no status'} — ${msg}`);
        break;
      }
      if (attempt < MAX_FALLBACK_ATTEMPTS - 1) {
        const wait = 3_000 + jitter();
        console.warn(`[bank-statements] fallback attempt ${attempt + 1}/${MAX_FALLBACK_ATTEMPTS} failed (${status || 'no status'}); retrying in ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Run async tasks in bounded-concurrency batches. Lets us parallelize chunk
 *  extraction without hammering Gemini with 6+ concurrent requests per key,
 *  which routinely trips rate limits on dense statements. */
async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Rough lower-bound on transaction count by counting dates in the raw text.
 *  Used as a cross-check to catch cases where the model skipped rows despite
 *  a valid trailer. Conservative — we only fail if the delta is large. */
function countLikelyDates(text: string): number {
  const patterns = [
    /\b\d{2}\/\d{2}\/\d{4}\b/g,
    /\b\d{2}-\d{2}-\d{4}\b/g,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{2,4}\b/gi,
  ];
  const seen = new Set<string>();
  for (const re of patterns) {
    const matches = text.match(re);
    if (matches) for (const m of matches) seen.add(m.toLowerCase() + '@' + (text.indexOf(m)));
  }
  return seen.size;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,\s]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalizeCategory(raw: unknown): string {
  if (typeof raw !== 'string') return 'Other';
  const match = BANK_STATEMENT_CATEGORIES.find(c => c.toLowerCase() === raw.toLowerCase());
  return match ?? 'Other';
}

/**
 * Coerce whatever Gemini returned into our canonical transaction shape.
 * Amount is always stored signed (positive = credit / inflow).
 */
function normalizeTransactions(raw: unknown[]): BankTransactionInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => {
    const obj = (t && typeof t === 'object') ? t as Record<string, unknown> : {};
    const type = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
    let amount = toNumber(obj.amount);
    // If the model returned an absolute value and a type, apply sign from type
    if (type === 'debit' && amount > 0) amount = -amount;
    if (type === 'credit' && amount < 0) amount = Math.abs(amount);
    const balance = obj.balance === null || obj.balance === undefined ? null : toNumber(obj.balance);
    return {
      date: typeof obj.date === 'string' ? obj.date : null,
      narration: typeof obj.narration === 'string' ? obj.narration.slice(0, 500) : null,
      amount,
      balance,
      category: normalizeCategory(obj.category),
      subcategory: typeof obj.subcategory === 'string' ? obj.subcategory : null,
      counterparty: typeof obj.counterparty === 'string' ? obj.counterparty.slice(0, 200) : null,
      reference: typeof obj.reference === 'string' ? obj.reference.slice(0, 100) : null,
      isRecurring: obj.isRecurring === true,
    };
  });
}

/**
 * Apply user-defined rules: if a rule's match_text appears (case-insensitive)
 * inside the narration, override category and/or stamp counterparty_label.
 * Mutates a shallow copy — leaves originals alone. Rules are tried in order,
 * first match wins.
 */
function applyUserRules(txs: BankTransactionInput[], rules: BankStatementRuleRow[]): BankTransactionInput[] {
  if (!rules.length) return txs;
  return txs.map((tx) => {
    const hay = (tx.narration ?? '').toLowerCase();
    for (const rule of rules) {
      if (!rule.match_text) continue;
      if (hay.includes(rule.match_text.toLowerCase())) {
        return {
          ...tx,
          category: rule.category ? normalizeCategory(rule.category) : tx.category,
          counterparty: rule.counterparty_label ?? tx.counterparty,
        };
      }
    }
    return tx;
  });
}

function computeTotals(txs: BankTransactionInput[]): { inflow: number; outflow: number } {
  let inflow = 0;
  let outflow = 0;
  for (const tx of txs) {
    if (tx.amount >= 0) inflow += tx.amount;
    else outflow += Math.abs(tx.amount);
  }
  return { inflow, outflow };
}

interface BalanceMismatch {
  index: number;
  date: string | null;
  narration: string | null;
  expectedDelta: number;
  actualDelta: number;
}

/**
 * Reconcile each row's signed amount against the bank's printed
 * running balance. For row N with both balance(N) and balance(N-1)
 * extracted, balance(N) - balance(N-1) pins the row's signed amount
 * exactly — the bank's printed number is authoritative, the AI's
 * credit/debit classification is not.
 *
 * Two outcomes per mismatched row:
 *
 *   - Pure sign flip (|expected| ≈ |actual|, signs differ): the AI
 *     got the rupee amount right but put it on the wrong side of the
 *     ledger. We overwrite tx.amount with the printed delta. This
 *     is the dominant failure mode and produces the symmetric
 *     "inflow undercounts by X, outflow overcounts by X" drift
 *     pattern (e.g. 16-row Canara mismatch → ₹62K each-way drift,
 *     ₹1.23L net error).
 *
 *   - Magnitudes also disagree: real extraction error (AI misread
 *     a digit, missed a row, etc.). We can't pick a correct value
 *     from one side, so we surface it for human review and leave
 *     tx.amount alone.
 *
 * Mutates txs in-place. Skips rows where either balance is null
 * (page boundaries, banks that don't print a per-row balance).
 */
function reconcileBalances(txs: BankTransactionInput[]): {
  autoCorrected: number;
  mismatches: BalanceMismatch[];
} {
  let autoCorrected = 0;
  const mismatches: BalanceMismatch[] = [];
  for (let i = 1; i < txs.length; i++) {
    const prev = txs[i - 1];
    const cur = txs[i];
    if (prev.balance == null || cur.balance == null) continue;
    const expectedDelta = cur.balance - prev.balance;
    const actualDelta = cur.amount;
    // Tolerance: ₹1 absolute or 0.5% of the larger value (covers
    // rounding in printed balances).
    const tol = Math.max(1, Math.abs(actualDelta) * 0.005, Math.abs(expectedDelta) * 0.005);
    if (Math.abs(expectedDelta - actualDelta) <= tol) continue;

    if (Math.abs(Math.abs(expectedDelta) - Math.abs(actualDelta)) <= tol) {
      // Sign flip — printed balance is ground truth, overwrite.
      cur.amount = expectedDelta;
      autoCorrected++;
      continue;
    }

    mismatches.push({
      index: i,
      date: cur.date,
      narration: cur.narration,
      expectedDelta,
      actualDelta,
    });
  }
  return { autoCorrected, mismatches };
}

function enforceQuota(req: AuthRequest, res: Response): { ok: true; billingUserId: string; plan: string; creditsLimit: number; creditsUsed: number; creditsRemaining: number } | { ok: false } {
  const actor = userRepo.findById(req.user!.id);
  const billingUser = actor ? getBillingUser(actor) : undefined;
  const billingUserId = billingUser?.id ?? req.user!.id;
  const plan = billingUser?.plan ?? actor?.plan ?? 'free';
  const limitSource = billingUser ?? actor;
  // The bank statement plan limit is now interpreted as a CREDIT cap.
  // Same number as before (3 / 15 / 50) — but each credit buys 5 PDF
  // pages or 100 CSV rows, so the user-facing capacity is far larger
  // and rejection happens up-front based on file size, not run count.
  const creditsLimit = limitSource ? getUserLimits(limitSource).bankStatements : 3;
  let creditsUsed = 0;
  try {
    creditsUsed = featureUsageRepo.sumCreditsThisMonthByBillingUser(billingUserId, 'bank_statement_analyze');
  } catch (err) {
    console.error('[bank-statements] Failed to read usage:', err);
  }
  const creditsRemaining = Math.max(0, creditsLimit - creditsUsed);
  if (creditsRemaining <= 0) {
    res.status(429).json({
      error: `You've reached your monthly bank statement credit allowance. Upgrade your plan or wait until next month.`,
      upgrade: plan !== 'enterprise',
    });
    return { ok: false };
  }
  return { ok: true, billingUserId, plan, creditsLimit, creditsUsed, creditsRemaining };
}

/** Persist a completed analysis into a placeholder row created upfront.
 *  Two-phase: createPlaceholder (status='analyzing') happens at request
 *  start so the row is visible to a tab-close-and-reload, then this fills
 *  in extracted metadata + transactions and flips status to 'done'. */
function persistStatement(
  userId: string,
  statementId: string,
  data: ExtractedStatement,
  fallbackName: string,
) {
  const rawTxs = normalizeTransactions(data.transactions ?? []);
  const rules = bankStatementRuleRepo.listByUser(userId);
  const txs = applyUserRules(rawTxs, rules);

  // Auto-correct sign flips against the bank's printed running
  // balance BEFORE summing. A single misclassified row contributes
  // 2× its amount to the inflow/outflow drift (it's on the wrong
  // side of the ledger), so reconciling first is what makes the
  // dashboard totals match a hand-tied calculation.
  const { autoCorrected, mismatches } = reconcileBalances(txs);

  const { inflow, outflow } = computeTotals(txs);
  const periodLabel = data.periodFrom && data.periodTo
    ? `${data.periodFrom} – ${data.periodTo}`
    : new Date().toISOString().slice(0, 10);
  const name = [data.bankName, periodLabel].filter(Boolean).join(' · ') || fallbackName;

  bankStatementRepo.updateAfterAnalyze(statementId, userId, {
    name,
    bankName: data.bankName ?? null,
    accountNumberMasked: data.accountNumberMasked ?? null,
    periodFrom: data.periodFrom ?? null,
    periodTo: data.periodTo ?? null,
    sourceFilename: null,  // already set on placeholder
    sourceMime: null,
    rawExtracted: JSON.stringify(data),
  });
  bankTransactionRepo.bulkInsert(statementId, txs);
  bankStatementRepo.updateTotals(statementId, inflow, outflow, txs.length);

  return { txCount: txs.length, autoCorrected, mismatches };
}

function serializeStatement(row: ReturnType<typeof bankStatementRepo.findByIdForUser>) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    bankName: row.bank_name,
    accountNumberMasked: row.account_number_masked,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    sourceFilename: row.source_filename,
    sourceMime: row.source_mime,
    totalInflow: row.total_inflow,
    totalOutflow: row.total_outflow,
    txCount: row.tx_count,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeTransaction(row: ReturnType<typeof bankTransactionRepo.listByStatement>[number]) {
  return {
    id: row.id,
    date: row.tx_date,
    narration: row.narration,
    amount: row.amount,
    balance: row.balance,
    category: row.category,
    subcategory: row.subcategory,
    counterparty: row.counterparty,
    reference: row.reference,
    isRecurring: row.is_recurring === 1,
    userOverride: row.user_override === 1,
  };
}

function serializeRule(row: BankStatementRuleRow) {
  return {
    id: row.id,
    matchText: row.match_text,
    category: row.category,
    counterpartyLabel: row.counterparty_label,
    createdAt: row.created_at,
  };
}

// ── Routes ─────────────────────────────────────────────────────────────

// GET /api/bank-statements — list
router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const rows = bankStatementRepo.findByUserId(req.user.id);
  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : null;
  const creditsLimit = (billingUser ?? actor) ? getUserLimits(billingUser ?? actor!).bankStatements : 3;
  const creditsUsed = billingUser
    ? featureUsageRepo.sumCreditsThisMonthByBillingUser(billingUser.id, 'bank_statement_analyze')
    : 0;
  res.json({
    statements: rows.map(serializeStatement),
    usage: {
      creditsUsed,
      creditsLimit,
      pagesPerCredit: PAGES_PER_CREDIT.bank_statement,
      csvRowsPerCredit: CSV_ROWS_PER_CREDIT.bank_statement ?? 0,
    },
  });
});

// GET /api/bank-statements/rules — list user-defined categorization rules.
router.get('/rules', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const rules = bankStatementRuleRepo.listByUser(req.user.id).map(serializeRule);
  res.json({ rules });
});

// POST /api/bank-statements/rules — create a new rule.
router.post('/rules', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const matchText = typeof req.body?.matchText === 'string' ? req.body.matchText.trim() : '';
  if (!matchText) { res.status(400).json({ error: 'matchText is required' }); return; }
  const category = typeof req.body?.category === 'string' ? normalizeCategory(req.body.category) : null;
  const counterpartyLabel = typeof req.body?.counterpartyLabel === 'string' && req.body.counterpartyLabel.trim()
    ? req.body.counterpartyLabel.trim().slice(0, 200)
    : null;
  if (!category && !counterpartyLabel) {
    res.status(400).json({ error: 'Provide at least a category or counterpartyLabel' });
    return;
  }
  const row = bankStatementRuleRepo.create(req.user.id, matchText.slice(0, 200), category, counterpartyLabel);
  res.status(201).json({ rule: serializeRule(row) });
});

// DELETE /api/bank-statements/rules/:ruleId
router.delete('/rules/:ruleId', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const ok = bankStatementRuleRepo.delete(req.user.id, req.params.ruleId);
  if (!ok) { res.status(404).json({ error: 'Rule not found' }); return; }
  res.json({ success: true });
});

function serializeCondition(row: BankStatementConditionRow) {
  return { id: row.id, text: row.text, createdAt: row.created_at };
}

// GET /api/bank-statements/conditions — list user-defined parsing conditions.
router.get('/conditions', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const conditions = bankStatementConditionRepo.listByUser(req.user.id).map(serializeCondition);
  res.json({ conditions, maxWords: MAX_CONDITION_WORDS });
});

// POST /api/bank-statements/conditions — create a new condition.
router.post('/conditions', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) { res.status(400).json({ error: 'text is required' }); return; }
  if (countWords(text) > MAX_CONDITION_WORDS) {
    res.status(400).json({ error: `Condition exceeds the ${MAX_CONDITION_WORDS}-word limit` });
    return;
  }
  const row = bankStatementConditionRepo.create(req.user.id, text.slice(0, 1000));
  res.status(201).json({ condition: serializeCondition(row) });
});

// DELETE /api/bank-statements/conditions/:conditionId
router.delete('/conditions/:conditionId', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const ok = bankStatementConditionRepo.delete(req.user.id, req.params.conditionId);
  if (!ok) { res.status(404).json({ error: 'Condition not found' }); return; }
  res.json({ success: true });
});

// GET /api/bank-statements/:id — detail + transactions
router.get('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const row = bankStatementRepo.findByIdForUser(req.params.id, req.user.id);
  if (!row) { res.status(404).json({ error: 'Statement not found' }); return; }
  const txs = bankTransactionRepo.listByStatement(row.id);
  res.json({
    statement: serializeStatement(row),
    transactions: txs.map(serializeTransaction),
  });
});

// POST /api/bank-statements/analyze — multipart file OR JSON { csvText, filename? }
router.post(
  '/analyze',
  (req: Request, res: Response, next: NextFunction) => {
    const ct = req.headers['content-type'] ?? '';
    if (typeof ct === 'string' && ct.startsWith('multipart/form-data')) {
      upload.single('file')(req, res, (err) => {
        if (err) return next(err);
        next();
      });
    } else {
      next();
    }
  },
  async (req: AuthRequest, res: Response) => {
    if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }

    const quota = enforceQuota(req, res);
    if (!quota.ok) return;

    // Load free-form parsing conditions for this user once and prepend them to
    // every prompt path (TSV chunks, vision, CSV). Empty string when the user
    // has none.
    const userConditions = bankStatementConditionRepo.listByUser(req.user.id);
    const conditionsBlock = buildConditionsBlock(userConditions);

    const isPdfText = !req.file && typeof req.body?.pdfText === 'string' && req.body.pdfText.length > 0;
    const isCsv = !req.file && !isPdfText && typeof req.body?.csvText === 'string';

    if (!req.file && !isPdfText && !isCsv) {
      res.status(400).json({ error: 'Provide a PDF/image file, pdfText body, or csvText body.' });
      return;
    }

    // Opt-in SSE progress stream — only meaningful for the pdfText path
    // because that's the one with visible multi-chunk work. Image/vision and
    // CSV complete in a single call and just use the JSON response.
    const wantsStream = isPdfText && req.body?.stream === true;
    let sseOpen = false;
    const sendSse = (obj: unknown) => {
      if (!sseOpen) return;
      try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* client disconnected */ }
    };
    if (wantsStream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        // Tell any upstream nginx/proxy not to buffer — otherwise chunk
        // completions don't reach the browser until the whole response ends,
        // defeating the progress bar.
        'X-Accel-Buffering': 'no',
      });
      sseOpen = true;
    }

    // Compute a fingerprint of the input so we can:
    //   1. Refuse a duplicate analysis if one's already running for this
    //      file (tab close + retry would otherwise fire a parallel run).
    //   2. Persist a status='analyzing' row UPFRONT — Node doesn't abort
    //      handlers on client disconnect, so the analysis keeps going even
    //      if the user reloads, and the row's there for them to find when
    //      they come back.
    let fileHash: string | null = null;
    if (req.file) {
      fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    } else if (isPdfText) {
      fileHash = crypto.createHash('sha256').update(String(req.body.pdfText)).digest('hex');
    } else if (isCsv) {
      fileHash = crypto.createHash('sha256').update(String(req.body.csvText)).digest('hex');
    }

    if (fileHash) {
      const inProgress = bankStatementRepo.findInProgressByHashForUser(req.user.id, fileHash);
      if (inProgress) {
        console.log(`[bank-statements] re-attaching to in-progress statement ${inProgress.id} instead of starting a new run`);
        const txs = bankTransactionRepo.listByStatement(inProgress.id).map(serializeTransaction);
        const payload = { statement: serializeStatement(inProgress), transactions: txs, txCount: txs.length, resumed: true };
        if (sseOpen) { sendSse({ type: 'done', ...payload }); res.end(); }
        else res.status(200).json(payload);
        return;
      }
      // Same-hash dedup for SUCCESSFULLY-completed runs. Without this, a
      // second upload of the same file re-runs Gemini and produces
      // slightly different totals than the first run because
      //   - chunks that 503 on one run vs the next get routed to the
      //     fallback model with different reasoning_effort,
      //   - the per-row salvage logic (both-debit-credit, trailer-undercount
      //     accept) makes interpretation calls that aren't bit-stable.
      // Reusing the existing row keeps the user's view consistent and
      // saves the duplicate Gemini spend. They can always delete the
      // existing one if they want a fresh analysis.
      const previouslyDone = bankStatementRepo.findDoneByHashForUser(req.user.id, fileHash);
      if (previouslyDone) {
        console.log(`[bank-statements] reusing existing successful analysis ${previouslyDone.id} for hash ${fileHash.slice(0, 12)}…`);
        const txs = bankTransactionRepo.listByStatement(previouslyDone.id).map(serializeTransaction);
        const payload = { statement: serializeStatement(previouslyDone), transactions: txs, txCount: txs.length, resumed: true, alreadyAnalyzed: true };
        if (sseOpen) { sendSse({ type: 'done', ...payload }); res.end(); }
        else res.status(200).json(payload);
        return;
      }
    }

    // Pre-flight credit check. Count the file's "size" up front in the
    // same units the credit policy uses (PDF pages for vision/pdfText,
    // CSV rows for csvText), translate to credits, and reject 4xx if
    // the user doesn't have enough remaining for the month. Avoids
    // starting an expensive run and then half-finishing when the cap
    // hits mid-flight.
    let pagesTotal = 0;
    let creditsNeeded = 0;
    let pagesUnit: 'pages' | 'rows' = 'pages';
    if (isPdfText) {
      const pages = String(req.body.pdfText).split(/\n?---\s*PAGE BREAK\s*---\n?/).filter(p => p.trim()).length;
      pagesTotal = Math.max(1, pages);
      creditsNeeded = creditsForPages('bank_statement', pagesTotal);
    } else if (isCsv) {
      // Rough count without re-parsing the whole CSV — header + non-empty
      // lines. The full Papa.parse runs later in the CSV branch; close
      // enough for the pre-flight gate.
      const csvLines = String(req.body.csvText).split(/\r?\n/).filter(l => l.trim()).length;
      pagesTotal = Math.max(0, csvLines - 1); // minus header
      creditsNeeded = creditsForCsvRows('bank_statement', pagesTotal);
      pagesUnit = 'rows';
    } else if (req.file) {
      // Vision path on a scanned/image PDF — we don't have a cheap page
      // count from raw bytes here, so charge the minimum (1 credit /
      // 5 pages of headroom). The actual page count gets reconciled at
      // finish time via the chunk loop's pages_processed accumulator.
      pagesTotal = PAGES_PER_CREDIT.bank_statement;
      creditsNeeded = 1;
    }
    if (creditsNeeded > quota.creditsRemaining) {
      // Surface the over-limit as a percentage rather than raw
      // credits — credits are an internal unit, percentages map
      // cleanly to the % allowance bar the user already sees on
      // the landing page. "Exceeds by 50%" reads better than
      // "needs 6 credits but you have 4 left".
      const excessPct = quota.creditsRemaining > 0
        ? Math.ceil(((creditsNeeded - quota.creditsRemaining) / quota.creditsRemaining) * 100)
        : 100;
      const unit = pagesUnit === 'rows' ? 'rows' : 'pages';
      const allowance = pagesUnit === 'rows'
        ? `${(CSV_ROWS_PER_CREDIT.bank_statement ?? 0) * quota.creditsRemaining} rows`
        : `${PAGES_PER_CREDIT.bank_statement * quota.creditsRemaining} pages`;
      const csvHint = isCsv ? '' : ' Tip: CSV exports use a more generous row-per-credit ratio.';
      const errorMsg = quota.creditsRemaining === 0
        ? `You've already used 100% of your monthly bank statement allowance. Upgrade your plan or wait until next month.${csvHint}`
        : `This file (${pagesTotal} ${unit}) exceeds your remaining monthly allowance by ~${excessPct}%. You have room for about ${allowance} this month.${csvHint}`;
      res.status(413).json({
        error: errorMsg,
        excessPct,
        creditsNeeded,
        creditsRemaining: quota.creditsRemaining,
        upgrade: quota.plan !== 'enterprise',
      });
      return;
    }

    // Upfront placeholder. Visible to any subsequent /api/bank-statements
    // GET while the analysis runs, even after this connection closes.
    const placeholderFilename = req.file?.originalname
      ?? (typeof req.body?.filename === 'string' ? req.body.filename : null)
      ?? (isCsv ? 'statement.csv' : 'statement.pdf');
    const placeholderMime = req.file?.mimetype ?? (isCsv ? 'text/csv' : 'application/pdf');
    const placeholder = bankStatementRepo.createPlaceholder(req.user.id, quota.billingUserId, {
      name: placeholderFilename.replace(/\.(pdf|csv|jpe?g|png|webp)$/i, '') || 'Bank Statement',
      sourceFilename: placeholderFilename,
      sourceMime: placeholderMime,
      fileHash,
      pagesTotal,
    });

    try {
      let extracted: ExtractedStatement;
      let filename: string | null;
      let mimeType: string | null;

      if (req.file) {
        filename = req.file.originalname;
        mimeType = req.file.mimetype;
        const base64Data = req.file.buffer.toString('base64');
        const dataUrl = `data:${mimeType};base64,${base64Data}`;
        // Vision fallback path — used only for scanned/image PDFs or direct
        // image uploads. Digital PDFs get pre-extracted client-side and hit
        // the faster `pdfText` branch below.
        const visionResult = await extractWithRetry<ExtractedStatement>(dataUrl, `${conditionsBlock}${BANK_STATEMENT_PROMPT}`, { maxTokens: 8192 });
        extracted = visionResult.data;
        (res.locals as Record<string, unknown>).geminiUsages = [{
          inputTokens: visionResult.inputTokens,
          outputTokens: visionResult.outputTokens,
          modelUsed: visionResult.modelUsed,
        }];
      } else if (isPdfText) {
        // Fast path: the frontend extracted the PDF text layer via pdfjs-dist
        // and sent it here. Gemini parses plain text ~3-5× faster than vision
        // because there's no OCR / layout analysis phase.
        //
        // Strategy (correctness > speed, but both matter):
        //   1. Compact TSV output — each tx is one tab-separated line (~70
        //      chars) instead of JSON (~250 chars). Fits ~3-4× more rows per
        //      response.
        //   2. max_tokens = 8192 with ~20K-char input chunks — sized to sit
        //      well inside flash-lite's practical reliable output ceiling so
        //      chunks don't truncate. On truncation we escalate to flash
        //      (16K tokens) rather than retry flash-lite with the same params.
        //   3. Chunks run with bounded concurrency (4 in flight) to avoid
        //      tripping per-key rate limits — unbounded parallelism on 6+
        //      chunks was producing 429s that compounded with retries.
        //   4. Every response carries a `---END:N---` trailer. We verify the
        //      trailer count matches the parsed row count — if it doesn't,
        //      the output was truncated or malformed and we FAIL LOUDLY
        //      rather than persist a silently-incomplete extraction.
        //   5. A cross-check against the raw input's date count catches the
        //      rare case where Gemini emits a valid trailer but skipped rows.
        filename = typeof req.body?.filename === 'string' ? req.body.filename : 'statement.pdf';
        mimeType = 'application/pdf';
        const rawText = String(req.body.pdfText);
        const pages = rawText.split(/\n?---\s*PAGE BREAK\s*---\n?/).map(p => p.trim()).filter(Boolean);
        // Sizing: aim for chunks that reliably finish on flash-lite within
        // its practical output ceiling (~8K tokens / ~400 TSV rows). 40K char
        // chunks with 16K max_tokens routinely truncated — each failure cost
        // ~50s and then we'd retry identical params. Halving the input and
        // the output budget means a chunk takes 10-15s typical, leaves
        // headroom against truncation, and the concurrency cap below keeps
        // per-key rate limits from turning parallel calls into 429s.
        //
        //   ~20K chars ≈ 6-8 typical pages ≈ 180-250 transactions.
        //   20 chunks covers statements up to ~150 pages. Going past the cap
        //   silently drops pages, which is unacceptable for a tax feature —
        //   the explicit ceiling still bounds worst-case cost per request.
        // Sizing: aim for chunks that reliably finish on gemini-2.5-flash.
        // 20K char chunks with 8K max_tokens were producing short/truncated
        // responses (1-9 rows for a 17-page chunk) — the model was bailing
        // early on dense input, not running out of tokens. Halving to 12K
        // gives the model a clearer task per call. Each chunk is now
        // ~4 typical pages / ~120 transactions, well inside what even a
        // noisy flash response can handle.
        //
        //   ~12K chars ≈ 4 typical pages ≈ 120 transactions.
        //   35 chunks covers statements up to ~140 pages. The explicit
        //   ceiling bounds worst-case cost per request.
        // Sizing for dense-narration statements (e.g. Canara Bank UPI, where
        // a single row can run 200-250 chars). 12K-char chunks with 8K output
        // tokens were producing finish_reason=length at ~61-70 rows on dense
        // chunks even after disabling thinking-token consumption. Shrinking to
        // 8K-char input / 16K-token output gives ~4× the headroom: each chunk
        // now holds ~60-80 rows and fits comfortably inside 16K output tokens
        // of pure TSV (no thinking), which is ~500+ rows of budget.
        //
        //   ~8K chars ≈ 2-3 typical pages ≈ 60-80 transactions.
        //   50 chunks covers statements up to ~150 pages.
        const MAX_CHARS_PER_CHUNK = 8_000;
        const MAX_OUTPUT_TOKENS = 16_384;
        const MAX_CHUNKS = 50;
        // Concurrency 4: with thinking disabled on the primary and the larger
        // output budget, individual chunks are more reliable, so we can push
        // parallelism back up without tripping the retry ladder. A 46-page
        // statement now completes in 2 waves (~50s) instead of 4 (~80s). If
        // we start seeing sustained 429/503 bursts, drop back to 2.
        const CHUNK_CONCURRENCY = 4;

        // Build chunks by packing pages until we approach the char budget.
        // This means a 10-page statement is ONE call; 46 pages → 3 calls.
        const chunks: string[] = [];
        const chunkPageRanges: Array<[number, number]> = [];
        {
          let buf: string[] = [];
          let bufLen = 0;
          let firstPage = 1;
          for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            if (buf.length > 0 && bufLen + p.length > MAX_CHARS_PER_CHUNK) {
              chunks.push(buf.join('\n\n'));
              chunkPageRanges.push([firstPage, i]);
              buf = [];
              bufLen = 0;
              firstPage = i + 1;
              if (chunks.length >= MAX_CHUNKS) break;
            }
            buf.push(p);
            bufLen += p.length + 2;
          }
          if (buf.length > 0 && chunks.length < MAX_CHUNKS) {
            chunks.push(buf.join('\n\n'));
            chunkPageRanges.push([firstPage, pages.length]);
          }
          if (chunks.length === 0) {
            chunks.push(rawText.slice(0, MAX_CHARS_PER_CHUNK));
            chunkPageRanges.push([1, 1]);
          }
        }
        const dateCount = countLikelyDates(rawText);
        console.log(`[bank-statements] pdfText: ${pages.length} pages → ${chunks.length} chunk(s), ~${dateCount} candidate dates`);

        sendSse({ type: 'start', totalChunks: chunks.length, pages: pages.length });

        // Failed-attempt cost logging closure. Production logs across the
        // chunked TSV pipeline showed retries / truncations / trailer
        // mismatches burning Gemini tokens that never landed in
        // usageRepo. This makes wasted spend visible in the admin
        // dashboard under category `bank_statement_failed`.
        const bankClientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
        const recordBankAttempt: BankRecordAttempt = ({ failed, inputTokens, outputTokens, model }) => {
          if (!failed) return;
          if (inputTokens === 0 && outputTokens === 0) return;
          try {
            const cost = costForModel(model, inputTokens, outputTokens);
            usageRepo.logWithBilling(
              bankClientIp,
              req.user!.id,
              quota.billingUserId,
              inputTokens,
              outputTokens,
              cost,
              false,
              model,
              false,
              'bank_statement_failed',
            );
          } catch (e) {
            console.error('[bank-statements] failed-attempt cost log error', e);
          }
        };

        // Bounded-concurrency: we still need every chunk to succeed (silently
        // dropping transactions is unacceptable for a tax feature) but firing
        // all chunks at Gemini simultaneously produces 429s on a single
        // API key. Four concurrent calls keeps us well under the per-key RPM
        // cap while still completing a 10-chunk statement in roughly 3 waves.
        let completedCount = 0;
        const chunkResults = await mapWithConcurrency(
          chunks,
          CHUNK_CONCURRENCY,
          async (chunk, idx) => {
            const t0 = Date.now();
            try {
              const r = await extractBankStatementTsv(chunk, MAX_OUTPUT_TOKENS, conditionsBlock, recordBankAttempt);
              console.log(`[bank-statements] chunk ${idx + 1}/${chunks.length} (pages ${chunkPageRanges[idx][0]}-${chunkPageRanges[idx][1]}) ✓ ${r.actualCount} tx in ${Date.now() - t0}ms`);
              // Tick pages_processed so a cancel debits credits
              // proportional to the work actually done.
              const chunkPages = chunkPageRanges[idx][1] - chunkPageRanges[idx][0] + 1;
              bankStatementRepo.bumpPagesProcessed(placeholder.id, req.user!.id, chunkPages);
              completedCount += 1;
              sendSse({
                type: 'progress',
                completed: completedCount,
                total: chunks.length,
                pages: chunkPageRanges[idx],
                txInChunk: r.actualCount,
              });
              return r;
            } catch (e) {
              const msg = (e as Error).message ?? String(e);
              console.error(`[bank-statements] chunk ${idx + 1}/${chunks.length} (pages ${chunkPageRanges[idx][0]}-${chunkPageRanges[idx][1]}) ✗ ${msg}`);
              throw new Error(`Section ${idx + 1}/${chunks.length} (pages ${chunkPageRanges[idx][0]}-${chunkPageRanges[idx][1]}): ${msg}`);
            }
          },
        );

        const merged = chunkResults.flatMap(r => r.transactions);
        extracted = {
          bankName: chunkResults.map(r => r.bankName).find(v => !!v) ?? null,
          accountNumberMasked: chunkResults.map(r => r.accountNumberMasked).find(v => !!v) ?? null,
          periodFrom: chunkResults.map(r => r.periodFrom).find(v => !!v) ?? null,
          periodTo: chunkResults.map(r => r.periodTo).find(v => !!v) ?? null,
          currency: 'INR',
          transactions: merged,
        };

        // Cross-check: candidate-date count vs extracted transaction count.
        // dateCount is noisy — repeated period headers on every page, "As on"
        // footers, summary rows and running-balance headers all look like
        // dates to a regex. Anchor the floor at 50% so we catch genuinely
        // broken extractions (a whole chunk's worth dropped) without false-
        // failing on legitimate statements that happen to repeat dates.
        if (dateCount > 0 && merged.length < dateCount * 0.5) {
          throw new Error(
            `Transaction count sanity check failed: extracted ${merged.length} rows but found ~${dateCount} date-like markers in the PDF text. ` +
            `Rather than persist a likely-incomplete analysis, we're bailing. Retry, or use a CSV export if available.`,
          );
        }

        (res.locals as Record<string, unknown>).geminiUsages = chunkResults.map(r => ({
          inputTokens: r.inputTokens, outputTokens: r.outputTokens, modelUsed: r.modelUsed,
        }));
      } else {
        // CSV path: client posted parsed CSV text; we already know the
        // structure (date / narration / debit / credit / balance), so the
        // only AI work is enrichment — categorise each row and fill in
        // bankName / period / counterparty if visible. No chunking when
        // the row count fits in one call's output budget; chunked above
        // ~120 rows because the prompt asks Gemini to return the full
        // schema for every row, and 16 K output tokens (the practical
        // ceiling on flash-lite without truncation) cover roughly that
        // many rows comfortably. The wizard path commonly ships 300+
        // rows from a Canara-style statement, which used to truncate
        // silently and produce "Failed to parse Gemini JSON response".
        filename = typeof req.body?.filename === 'string' ? req.body.filename : 'statement.csv';
        mimeType = 'text/csv';
        const parsed = Papa.parse(String(req.body.csvText), { header: true, skipEmptyLines: true });
        const rows = parsed.data as Record<string, string>[];
        const normalized = rows.map((r) => {
          const date = r.date ?? r.Date ?? r['Txn Date'] ?? r['Transaction Date'] ?? null;
          const narration = r.narration ?? r.Narration ?? r.Description ?? r['Particulars'] ?? '';
          const credit = toNumber(r.credit ?? r.Credit ?? r['Deposit Amt.'] ?? r.deposit ?? 0);
          const debit = toNumber(r.debit ?? r.Debit ?? r['Withdrawal Amt.'] ?? r.withdrawal ?? 0);
          const balance = r.balance ?? r.Balance ?? r['Closing Balance'] ?? null;
          const amountRaw = toNumber(r.amount ?? r.Amount ?? 0);
          const signedAmount = credit ? credit : debit ? -debit : amountRaw;
          return {
            date,
            narration,
            amount: signedAmount,
            type: signedAmount >= 0 ? 'credit' : 'debit',
            balance: balance ? toNumber(balance) : null,
          };
        });

        const CSV_BATCH_SIZE = 120;
        const CSV_BATCH_CONCURRENCY = 3;
        const CSV_MAX_OUTPUT_TOKENS = 16_384;
        const buildPrompt = (batch: typeof normalized, isFirst: boolean) =>
          `${conditionsBlock}${BANK_STATEMENT_PROMPT}\n\n` +
          `The transactions array has already been extracted and is given below as JSON. ` +
          `Return the same schema, ` +
          (isFirst
            ? `filling bankName/accountNumberMasked/periodFrom/periodTo from context if obvious (else null) `
            : `setting bankName/accountNumberMasked/periodFrom/periodTo to null (this is a continuation batch) `) +
          `and adding category / subcategory / counterparty / reference / isRecurring to each row. ` +
          `Preserve the given amount signs.\n\nINPUT_ROWS:\n${JSON.stringify(batch)}`;

        if (normalized.length <= CSV_BATCH_SIZE) {
          // Single-call fast path. Bumped to 16 K to match the chunked
          // path's per-call budget and absorb verbose narrations.
          const csvResult = await callGeminiJson<ExtractedStatement>(
            [{ role: 'user', content: buildPrompt(normalized, true) }],
            { maxTokens: CSV_MAX_OUTPUT_TOKENS },
          );
          extracted = csvResult.data;
          (res.locals as Record<string, unknown>).geminiUsages = [{
            inputTokens: csvResult.inputTokens,
            outputTokens: csvResult.outputTokens,
            modelUsed: csvResult.modelUsed,
          }];
        } else {
          // Chunked path. Each batch only categorises its own rows;
          // the first batch additionally returns statement metadata
          // (bankName / period). Merge by concat — input order is
          // preserved within each batch, and batches are submitted in
          // index order, so the resulting transactions[] matches the
          // original CSV row order.
          const batches: Array<typeof normalized> = [];
          for (let i = 0; i < normalized.length; i += CSV_BATCH_SIZE) {
            batches.push(normalized.slice(i, i + CSV_BATCH_SIZE));
          }
          console.log(`[bank-statements] csv path: ${normalized.length} rows → ${batches.length} batch(es) of up to ${CSV_BATCH_SIZE}`);
          sendSse({ type: 'start', totalChunks: batches.length, pages: batches.length });

          const batchResults = await mapWithConcurrency(
            batches,
            CSV_BATCH_CONCURRENCY,
            async (batch, idx) => {
              const t0 = Date.now();
              const result = await callGeminiJson<ExtractedStatement>(
                [{ role: 'user', content: buildPrompt(batch, idx === 0) }],
                { maxTokens: CSV_MAX_OUTPUT_TOKENS },
              );
              console.log(`[bank-statements] csv batch ${idx + 1}/${batches.length} ✓ ${result.data.transactions?.length ?? 0} rows in ${Date.now() - t0}ms`);
              sendSse({ type: 'progress', completed: idx + 1, total: batches.length, txInChunk: result.data.transactions?.length ?? 0 });
              return result;
            },
          );

          const merged: ExtractedStatement = {
            bankName: batchResults[0]?.data.bankName ?? null,
            accountNumberMasked: batchResults[0]?.data.accountNumberMasked ?? null,
            periodFrom: batchResults[0]?.data.periodFrom ?? null,
            periodTo: batchResults[0]?.data.periodTo ?? null,
            currency: batchResults[0]?.data.currency ?? 'INR',
            transactions: batchResults.flatMap(r => r.data.transactions ?? []),
          };

          // If a batch came back short, count-mismatch fail loudly rather
          // than silently dropping rows. Categorisation can drop a row if
          // Gemini truncated; we'd rather error than persist incomplete.
          if (merged.transactions.length < normalized.length * 0.95) {
            throw new Error(
              `Categorisation produced ${merged.transactions.length} rows but expected ~${normalized.length}. ` +
              `One or more batches likely truncated. Retry, and if it persists raise CSV_BATCH_SIZE downward.`,
            );
          }

          extracted = merged;
          (res.locals as Record<string, unknown>).geminiUsages = batchResults.map(r => ({
            inputTokens: r.inputTokens,
            outputTokens: r.outputTokens,
            modelUsed: r.modelUsed,
          }));
        }
      }

      // Honor a mid-flight cancel. If the user clicked Cancel while
      // Gemini was running, the placeholder row is now 'cancelled' —
      // don't overwrite it with extracted data and don't bill the slot
      // again (cancel route already debited featureUsage).
      if (bankStatementRepo.getStatus(placeholder.id, req.user.id) === 'cancelled') {
        console.log(`[bank-statements] statement ${placeholder.id} was cancelled mid-analysis; discarding ${extracted.transactions.length} extracted rows`);
        const cancelledPayload = {
          statement: serializeStatement(bankStatementRepo.findByIdForUser(placeholder.id, req.user.id)),
          transactions: [],
          txCount: 0,
          cancelled: true,
        };
        if (sseOpen) { sendSse({ type: 'done', ...cancelledPayload }); res.end(); }
        else res.status(200).json(cancelledPayload);
        return;
      }
      const { txCount, autoCorrected, mismatches } = persistStatement(req.user.id, placeholder.id, extracted, filename ?? 'Bank Statement');

      // Bill credits based on the actual file size processed. For PDF
      // paths pages_processed reflects chunks completed; for CSV the
      // route hasn't bumped it (single non-chunked Gemini call), so we
      // fall through to the upfront pagesTotal which IS the row count.
      try {
        const bankCredits = isCsv
          ? creditsForCsvRows('bank_statement', pagesTotal)
          : creditsForPages('bank_statement', pagesTotal);
        featureUsageRepo.logWithBilling(req.user.id, quota.billingUserId, 'bank_statement_analyze', bankCredits);
      } catch (err) {
        console.error('[bank-statements] Failed to log usage:', err);
      }

      // Log Gemini-side cost — aggregated across vision or pdfText-chunk
      // calls — so this feature appears in the admin API-cost dashboard.
      try {
        const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
        const usages = (res.locals as Record<string, unknown>).geminiUsages as
          Array<{ inputTokens: number; outputTokens: number; modelUsed: string }> | undefined;
        if (usages && usages.length > 0) {
          const inputTok = usages.reduce((a, u) => a + u.inputTokens, 0);
          const outputTok = usages.reduce((a, u) => a + u.outputTokens, 0);
          // Price each call by its actual model. The chunked TSV path
          // runs on gemini-2.5-flash / gemini-3-flash-preview; flat T2
          // rates were under-counting by 3-6x.
          const cost = usages.reduce((a, u) => a + costForModel(u.modelUsed, u.inputTokens, u.outputTokens), 0);
          usageRepo.logWithBilling(clientIp, req.user.id, quota.billingUserId, inputTok, outputTok, cost, false, usages[0].modelUsed, false, 'bank_statement');
        }
      } catch (err) {
        console.error('[bank-statements] Failed to log cost:', err);
      }

      const transactions = bankTransactionRepo.listByStatement(placeholder.id).map(serializeTransaction);
      const warning = (res.locals as Record<string, unknown>).analyzerWarning as string | undefined;
      // Reconciliation banner. We auto-fix sign flips against the
      // printed running balance (totals are already correct in that
      // case); we only ask the user to review rows where the
      // magnitude also disagrees.
      const reconciliationWarning = (() => {
        const parts: string[] = [];
        if (autoCorrected > 0) {
          parts.push(`Auto-corrected ${autoCorrected} row${autoCorrected === 1 ? '' : 's'} where the AI's credit/debit sign disagreed with the printed running balance — totals below reflect the corrected values.`);
        }
        if (mismatches.length > 0) {
          parts.push(`${mismatches.length} row${mismatches.length === 1 ? '' : 's'} still need${mismatches.length === 1 ? 's' : ''} manual review — the running balance doesn't match the AI's amount and we couldn't determine the correct value automatically.`);
        }
        return parts.length > 0 ? parts.join(' ') : null;
      })();
      const payload = {
        statement: serializeStatement(bankStatementRepo.findByIdForUser(placeholder.id, req.user.id)),
        transactions,
        txCount,
        ...(warning ? { warning } : {}),
        ...(reconciliationWarning ? { reconciliationWarning } : {}),
        ...(mismatches && mismatches.length > 0 ? { mismatches: mismatches.slice(0, 20) } : {}),
      };
      if (sseOpen) {
        sendSse({ type: 'done', ...payload });
        res.end();
      } else {
        res.status(200).json(payload);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[bank-statements] analyze error:', errMsg);
      // Mark the placeholder row as 'error' so the user sees it in the list
      // (and the polling loop stops) rather than a row stuck on 'analyzing'
      // forever. Leave the row in place — deleting would lose the error
      // message and prevent the user from understanding what went wrong.
      try {
        bankStatementRepo.setError(placeholder.id, req.user.id, errMsg);
      } catch (e) {
        console.error('[bank-statements] failed to mark statement as error:', e);
      }
      const body = {
        error: 'Failed to analyze statement.',
        detail: errMsg.slice(0, 400),
        statementId: placeholder.id,
        hint: 'If this is a large statement (150+ pages), try a CSV export instead. Scanned / image PDFs may also fail — re-save as a digital PDF and retry.',
      };
      if (sseOpen) {
        // SSE headers are already flushed, so we can't change status — emit
        // an error event and end the stream. The client parses this back into
        // a thrown Error, same shape as the JSON path.
        sendSse({ type: 'error', ...body });
        res.end();
      } else {
        res.status(500).json(body);
      }
    }
  },
);

// PATCH /api/bank-statements/:id — rename
router.patch('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  const ok = bankStatementRepo.updateName(req.params.id, req.user.id, name);
  if (!ok) { res.status(404).json({ error: 'Statement not found' }); return; }
  res.json({ statement: serializeStatement(bankStatementRepo.findByIdForUser(req.params.id, req.user.id)) });
});

// DELETE /api/bank-statements/:id
router.delete('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const ok = bankStatementRepo.deleteById(req.params.id, req.user.id);
  if (!ok) { res.status(404).json({ error: 'Statement not found' }); return; }
  res.json({ success: true });
});

// POST /api/bank-statements/:id/cancel — user-triggered cancel for a
// running analysis. Counts toward the monthly quota for the same reason
// ledger does: we already paid the Gemini cost for whatever chunks ran,
// and refunding the slot would make Generate→Cancel a free way past the
// monthly cap.
router.post('/:id/cancel', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const stmt = bankStatementRepo.findByIdForUser(req.params.id, req.user.id);
  if (!stmt) { res.status(404).json({ error: 'Statement not found' }); return; }
  if (stmt.status !== 'analyzing') {
    res.status(400).json({ error: `Statement already ${stmt.status}; nothing to cancel.` });
    return;
  }
  const ok = bankStatementRepo.cancel(stmt.id, req.user.id);
  if (!ok) { res.status(409).json({ error: 'Statement settled before cancel could apply.' }); return; }
  try {
    const actor = userRepo.findById(req.user.id);
    const billingUserId = actor ? getBillingUser(actor).id : req.user.id;
    // Cancel debits credits proportional to pages_processed (chunks
    // that finished before the cancel). 0 chunks done = 0 credits =
    // free retry, which is fair when the user catches a mis-upload
    // immediately. If cancel beat the first chunk we still log a
    // 0-credit row so the dashboard reflects the click.
    const after = bankStatementRepo.findByIdForUser(stmt.id, req.user.id);
    const cancelCredits = after && after.source_mime === 'text/csv'
      ? creditsForCsvRows('bank_statement', after.pages_processed || 0)
      : creditsForPages('bank_statement', after?.pages_processed || 0);
    featureUsageRepo.logWithBilling(req.user.id, billingUserId, 'bank_statement_analyze', cancelCredits);
  } catch (err) {
    console.error('[bank-statements] cancel feature_usage log failed', err);
  }
  res.json({ statement: serializeStatement(bankStatementRepo.findByIdForUser(stmt.id, req.user.id)) });
});

// PATCH /api/bank-statements/:id/transactions/:txId — reassign category
router.patch('/:id/transactions/:txId', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const { id, txId } = req.params;
  const category = typeof req.body?.category === 'string' ? normalizeCategory(req.body.category) : null;
  const subcategory = typeof req.body?.subcategory === 'string' ? req.body.subcategory : null;
  if (!category) { res.status(400).json({ error: 'category is required' }); return; }
  const ok = bankTransactionRepo.updateCategory(txId, id, req.user.id, category, subcategory);
  if (!ok) { res.status(404).json({ error: 'Transaction not found' }); return; }
  res.json({ success: true });
});

// GET /api/bank-statements/:id/export.csv — download categorized CSV
router.get('/:id/export.csv', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const row = bankStatementRepo.findByIdForUser(req.params.id, req.user.id);
  if (!row) { res.status(404).json({ error: 'Statement not found' }); return; }
  const txs = bankTransactionRepo.listByStatement(row.id);
  const csv = Papa.unparse({
    fields: ['Date', 'Narration', 'Counterparty', 'Reference', 'Type', 'Amount', 'Balance', 'Category', 'Subcategory', 'Recurring', 'UserOverride'],
    data: txs.map((t) => [
      t.tx_date ?? '',
      t.narration ?? '',
      t.counterparty ?? '',
      t.reference ?? '',
      t.amount >= 0 ? 'Credit' : 'Debit',
      Math.abs(t.amount),
      t.balance ?? '',
      t.category,
      t.subcategory ?? '',
      t.is_recurring ? 'Yes' : 'No',
      t.user_override ? 'Yes' : 'No',
    ]),
  });
  const safeName = (row.name || 'statement').replace(/[^a-z0-9_-]+/gi, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.csv"`);
  res.send(csv);
});

// Multer error handler — scoped to this router
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File exceeds the 500 KB size limit.' });
      return;
    }
    res.status(400).json({ error: `Upload error: ${err.message}` });
    return;
  }
  if (err instanceof Error && err.message === 'INVALID_MIME_TYPE') {
    res.status(400).json({ error: 'Invalid file type. Please upload a PDF or image (JPEG, PNG, WebP).' });
    return;
  }
  next(err);
});

export default router;
