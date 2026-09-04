/**
 * "Please support my software / bank" requests.
 *
 * The ledger and bank-statement uploaders both list the formats we
 * have zero-touch rules for. When a user's package isn't on the list
 * they can file a request here with a SAMPLE EXPORT attached, which
 * is what actually lets us write the rule — a format name alone is
 * not enough to build a column mapping from.
 *
 * The sample is real financial data belonging to the user, so it is
 * write-only from their side: they can see that they filed it and its
 * status, but the bytes are only ever served back to an admin.
 */
import { Router, Response } from 'express';
import multer, { MulterError } from 'multer';
import { formatRequestRepo, type FormatRequestKind, type FormatRequestStatus } from '../db/repositories/formatRequestRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { getBillingUser } from '../lib/billing.js';
import { AuthRequest } from '../types.js';

const router = Router();

const MAX_SAMPLE_BYTES = 15 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SAMPLE_BYTES },
});

const KINDS: FormatRequestKind[] = ['ledger', 'bank'];
const STATUSES: FormatRequestStatus[] = ['new', 'in_progress', 'done', 'rejected'];

/** Per-user daily cap. Generous enough that nobody legitimately hits
 *  it, low enough that the samples table can't be used as free file
 *  storage. */
const DAILY_LIMIT = 10;

router.post('/', (req: AuthRequest, res: Response) => {
  upload.single('sample')(req as never, res as never, (err: unknown) => {
    if (err) {
      const msg = err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE'
        ? 'Sample file is too large — please keep it under 15 MB.'
        : 'Could not read the uploaded sample.';
      res.status(400).json({ error: msg });
      return;
    }
    void handleCreate(req, res);
  });
});

async function handleCreate(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }

  const kind = String(req.body?.kind ?? '') as FormatRequestKind;
  if (!KINDS.includes(kind)) {
    res.status(400).json({ error: 'Invalid request type.' });
    return;
  }
  const softwareName = String(req.body?.softwareName ?? '').trim();
  if (!softwareName) {
    res.status(400).json({
      error: kind === 'bank'
        ? 'Please tell us which bank the statement is from.'
        : 'Please tell us which accounting software the ledger came from.',
    });
    return;
  }
  if (softwareName.length > 120) {
    res.status(400).json({ error: 'Name is too long — keep it under 120 characters.' });
    return;
  }
  const notes = String(req.body?.notes ?? '').trim().slice(0, 2000) || null;

  if (formatRequestRepo.countRecentForUser(req.user.id) >= DAILY_LIMIT) {
    res.status(429).json({ error: 'You have filed several requests today. Please try again tomorrow.' });
    return;
  }

  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : undefined;

  const f = (req as unknown as { file?: Express.Multer.File }).file;
  const id = formatRequestRepo.create({
    userId: req.user.id,
    billingUserId: billingUser?.id ?? req.user.id,
    kind,
    softwareName,
    notes,
    file: f ? { name: f.originalname, mime: f.mimetype, size: f.size, buffer: f.buffer } : null,
  });

  console.log(`[formatRequests] ${kind} support requested: "${softwareName}" by ${req.user.id}${f ? ` (sample ${f.originalname}, ${f.size}B)` : ' (no sample)'}`);
  res.json({
    success: true,
    id,
    // Set expectations honestly: without a sample we usually cannot act.
    message: f
      ? 'Thanks — we have your sample and will look at adding support.'
      : 'Thanks. A sample export helps a lot — you can send one any time by filing this again with a file attached.',
  });
}

/** The user's own requests, so the UI can show "already requested". */
router.get('/mine', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  res.json({ requests: formatRequestRepo.listForUser(req.user.id) });
});

export default router;
