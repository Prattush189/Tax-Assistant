// server/routes/upload.ts
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { gemini, GEMINI_MODEL, GEMINI_FALLBACK_MODEL } from '../lib/grok.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { AuthRequest } from '../types.js';

const router = Router();

/** Parse JSON safely — strips markdown fences and attempts recovery on truncated strings */
function safeParseJson(raw: string): any {
  let cleaned = raw
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();

  // First try direct parse
  try {
    return JSON.parse(cleaned);
  } catch {
    // Attempt recovery: the response was likely truncated mid-string
    // Strategy: find the last balanced closing point and close the JSON manually
  }

  // Try to recover by closing any open string/array/object
  try {
    // Count unclosed brackets
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let escape = false;
    let lastValidEnd = -1;

    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') braceDepth++;
      else if (ch === '}') { braceDepth--; if (braceDepth === 0 && bracketDepth === 0) lastValidEnd = i; }
      else if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth--;
    }

    // If we ended inside a string, close it
    if (inString) cleaned += '"';
    // Close any open arrays
    while (bracketDepth > 0) { cleaned += ']'; bracketDepth--; }
    // Close any open objects
    while (braceDepth > 0) { cleaned += '}'; braceDepth--; }

    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/** Single attempt to call Gemini with a specific model */
async function callGemini(dataUrl: string, model: string): Promise<any> {
  const response = await gemini.chat.completions.create({
    model,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: EXTRACTION_PROMPT },
      ],
    }],
  });
  const raw = response.choices[0]?.message?.content ?? '{}';
  const parsed = safeParseJson(raw);
  if (!parsed) throw new Error('Failed to parse extraction JSON');
  return parsed;
}

/**
 * Extract with retry and model fallback:
 * 1. Try primary model (gemini-2.5-flash-lite) up to 3 times
 * 2. If all retries fail, try fallback model (gemini-2.5-flash) once
 */
async function extractWithRetry(dataUrl: string): Promise<any> {
  const MAX_PRIMARY_ATTEMPTS = 3;
  let lastErr: any;

  // Phase 1: Primary model with retries
  for (let attempt = 0; attempt < MAX_PRIMARY_ATTEMPTS; attempt++) {
    try {
      return await callGemini(dataUrl, GEMINI_MODEL);
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? 0;
      const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (!retryable) break; // Non-retryable error — skip retries, try fallback model
      if (attempt < MAX_PRIMARY_ATTEMPTS - 1) {
        console.warn(`[upload] Gemini ${GEMINI_MODEL} retry ${attempt + 1}/${MAX_PRIMARY_ATTEMPTS} after status ${status}`);
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt))); // 1s, 2s, 4s
      }
    }
  }

  // Phase 2: Fallback to full flash model
  console.warn(`[upload] ${GEMINI_MODEL} failed, falling back to ${GEMINI_FALLBACK_MODEL}`);
  try {
    return await callGemini(dataUrl, GEMINI_FALLBACK_MODEL);
  } catch (err) {
    lastErr = err;
  }

  throw lastErr;
}

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

      extractedData = await extractWithRetry(dataUrl);

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
