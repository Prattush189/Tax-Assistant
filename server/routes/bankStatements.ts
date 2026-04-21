// server/routes/bankStatements.ts
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import Papa from 'papaparse';
import { extractWithRetry } from '../lib/documentExtract.js';
import { callGeminiJson } from '../lib/geminiJson.js';
import { BANK_STATEMENT_PROMPT, BANK_STATEMENT_TSV_PROMPT, BANK_STATEMENT_CATEGORIES } from '../lib/bankStatementPrompt.js';
import { gemini } from '../lib/gemini.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { bankStatementRepo } from '../db/repositories/bankStatementRepo.js';
import { bankTransactionRepo, BankTransactionInput } from '../db/repositories/bankTransactionRepo.js';
import { bankStatementRuleRepo, BankStatementRuleRow } from '../db/repositories/bankStatementRuleRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST } from '../lib/gemini.js';
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
  limits: { fileSize: 10 * 1024 * 1024 },
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

function parseTsvResponse(raw: string): Omit<TsvExtractResult, 'inputTokens' | 'outputTokens' | 'modelUsed'> {
  // Strip accidental code fences — the prompt forbids them but models slip.
  const text = raw.replace(/^```[a-z]*\n?/im, '').replace(/\n?```\s*$/m, '').trim();
  const lines = text.split(/\r?\n/);

  let bankName: string | null = null;
  let accountNumberMasked: string | null = null;
  let periodFrom: string | null = null;
  let periodTo: string | null = null;
  const rows: unknown[] = [];
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
    // Expect exactly 10 fields. Skip stray blank/short lines defensively —
    // they almost always indicate an incomplete line, which the trailer
    // check below will catch anyway.
    if (parts.length < 10) continue;
    const amount = Number(parts[2].replace(/[,\s]/g, ''));
    if (!Number.isFinite(amount)) continue;
    const balanceStr = cleanTsvCell(parts[4]);
    const balance = balanceStr === '' ? null : Number(balanceStr.replace(/[,\s]/g, ''));
    rows.push({
      date: cleanTsvCell(parts[0]),
      narration: cleanTsvCell(parts[1]),
      amount,
      type: cleanTsvCell(parts[3]).toLowerCase() === 'credit' ? 'credit' : 'debit',
      balance: Number.isFinite(balance as number) ? balance : null,
      category: cleanTsvCell(parts[5]) || 'Other',
      subcategory: cleanTsvCell(parts[6]) || null,
      counterparty: cleanTsvCell(parts[7]) || null,
      reference: cleanTsvCell(parts[8]) || null,
      isRecurring: cleanTsvCell(parts[9]) === '1',
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
  };
}

async function extractBankStatementTsvOnce(
  chunkText: string,
  model: string,
  maxTokens: number,
): Promise<TsvExtractResult> {
  const messages: ChatCompletionMessageParam[] = [{
    role: 'user',
    content: `${BANK_STATEMENT_TSV_PROMPT}\n\nINPUT_TEXT:\n${chunkText}`,
  }];
  const response = await gemini.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages,
    stream: false,
  });
  const raw = response.choices[0]?.message?.content ?? '';
  const parsed = parseTsvResponse(raw);

  // Integrity check #1: trailer MUST be present. Its absence means the
  // model's output was truncated mid-stream and we have no idea how many
  // rows were dropped.
  if (parsed.declaredCount < 0) {
    throw new Error(`TSV response was truncated: missing ---END:N--- trailer (got ${parsed.actualCount} rows before truncation)`);
  }

  // Integrity check #2: parsed rows MUST match trailer count. A mismatch
  // means some lines were malformed (wrong field count) or Gemini's trailer
  // number is wrong — either way we can't trust the extraction.
  if (parsed.declaredCount !== parsed.actualCount) {
    throw new Error(`TSV row-count mismatch: trailer claims ${parsed.declaredCount}, parsed ${parsed.actualCount}`);
  }

  return {
    ...parsed,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    modelUsed: model,
  };
}

/**
 * Retry + fallback wrapper around the TSV extraction. Retries transient
 * upstream errors (429/5xx) and TSV validation failures (truncated or
 * mismatched trailer — often a one-shot issue where the model over-shoots
 * max_tokens). After 2 attempts on flash-lite we escalate to the larger
 * flash model, which has higher throughput for long outputs.
 */
