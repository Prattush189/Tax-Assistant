// server/routes/upload.ts
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';

const router = Router();

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
// Returns: { fileUri, mimeType, summary } on success
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

    // File is in memory as req.file.buffer
    // Full Gemini Files API integration comes in Phase 5 (DOC-01 through DOC-04).
    // This endpoint validates and accepts uploads; returns a placeholder summary.
    // The buffer is available for Phase 5 to forward to Gemini Files API.
    const { originalname, mimetype, size } = req.file;

    console.log(`[upload] Received: ${originalname} (${mimetype}, ${size} bytes)`);

    res.status(200).json({
      success: true,
      filename: originalname,
      mimeType: mimetype,
      sizeBytes: size,
      // Phase 5 will replace this with actual Gemini Files API URI and AI summary
      summary: `File "${originalname}" received and ready for analysis. (Full document AI analysis coming in Phase 5.)`,
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
