// server/routes/upload.ts
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { gemini, GEMINI_MODEL } from '../lib/grok.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { AuthRequest } from '../types.js';

const router = Router();

// Monthly attachment upload limits per plan
const MONTHLY_ATTACHMENT_LIMITS: Record<string, number> = {
  free: 10,
  pro: 100,
  enterprise: 500,
};

const EXTRACTION_PROMPT = `Analyze this document and return ONLY a JSON object. Handle ANY document type (tax forms, reports, invoices, notices, articles, etc.).

Return this exact shape:
{
  "documentType": "Form 16 | salary slip | investment proof | tax notice | financial report | invoice | article | other",
  "financialYear": "e.g. 2024-25 or null",
  "employerName": "or null",
  "employeeName": "or null",
  "pan": "or null",
  "grossSalary": null,
  "standardDeduction": null,
  "taxableSalary": null,
  "tdsDeducted": null,
  "deductions80C": null,
  "deductions80D": null,
  "otherDeductions": null,
  "summary": "2-4 sentence comprehensive summary describing what the document contains, key topics, figures, and main points. Be specific — mention actual content, not just the document type.",
  "keyPoints": ["array of 3-8 specific facts, figures, or notable points from the document"],
  "fullText": "detailed extraction of the most important text content (up to 1500 chars) — tables, figures, key sections. This is what the chat assistant will see."
}

Rules:
- For tax forms (Form 16, salary slip, etc.): fill structured fields (grossSalary, TDS, etc.) with actual values
- For other documents: set tax-specific fields to null but make summary/keyPoints/fullText rich and detailed
- NEVER leave summary as just "Document uploaded" — always describe actual content
- Return raw JSON, no markdown code fences`;

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

    // Enforce monthly attachment upload cap (resilient — won't crash on DB issues)
    const user = userRepo.findById(req.user.id);
    const plan = user?.plan ?? 'free';
    const monthlyLimit = MONTHLY_ATTACHMENT_LIMITS[plan] ?? 10;
    let usedThisMonth = 0;
    try {
      usedThisMonth = featureUsageRepo.countThisMonth(req.user.id, 'attachment_upload');
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

      const response = await gemini.chat.completions.create({
        model: GEMINI_MODEL,
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        }],
      });

      const raw = (response.choices[0]?.message?.content ?? '{}')
        .replace(/^```json\n?/m, '')
        .replace(/\n?```$/m, '')
        .trim();
      extractedData = JSON.parse(raw);

      // Log successful upload toward monthly cap (non-fatal)
      try {
        featureUsageRepo.log(req.user.id, 'attachment_upload');
      } catch (logErr) {
        console.error('[upload] Failed to log attachment usage:', logErr);
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