async function extractBankStatementTsv(chunkText: string, maxTokens: number): Promise<TsvExtractResult> {
  const MAX_PRIMARY_ATTEMPTS = 2;
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_PRIMARY_ATTEMPTS; attempt++) {
    try {
      return await extractBankStatementTsvOnce(chunkText, 'gemini-2.5-flash-lite', maxTokens);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status ?? 0;
      const validationFailure = /trailer|mismatch|truncated/i.test((err as Error).message ?? '');
      const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || validationFailure;
      if (!retryable) break;
      if (attempt < MAX_PRIMARY_ATTEMPTS - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  // One escalated attempt on the larger model — it has more headroom for
  // statements with unusually dense pages.
  try {
    return await extractBankStatementTsvOnce(chunkText, 'gemini-2.5-flash', maxTokens);
  } catch (err) {
    lastErr = err;
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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

function enforceQuota(req: AuthRequest, res: Response): { ok: true; billingUserId: string; plan: string } | { ok: false } {
  const actor = userRepo.findById(req.user!.id);
  const billingUser = actor ? getBillingUser(actor) : undefined;
  const billingUserId = billingUser?.id ?? req.user!.id;
  const plan = billingUser?.plan ?? actor?.plan ?? 'free';
  const limitSource = billingUser ?? actor;
  const limit = limitSource ? getUserLimits(limitSource).bankStatements : 3;
  let used = 0;
  try {
    used = featureUsageRepo.countThisMonthByBillingUser(billingUserId, 'bank_statement_analyze');
  } catch (err) {
    console.error('[bank-statements] Failed to read usage:', err);
  }
  if (used >= limit) {
    res.status(429).json({
      error: `You've reached your monthly bank statement analysis limit (${limit}). Upgrade your plan or wait until next month.`,
      upgrade: plan !== 'enterprise',
    });
    return { ok: false };
  }
  return { ok: true, billingUserId, plan };
}

/** Shared persistence path after we have a structured extraction. */
function persistStatement(
  userId: string,
  billingUserId: string,
  data: ExtractedStatement,
  meta: { filename: string | null; mimeType: string | null; fallbackName: string },
) {
  const rawTxs = normalizeTransactions(data.transactions ?? []);
  const rules = bankStatementRuleRepo.listByUser(userId);
  const txs = applyUserRules(rawTxs, rules);
  const { inflow, outflow } = computeTotals(txs);
  const periodLabel = data.periodFrom && data.periodTo
    ? `${data.periodFrom} – ${data.periodTo}`
    : new Date().toISOString().slice(0, 10);
  const name = [data.bankName, periodLabel].filter(Boolean).join(' · ') || meta.fallbackName;

  const statement = bankStatementRepo.create(userId, billingUserId, {
    name,
    bankName: data.bankName ?? null,
    accountNumberMasked: data.accountNumberMasked ?? null,
    periodFrom: data.periodFrom ?? null,
    periodTo: data.periodTo ?? null,
    sourceFilename: meta.filename,
    sourceMime: meta.mimeType,
    rawExtracted: JSON.stringify(data),
  });
  bankTransactionRepo.bulkInsert(statement.id, txs);
  bankStatementRepo.updateTotals(statement.id, inflow, outflow, txs.length);
  return { statement, txCount: txs.length };
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
  res.json({ statements: rows.map(serializeStatement) });
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

    const isPdfText = !req.file && typeof req.body?.pdfText === 'string' && req.body.pdfText.length > 0;
    const isCsv = !req.file && !isPdfText && typeof req.body?.csvText === 'string';

    if (!req.file && !isPdfText && !isCsv) {
      res.status(400).json({ error: 'Provide a PDF/image file, pdfText body, or csvText body.' });
      return;
    }

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
        const visionResult = await extractWithRetry<ExtractedStatement>(dataUrl, BANK_STATEMENT_PROMPT, { maxTokens: 8192 });
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
        //   2. max_tokens = 16384 — Gemini 2.5 Flash-Lite supports this
        //      ceiling and it comfortably holds ~700-900 TSV rows.
        //   3. A 46-page statement with ~900 tx now fits a SINGLE call.
        //      Larger statements get parallel chunks of ≤700 tx each.
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
        // ~40k input chars ≈ 12-14 typical pages ≈ 350-500 transactions.
        // With 16K output tokens each chunk has headroom even for unusually
        // dense statements (60+ tx/page). 6 chunks in parallel handles up to
        // ~80 pages which covers every realistic statement we've seen.
        const MAX_CHARS_PER_CHUNK = 40_000;
        const MAX_OUTPUT_TOKENS = 16384;
        const MAX_CHUNKS = 6;

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

        // All chunks in parallel. We DO need all of them — silently dropping
        // a section would mean missing transactions, which is unacceptable
        // for a tax/accounting feature. Promise.all rejects on first error;
        // we surface the error and bail.
        const chunkResults = await Promise.all(
          chunks.map(async (chunk, idx) => {
            const t0 = Date.now();
            try {
              const r = await extractBankStatementTsv(chunk, MAX_OUTPUT_TOKENS);
              console.log(`[bank-statements] chunk ${idx + 1}/${chunks.length} (pages ${chunkPageRanges[idx][0]}-${chunkPageRanges[idx][1]}) ✓ ${r.actualCount} tx in ${Date.now() - t0}ms`);
              return r;
            } catch (e) {
              const msg = (e as Error).message ?? String(e);
              console.error(`[bank-statements] chunk ${idx + 1}/${chunks.length} (pages ${chunkPageRanges[idx][0]}-${chunkPageRanges[idx][1]}) ✗ ${msg}`);
              throw new Error(`Section ${idx + 1}/${chunks.length} (pages ${chunkPageRanges[idx][0]}-${chunkPageRanges[idx][1]}): ${msg}`);
            }
          }),
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
        // We only fail when the delta is big enough to be meaningful — small
        // differences are normal (header dates, page footers, summary rows).
        if (dateCount > 0 && merged.length < dateCount * 0.65) {
          throw new Error(
            `Transaction count sanity check failed: extracted ${merged.length} rows but found ~${dateCount} date-like markers in the PDF text. ` +
            `Rather than persist a likely-incomplete analysis, we're bailing. Retry, or use a CSV export if available.`,
          );
        }

        (res.locals as Record<string, unknown>).geminiUsages = chunkResults.map(r => ({
          inputTokens: r.inputTokens, outputTokens: r.outputTokens, modelUsed: r.modelUsed,
        }));
      } else {
        // CSV path: parse client-provided CSV to a compact text block and ask
        // Gemini to categorize (structure already known, only categorization
        // is LLM-driven). Cheaper than the vision path.
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
        const csvSnippet = JSON.stringify(normalized).slice(0, 80000);
        const csvPrompt = `${BANK_STATEMENT_PROMPT}\n\nThe transactions array has already been extracted and is given below as JSON. Return the same schema, filling bankName/period from context if obvious (else null) and adding category / subcategory / isRecurring to each row. Preserve the given amount signs.\n\nINPUT_ROWS:\n${csvSnippet}`;
        // Send as a tiny data URL with plain text — reuse the pipeline.
        const dataUrl = `data:text/plain;base64,${Buffer.from(csvPrompt).toString('base64')}`;
        const csvResult = await extractWithRetry<ExtractedStatement>(dataUrl, csvPrompt, { maxTokens: 8192 });
        extracted = csvResult.data;
        (res.locals as Record<string, unknown>).geminiUsages = [{
          inputTokens: csvResult.inputTokens,
          outputTokens: csvResult.outputTokens,
          modelUsed: csvResult.modelUsed,
        }];
      }

      const { statement, txCount } = persistStatement(req.user.id, quota.billingUserId, extracted, {
        filename,
        mimeType,
        fallbackName: filename ?? 'Bank Statement',
      });

      try {
        featureUsageRepo.logWithBilling(req.user.id, quota.billingUserId, 'bank_statement_analyze');
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
          const cost = inputTok * GEMINI_T2_INPUT_COST + outputTok * GEMINI_T2_OUTPUT_COST;
          usageRepo.logWithBilling(clientIp, req.user.id, quota.billingUserId, inputTok, outputTok, cost, false, usages[0].modelUsed, false, 'bank_statement');
        }
      } catch (err) {
        console.error('[bank-statements] Failed to log cost:', err);
      }

      const transactions = bankTransactionRepo.listByStatement(statement.id).map(serializeTransaction);
      const warning = (res.locals as Record<string, unknown>).analyzerWarning as string | undefined;
      res.status(200).json({
        statement: serializeStatement(bankStatementRepo.findByIdForUser(statement.id, req.user.id)),
        transactions,
        txCount,
        ...(warning ? { warning } : {}),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[bank-statements] analyze error:', errMsg);
      res.status(500).json({
        error: 'Failed to analyze statement.',
        detail: errMsg.slice(0, 400),
        hint: 'If this is a large statement (40+ pages), try a CSV export instead. Scanned / image PDFs may also fail — re-save as a digital PDF and retry.',
      });
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
      res.status(400).json({ error: 'File exceeds the 10MB size limit.' });
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
