// server/routes/bankStatements.ts
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import Papa from 'papaparse';
import { extractWithRetry } from '../lib/documentExtract.js';
import { BANK_STATEMENT_PROMPT, BANK_STATEMENT_CATEGORIES } from '../lib/bankStatementPrompt.js';
import { bankStatementRepo } from '../db/repositories/bankStatementRepo.js';
import { bankTransactionRepo, BankTransactionInput } from '../db/repositories/bankTransactionRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { getBillingUser } from '../lib/billing.js';
import { AuthRequest } from '../types.js';

const router = Router();

// Monthly bank statement analysis cap per plan. Separate from the generic
// attachment-upload cap because statement extraction uses more tokens.
const MONTHLY_ANALYZE_LIMITS: Record<string, number> = {
  free: 3,
  pro: 30,
  enterprise: 200,
  'enterprise-shared': 200,
};

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
      isRecurring: obj.isRecurring === true,
    };
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
  const limit = MONTHLY_ANALYZE_LIMITS[plan] ?? MONTHLY_ANALYZE_LIMITS.free;
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
  const txs = normalizeTransactions(data.transactions ?? []);
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
    isRecurring: row.is_recurring === 1,
    userOverride: row.user_override === 1,
  };
}

// ── Routes ─────────────────────────────────────────────────────────────

// GET /api/bank-statements — list
router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const rows = bankStatementRepo.findByUserId(req.user.id);
  res.json({ statements: rows.map(serializeStatement) });
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

    const isCsv = !req.file && typeof req.body?.csvText === 'string';

    if (!req.file && !isCsv) {
      res.status(400).json({ error: 'Provide a PDF/image file or csvText body.' });
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
        // Statements can be long — bump max_tokens.
        extracted = await extractWithRetry(dataUrl, BANK_STATEMENT_PROMPT, { maxTokens: 8192 });
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
        extracted = await extractWithRetry(dataUrl, csvPrompt, { maxTokens: 8192 });
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

      const transactions = bankTransactionRepo.listByStatement(statement.id).map(serializeTransaction);
      res.status(200).json({
        statement: serializeStatement(bankStatementRepo.findByIdForUser(statement.id, req.user.id)),
        transactions,
        txCount,
      });
    } catch (err) {
      console.error('[bank-statements] analyze error:', err);
      res.status(500).json({ error: 'Failed to analyze statement. Please try a clearer file or CSV.' });
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
    fields: ['Date', 'Narration', 'Type', 'Amount', 'Balance', 'Category', 'Subcategory', 'Recurring', 'UserOverride'],
    data: txs.map((t) => [
      t.tx_date ?? '',
      t.narration ?? '',
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
