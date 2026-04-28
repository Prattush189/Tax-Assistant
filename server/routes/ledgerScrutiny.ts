// server/routes/ledgerScrutiny.ts
//
// AI Ledger Scrutiny: ingest a year-long Indian accounting ledger PDF and
// produce a CA-grade audit report. Two passes:
//   1. Extract pass — Gemini vision/JSON over the ledger PDF, returning a
//      structured tree of accounts + transactions. Cached by file_hash so
//      re-running scrutiny on the same PDF doesn't re-extract.
//   2. Scrutiny pass — full LLM-graded rubric (§40A(3), §269ST, TDS scope,
//      personal expenses, suspicious narrations, reconciliation, RCM) per
//      account. Streamed via SSE so the UI fills in progressively.
//
// File-size limit: 3 MB at the multer layer. Year-long Tally / Busy
// exports with many account heads can run 200+ pages and routinely cross
// 1-2 MB once images and fonts are embedded. Anything beyond 3 MB is
// rejected with a clear "split the export" hint.

import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { extractWithRetry } from '../lib/documentExtract.js';
import { safeParseJson } from '../lib/geminiJson.js';
import { pickChatProvider } from '../lib/chatProvider.js';
import { SseWriter } from '../lib/sseStream.js';
import { gemini, GEMINI_CHAT_MODEL_THINK_FB, costForModel } from '../lib/gemini.js';
import { creditsForPages, PAGES_PER_CREDIT } from '../lib/creditPolicy.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import {
  LEDGER_EXTRACT_PROMPT,
  LEDGER_EXTRACT_TSV_PROMPT,
  LEDGER_SCRUTINY_SYSTEM_PROMPT,
  LEDGER_SCRUTINY_USER_PROMPT_HEAD,
} from '../lib/ledgerScrutinyPrompt.js';
import {
  ledgerScrutinyRepo,
  LedgerObservationCreateInput,
  LedgerAccountCreateInput,
  LedgerObservationSeverity,
} from '../db/repositories/ledgerScrutinyRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { getBillingUser } from '../lib/billing.js';
import { getUserLimits } from '../lib/planLimits.js';
import { AuthRequest } from '../types.js';

const router = Router();

const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3 MB — Tally / Busy year-long ledgers can be dense.

const ALLOWED_MIME_TYPES = ['application/pdf'] as const;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_MIME_TYPE'));
    }
  },
});

// ── Types for the extract-pass JSON shape ────────────────────────────────
interface ExtractedTransaction {
  date: string | null;
  narration: string | null;
  voucher: string | null;
  debit: number;
  credit: number;
  balance: number | null;
}

interface ExtractedAccount {
  name: string;
  accountType: string | null;
  opening: number;
  closing: number;
  totalDebit: number;
  totalCredit: number;
  transactions: ExtractedTransaction[];
}

interface ExtractedLedger {
  partyName: string | null;
  gstin: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  accounts: ExtractedAccount[];
}

// ── Types for the scrutiny-pass JSON shape ──────────────────────────────
interface ScrutinyObservationRaw {
  accountName: string | null;
  code: string;
  severity: string;
  message: string;
  amount: number | null;
  dateRef: string | null;
  suggestedAction: string | null;
}

interface ScrutinySummaryRaw {
  highCount?: number;
  warnCount?: number;
  infoCount?: number;
  totalFlaggedAmount?: number;
  headline?: string;
}

interface ScrutinyResultRaw {
  summary: ScrutinySummaryRaw;
  observations: ScrutinyObservationRaw[];
}

// ── Helpers ─────────────────────────────────────────────────────────────
function toNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalizeAccount(raw: unknown, idx: number): ExtractedAccount {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const txArr = Array.isArray(obj.transactions) ? obj.transactions : [];
  return {
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim().slice(0, 200) : `Account ${idx + 1}`,
    accountType: typeof obj.accountType === 'string' ? obj.accountType : null,
    opening: toNumber(obj.opening),
    closing: toNumber(obj.closing),
    totalDebit: toNumber(obj.totalDebit),
    totalCredit: toNumber(obj.totalCredit),
    transactions: txArr.map((t) => {
      const tobj = t && typeof t === 'object' ? (t as Record<string, unknown>) : {};
      return {
        date: typeof tobj.date === 'string' ? tobj.date : null,
        narration: typeof tobj.narration === 'string' ? tobj.narration.slice(0, 300) : null,
        voucher: typeof tobj.voucher === 'string' ? tobj.voucher : null,
        debit: toNumber(tobj.debit),
        credit: toNumber(tobj.credit),
        balance: tobj.balance === null || tobj.balance === undefined ? null : toNumber(tobj.balance),
      };
    }),
  };
}

function normalizeExtraction(raw: unknown): ExtractedLedger {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const accountsArr = Array.isArray(obj.accounts) ? obj.accounts : [];
  return {
    partyName: typeof obj.partyName === 'string' ? obj.partyName : null,
    gstin: typeof obj.gstin === 'string' ? obj.gstin : null,
    periodFrom: typeof obj.periodFrom === 'string' ? obj.periodFrom : null,
    periodTo: typeof obj.periodTo === 'string' ? obj.periodTo : null,
    accounts: accountsArr.map(normalizeAccount),
  };
}

function normalizeSeverity(raw: unknown): LedgerObservationSeverity {
  const s = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (s === 'high' || s === 'warn' || s === 'info') return s;
  return 'info';
}

/**
 * Resolve a quota gate before any expensive work runs. Returns either the
 * billingUserId / plan to attribute the work to, or false (response already
 * sent).
 */
function enforceQuota(
  req: AuthRequest,
  res: Response,
): { ok: true; billingUserId: string; plan: string; creditsLimit: number; creditsUsed: number; creditsRemaining: number } | { ok: false } {
  const actor = userRepo.findById(req.user!.id);
  if (!actor) {
    res.status(401).json({ error: 'User not found' });
    return { ok: false };
  }
  const billingUser = getBillingUser(actor);
  // Plan limit is now interpreted as a credit cap (1 credit = 10
  // ledger pages). Same number, far more capacity per credit since
  // a typical ledger run is one job, but a 200-page export now spans
  // 20 credits — preventing huge ledgers from consuming a whole
  // month of allowance in one call.
  const creditsLimit = getUserLimits(billingUser).ledgerScrutiny;
  let creditsUsed = 0;
  try {
    creditsUsed = featureUsageRepo.sumCreditsThisMonthByBillingUser(billingUser.id, 'ledger_scrutiny');
  } catch (err) {
    console.error('[ledger-scrutiny] usage read failed', err);
  }
  const creditsRemaining = Math.max(0, creditsLimit - creditsUsed);
  if (creditsRemaining <= 0) {
    res.status(429).json({
      error: `You've reached your monthly ledger scrutiny credit allowance. Upgrade your plan or wait until next month.`,
      upgrade: billingUser.plan !== 'enterprise',
      creditsUsed,
      creditsLimit,
    });
    return { ok: false };
  }
  return { ok: true, billingUserId: billingUser.id, plan: billingUser.plan, creditsLimit, creditsUsed, creditsRemaining };
}

// ── Serializers ─────────────────────────────────────────────────────────
function serializeJob(row: ReturnType<typeof ledgerScrutinyRepo.findByIdForUser>) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    partyName: row.party_name,
    gstin: row.gstin,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    sourceFilename: row.source_filename,
    sourceMime: row.source_mime,
    status: row.status,
    totalFlagsHigh: row.total_flags_high,
    totalFlagsWarn: row.total_flags_warn,
    totalFlagsInfo: row.total_flags_info,
    totalFlaggedAmount: row.total_flagged_amount,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeAccount(row: ReturnType<typeof ledgerScrutinyRepo.listAccounts>[number]) {
  return {
    id: row.id,
    name: row.name,
    accountType: row.account_type,
    opening: row.opening,
    closing: row.closing,
    totalDebit: row.total_debit,
    totalCredit: row.total_credit,
    txCount: row.tx_count,
  };
}

function serializeObservation(row: ReturnType<typeof ledgerScrutinyRepo.listObservations>[number]) {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    code: row.code,
    severity: row.severity,
    message: row.message,
    amount: row.amount,
    dateRef: row.date_ref,
    suggestedAction: row.suggested_action,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
  };
}

// ── TSV extraction (mirrors the bank-statement pipeline) ──────────────────
// The original ledger flow asked Gemini for one giant nested-JSON object over
// the whole PDF in a single vision call. That worked for short test ledgers
// and broke immediately on real year-long Tally / Busy exports: when the
// response truncated mid-JSON, `safeParseJson` silently failed and we
// surfaced "Failed to parse Gemini JSON response" with no diagnostic.
//
// The bank-statement analyzer hits the same shape of problem (50+ pages,
// many rows) and solves it with a chunked TSV pipeline + `---END:N---`
// trailer for truncation detection. We reuse the same approach here.

