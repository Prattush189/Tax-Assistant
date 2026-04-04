// server/routes/upload.ts
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { GoogleGenAI, createPartFromUri } from '@google/genai';

const router = Router();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const EXTRACTION_PROMPT = `You are analyzing an Indian tax document. Extract the following fields if present:
- Document type (Form 16, salary slip, investment proof, other)
- Employer name
- Employee name / PAN
- Financial year
- Gross salary
- Standard deduction applied
- Net taxable salary
- TDS deducted (total)
- Section 80C investments
- Section 80D premium
- Any other deductions mentioned

Respond ONLY with a JSON object. Use null for missing fields. Format:
{
  "documentType": "...",
  "financialYear": "...",
  "employerName": "...",
  "employeeName": "...",
  "pan": "...",
  "grossSalary": number | null,
  "standardDeduction": number | null,
  "taxableSalary": number | null,
  "tdsDeducted": number | null,
  "deductions80C": number | null,
  "deductions80D": number | null,
  "otherDeductions": number | null,
  "summary": "One sentence describing what this document shows"
}`;

// Allowed MIME types for tax documents: PDFs and common image formats
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
];

// Memory storage — files are passed directly to Gemini, never written to disk
// This satisfies DOC-04 (no file URI persists after the browser session ends)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_MIME_TYPE'));
    }
  },
});

// POST /api/upload
// Accepts a single file field named "file"
// Returns: { fileUri, mimeType, extractedData, ... } on success
// Returns: { error: string } on failure
router.post(
  '/upload',
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  },
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided.' });
      return;
    }

    const { originalname, mimetype, size } = req.file;
    console.log(`[upload] Received: ${originalname} (${mimetype}, ${size} bytes)`);

    // Step 1: Wrap Buffer in Blob — CRITICAL: ai.files.upload() does NOT accept raw Node.js Buffer
    let uploadedFile: { uri?: string; name?: string; mimeType?: string };
    try {
      const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
      uploadedFile = await ai.files.upload({
        file: blob,
        config: { mimeType: req.file.mimetype },
      });
    } catch (err) {
      console.error('[upload] Files API upload error:', err);
      res.status(500).json({ error: 'Failed to upload document to AI service. Please try again.' });
      return;
    }

    // Step 2: Extract structured data from the uploaded document
    let extractedData: Record<string, unknown>;
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [{
          role: 'user',
          parts: [
            createPartFromUri(uploadedFile.uri!, uploadedFile.mimeType ?? mimetype),
            { text: EXTRACTION_PROMPT },
          ],
        }],
      });
      // Strip markdown code fences — Gemini occasionally wraps JSON in ```json ... ```
      const raw = response.text
        ?.replace(/^```json\n?/m, '').replace(/\n?```$/m, '').trim() ?? '{}';
      extractedData = JSON.parse(raw);
    } catch (err) {
      console.error('[upload] Extraction error:', err);
      extractedData = { summary: 'Document uploaded but summary could not be generated.' };
    }

    // Step 3: DOC-04 — Do NOT delete the file yet. Client holds URI in session state.
    // The URI is needed for DOC-02 follow-up chat. Gemini auto-expires files after 48h.
    // URI is returned to client and held in React state only — never in localStorage.

    res.status(200).json({
      success: true,
      filename: originalname,
      mimeType: mimetype,
      sizeBytes: size,
      fileUri: uploadedFile.uri,
      extractedData,
    });
  }
);

// Multer error handler — maps multer error codes to user-friendly messages
// Per CONTEXT.md: file upload errors show inline below upload area, not as chat messages
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
      error: 'Invalid file type. Please upload a PDF or image (JPEG, PNG, WebP, HEIC).',
    });
    return;
  }
  res.status(500).json({ error: 'Upload failed. Please try again.' });
});

export default router;
