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
// File-size limit: 1 MB at the multer layer. Ledger PDFs are dense text —
// 1 MB comfortably holds ~150 pages of typed ledger. Larger files will be
// rejected with a clear "split the export" hint.

import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { extractWithRetry } from '../lib/documentExtract.js';
import { safeParseJson } from '../lib/geminiJson.js';
import { pickChatProvider } from '../lib/chatProvider.js';
import { SseWriter } from '../lib/sseStream.js';
import {
  LEDGER_EXTRACT_PROMPT,
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
import { GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST } from '../lib/gemini.js';
import { getBillingUser } from '../lib/billing.js';
import { getUserLimits } from '../lib/planLimits.js';
import { AuthRequest } from '../types.js';

const router = Router();

const MAX_FILE_BYTES = 1 * 1024 * 1024; // 1 MB — user-mandated cap

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
): { ok: true; billingUserId: string; plan: string; limit: number } | { ok: false } {
  const actor = userRepo.findById(req.user!.id);
  if (!actor) {
    res.status(401).json({ error: 'User not found' });
    return { ok: false };
  }
  const billingUser = getBillingUser(actor);
  const limit = getUserLimits(billingUser).ledgerScrutiny;
  let used = 0;
  try {
    used = featureUsageRepo.countThisMonthByBillingUser(billingUser.id, 'ledger_scrutiny');
  } catch (err) {
    console.error('[ledger-scrutiny] usage read failed', err);
  }
  if (used >= limit) {
    res.status(429).json({
      error: `You've reached your monthly ledger scrutiny limit (${limit}). Upgrade your plan or wait until next month.`,
      upgrade: billingUser.plan !== 'enterprise',
      used,
      limit,
    });
    return { ok: false };
  }
  return { ok: true, billingUserId: billingUser.id, plan: billingUser.plan, limit };
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

// ── Routes ──────────────────────────────────────────────────────────────

// GET /api/ledger-scrutiny — list jobs (with usage counter)
router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const rows = ledgerScrutinyRepo.listByUser(req.user.id);
  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : null;
  const limits = billingUser ? getUserLimits(billingUser) : null;
  const used = billingUser
    ? featureUsageRepo.countThisMonthByBillingUser(billingUser.id, 'ledger_scrutiny')
    : 0;
  res.json({
    jobs: rows.map(serializeJob),
    usage: { used, limit: limits?.ledgerScrutiny ?? 0 },
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

// POST /api/ledger-scrutiny/upload — multipart PDF upload + extract pass
router.post(
  '/upload',
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  },
  async (req: AuthRequest, res: Response) => {
    if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded. Attach a ledger PDF as "file".' });
      return;
    }

    // Quota gate before extraction (which is also expensive — though we
    // only debit usage on a successful scrutiny pass, we don't want a user
    // already at-cap to burn extract calls either).
    const quota = enforceQuota(req, res);
    if (!quota.ok) return;

    const filename = req.file.originalname;
    const mimeType = req.file.mimetype;
    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

    // If the user uploaded the same file before, reuse the extraction —
    // creates a fresh job row but skips re-running the vision pass.
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

    try {
      let extracted: ExtractedLedger;
      let rawJson: string;

      if (cached?.raw_extracted) {
        rawJson = cached.raw_extracted;
        const parsed = safeParseJson<ExtractedLedger>(rawJson);
        extracted = normalizeExtraction(parsed);
      } else {
        ledgerScrutinyRepo.setStatus(job.id, req.user.id, 'extracting');
        const base64 = req.file.buffer.toString('base64');
        const dataUrl = `data:${mimeType};base64,${base64}`;
        const result = await extractWithRetry<ExtractedLedger>(dataUrl, LEDGER_EXTRACT_PROMPT, {
          maxTokens: 16384,
        });
        extracted = normalizeExtraction(result.data);
        rawJson = JSON.stringify(extracted);

        // Log the vision-extract cost so it shows up in admin api-cost dashboards.
        try {
          const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
          const cost = result.inputTokens * GEMINI_T2_INPUT_COST + result.outputTokens * GEMINI_T2_OUTPUT_COST;
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
      ledgerScrutinyRepo.setStatus(job.id, req.user.id, 'pending');

      const accounts = ledgerScrutinyRepo.listAccounts(job.id);
      res.status(200).json({
        job: serializeJob(ledgerScrutinyRepo.findByIdForUser(job.id, req.user.id)),
        accounts: accounts.map(serializeAccount),
        observations: [],
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[ledger-scrutiny] extract error:', errMsg);
      ledgerScrutinyRepo.setStatus(job.id, req.user.id, 'error', errMsg.slice(0, 500));
      res.status(500).json({
        error: 'Failed to extract ledger.',
        detail: errMsg.slice(0, 400),
        hint: 'Re-export from Tally / Busy with smaller account groups, or split the year into halves.',
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

  try {
    const provider = pickChatProvider();
    const usage = await provider.streamChat(
      { systemPrompt: LEDGER_SCRUTINY_SYSTEM_PROMPT, userMessage, maxTokens: 8192 },
      (text) => {
        fullResponse += text;
        sse.writeText(text);
      },
    );

    const parsed = safeParseJson<ScrutinyResultRaw>(fullResponse);
    if (!parsed || !Array.isArray(parsed.observations)) {
      throw new Error('Scrutiny response was not valid JSON.');
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
    ledgerScrutinyRepo.setStatus(job.id, req.user.id, 'done');

    // Bill the monthly quota only on success.
    try {
      featureUsageRepo.logWithBilling(req.user.id, quota.billingUserId, 'ledger_scrutiny');
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

// Multer error handler — scoped to this router.
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'Ledger PDF exceeds the 1 MB size limit. Split the export and re-upload.' });
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