interface LedgerTsvAccount {
  name: string;
  accountType: string | null;
  opening: number | null;
  closing: number | null;
  totalDebit: number | null;
  totalCredit: number | null;
}

interface LedgerTsvTransaction {
  accountName: string;
  date: string | null;
  narration: string | null;
  voucher: string | null;
  debit: number;
  credit: number;
  balance: number | null;
}

interface LedgerTsvChunkResult {
  partyName: string | null;
  gstin: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  accounts: LedgerTsvAccount[];
  transactions: LedgerTsvTransaction[];
  declaredCount: number;
  actualCount: number;
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
}

function cleanTsvCell(s: string): string {
  const t = s.trim();
  if (t === '' || t.toLowerCase() === 'null') return '';
  return t;
}

function parseTsvNumber(s: string): number | null {
  const t = cleanTsvCell(s);
  if (t === '') return null;
  const n = Number(t.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseLedgerTsvResponse(raw: string): Omit<LedgerTsvChunkResult, 'inputTokens' | 'outputTokens' | 'modelUsed'> & { droppedReasons: string[] } {
  // Strip accidental code fences — the prompt forbids them but models slip.
  const text = raw.replace(/^```[a-z]*\n?/im, '').replace(/\n?```\s*$/m, '').trim();
  const lines = text.split(/\r?\n/);

  let partyName: string | null = null;
  let gstin: string | null = null;
  let periodFrom: string | null = null;
  let periodTo: string | null = null;
  const accounts: LedgerTsvAccount[] = [];
  const transactions: LedgerTsvTransaction[] = [];
  const droppedReasons: string[] = [];
  let declaredCount = -1;

  for (const line of lines) {
    if (!line.trim()) continue;
    const endMatch = /^---END:(\d+)---$/.exec(line.trim());
    if (endMatch) {
      declaredCount = parseInt(endMatch[1], 10);
      break;
    }
    if (line.startsWith('HEADER\t')) {
      const h = line.split('\t');
      partyName = cleanTsvCell(h[1] ?? '') || null;
      gstin = cleanTsvCell(h[2] ?? '') || null;
      periodFrom = cleanTsvCell(h[3] ?? '') || null;
      periodTo = cleanTsvCell(h[4] ?? '') || null;
      continue;
    }
    if (line.startsWith('ACCOUNT\t')) {
      const a = line.split('\t');
      // Required fields: ACCOUNT + name. Trailing fields (type / opening /
      // closing / totals) may be omitted by the model when they're empty,
      // so we never reject the line on field count alone — only the name
      // is mandatory. Missing trailing fields default to null and are
      // filled in either from a later chunk that surfaces the account or
      // recomputed from the transactions on merge.
      const name = cleanTsvCell(a[1] ?? '');
      if (!name) {
        droppedReasons.push('account-no-name');
        continue;
      }
      accounts.push({
        name,
        accountType: cleanTsvCell(a[2] ?? '') || null,
        opening: parseTsvNumber(a[3] ?? ''),
        closing: parseTsvNumber(a[4] ?? ''),
        totalDebit: parseTsvNumber(a[5] ?? ''),
        totalCredit: parseTsvNumber(a[6] ?? ''),
      });
      continue;
    }
    if (line.startsWith('TX\t')) {
      const t = line.split('\t');
      // Required fields: TX + accountName + date + (debit OR credit). The
      // model frequently strips the trailing balance field when empty
      // (Gemini quirk on long TSV — all 83 rows in a chunk omitted it),
      // so we accept rows down to 7 fields and treat missing trailing
      // fields (balance, then voucher) as empty. Anything below 7 means
      // the row was genuinely malformed.
      if (t.length < 7) {
        droppedReasons.push(`tx-fields=${t.length}`);
        continue;
      }
      const accountName = cleanTsvCell(t[1] ?? '');
      if (!accountName) {
        droppedReasons.push('tx-no-account');
        continue;
      }
      const debitStr = cleanTsvCell(t[5] ?? '');
      const creditStr = cleanTsvCell(t[6] ?? '');
      const debit = debitStr === '' ? 0 : Number(debitStr.replace(/[,\s]/g, ''));
      const credit = creditStr === '' ? 0 : Number(creditStr.replace(/[,\s]/g, ''));
      if (!Number.isFinite(debit) || !Number.isFinite(credit)) {
        droppedReasons.push('tx-NaN-amount');
        continue;
      }
      // Both debit AND credit populated is almost always the model
      // confusing a paired DR/CR display row. Production logs showed
      // 60-70 rows per chunk getting dropped this way, which tipped
      // chunks past the trailer-mismatch tolerance and triggered
      // expensive fallback retries. Salvage by taking the larger of
      // the two as the actual amount and zeroing the other — better
      // than dropping the row, and the parser warning still surfaces
      // the imperfect classification.
      let salvagedDebit = debit;
      let salvagedCredit = credit;
      if (debit > 0 && credit > 0) {
        droppedReasons.push('tx-both-debit-credit-salvaged');
        if (debit >= credit) salvagedCredit = 0; else salvagedDebit = 0;
      } else if (debit === 0 && credit === 0) {
        droppedReasons.push('tx-no-amount');
        continue;
      }
      transactions.push({
        accountName,
        date: cleanTsvCell(t[2] ?? '') || null,
        narration: cleanTsvCell(t[3] ?? '') || null,
        voucher: cleanTsvCell(t[4] ?? '') || null,
        debit: salvagedDebit,
        credit: salvagedCredit,
        balance: parseTsvNumber(t[7] ?? ''),
      });
    }
  }

  return {
    partyName,
    gstin,
    periodFrom,
    periodTo,
    accounts,
    transactions,
    declaredCount,
    actualCount: transactions.length,
    droppedReasons,
  };
}

/** Records the token usage of a Gemini call regardless of whether the
 *  response parsed cleanly. The route supplies a closure that captures
 *  user/billing identifiers and writes through usageRepo with category
 *  `_failed` for thrown attempts. Lets the admin dashboard distinguish
 *  productive from wasted spend instead of silently under-counting. */
type RecordAttempt = (input: { failed: boolean; inputTokens: number; outputTokens: number; model: string }) => void;
const NOOP_RECORD: RecordAttempt = () => {};

async function extractLedgerTsvOnce(
  chunkText: string,
  model: string,
  maxTokens: number,
  reasoningEffort: 'none' | 'low' | 'medium' | 'high',
  recordAttempt: RecordAttempt = NOOP_RECORD,
): Promise<LedgerTsvChunkResult> {
  const messages: ChatCompletionMessageParam[] = [{
    role: 'user',
    content: `${LEDGER_EXTRACT_TSV_PROMPT}\n\nINPUT_TEXT:\n${chunkText}`,
  }];
  // `reasoning_effort: 'none'` zeroes Gemini's thinking budget — without it
  // the model burns most of `max_tokens` reasoning before emitting any TSV
  // and finishes with finish_reason=length at a few rows. Transcribing rows
  // from already-extracted text needs no reasoning. `temperature: 0` makes
  // the extraction deterministic so the same ledger run twice produces the
  // same accounts and transactions.
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
  // Capture usage immediately. If any of the validation steps below throw,
  // the caller still gets the cost reported via the recordAttempt closure.
  // Mark `failed: true` until we know parsing succeeded.
  let succeeded = false;
  try {
    const parsed = parseLedgerTsvResponse(raw);

    // Integrity check #1: trailer MUST be present. Its absence means either
    // the model output truncated mid-stream (hit max_tokens) OR the model
    // returned a short prose / refusal response. Log a preview + finish_reason
    // so the next occurrence tells us which case it is.
    if (parsed.declaredCount < 0) {
      const preview = raw.slice(0, 300).replace(/\n/g, '\\n');
      console.warn(`[ledger-scrutiny] ${model} truncated (finish_reason=${finishReason}, got ${parsed.actualCount} TX). Raw preview: ${preview}`);
      throw new Error(`TSV response was truncated: missing ---END:N--- trailer (got ${parsed.actualCount} TX, finish_reason=${finishReason})`);
    }

    // Integrity check #2: parsed rows MUST NOT be fewer than the trailer
    // count. If we parsed fewer than declared we usually dropped some
    // (malformed lines, wrong field count). But Gemini also empirically
    // miscounts its own trailer by 1-2 on dense input even when nothing
    // was dropped (`dropped: unknown`), so we tolerate a small delta —
    // ≤ max(2, 2% of declared) — rather than throwing away a 80-row
    // chunk because the trailer said 84 and we got 83 cleanly.
    if (parsed.actualCount < parsed.declaredCount) {
      const delta = parsed.declaredCount - parsed.actualCount;
      const tolerance = Math.max(2, Math.floor(parsed.declaredCount * 0.02));
      const reasonCounts = parsed.droppedReasons.reduce<Record<string, number>>((acc, r) => {
        acc[r] = (acc[r] ?? 0) + 1;
        return acc;
      }, {});
      const reasonStr = Object.entries(reasonCounts).map(([k, v]) => `${k}=${v}`).join(',') || 'unknown';
      if (delta > tolerance) {
        throw new Error(`TSV row-count mismatch: trailer claims ${parsed.declaredCount}, parsed ${parsed.actualCount} (dropped: ${reasonStr})`);
      }
      console.warn(`[ledger-scrutiny] ${model} small trailer undercount within tolerance: claimed ${parsed.declaredCount}, parsed ${parsed.actualCount} (dropped: ${reasonStr}) — accepting`);
    }
    if (parsed.actualCount > parsed.declaredCount) {
      console.warn(`[ledger-scrutiny] ${model} trailer undercount: claimed ${parsed.declaredCount}, parsed ${parsed.actualCount} — accepting parsed count`);
    }

    succeeded = true;
    return {
      ...parsed,
      inputTokens,
      outputTokens,
      modelUsed: model,
    };
  } finally {
    // Record this attempt's cost. Successful attempts are still aggregated
    // and logged at the route level so we can attribute them to features —
    // `failed: false` here is a no-op for the cost dashboard. Failed
    // attempts (truncation / trailer mismatch / row-count mismatch) get
    // logged with category `_failed` so wasted spend is visible.
    recordAttempt({ failed: !succeeded, inputTokens, outputTokens, model });
  }
}

/**
 * Retry + fallback wrapper. Mirrors the bank-statement two-tier cascade:
 *   - Primary : gemini-2.5-flash       — stable GA, most reliable on long TSV.
 *   - Fallback: gemini-3-flash-preview — stronger on dense chunks but flakier;
 *                                        only invoked when the GA model fails.
 *
 * Truncation / trailer-mismatch errors break out of the current tier
 * immediately — retrying the same params on the same model can't fix a
 * truncated response, but the fallback's doubled output ceiling can.
 */
async function extractLedgerTsv(chunkText: string, maxTokens: number, recordAttempt: RecordAttempt = NOOP_RECORD): Promise<LedgerTsvChunkResult> {
  const MAX_PRIMARY_ATTEMPTS = 4;
  const MAX_FALLBACK_ATTEMPTS = 3;
  let lastErr: unknown;

  const jitter = () => 300 + Math.floor(Math.random() * 600);
  const isRetryableStatus = (s: number) =>
    s === 429 || s === 500 || s === 502 || s === 503 || s === 504;
  const tierDone = (err: unknown): boolean => {
    const msg = (err as Error).message ?? '';
    const status = (err as { status?: number })?.status ?? 0;
    if (/trailer|mismatch|truncated/i.test(msg)) return true;
    if (status === 400) return true;
    if (!isRetryableStatus(status) && status !== 0) return true;
    return false;
  };

  const PRIMARY_BACKOFFS_MS = [2_000, 5_000, 12_000];
  for (let attempt = 0; attempt < MAX_PRIMARY_ATTEMPTS; attempt++) {
    try {
      return await extractLedgerTsvOnce(chunkText, 'gemini-2.5-flash', maxTokens, 'none', recordAttempt);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status ?? 0;
      const msg = (err as Error).message?.slice(0, 140) ?? '';
      if (tierDone(err)) {
        console.warn(`[ledger-scrutiny] primary gemini-2.5-flash giving up after attempt ${attempt + 1}: ${status || 'no status'} — ${msg}`);
        break;
      }
      if (attempt < MAX_PRIMARY_ATTEMPTS - 1) {
        const wait = (PRIMARY_BACKOFFS_MS[attempt] ?? 12_000) + jitter();
        console.warn(`[ledger-scrutiny] primary attempt ${attempt + 1}/${MAX_PRIMARY_ATTEMPTS} failed (${status || 'no status'}); retrying in ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }

  for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS; attempt++) {
    try {
      return await extractLedgerTsvOnce(chunkText, GEMINI_CHAT_MODEL_THINK_FB, maxTokens * 2, 'low', recordAttempt);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status ?? 0;
      const msg = (err as Error).message?.slice(0, 140) ?? '';
      if (tierDone(err)) {
        console.warn(`[ledger-scrutiny] fallback ${GEMINI_CHAT_MODEL_THINK_FB} giving up after attempt ${attempt + 1}: ${status || 'no status'} — ${msg}`);
        break;
      }
      if (attempt < MAX_FALLBACK_ATTEMPTS - 1) {
        const wait = 3_000 + jitter();
        console.warn(`[ledger-scrutiny] fallback attempt ${attempt + 1}/${MAX_FALLBACK_ATTEMPTS} failed (${status || 'no status'}); retrying in ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Try `extractLedgerTsv` on the chunk, and if it fails for a reason that
 * smaller input would plausibly fix (truncation / trailer mismatch / tier
 * exhaustion after retries), split the chunk in half and try each half
 * separately. Recurses up to `maxDepth` times before giving up — at depth
 * 2 a single original chunk can become 4 sub-chunks, which is enough to
 * recover from any practical Tally export where one section happens to
 * be denser than the rest.
 *
 * The bank-statement pipeline doesn't need this because its chunks are
 * uniformly sized small chunks of transactions. Ledgers are different:
 * one account head can dump 500+ transactions in a single page, while
 * the next page might have a sparse 5-transaction account. Bisection
 * gives us a self-healing recovery path for the dense outliers.
 */
async function extractLedgerTsvWithBisect(
  chunkText: string,
  maxTokens: number,
  depth: number,
  maxDepth: number,
  label: string,
  recordAttempt: RecordAttempt = NOOP_RECORD,
): Promise<LedgerTsvChunkResult[]> {
  try {
    const r = await extractLedgerTsv(chunkText, maxTokens, recordAttempt);
    return [r];
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (depth >= maxDepth) {
      console.warn(`[ledger-scrutiny] ${label}: bisect depth ${depth} reached, surfacing error: ${msg.slice(0, 140)}`);
      throw err;
    }
    if (chunkText.length < 1500) {
      // Below 1.5K chars there's nothing to gain from another split — the
      // failure is the model giving up on legitimately small input.
      console.warn(`[ledger-scrutiny] ${label}: chunk too small to bisect (${chunkText.length} chars), surfacing error`);
      throw err;
    }
    console.warn(`[ledger-scrutiny] ${label}: bisecting after failure (${msg.slice(0, 140)})`);

    // Split on a paragraph boundary near the midpoint to keep account
    // blocks intact. The text is `\n\n`-joined pages, so a `\n\n` near
    // the middle is the cleanest cut point.
    const mid = Math.floor(chunkText.length / 2);
    let cut = chunkText.lastIndexOf('\n\n', mid);
    if (cut < chunkText.length * 0.2 || cut < 0) {
      cut = chunkText.indexOf('\n\n', mid);
    }
    if (cut < 0) cut = mid;
    const left = chunkText.slice(0, cut).trim();
    const right = chunkText.slice(cut).trim();
    if (!left || !right) throw err;

    const [leftRes, rightRes] = await Promise.all([
      extractLedgerTsvWithBisect(left, maxTokens, depth + 1, maxDepth, `${label}.L`, recordAttempt),
      extractLedgerTsvWithBisect(right, maxTokens, depth + 1, maxDepth, `${label}.R`, recordAttempt),
    ]);
    return [...leftRes, ...rightRes];
  }
}

/** Bounded-concurrency map. Lets us run chunk extractions in parallel
 *  without firing 6+ concurrent Gemini calls per request, which routinely
 *  trips per-key rate limits on long ledgers. */
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
 *  Used as a cross-check to catch cases where every chunk emitted a valid
 *  trailer but the model still skipped rows. Conservative — we only fail
 *  if the delta is large. */
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

/** Pack `--- PAGE BREAK ---` separated pages into chunks under the char
 *  budget. A 10-page ledger becomes ONE chunk; a 60-page ledger ~7 chunks. */
function chunkLedgerText(rawText: string, maxCharsPerChunk: number, maxChunks: number): string[] {
  const pages = rawText.split(/\n?---\s*PAGE BREAK\s*---\n?/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf: string[] = [];
  let bufLen = 0;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (buf.length > 0 && bufLen + p.length > maxCharsPerChunk) {
      chunks.push(buf.join('\n\n'));
      buf = [];
      bufLen = 0;
      if (chunks.length >= maxChunks) break;
    }
    buf.push(p);
    bufLen += p.length + 2;
  }
  if (buf.length > 0 && chunks.length < maxChunks) chunks.push(buf.join('\n\n'));
  if (chunks.length === 0) chunks.push(rawText.slice(0, maxCharsPerChunk));
  return chunks;
}

/** Merge per-chunk results into a single ExtractedLedger. Account totals
 *  are recomputed from the actual transactions (the model's per-chunk
 *  totals are unreliable when an account is split across chunks). Account
 *  metadata (type, opening, closing) is taken from the first / last chunk
 *  that surfaced it. */
function mergeLedgerChunks(chunkResults: LedgerTsvChunkResult[]): ExtractedLedger {
  const partyName = chunkResults.map(r => r.partyName).find(v => !!v) ?? null;
  const gstin = chunkResults.map(r => r.gstin).find(v => !!v) ?? null;
  const periodFrom = chunkResults.map(r => r.periodFrom).find(v => !!v) ?? null;
  const periodTo = chunkResults.map(r => r.periodTo).find(v => !!v) ?? null;

  // Group transactions by lowercase account name. Preserve insertion order
  // so the first time we see an account in a chunk fixes its display order.
  const accountOrder: string[] = [];
  const accountMeta = new Map<string, { name: string; accountType: string | null; opening: number | null; closing: number | null }>();
  const txByAccount = new Map<string, ExtractedTransaction[]>();

  const ensureAccount = (name: string, accountType: string | null) => {
    const key = name.toLowerCase();
    if (!accountMeta.has(key)) {
      accountOrder.push(key);
      accountMeta.set(key, { name, accountType, opening: null, closing: null });
      txByAccount.set(key, []);
    } else if (accountType && !accountMeta.get(key)!.accountType) {
      accountMeta.get(key)!.accountType = accountType;
    }
  };

  for (const chunk of chunkResults) {
    for (const a of chunk.accounts) {
      ensureAccount(a.name, a.accountType);
      const meta = accountMeta.get(a.name.toLowerCase())!;
      // Opening balance: take the FIRST non-null value seen across chunks
      // (the chunk that actually contained the opening balance line).
      if (meta.opening === null && a.opening !== null) meta.opening = a.opening;
      // Closing balance: take the LAST non-null value (the chunk that
      // actually contained the closing balance line is usually the last
      // chunk in which the account appears).
      if (a.closing !== null) meta.closing = a.closing;
    }
    for (const t of chunk.transactions) {
      ensureAccount(t.accountName, null);
      const key = t.accountName.toLowerCase();
      txByAccount.get(key)!.push({
        date: t.date,
        narration: t.narration,
        voucher: t.voucher,
        debit: t.debit,
        credit: t.credit,
        balance: t.balance,
      });
    }
  }

  const accounts: ExtractedAccount[] = accountOrder.map((key) => {
    const meta = accountMeta.get(key)!;
    const txs = txByAccount.get(key) ?? [];
    const totalDebit = txs.reduce((s, t) => s + (t.debit || 0), 0);
    const totalCredit = txs.reduce((s, t) => s + (t.credit || 0), 0);
    return {
      name: meta.name,
      accountType: meta.accountType,
      opening: meta.opening ?? 0,
      closing: meta.closing ?? 0,
      totalDebit,
      totalCredit,
      transactions: txs,
    };
  });

  return { partyName, gstin, periodFrom, periodTo, accounts };
}

// ── Chunked scrutiny pass ────────────────────────────────────────────────
// The single-call scrutiny was hitting `Scrutiny response was not valid
// JSON (49549 chars streamed; likely truncated mid-output)` on a 174-
// account ledger because the audit JSON for that many accounts blew past
// the 16K-token output budget. Solution: split accounts into groups,
// audit each group in a separate Gemini call, merge observations.

interface ScrutinyChunkResult {
  observations: ScrutinyObservationRaw[];
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
}

/** One scrutiny call covering a subset of accounts. Mirrors the extract
 *  pipeline's structure (recordAttempt, manual cost capture) so failed
 *  attempts get logged under `ledger_scrutiny_failed` instead of vanishing. */
async function scrutinizeAccountGroupOnce(
  extracted: ExtractedLedger,
  groupAccounts: ExtractedAccount[],
  txPerAccount: number,
  totalAccounts: number,
  model: string,
  maxTokens: number,
  recordAttempt: RecordAttempt = NOOP_RECORD,
): Promise<ScrutinyChunkResult> {
  const ledgerForPrompt = {
    partyName: extracted.partyName,
    gstin: extracted.gstin,
    periodFrom: extracted.periodFrom,
    periodTo: extracted.periodTo,
    accounts: groupAccounts.map((a) => ({
      name: a.name,
      accountType: a.accountType,
      opening: a.opening,
      closing: a.closing,
      totalDebit: a.totalDebit,
      totalCredit: a.totalCredit,
      transactions: (a.transactions ?? []).slice(0, txPerAccount),
    })),
  };
  const userMessage = `${LEDGER_SCRUTINY_USER_PROMPT_HEAD}This is a SUBSET of ${groupAccounts.length} accounts out of ${totalAccounts} in the full ledger. Apply the rubric and emit observations only for the accounts shown below. Skip cross-ledger reconciliation findings (those are computed server-side from totals). Do NOT fabricate accounts not shown.\n\n${JSON.stringify(ledgerForPrompt, null, 2)}`;

  const response = await gemini.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: LEDGER_SCRUTINY_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    stream: false,
    response_format: { type: 'json_object' },
    temperature: 0,
  });
  const raw = response.choices[0]?.message?.content ?? '{}';
  const finishReason = response.choices[0]?.finish_reason ?? 'unknown';
  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;
  let succeeded = false;
  try {
    const parsed = safeParseJson<ScrutinyResultRaw>(raw);
    if (!parsed || !Array.isArray(parsed.observations)) {
      const tail = raw.slice(-200).replace(/\n/g, '\\n');
      console.warn(`[ledger-scrutiny] ${model} scrutiny chunk parse failed (finish_reason=${finishReason}, ${raw.length} chars). Tail: ${tail}`);
      throw new Error(`Scrutiny chunk JSON parse failed (${raw.length} chars, finish_reason=${finishReason})`);
    }
    succeeded = true;
    return { observations: parsed.observations, inputTokens, outputTokens, modelUsed: model };
  } finally {
    recordAttempt({ failed: !succeeded, inputTokens, outputTokens, model });
  }
}

/** Two-tier retry mirroring the extract pipeline. */
async function scrutinizeAccountGroup(
  extracted: ExtractedLedger,
  groupAccounts: ExtractedAccount[],
  txPerAccount: number,
  totalAccounts: number,
  recordAttempt: RecordAttempt,
): Promise<ScrutinyChunkResult> {
  const MAX_PRIMARY_ATTEMPTS = 3;
  const MAX_FALLBACK_ATTEMPTS = 2;
  let lastErr: unknown;
  const jitter = () => 300 + Math.floor(Math.random() * 600);
  const isRetryableStatus = (s: number) =>
    s === 429 || s === 500 || s === 502 || s === 503 || s === 504;
  const PRIMARY_BACKOFFS_MS = [2_000, 5_000];

  for (let attempt = 0; attempt < MAX_PRIMARY_ATTEMPTS; attempt++) {
    try {
      return await scrutinizeAccountGroupOnce(extracted, groupAccounts, txPerAccount, totalAccounts, 'gemini-2.5-flash', 8192, recordAttempt);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status ?? 0;
      const msg = (err as Error).message ?? '';
      if (/parse failed/i.test(msg) || (status !== 0 && !isRetryableStatus(status))) break;
      if (attempt < MAX_PRIMARY_ATTEMPTS - 1) {
        await new Promise(r => setTimeout(r, (PRIMARY_BACKOFFS_MS[attempt] ?? 5_000) + jitter()));
      }
    }
  }
  for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS; attempt++) {
    try {
      return await scrutinizeAccountGroupOnce(extracted, groupAccounts, txPerAccount, totalAccounts, GEMINI_CHAT_MODEL_THINK_FB, 16384, recordAttempt);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_FALLBACK_ATTEMPTS - 1) {
        await new Promise(r => setTimeout(r, 3_000 + jitter()));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Run scrutiny across an entire ledger by chunking accounts. Each group
 * gets its own Gemini call, observations are merged, and per-account
 * totals plus reconciliation flags are computed server-side.
 *
 * Returns the prepared LedgerObservationCreateInput[] ready to persist
 * plus aggregated usage for cost logging.
 */
async function runChunkedScrutiny(
  extracted: ExtractedLedger,
  accountIdByName: Map<string, string>,
  recordAttempt: RecordAttempt,
  onChunkDone: (completed: number, total: number) => void = () => {},
): Promise<{
  observations: LedgerObservationCreateInput[];
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
}> {
  // 60 tx per account is enough to surface §40A(3), §269ST, TDS-scope,
  // personal-expense and round-tripping signals for the rubric. The old
  // 200-row digest was paying input cost without proportional accuracy.
  const TX_PER_ACCOUNT = 60;
  // 15 accounts × 60 tx ≈ 35K input tokens — comfortably under the
  // gemini-2.5-flash window — and the 8K output ceiling holds 25-30
  // observations easily, which is more than any single 15-account
  // group ever produces in practice.
  const ACCOUNTS_PER_CHUNK = 15;
  const SCRUTINY_CONCURRENCY = 2;

  const accounts = extracted.accounts;
  if (accounts.length === 0) {
    return { observations: [], inputTokens: 0, outputTokens: 0, modelUsed: 'gemini-2.5-flash' };
  }
  const groups: ExtractedAccount[][] = [];
  for (let i = 0; i < accounts.length; i += ACCOUNTS_PER_CHUNK) {
    groups.push(accounts.slice(i, i + ACCOUNTS_PER_CHUNK));
  }
  console.log(`[ledger-scrutiny] chunked scrutiny: ${accounts.length} accounts → ${groups.length} group(s)`);

  let completed = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let modelUsed = '';
  const allObservations: ScrutinyObservationRaw[] = [];

  await mapWithConcurrency(groups, SCRUTINY_CONCURRENCY, async (group, idx) => {
    const t0 = Date.now();
    try {
      const r = await scrutinizeAccountGroup(extracted, group, TX_PER_ACCOUNT, accounts.length, recordAttempt);
      console.log(`[ledger-scrutiny] scrutiny group ${idx + 1}/${groups.length} ✓ ${r.observations.length} observations in ${Date.now() - t0}ms`);
      allObservations.push(...r.observations);
      totalInput += r.inputTokens;
      totalOutput += r.outputTokens;
      modelUsed = r.modelUsed || modelUsed;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      console.error(`[ledger-scrutiny] scrutiny group ${idx + 1}/${groups.length} ✗ ${msg}`);
      throw new Error(`Scrutiny group ${idx + 1}/${groups.length}: ${msg}`);
    } finally {
      completed += 1;
      onChunkDone(completed, groups.length);
    }
  });

  const observationInputs: LedgerObservationCreateInput[] = allObservations.map((o) => {
    const accountId = o.accountName ? accountIdByName.get(o.accountName.toLowerCase()) ?? null : null;
    return {
      accountId,
      accountName: o.accountName ?? null,
      code: typeof o.code === 'string' ? o.code.slice(0, 64) : 'GENERIC',
      severity: normalizeSeverity(o.severity),
      message: typeof o.message === 'string' ? o.message.slice(0, 1000) : '',
      amount: o.amount === null || o.amount === undefined ? null : toNumber(o.amount),
      dateRef: typeof o.dateRef === 'string' ? o.dateRef : null,
      suggestedAction: typeof o.suggestedAction === 'string' ? o.suggestedAction.slice(0, 500) : null,
    };
  }).filter((o) => o.message);

  return { observations: observationInputs, inputTokens: totalInput, outputTokens: totalOutput, modelUsed: modelUsed || 'gemini-2.5-flash' };
}

// ── Routes ──────────────────────────────────────────────────────────────

// GET /api/ledger-scrutiny — list jobs (with usage counter)
router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const rows = ledgerScrutinyRepo.listByUser(req.user.id);
  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : null;
  const limits = billingUser ? getUserLimits(billingUser) : null;
  const creditsUsed = billingUser
    ? featureUsageRepo.sumCreditsThisMonthByBillingUser(billingUser.id, 'ledger_scrutiny')
    : 0;
  const creditsLimit = limits?.ledgerScrutiny ?? 0;
  res.json({
    jobs: rows.map(serializeJob),
    usage: {
      // Legacy fields kept for any caller still reading them; both
      // values now refer to credits, not run counts.
      used: creditsUsed,
      limit: creditsLimit,
      // Credit accounting fields the UI uses to render the percentage
      // bar and the "X / Y pages" / "X / Y rows" subtitle.
      creditsUsed,
      creditsLimit,
      pagesPerCredit: PAGES_PER_CREDIT.ledger_scrutiny,
    },
  });
});

// GET /api/ledger-scrutiny/:id — full detail (job + accounts + observations)
router.get('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const job = ledgerScrutinyRepo.findByIdForUser(req.params.id, req.user.id);
  if (!job) { res.status(404).json({ error: 'Ledger scrutiny job not found' }); return; }
  const accounts = ledgerScrutinyRepo.listAccounts(job.id).map(serializeAccount);
  const observations = ledgerScrutinyRepo.listObservations(job.id).map(serializeObservation);
  res.json({
    job: serializeJob(job),
    accounts,
    observations,
  });
});

// PATCH /api/ledger-scrutiny/:id — rename
router.patch('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  const ok = ledgerScrutinyRepo.rename(req.params.id, req.user.id, name);
  if (!ok) { res.status(404).json({ error: 'Job not found' }); return; }
  res.json({ job: serializeJob(ledgerScrutinyRepo.findByIdForUser(req.params.id, req.user.id)) });
});

// DELETE /api/ledger-scrutiny/:id
router.delete('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const ok = ledgerScrutinyRepo.deleteById(req.params.id, req.user.id);
  if (!ok) { res.status(404).json({ error: 'Job not found' }); return; }
  res.json({ success: true });
});

// PATCH /api/ledger-scrutiny/:id/observations/:obsId — toggle status
router.patch('/:id/observations/:obsId', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const status = req.body?.status;
  if (status !== 'open' && status !== 'resolved') {
    res.status(400).json({ error: 'status must be "open" or "resolved"' });
    return;
  }
  const ok = ledgerScrutinyRepo.setObservationStatus(req.params.obsId, req.user.id, status);
  if (!ok) { res.status(404).json({ error: 'Observation not found' }); return; }
  const obs = ledgerScrutinyRepo.findObservationForUser(req.params.obsId, req.user.id);
  res.json({ observation: obs ? serializeObservation(obs) : null });
});

// POST /api/ledger-scrutiny/upload — accepts EITHER:
//   - multipart/form-data with a PDF file (vision path; used for scanned
//     ledgers without a text layer), OR
//   - application/json with `{ pdfText, filename? }` (TSV chunked path; the
//     frontend extracts the PDF text via pdfjs-dist and sends it here. This
//     mirrors the bank-statement analyzer and is what makes the feature work
//     reliably on 50+ page ledgers).
router.post(
  '/upload',
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

    const isPdfText = !req.file && typeof req.body?.pdfText === 'string' && req.body.pdfText.length > 0;
    if (!req.file && !isPdfText) {
      res.status(400).json({ error: 'No file uploaded. Attach a ledger PDF as "file" or send pdfText JSON.' });
      return;
    }

    // Quota gate before extraction (which is also expensive — though we
    // only debit usage on a successful scrutiny pass, we don't want a user
    // already at-cap to burn extract calls either).
    const quota = enforceQuota(req, res);
    if (!quota.ok) return;

    let filename: string;
    let mimeType: string;
    let fileHash: string;
    let pdfText: string | null = null;

    if (req.file) {
      filename = req.file.originalname;
      mimeType = req.file.mimetype;
      fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    } else {
      pdfText = String(req.body.pdfText);
      filename = typeof req.body?.filename === 'string' && req.body.filename.trim()
        ? String(req.body.filename)
        : 'ledger.pdf';
      mimeType = 'application/pdf';
      // Hash the text content — re-extracting the same digital ledger
      // produces byte-identical text from pdfjs, so the cache still works.
      fileHash = crypto.createHash('sha256').update(pdfText).digest('hex');
    }

    // Refuse to start a parallel extraction if one is still running for
    // this exact file. A tab close + retry used to fire a fresh Gemini
    // run while the previous one was still going, doubling cost for no
    // benefit. The in-progress job stays alive on the server (Node.js
    // doesn't abort handlers when the client disconnects), so handing
    // back its id lets the UI re-attach via GET /api/ledger-scrutiny/:id
    // instead of paying for the same work twice.
    const inProgress = ledgerScrutinyRepo.findInProgressByHashForUser(req.user.id, fileHash);
    if (inProgress) {
      console.log(`[ledger-scrutiny] re-attaching to in-progress job ${inProgress.id} (status=${inProgress.status}) instead of starting a new run`);
      const accounts = ledgerScrutinyRepo.listAccounts(inProgress.id).map(serializeAccount);
      const observations = ledgerScrutinyRepo.listObservations(inProgress.id).map(serializeObservation);
      res.status(200).json({
        job: serializeJob(inProgress),
        accounts,
        observations,
        resumed: true,
      });
      return;
    }

    // Pre-flight credit check. Count pages up front (cheap — pdfText is
    // already split, vision falls back to a 10-page minimum estimate)
    // and refuse the upload if the user's remaining credits don't cover
    // the file. 1 credit = 10 ledger pages.
    let ledgerPagesTotal = 0;
    if (pdfText !== null) {
      ledgerPagesTotal = pdfText.split(/\n?---\s*PAGE BREAK\s*---\n?/).filter(p => p.trim()).length;
      if (ledgerPagesTotal === 0) ledgerPagesTotal = 1;
    } else {
      // Vision path on a scanned PDF — page count from raw bytes is
      // expensive to compute here; charge minimum 1 credit (10 pages
      // of headroom) and reconcile via pages_processed at finish time.
      ledgerPagesTotal = PAGES_PER_CREDIT.ledger_scrutiny;
    }
    const ledgerCreditsNeeded = creditsForPages('ledger_scrutiny', ledgerPagesTotal);
    if (ledgerCreditsNeeded > quota.creditsRemaining) {
      const excessPct = quota.creditsRemaining > 0
        ? Math.ceil(((ledgerCreditsNeeded - quota.creditsRemaining) / quota.creditsRemaining) * 100)
        : 100;
      const remainingPages = quota.creditsRemaining * PAGES_PER_CREDIT.ledger_scrutiny;
      const errorMsg = quota.creditsRemaining === 0
        ? `You've already used 100% of your monthly ledger allowance. Upgrade your plan or wait until next month.`
        : `This ledger (${ledgerPagesTotal} pages) exceeds your remaining monthly allowance by ~${excessPct}%. You have room for about ${remainingPages} pages this month.`;
      res.status(413).json({
        error: errorMsg,
        excessPct,
        creditsNeeded: ledgerCreditsNeeded,
        creditsRemaining: quota.creditsRemaining,
        upgrade: quota.plan !== 'enterprise',
      });
      return;
    }

    // If the user uploaded the same file before, reuse the extraction —
    // creates a fresh job row but skips re-running the extract pass.
    const cached = ledgerScrutinyRepo.findByHashForUser(req.user.id, fileHash);

    const job = ledgerScrutinyRepo.createJob(req.user.id, quota.billingUserId, {
      name: filename.replace(/\.pdf$/i, '') || 'Ledger',
      partyName: cached?.party_name ?? null,
      gstin: cached?.gstin ?? null,
      periodFrom: cached?.period_from ?? null,
      periodTo: cached?.period_to ?? null,
      sourceFilename: filename,
      sourceMime: mimeType,
      fileHash,
    });
    ledgerScrutinyRepo.setPagesTotal(job.id, req.user.id, ledgerPagesTotal);

    // Declared outside the try so the catch block can include them in the
    // error response — lets the user (and us in logs) see whether chunking
    // was attempted at all when extraction fails.
    let extractPath: 'cache' | 'tsv-chunked' | 'vision' = 'vision';
    let chunkCount = 0;
    // Captured up here so the auto-chain block (which runs after both the
    // pdfText and vision branches) can use the same client IP for cost
    // logging without recomputing it.
    const ledgerClientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';

    try {
      let extracted: ExtractedLedger;
      let rawJson: string;

      if (cached?.raw_extracted) {
        extractPath = 'cache';
        rawJson = cached.raw_extracted;
        const parsed = safeParseJson<ExtractedLedger>(rawJson);
        extracted = normalizeExtraction(parsed);
      } else if (pdfText !== null) {
        extractPath = 'tsv-chunked';
        // ── TSV chunked path (digital PDFs) ─────────────────────────────
        // Sized to mirror the bank-statement pipeline. 8K-char chunks fit
        // comfortably inside gemini-2.5-flash with a 16K-token output
        // budget once thinking is disabled (~500 TSV rows of headroom),
        // which leaves enough slack for dense Tally exports where a single
        // narration can run 200+ chars. 50 chunks covers ~150 pages.
        ledgerScrutinyRepo.setStatus(job.id, req.user.id, 'extracting');
        const MAX_CHARS_PER_CHUNK = 8_000;
        const MAX_OUTPUT_TOKENS = 16_384;
        const MAX_CHUNKS = 50;
        // Concurrency 3: tested at 2 (very low retry tax but doubled
        // wall-time vs the original 4) and 4 (fast but heavy 503 wave).
        // 3 is the empirical sweet spot — keeps a 33-chunk ledger
        // around 8-10 min while still saturating the per-key burst
        // budget enough to avoid paying for half-finished extracts.
        // Failed-attempt cost logging surfaces any retry tax in
        // `ledger_extract_failed` so we can keep tuning from data.
        const CHUNK_CONCURRENCY = 3;

        const chunks = chunkLedgerText(pdfText, MAX_CHARS_PER_CHUNK, MAX_CHUNKS);
        chunkCount = chunks.length;
        const dateCount = countLikelyDates(pdfText);
        console.log(`[ledger-scrutiny] pdfText path: ${chunks.length} chunk(s), ~${dateCount} candidate dates`);

        // Closure that fires for every Gemini attempt — successful or
        // not. Failed attempts get logged immediately at category
        // `ledger_extract_failed` so the admin dashboard reflects wasted
        // spend; successful attempts are aggregated and logged as
        // `ledger_extract` after merge so the per-feature totals stay
        // tidy. Without this, retries / truncations / trailer mismatches
        // burned billable tokens that never showed up in our tracking
        // (production: $7 spend vs $1.59 logged on a 33-chunk run).
        const recordLedgerAttempt: RecordAttempt = ({ failed, inputTokens, outputTokens, model }) => {
          if (!failed) return;
          if (inputTokens === 0 && outputTokens === 0) return;
          try {
            const cost = costForModel(model, inputTokens, outputTokens);
            usageRepo.logWithBilling(
              ledgerClientIp,
              req.user!.id,
              quota.billingUserId,
              inputTokens,
              outputTokens,
              cost,
              false,
              model,
              false,
              'ledger_extract_failed',
            );
          } catch (e) {
            console.error('[ledger-scrutiny] failed-attempt cost log error', e);
          }
        };

        // Approximate pages per chunk for the credit accumulator. The
        // actual chunker packs by char budget, so chunks have variable
        // page counts; the average is close enough for partial-run
        // billing on cancel.
        const pagesPerChunk = Math.max(1, Math.ceil(ledgerPagesTotal / chunks.length));
        const chunkResultLists = await mapWithConcurrency(
          chunks,
          CHUNK_CONCURRENCY,
          async (chunk, idx) => {
            const t0 = Date.now();
            const label = `chunk ${idx + 1}/${chunks.length}`;
            try {
              // depth 0 → can recursively split up to depth 2 (4 sub-chunks).
              const results = await extractLedgerTsvWithBisect(chunk, MAX_OUTPUT_TOKENS, 0, 2, label, recordLedgerAttempt);
              const totalTx = results.reduce((s, r) => s + r.actualCount, 0);
              const totalAcct = results.reduce((s, r) => s + r.accounts.length, 0);
              const note = results.length > 1 ? ` (bisected into ${results.length})` : '';
              console.log(`[ledger-scrutiny] ${label} ✓ ${totalAcct} accounts, ${totalTx} TX in ${Date.now() - t0}ms${note}`);
              ledgerScrutinyRepo.bumpPagesProcessed(job.id, req.user!.id, pagesPerChunk);
              return results;
            } catch (e) {
              const msg = (e as Error).message ?? String(e);
              console.error(`[ledger-scrutiny] ${label} ✗ ${msg}`);
              throw new Error(`Section ${idx + 1}/${chunks.length}: ${msg}`);
            }
          },
        );
        const chunkResults = chunkResultLists.flat();

        extracted = mergeLedgerChunks(chunkResults);
        const totalTx = extracted.accounts.reduce((s, a) => s + a.transactions.length, 0);

        // Cross-check: candidate-date count vs extracted transaction count.
        // Ledger text has FAR more date-like markers than transaction rows
        // (period headers on every page, voucher type lists, opening/closing
        // balance dates, running-balance "As at" lines, page footers), so
        // the bank-statement 50% threshold false-fails on dense Tally
        // exports. Drop the floor to 25% — still catches wholesale chunk
        // loss (one chunk silently dropped = ~50%+ shortfall on a 4-chunk
        // run) without rejecting legitimate ledgers.
        if (dateCount > 0 && totalTx < dateCount * 0.25) {
          throw new Error(
            `Transaction count sanity check failed: extracted ${totalTx} TX rows but found ~${dateCount} date-like markers in the ledger text. ` +
            `Rather than persist a likely-incomplete extraction, we're bailing.`,
          );
        }

        extracted = normalizeExtraction(extracted);
        rawJson = JSON.stringify(extracted);

        // Aggregate cost across all successful chunks. Price each chunk
        // by the model that actually produced it (gemini-2.5-flash on the
        // primary path, gemini-3-flash-preview on the fallback) — using a
        // flat T2 / Flash-Lite rate here was under-counting by 3-6x
        // because the chunks never run on Flash-Lite. Failed attempts
        // are already logged separately via recordLedgerAttempt.
        try {
          const inputTok = chunkResults.reduce((s, r) => s + r.inputTokens, 0);
          const outputTok = chunkResults.reduce((s, r) => s + r.outputTokens, 0);
          const cost = chunkResults.reduce((s, r) => s + costForModel(r.modelUsed, r.inputTokens, r.outputTokens), 0);
          const modelUsed = chunkResults[0]?.modelUsed ?? 'gemini-2.5-flash';
          usageRepo.logWithBilling(
            ledgerClientIp,
            req.user.id,
            quota.billingUserId,
            inputTok,
            outputTok,
            cost,
            false,
            modelUsed,
            false,
            'ledger_extract',
          );
        } catch (err) {
          console.error('[ledger-scrutiny] cost log failed', err);
        }
      } else {
        extractPath = 'vision';
        // ── Vision path (scanned PDFs without a text layer) ─────────────
        // The legacy single-call JSON extraction. Kept as a fallback for
        // image-only PDFs where pdfjs can't recover any text. Less reliable
        // on long ledgers — the frontend should prefer the pdfText path.
        console.log(`[ledger-scrutiny] vision path: scanned PDF, no text layer`);
        ledgerScrutinyRepo.setStatus(job.id, req.user.id, 'extracting');
        const base64 = req.file!.buffer.toString('base64');
        const dataUrl = `data:${mimeType};base64,${base64}`;
        const result = await extractWithRetry<ExtractedLedger>(dataUrl, LEDGER_EXTRACT_PROMPT, {
          maxTokens: 16384,
        });
        extracted = normalizeExtraction(result.data);
        rawJson = JSON.stringify(extracted);

        try {
          const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
          const cost = costForModel(result.modelUsed, result.inputTokens, result.outputTokens);
          usageRepo.logWithBilling(
            clientIp,
            req.user.id,
            quota.billingUserId,
            result.inputTokens,
            result.outputTokens,
            cost,
            false,
            result.modelUsed,
            false,
            'ledger_extract',
          );
        } catch (err) {
          console.error('[ledger-scrutiny] cost log failed', err);
        }
      }

      ledgerScrutinyRepo.saveExtraction(job.id, req.user.id, rawJson, {
        partyName: extracted.partyName,
        gstin: extracted.gstin,
        periodFrom: extracted.periodFrom,
        periodTo: extracted.periodTo,
      });

      const accountInputs: LedgerAccountCreateInput[] = extracted.accounts.map((a, idx) => ({
        name: a.name,
        accountType: a.accountType,
        opening: a.opening,
        closing: a.closing,
        totalDebit: a.totalDebit,
        totalCredit: a.totalCredit,
        txCount: a.transactions.length,
        sortIndex: idx,
      }));
      ledgerScrutinyRepo.replaceAccounts(job.id, accountInputs);

      const accounts = ledgerScrutinyRepo.listAccounts(job.id);
      const totalTx = extracted.accounts.reduce((s, a) => s + a.transactions.length, 0);
      console.log(`[ledger-scrutiny] extract done via ${extractPath}: ${accounts.length} accounts, ${totalTx} TX${chunkCount ? `, ${chunkCount} chunk(s)` : ''}`);

      // ── Auto-chain into the audit pass ────────────────────────────────
      // Runs the chunked scrutiny inline so the user sees a single end-to-
      // end progress bar instead of "extract done, click Run scrutiny".
      // The job's `pending` state never surfaces externally — we go
      // straight from `extracting` → `scrutinizing` → `done`. The 5-second
      // poll loop on the manager picks up status transitions live, so a
      // tab close + reload during scrutiny re-attaches to the in-progress
      // run and the upload route's `findInProgressByHashForUser` guard
      // refuses any duplicate retry.
      ledgerScrutinyRepo.setStatus(job.id, req.user.id, 'scrutinizing');
      const accountIdByName = new Map<string, string>();
      for (const a of accounts) accountIdByName.set(a.name.toLowerCase(), a.id);

      const recordScrutinyAttempt: RecordAttempt = ({ failed, inputTokens, outputTokens, model }) => {
        if (!failed) return;
        if (inputTokens === 0 && outputTokens === 0) return;
        try {
          const cost = costForModel(model, inputTokens, outputTokens);
          usageRepo.logWithBilling(
            ledgerClientIp,
            req.user!.id,
            quota.billingUserId,
            inputTokens,
            outputTokens,
            cost,
            false,
            model,
            false,
            'ledger_scrutiny_failed',
          );
        } catch (e) {
          console.error('[ledger-scrutiny] scrutiny failed-attempt cost log error', e);
        }
      };

      const scrutinyResult = await runChunkedScrutiny(extracted, accountIdByName, recordScrutinyAttempt);
      ledgerScrutinyRepo.replaceObservations(job.id, scrutinyResult.observations);

      let high = 0, warn = 0, info = 0, flaggedAmount = 0;
      for (const o of scrutinyResult.observations) {
        if (o.severity === 'high') high += 1;
        else if (o.severity === 'warn') warn += 1;
        else info += 1;
        if (typeof o.amount === 'number') flaggedAmount += Math.abs(o.amount);
      }
      ledgerScrutinyRepo.updateTotals(job.id, high, warn, info, flaggedAmount);
      // If the user cancelled mid-flight, leave the row at 'cancelled'.
      // Persisting a 'done' over the top would hide their cancel intent
      // and re-enable Export PDF on a job they explicitly abandoned.
      const currentStatus = ledgerScrutinyRepo.getStatus(job.id, req.user.id);
      if (currentStatus === 'cancelled') {
        console.log(`[ledger-scrutiny] job ${job.id} was cancelled; skipping 'done' transition and quota debit`);
        res.status(200).json({
          job: serializeJob(ledgerScrutinyRepo.findByIdForUser(job.id, req.user.id)),
          accounts: ledgerScrutinyRepo.listAccounts(job.id).map(serializeAccount),
          observations: [],
          extractPath,
          chunkCount,
          cancelled: true,
        });
        return;
      }
      ledgerScrutinyRepo.setStatus(job.id, req.user.id, 'done');

      // Bill credits = ceil(pages / 10). On a clean success
      // pages_processed is roughly equal to pagesTotal — use the
      // larger of the two so an under-counted chunk approximation
      // doesn't accidentally undercharge.
      try {
        const pages = ledgerScrutinyRepo.getPagesTotals(job.id, req.user.id);
        const billedPages = Math.max(pages?.pages_processed ?? 0, ledgerPagesTotal);
        const ledgerCredits = creditsForPages('ledger_scrutiny', billedPages);
        featureUsageRepo.logWithBilling(req.user.id, quota.billingUserId, 'ledger_scrutiny', ledgerCredits);
      } catch (err) {
        console.error('[ledger-scrutiny] feature usage log failed', err);
      }
      // Cost log for the (successful) scrutiny pass.
      try {
        const cost = costForModel(scrutinyResult.modelUsed, scrutinyResult.inputTokens, scrutinyResult.outputTokens);
        usageRepo.logWithBilling(
          ledgerClientIp,
          req.user.id,
          quota.billingUserId,
          scrutinyResult.inputTokens,
          scrutinyResult.outputTokens,
          cost,
          false,
          scrutinyResult.modelUsed,
          false,
          'ledger_scrutiny',
        );
      } catch (err) {
        console.error('[ledger-scrutiny] scrutiny cost log failed', err);
      }
      console.log(`[ledger-scrutiny] scrutiny done: ${scrutinyResult.observations.length} observations (${high} high, ${warn} warn, ${info} info)`);

      const observations = ledgerScrutinyRepo.listObservations(job.id).map(serializeObservation);
      res.status(200).json({
        job: serializeJob(ledgerScrutinyRepo.findByIdForUser(job.id, req.user.id)),
        accounts: accounts.map(serializeAccount),
        observations,
        extractPath,
        chunkCount,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[ledger-scrutiny] extract error (path=${extractPath}, chunks=${chunkCount}):`, errMsg);
      ledgerScrutinyRepo.setStatus(job.id, req.user.id, 'error', errMsg.slice(0, 500));
      // Tailor the hint to the path that was attempted. Telling a user with a
      // 100-page digital PDF to "split the year" is misleading once chunking
      // is in play — chunked failures usually mean a chunk consistently
      // truncated or sanity-failed, which a smaller export won't fix.
      const hint = extractPath === 'tsv-chunked'
        ? `Failed in the chunked extractor (${chunkCount} chunk(s) attempted). If a section keeps timing out, retry — Gemini may have been throttling. If the error mentions "trailer" or "truncated", a single chunk genuinely overflowed and you'll need a smaller export.`
        : extractPath === 'vision'
          ? 'Vision extractor used (PDF has no text layer or text extraction failed in the browser). Re-save the PDF as a digital export rather than a scan, or split the year into halves.'
          : 'Re-export from Tally / Busy with smaller account groups, or split the year into halves.';
      res.status(500).json({
        error: 'Failed to extract ledger.',
        detail: errMsg.slice(0, 400),
        extractPath,
        chunkCount,
        hint,
      });
    }
  },
);

// POST /api/ledger-scrutiny/:id/scrutinize — SSE-streamed audit pass
router.post('/:id/scrutinize', async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const job = ledgerScrutinyRepo.findByIdForUser(req.params.id, req.user.id);
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  if (!job.raw_extracted) {
    res.status(400).json({ error: 'Job has no extraction. Re-upload the ledger PDF.' });
    return;
  }

  const quota = enforceQuota(req, res);
  if (!quota.ok) return;

  ledgerScrutinyRepo.setStatus(job.id, req.user.id, 'scrutinizing');

  const accounts = ledgerScrutinyRepo.listAccounts(job.id);
  const accountIdByName = new Map<string, string>();
  for (const a of accounts) accountIdByName.set(a.name.toLowerCase(), a.id);

  // Build the user message: feed the accounts + a compact transactions
  // digest so the model can spot patterns (round-tripping, cash thresholds,
  // missing TDS, recon breaks). For very long ledgers we cap each account's
  // txn list to 200 rows in the prompt — fine for rubric grading.
  const extracted = safeParseJson<ExtractedLedger>(job.raw_extracted);
  const ledgerForPrompt = {
    partyName: extracted?.partyName ?? job.party_name,
    gstin: extracted?.gstin ?? job.gstin,
    periodFrom: extracted?.periodFrom ?? job.period_from,
    periodTo: extracted?.periodTo ?? job.period_to,
    accounts: (extracted?.accounts ?? []).map((a) => ({
      name: a.name,
      accountType: a.accountType,
      opening: a.opening,
      closing: a.closing,
      totalDebit: a.totalDebit,
      totalCredit: a.totalCredit,
      transactions: (a.transactions ?? []).slice(0, 200),
    })),
  };
  const userMessage = `${LEDGER_SCRUTINY_USER_PROMPT_HEAD}${JSON.stringify(ledgerForPrompt, null, 2)}`;

  const sse = new SseWriter(res);
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
  let fullResponse = '';

  // Progress signal for the client's progress bar. We don't know the exact
  // length of the model's JSON output ahead of time, so we estimate ~250
  // chars of streamed text per account (rough but stable enough that the
  // bar advances smoothly). The client caps `completed` at `total - 1` so
  // it never visually "completes" before the `done` event arrives.
  const totalBytesEstimate = Math.max(accounts.length * 250, 4000);
  sse.writeEvent({
    phase: 'scrutinizing',
    accountsTotal: accounts.length,
    total: totalBytesEstimate,
    completed: 0,
  });
  let streamedBytes = 0;
  let lastProgressEmit = 0;

  try {
    const provider = pickChatProvider();
    const usage = await provider.streamChat(
      // 16K tokens of audit-JSON room. Year-long ledgers can produce 50+
      // observations across 30+ accounts, each carrying section citations
      // and suggested actions; the old 8K ceiling was truncating mid-array
      // on anything bigger than a quarterly export, surfacing as a generic
      // "Scrutiny response was not valid JSON" with no diagnostic.
      { systemPrompt: LEDGER_SCRUTINY_SYSTEM_PROMPT, userMessage, maxTokens: 16384 },
      (text) => {
        fullResponse += text;
        sse.writeText(text);
        streamedBytes += text.length;
        const now = Date.now();
        if (now - lastProgressEmit >= 250) {
          lastProgressEmit = now;
          sse.writeEvent({
            progress: true,
            completed: Math.min(streamedBytes, totalBytesEstimate - 1),
            total: totalBytesEstimate,
          });
        }
      },
    );

    const parsed = safeParseJson<ScrutinyResultRaw>(fullResponse);
    if (!parsed || !Array.isArray(parsed.observations)) {
      // Truncated JSON (the most common cause) is invisible from a generic
      // "not valid JSON" error. Capture the response length and tail so the
      // logs reveal whether the model hit max_tokens mid-array vs returned
      // a non-JSON refusal.
      const tail = fullResponse.slice(-200).replace(/\n/g, '\\n');
      console.warn(`[ledger-scrutiny] scrutiny JSON parse failed: ${fullResponse.length} chars, tail: ${tail}`);
      throw new Error(`Scrutiny response was not valid JSON (${fullResponse.length} chars streamed; likely truncated mid-output for a ledger with many findings).`);
    }

    const observationInputs: LedgerObservationCreateInput[] = parsed.observations.map((o) => {
      const accountId = o.accountName ? accountIdByName.get(o.accountName.toLowerCase()) ?? null : null;
      return {
        accountId,
        accountName: o.accountName ?? null,
        code: typeof o.code === 'string' ? o.code.slice(0, 64) : 'GENERIC',
        severity: normalizeSeverity(o.severity),
        message: typeof o.message === 'string' ? o.message.slice(0, 1000) : '',
        amount: o.amount === null || o.amount === undefined ? null : toNumber(o.amount),
        dateRef: typeof o.dateRef === 'string' ? o.dateRef : null,
        suggestedAction: typeof o.suggestedAction === 'string' ? o.suggestedAction.slice(0, 500) : null,
      };
    }).filter((o) => o.message);

    ledgerScrutinyRepo.replaceObservations(job.id, observationInputs);
    let high = 0, warn = 0, info = 0, flaggedAmount = 0;
    for (const o of observationInputs) {
      if (o.severity === 'high') high += 1;
      else if (o.severity === 'warn') warn += 1;
      else info += 1;
      if (typeof o.amount === 'number') flaggedAmount += Math.abs(o.amount);
    }
    ledgerScrutinyRepo.updateTotals(job.id, high, warn, info, flaggedAmount);
    // Honor a mid-flight cancel: don't overwrite 'cancelled' with 'done'.
    if (ledgerScrutinyRepo.getStatus(job.id, req.user.id) === 'cancelled') {
      sse.writeDone({ jobId: job.id, cancelled: true, summary: { high, warn, info, flaggedAmount, headline: null }, observationsCount: 0 });
      return;
    }
    ledgerScrutinyRepo.setStatus(job.id, req.user.id, 'done');

    // Bill credits proportional to the pages this scrutiny covered.
    try {
      const pages = ledgerScrutinyRepo.getPagesTotals(job.id, req.user.id);
      const billedPages = Math.max(pages?.pages_processed ?? 0, pages?.pages_total ?? 0);
      const ledgerCredits = creditsForPages('ledger_scrutiny', billedPages || PAGES_PER_CREDIT.ledger_scrutiny);
      featureUsageRepo.logWithBilling(req.user.id, quota.billingUserId, 'ledger_scrutiny', ledgerCredits);
    } catch (err) {
      console.error('[ledger-scrutiny] feature usage log failed', err);
    }

    // Log scrutiny-pass token cost.
    try {
      const totalInput = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
      usageRepo.logWithBilling(
        clientIp,
        req.user.id,
        quota.billingUserId,
        totalInput,
        usage.outputTokens,
        usage.costUsd,
        false,
        usage.modelUsed,
        usage.withSearch,
        'ledger_scrutiny',
      );
    } catch (err) {
      console.error('[ledger-scrutiny] cost log failed', err);
    }

    sse.writeDone({
      jobId: job.id,
      summary: {
        high,
        warn,
        info,
        flaggedAmount,
        headline: parsed.summary?.headline ?? null,
      },
      observationsCount: observationInputs.length,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[ledger-scrutiny] scrutinize error:', errMsg);
    ledgerScrutinyRepo.setStatus(job.id, req.user.id, 'error', errMsg.slice(0, 500));
    sse.writeError(`Scrutiny failed: ${errMsg.slice(0, 200)}`);
  } finally {
    sse.end();
  }
});

// POST /api/ledger-scrutiny/:id/cancel — user-triggered cancel for a
// running job. Counts toward the monthly quota (we already paid the
// Gemini cost for whatever chunks have run; refunding the slot would
// let users spam-and-cancel to avoid the limit).
router.post('/:id/cancel', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const job = ledgerScrutinyRepo.findByIdForUser(req.params.id, req.user.id);
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  if (job.status !== 'pending' && job.status !== 'extracting' && job.status !== 'scrutinizing') {
    res.status(400).json({ error: `Job already ${job.status}; nothing to cancel.` });
    return;
  }
  const ok = ledgerScrutinyRepo.cancelJob(job.id, req.user.id);
  if (!ok) { res.status(409).json({ error: 'Job already settled before cancel could apply.' }); return; }
  // Charge credits proportional to pages_processed (partial-page
  // billing). 0 chunks done = 0 credits; the slot is still logged
  // so the dashboard reflects the click but the user gets a free
  // retry for catching a mis-upload immediately.
  try {
    const actor = userRepo.findById(req.user.id);
    const billingUserId = actor ? getBillingUser(actor).id : req.user.id;
    const pages = ledgerScrutinyRepo.getPagesTotals(job.id, req.user.id);
    const cancelCredits = creditsForPages('ledger_scrutiny', pages?.pages_processed ?? 0);
    featureUsageRepo.logWithBilling(req.user.id, billingUserId, 'ledger_scrutiny', cancelCredits);
  } catch (err) {
    console.error('[ledger-scrutiny] cancel feature_usage log failed', err);
  }
  res.json({ job: serializeJob(ledgerScrutinyRepo.findByIdForUser(job.id, req.user.id)) });
});

// Multer error handler — scoped to this router.
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'Ledger PDF exceeds the 3 MB size limit. Split the export and re-upload.' });
      return;
    }
    res.status(400).json({ error: `Upload error: ${err.message}` });
    return;
  }
  if (err instanceof Error && err.message === 'INVALID_MIME_TYPE') {
    res.status(400).json({ error: 'Only PDF ledgers are supported.' });
    return;
  }
  next(err);
});

export default router;
