// server/routes/upload.ts
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { grok, GROK_MODEL } from '../lib/grok.js';

const router = Router();

const EXTRACTION_PROMPT = `Extract from this Indian tax document. Return ONLY a JSON object:
{"documentType":"Form 16|salary slip|investment proof|other","financialYear":"...","employerName":"...","employeeName":"...","pan":"...","grossSalary":null,"standardDeduction":null,"taxableSalary":null,"tdsDeducted":null,"deductions80C":null,"deductions80D":null,"otherDeductions":null,"summary":"one sentence"}
Use null for missing fields.`;

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
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided.' });
      return;
    }

    const { originalname, mimetype, size } = req.file;
    console.log(`[upload] Received: ${originalname} (${mimetype}, ${size} bytes)`);

    let extractedData: Record<string, unknown>;

    try {
      const base64Data = req.file.buffer.toString('base64');
      const dataUrl = `data:${mimetype};base64,${base64Data}`;

      const response = await grok.chat.completions.create({
        model: GROK_MODEL,
        max_tokens: 512,
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
    } catch (err) {
      console.error('[upload] Extraction error:', err);
      extractedData = { summary: 'Document uploaded but summary could not be generated.' };
    }

    res.status(200).json({
      success: true,
      filename: originalname,
      mimeType: mimetype,
      sizeBytes: size,
      fileUri: null,
      extractedData,
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
