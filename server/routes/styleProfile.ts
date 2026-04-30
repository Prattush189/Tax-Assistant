/**
 * Style profile extraction and management.
 *
 * Users upload a sample notice/letter (PDF, DOCX, or pasted text). The
 * server extracts the text and asks Gemini to produce a structured "style
 * profile" (tone, phrases, paragraph patterns). That profile is stored per
 * user and injected into the notice system prompt at generation time.
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { gemini, GEMINI_MODEL, GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST } from '../lib/gemini.js';
import { callGeminiJson } from '../lib/geminiJson.js';
import { styleProfileRepo } from '../db/repositories/styleProfileRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { getBillingUser } from '../lib/billing.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { AuthRequest } from '../types.js';

const router = Router();

// ── Gemini style-extraction prompt ────────────────────────────────────────

const STYLE_EXTRACTION_PROMPT = `Analyze the following legal/professional document and extract the author's writing style profile. This will be used to replicate their writing style when generating notice letter replies.

Return ONLY a valid JSON object (no markdown fences, no commentary) with these fields:
{
  "tone": "formal / semi-formal / informal",
  "formalityLevel": <number 1-10>,
  "languagePatterns": ["pattern 1", "pattern 2", ...],
  "typicalPhrases": ["phrase 1", "phrase 2", ...],
  "paragraphStyle": "long and detailed / concise and pointed / moderate",
  "openingStyle": "how letters typically begin",
  "closingStyle": "how letters typically end",
  "citationStyle": "how legal sections/acts are referenced",
  "overallDescription": "A 2-3 sentence summary of the writing style that captures the author's voice."
}

RULES:
- Focus on WRITING STYLE, not content. Describe HOW the author writes, not WHAT they write about.
- languagePatterns: 3-6 brief descriptions of recurring language choices.
- typicalPhrases: 3-8 exact phrases the author tends to use.
- Keep each string value concise (under 200 chars).
- Output MUST be valid JSON, nothing else.`;

// ── Gemini call with retry + fallback ─────────────────────────────────────

async function extractStyleFromText(
  text: string,
  ctx: { userId: string; billingUserId: string; clientIp: string },
): Promise<Record<string, unknown>> {
  const result = await callGeminiJson<Record<string, unknown>>(
    [{
      role: 'user' as const,
      content: `${STYLE_EXTRACTION_PROMPT}\n\n--- DOCUMENT START ---\n${text.slice(0, 15000)}\n--- DOCUMENT END ---`,
    }],
    { maxTokens: 2048 },
  );
  try {
    const cost = result.inputTokens * GEMINI_T2_INPUT_COST + result.outputTokens * GEMINI_T2_OUTPUT_COST;
    usageRepo.logWithBilling(ctx.clientIp, ctx.userId, ctx.billingUserId, result.inputTokens, result.outputTokens, cost, false, result.modelUsed, false, 'style_profile');
  } catch (err) {
    console.error('[style-profile] Failed to log cost:', err);
  }
  if (!result.data?.tone) throw new Error('LLM returned invalid style profile JSON');
  return result.data;
}

// ── Multer setup — accepts PDF and DOCX ───────────────────────────────────

const STYLE_ALLOWED_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
] as const;

const styleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if ((STYLE_ALLOWED_MIMES as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and DOCX files are accepted.'));
    }
  },
});

// ── Extract text from uploaded file ───────────────────────────────────────

async function extractTextFromFile(file: Express.Multer.File): Promise<string> {
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    if (!result.value || result.value.trim().length < 50) {
      throw new Error('DOCX file contains too little text to extract a style profile.');
    }
    return result.value;
  }

  // PDF — use Gemini vision (same pattern as upload.ts)
  const base64 = file.buffer.toString('base64');
  const dataUrl = `data:application/pdf;base64,${base64}`;
  const response = await gemini.chat.completions.create({
    model: GEMINI_MODEL,
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: 'Extract the full text content of this document. Return ONLY the raw text, no commentary or formatting.' },
      ],
    }],
  });
  const text = response.choices[0]?.message?.content ?? '';
  if (text.trim().length < 50) {
    throw new Error('PDF contains too little text to extract a style profile.');
  }
  return text;
}

// ── Routes ────────────────────────────────────────────────────────────────

// GET /api/style-profile — return the user's current style profile
router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const row = styleProfileRepo.findByUserId(req.user.id);
  if (!row) { res.json({ styleProfile: null }); return; }
  let rules: Record<string, unknown> = {};
  try { rules = JSON.parse(row.style_rules); } catch { /* empty */ }
  res.json({
    styleProfile: {
      id: row.id,
      name: row.name,
      sourceFilename: row.source_filename,
      rules,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
});

// POST /api/style-profile/extract — upload file or paste text → extract style
router.post(
  '/extract',
  (req: Request, res: Response, next: NextFunction) => {
    // Try multipart first; if no file, fall through to JSON body handling
    styleUpload.single('sample')(req, res, (err) => {
      if (err) {
        // If it's a multer mime-type error, return helpful message
        if (err.message === 'Only PDF and DOCX files are accepted.') {
          res.status(400).json({ error: err.message });
          return;
        }
        return next(err);
      }
      next();
    });
  },
  async (req: AuthRequest, res: Response) => {
    if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }

    let sampleText: string;
    let sourceFilename: string;

    if (req.file) {
      // File upload path
      sourceFilename = req.file.originalname;
      try {
        sampleText = await extractTextFromFile(req.file);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to extract text from file' });
        return;
      }
    } else if (req.body?.text && typeof req.body.text === 'string' && req.body.text.trim().length >= 50) {
      // Paste-text path
      sampleText = req.body.text.trim();
      sourceFilename = 'Pasted text';
    } else {
      res.status(400).json({ error: 'Upload a PDF/DOCX file or paste at least 50 characters of sample text.' });
      return;
    }

    try {
      const actor = userRepo.findById(req.user.id);
      const billingUser = actor ? getBillingUser(actor) : undefined;
      const billingUserId = billingUser?.id ?? req.user.id;
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
      const styleRules = await extractStyleFromText(sampleText, { userId: req.user.id, billingUserId, clientIp });
      const name = req.body?.name || sourceFilename.replace(/\.[^.]+$/, '') || 'My Style';

      const row = styleProfileRepo.upsert(
        req.user.id,
        name,
        sourceFilename,
        sampleText.slice(0, 10000),
        JSON.stringify(styleRules),
      );

      res.json({
        ok: true,
        styleProfile: {
          id: row.id,
          name: row.name,
          sourceFilename: row.source_filename,
          rules: styleRules,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    } catch (err) {
      console.error('[style-profile] Extraction failed:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Style extraction failed',
      });
    }
  },
);

// DELETE /api/style-profile — remove the user's style profile
router.delete('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  styleProfileRepo.deleteByUserId(req.user.id);
  res.json({ ok: true });
});

export default router;
