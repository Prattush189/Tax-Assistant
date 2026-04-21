// server/routes/form16Import.ts
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { gemini, GEMINI_MODEL, GEMINI_FALLBACK_MODEL } from '../lib/gemini.js';
import { AuthRequest } from '../types.js';

const router = Router();

// ── JSON parsing (mirrors upload.ts safeParseJson) ──────────────────────

function safeParseJson(raw: string): any {
  let cleaned = raw
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Attempt recovery for truncated JSON
  }

  try {
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') braceDepth++;
      else if (ch === '}') { braceDepth--; }
      else if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth--;
    }

    if (inString) cleaned += '"';
    while (bracketDepth > 0) { cleaned += ']'; bracketDepth--; }
    while (braceDepth > 0) { cleaned += '}'; braceDepth--; }

    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

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

// ── Gemini call + retry (mirrors upload.ts extractWithRetry) ────────────

async function callGeminiForm16(dataUrl: string, model: string): Promise<any> {
  const response = await gemini.chat.completions.create({
    model,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: FORM16_EXTRACTION_PROMPT },
      ],
    }],
  });
  const raw = response.choices[0]?.message?.content ?? '{}';
  const parsed = safeParseJson(raw);
  if (!parsed) throw new Error('Failed to parse Form 16 extraction JSON');
  return parsed;
}

async function extractForm16WithRetry(dataUrl: string): Promise<any> {
  const MAX_PRIMARY_ATTEMPTS = 3;
  let lastErr: any;

  for (let attempt = 0; attempt < MAX_PRIMARY_ATTEMPTS; attempt++) {
    try {
      return await callGeminiForm16(dataUrl, GEMINI_MODEL);
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? 0;
      const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (!retryable) break;
      if (attempt < MAX_PRIMARY_ATTEMPTS - 1) {
        console.warn(`[form16] Gemini ${GEMINI_MODEL} retry ${attempt + 1}/${MAX_PRIMARY_ATTEMPTS} after status ${status}`);
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  console.warn(`[form16] ${GEMINI_MODEL} failed, falling back to ${GEMINI_FALLBACK_MODEL}`);
  try {
    return await callGeminiForm16(dataUrl, GEMINI_FALLBACK_MODEL);
  } catch (err) {
    lastErr = err;
  }

  throw lastErr;
}

// ── Multer — PDF only, 10 MB ────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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

      const extractedData = await extractForm16WithRetry(dataUrl);

      res.status(200).json({
        success: true,
        filename: originalname,
        extractedData,
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
      res.status(400).json({ error: 'File exceeds the 10 MB size limit.' });
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
