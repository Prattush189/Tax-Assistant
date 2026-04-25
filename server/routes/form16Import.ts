// server/routes/form16Import.ts
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { extractWithRetry } from '../lib/documentExtract.js';
import { GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST } from '../lib/gemini.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { getBillingUser } from '../lib/billing.js';
import { AuthRequest } from '../types.js';

const router = Router();

// ── Form 16 extraction prompt ───────────────────────────────────────────

const FORM16_EXTRACTION_PROMPT = `You are extracting structured data from an Indian Form 16 (TDS certificate for salaried employees). Analyze this PDF and return ONLY a JSON object.

Schema (all fields required, use null where not applicable):
{
  "employerName": "string or null",
  "employerTAN": "string or null — 10-char TAN of employer",
  "pan": "string or null — 10-char PAN of employee",
  "employeeName": "string or null",
  "assessmentYear": "string or null — e.g. 2025-26",
  "grossSalary": number or null,
  "perquisites17_2": number or null,
  "profitsInLieu17_3": number or null,
  "standardDeduction16ia": number or null,
  "professionalTax16iii": number or null,
  "incomeFromSal": number or null,
  "netSalary": number or null,
  "section80C": number or null,
  "section80D": number or null,
  "section80CCD1B": number or null,
  "section80E": number or null,
  "section80G": number or null,
  "section80TTA": number or null,
  "tdsOnSalary": number or null
}

STRICT RULES:
- Output MUST be valid JSON, nothing else. No markdown code fences, no commentary.
- Extract numeric values as numbers (not strings). Use null if a field is not found.
- For grossSalary, look for "Gross salary (1+2+3)" or similar in Part B.
- For standardDeduction16ia, look for "Deduction u/s 16(ia)" — typically 50000 or 75000.
- For professionalTax16iii, look for "Tax on employment / Professional tax u/s 16(iii)".
- For deductions under Chapter VI-A, look for the respective sections (80C, 80D, 80CCD(1B), 80E, 80G, 80TTA).
- For tdsOnSalary, look for "Tax payable / TDS" or total tax deducted.
- assessmentYear should be in format like "2025-26".
- Escape quotes in string values with backslash. No literal newlines inside strings.`;

// ── Multer — PDF only, 500 KB ───────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('INVALID_MIME_TYPE'));
    }
  },
});

// ── POST /import ────────────────────────────────────────────────────────

router.post(
  '/import',
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
      res.status(400).json({ error: 'No file provided. Please upload a PDF.' });
      return;
    }

    const { originalname, mimetype, size } = req.file;
    console.log(`[form16] Received: ${originalname} (${mimetype}, ${size} bytes)`);

    try {
      const base64Data = req.file.buffer.toString('base64');
      const dataUrl = `data:${mimetype};base64,${base64Data}`;

      const result = await extractWithRetry(dataUrl, FORM16_EXTRACTION_PROMPT);

      // Log AI cost so Form 16 imports show up in the admin API-cost
      // dashboard alongside chat / notice / document extractions.
      try {
        const actor = userRepo.findById(req.user.id);
        const billingUser = actor ? getBillingUser(actor) : undefined;
        const billingUserId = billingUser?.id ?? req.user.id;
        const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
        const cost = result.inputTokens * GEMINI_T2_INPUT_COST + result.outputTokens * GEMINI_T2_OUTPUT_COST;
        usageRepo.logWithBilling(clientIp, req.user.id, billingUserId, result.inputTokens, result.outputTokens, cost, false, result.modelUsed, false, 'form16');
      } catch (logErr) {
        console.error('[form16] Failed to log AI cost:', logErr);
      }

      res.status(200).json({
        success: true,
        filename: originalname,
        extractedData: result.data,
      });
    } catch (err) {
      console.error('[form16] Extraction error:', err);
      res.status(500).json({
        error: 'Failed to extract data from Form 16. Please ensure you uploaded a valid Form 16 PDF.',
      });
    }
  },
);

// ── Error handler ───────────────────────────────────────────────────────

router.use('/import', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File exceeds the 500 KB size limit.' });
      return;
    }
    res.status(400).json({ error: `Upload error: ${err.message}` });
    return;
  }
  if (err instanceof Error && err.message === 'INVALID_MIME_TYPE') {
    res.status(400).json({
      error: 'Invalid file type. Please upload a PDF file.',
    });
    return;
  }
  res.status(500).json({ error: 'Upload failed. Please try again.' });
});

export default router;
