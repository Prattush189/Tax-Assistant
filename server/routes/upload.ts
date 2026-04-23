// server/routes/upload.ts
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { extractWithRetry } from '../lib/documentExtract.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST } from '../lib/gemini.js';
import { getBillingUser } from '../lib/billing.js';
import { AuthRequest } from '../types.js';

const router = Router();

// Monthly attachment upload limits per plan
const MONTHLY_ATTACHMENT_LIMITS: Record<string, number> = {
  free: 10,
  pro: 100,
  enterprise: 500,
};

const EXTRACTION_PROMPT = `Analyze this document and return ONLY a JSON object. Handle ANY document type.

Schema (all fields required, use null where not applicable):
{
  "documentType": "Form 16 | salary slip | investment proof | tax notice | financial report | invoice | article | other",
  "financialYear": "YYYY-YY or null",
  "employerName": "string or null",
  "employeeName": "string or null",
  "pan": "string or null",
  "grossSalary": number or null,
  "standardDeduction": number or null,
  "taxableSalary": number or null,
  "tdsDeducted": number or null,
  "deductions80C": number or null,
  "deductions80D": number or null,
  "otherDeductions": number or null,
  "summary": "2-3 sentence description of actual content. Max 400 chars.",
  "keyPoints": ["3-6 short bullet strings, each max 120 chars"],
  "fullText": "Most important content as plain text. Max 600 chars."
}

STRICT RULES:
- Output MUST be valid JSON, nothing else. No markdown code fences, no commentary.
- Keep "summary" under 400 chars, each keyPoint under 120 chars, "fullText" under 600 chars. Total response must fit within 2000 tokens.
- Escape quotes in string values with backslash. No literal newlines inside strings — use \\n.
- For tax forms: fill structured fields with actual numeric values.
- For other documents: tax-specific fields = null, but summary/keyPoints/fullText must describe actual content.
- NEVER return a placeholder summary like "Document uploaded". Always describe what's actually in the document.`;

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_MIME_TYPE'));
    }
  },
});

router.post(
  '/upload',
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  },
  async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file provided.' });
      return;
    }

    // Enforce monthly attachment upload cap against the BILLING (pool) user so
    // invitees share the inviter's allowance. Resilient — fail open on DB err.
    const actor = userRepo.findById(req.user.id);
    const billingUser = actor ? getBillingUser(actor) : undefined;
    const billingUserId = billingUser?.id ?? req.user.id;
    const plan = billingUser?.plan ?? actor?.plan ?? 'free';
    const monthlyLimit = MONTHLY_ATTACHMENT_LIMITS[plan] ?? 10;
    let usedThisMonth = 0;
    try {
      usedThisMonth = featureUsageRepo.countThisMonthByBillingUser(billingUserId, 'attachment_upload');
    } catch (err) {
      console.error('[upload] Failed to check attachment usage:', err);
      // Fail open — allow upload if we can't check usage
    }

    if (usedThisMonth >= monthlyLimit) {
      res.status(429).json({
        error: `You've reached your monthly attachment upload limit (${monthlyLimit}). Upgrade your plan for more, or wait until the 1st.`,
        upgrade: plan !== 'enterprise',
      });
      return;
    }

    const { originalname, mimetype, size } = req.file;
    console.log(`[upload] Received: ${originalname} (${mimetype}, ${size} bytes)`);

    let extractedData: Record<string, unknown>;

    try {
      // Gemini 2.5 Flash handles both PDFs and images natively via OpenAI-compat mode
      const base64Data = req.file.buffer.toString('base64');
      const dataUrl = `data:${mimetype};base64,${base64Data}`;

      const result = await extractWithRetry(dataUrl, EXTRACTION_PROMPT);
      extractedData = result.data;

      // Log successful upload toward monthly cap (non-fatal). Writes both
      // user_id (actor) and billing_user_id (pool owner).
      try {
        featureUsageRepo.logWithBilling(req.user.id, billingUserId, 'attachment_upload');
      } catch (logErr) {
        console.error('[upload] Failed to log attachment usage:', logErr);
      }

      // Log AI cost to usageRepo so this extraction appears in the admin
      // "recent API calls" / cost-by-model dashboards alongside chat/notice.
      try {
        const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
        const cost = result.inputTokens * GEMINI_T2_INPUT_COST + result.outputTokens * GEMINI_T2_OUTPUT_COST;
        usageRepo.logWithBilling(clientIp, req.user.id, billingUserId, result.inputTokens, result.outputTokens, cost, false, result.modelUsed, false, 'document');
      } catch (logErr) {
        console.error('[upload] Failed to log AI cost:', logErr);
      }
    } catch (err) {
      console.error('[upload] Extraction error:', err);
      extractedData = {
        documentType: 'unknown',
        summary: `The user uploaded "${originalname}" but content could not be extracted. Ask the user what the document contains if more context is needed.`,
      };
    }

    res.status(200).json({
      success: true,
      filename: originalname,
      mimeType: mimetype,
      sizeBytes: size,
      fileUri: null,
      extractedData,
      usage: { used: usedThisMonth + 1, limit: monthlyLimit },
    });
  }
);

// Multer error handler
router.use('/upload', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File exceeds the 10MB size limit.' });
      return;
    }
    res.status(400).json({ error: `Upload error: ${err.message}` });
    return;
  }
  if (err instanceof Error && err.message === 'INVALID_MIME_TYPE') {
    res.status(400).json({
      error: 'Invalid file type. Please upload a PDF or image (JPEG, PNG, WebP).',
    });
    return;
  }
  res.status(500).json({ error: 'Upload failed. Please try again.' });
});

export default router;
