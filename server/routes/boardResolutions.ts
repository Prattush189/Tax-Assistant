import { Router, Response } from 'express';
import {
  boardResolutionRepo,
  BoardResolutionTemplateId,
} from '../db/repositories/boardResolutionRepo.js';
import { boardResolutionAccessMiddleware } from '../middleware/auth.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { getUserLimits, getUsagePeriodStart } from '../lib/planLimits.js';
import { getBillingUser } from '../lib/billing.js';
import { AuthRequest } from '../types.js';

const router = Router();

// All authenticated users may access board resolutions.
// Plan limits (monthly cap) are enforced at the POST route below.
router.use(boardResolutionAccessMiddleware);

const TEMPLATE_IDS: readonly BoardResolutionTemplateId[] = [
  'appointment_of_director',
  'bank_account_opening',
  'borrowing_powers',
  'share_allotment',
];

function isValidTemplateId(v: unknown): v is BoardResolutionTemplateId {
  return typeof v === 'string' && TEMPLATE_IDS.includes(v as BoardResolutionTemplateId);
}

function parseUiPayload(row: { ui_payload: string }) {
  try {
    return JSON.parse(row.ui_payload);
  } catch {
    return {};
  }
}

// GET /api/board-resolutions/drafts
router.get('/drafts', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const rows = boardResolutionRepo.findByUserId(req.user.id);
  const drafts = rows.map((r) => ({
    id: r.id,
    template_id: r.template_id,
    name: r.name,
    ui_payload: parseUiPayload(r),
    exported_at: r.exported_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  res.json({ drafts });
});

// POST /api/board-resolutions/drafts
router.post('/drafts', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }

  const user = userRepo.findById(req.user.id);
  if (!user) { res.status(401).json({ error: 'User not found' }); return; }

  // Per-feature board-resolution caps were removed in favour of the
  // single cross-feature token budget (enforceTokenQuota). The user
  // can draft as many resolutions as their token budget allows.
  // billingUser is still resolved here because the analytics counter
  // log below keys on it.
  const billingUser = getBillingUser(user);

  const { template_id, name, ui_payload } = req.body ?? {};

  if (!isValidTemplateId(template_id)) {
    res.status(400).json({ error: 'template_id must be one of ' + TEMPLATE_IDS.join(', ') });
    return;
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const payloadStr =
    typeof ui_payload === 'string'
      ? ui_payload
      : JSON.stringify(ui_payload ?? {});

  const draft = boardResolutionRepo.create(
    req.user.id,
    template_id,
    name.trim(),
    payloadStr,
  );

  // Log usage for limit tracking
  featureUsageRepo.logWithBilling(req.user.id, billingUser.id, 'board_resolution');

  res.status(201).json({
    ...draft,
    ui_payload: parseUiPayload(draft),
  });
});

// GET /api/board-resolutions/drafts/:id
router.get('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = boardResolutionRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) {
    res.status(404).json({ error: 'Draft not found' });
    return;
  }
  res.json({
    ...draft,
    ui_payload: parseUiPayload(draft),
  });
});

// PATCH /api/board-resolutions/drafts/:id — autosave (name and/or ui_payload)
router.patch('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = boardResolutionRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) {
    res.status(404).json({ error: 'Draft not found' });
    return;
  }

  const { name, ui_payload } = req.body ?? {};

  if (typeof name === 'string' && name.trim().length > 0) {
    boardResolutionRepo.updateName(draft.id, req.user.id, name.trim());
  }
  if (ui_payload !== undefined) {
    const payloadStr =
      typeof ui_payload === 'string' ? ui_payload : JSON.stringify(ui_payload);
    boardResolutionRepo.updatePayload(draft.id, req.user.id, payloadStr);
  }
  res.json({ success: true });
});

// DELETE /api/board-resolutions/drafts/:id
router.delete('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const deleted = boardResolutionRepo.deleteById(req.params.id, req.user.id);
  if (!deleted) {
    res.status(404).json({ error: 'Draft not found' });
    return;
  }
  res.json({ success: true });
});

export default router;
