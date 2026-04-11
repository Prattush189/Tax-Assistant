import { Router, Response } from 'express';
import { itrDraftRepo, ItrFormType } from '../db/repositories/itrDraftRepo.js';
import { validateItr } from '../lib/itr/validator.js';
import { runBusinessRules } from '../lib/itr/businessRules.js';
import { buildCreationInfo } from '../lib/itr/creationInfo.js';
import { stampDigest } from '../lib/itr/digest.js';
import { STATES } from '../lib/itr/enums/states.js';
import { COUNTRIES } from '../lib/itr/enums/countries.js';
import { NATURE_OF_BUSINESS } from '../lib/itr/enums/natureOfBusiness.js';
import { TDS_SECTIONS } from '../lib/itr/enums/sections.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { getBillingUserId } from '../lib/billing.js';
import { adminMiddleware } from '../middleware/auth.js';
import { AuthRequest } from '../types.js';

const router = Router();

// All ITR routes are admin-only. authMiddleware is applied at the parent
// '/api' mount in server/index.ts; we layer adminMiddleware on top here.
router.use(adminMiddleware);

function isValidFormType(v: unknown): v is ItrFormType {
  return v === 'ITR1' || v === 'ITR4';
}

function parseUiPayload(row: { ui_payload: string }) {
  try {
    return JSON.parse(row.ui_payload);
  } catch {
    return {};
  }
}

// GET /api/itr/drafts — list user's drafts
router.get('/drafts', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const rows = itrDraftRepo.findByUserId(req.user.id);
  const drafts = rows.map((r) => ({
    id: r.id,
    form_type: r.form_type,
    assessment_year: r.assessment_year,
    name: r.name,
    ui_payload: parseUiPayload(r),
    last_validated_at: r.last_validated_at,
    exported_at: r.exported_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  res.json({ drafts });
});

// POST /api/itr/drafts — create new draft
router.post('/drafts', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const { form_type, assessment_year, name, ui_payload } = req.body ?? {};

  if (!isValidFormType(form_type)) {
    res.status(400).json({ error: 'form_type must be ITR1 or ITR4' });
    return;
  }
  if (!assessment_year || typeof assessment_year !== 'string') {
    res.status(400).json({ error: 'assessment_year is required' });
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

  const actor = userRepo.findById(req.user.id);
  const draft = itrDraftRepo.create(
    req.user.id,
    form_type,
    assessment_year,
    name.trim(),
    payloadStr,
    getBillingUserId(actor ?? { id: req.user.id, inviter_id: null }),
  );
  res.status(201).json({
    ...draft,
    ui_payload: parseUiPayload(draft),
  });
});

// GET /api/itr/drafts/:id
router.get('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = itrDraftRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) {
    res.status(404).json({ error: 'Draft not found' });
    return;
  }
  res.json({
    ...draft,
    ui_payload: parseUiPayload(draft),
  });
});

// PATCH /api/itr/drafts/:id — autosave path (name and/or ui_payload)
router.patch('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = itrDraftRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) {
    res.status(404).json({ error: 'Draft not found' });
    return;
  }

  const { name, ui_payload } = req.body ?? {};

  if (typeof name === 'string' && name.trim().length > 0) {
    itrDraftRepo.updateName(draft.id, req.user.id, name.trim());
  }
  if (ui_payload !== undefined) {
    const payloadStr =
      typeof ui_payload === 'string' ? ui_payload : JSON.stringify(ui_payload);
    itrDraftRepo.updatePayload(draft.id, req.user.id, payloadStr);
  }
  res.json({ success: true });
});

// DELETE /api/itr/drafts/:id
router.delete('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const deleted = itrDraftRepo.deleteById(req.params.id, req.user.id);
  if (!deleted) {
    res.status(404).json({ error: 'Draft not found' });
    return;
  }
  res.json({ success: true });
});

// POST /api/itr/validate — validate an ITR JSON payload against the CBDT schema
// AND the business-rule registry. Returns both sets of errors.
//
// Body: { form_type, payload, draft_id? }
// If draft_id is provided, the schema validation result is persisted.
router.post('/validate', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const { form_type, payload, draft_id } = req.body ?? {};

  if (!isValidFormType(form_type)) {
    res.status(400).json({ error: 'form_type must be ITR1 or ITR4' });
    return;
  }
  if (payload === undefined || payload === null) {
    res.status(400).json({ error: 'payload is required' });
    return;
  }

  const schemaResult = validateItr(form_type, payload);
  const businessRules = runBusinessRules(form_type, payload);
  const hasBlockingBR = businessRules.some((v) => v.severity === 'error');
  const overallValid = schemaResult.valid && !hasBlockingBR;

  if (typeof draft_id === 'string' && draft_id.length > 0) {
    const draft = itrDraftRepo.findByIdForUser(draft_id, req.user.id);
    if (draft) {
      itrDraftRepo.markValidated(
        draft.id,
        req.user.id,
        overallValid
          ? null
          : JSON.stringify({
              schemaErrors: schemaResult.errors,
              businessRuleErrors: businessRules,
            }),
      );
    }
  }

  res.json({
    valid: overallValid,
    schemaValid: schemaResult.valid,
    schemaErrors: schemaResult.errors,
    businessRules,
  });
});

// POST /api/itr/finalize — stamps CreationInfo + Digest, runs final validation,
// and returns the fully-finalized JSON ready for download. Does NOT persist.
//
// Body: { form_type, payload, intermediaryCity?, swId? }
router.post('/finalize', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const { form_type, payload, intermediaryCity, swId, draft_id } = req.body ?? {};

  if (!isValidFormType(form_type)) {
    res.status(400).json({ error: 'form_type must be ITR1 or ITR4' });
    return;
  }
  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'payload is required' });
    return;
  }

  // Deep-clone to avoid mutating the client payload
  const finalized = JSON.parse(JSON.stringify(payload));
  const root = finalized as {
    ITR?: { ITR1?: { CreationInfo?: unknown }; ITR4?: { CreationInfo?: unknown } };
  };
  const inner = form_type === 'ITR1' ? root.ITR?.ITR1 : root.ITR?.ITR4;
  if (!inner) {
    res.status(400).json({ error: `Payload must contain ITR.${form_type}` });
    return;
  }
  (inner as Record<string, unknown>).CreationInfo = buildCreationInfo({
    swId: typeof swId === 'string' && swId.length > 0 ? swId : undefined,
    intermediaryCity:
      typeof intermediaryCity === 'string' && intermediaryCity.length > 0
        ? intermediaryCity
        : undefined,
  });
  stampDigest(finalized);

  const schemaResult = validateItr(form_type, finalized);
  const businessRules = runBusinessRules(form_type, finalized);
  const valid = schemaResult.valid && !businessRules.some((v) => v.severity === 'error');

  if (valid && typeof draft_id === 'string' && draft_id.length > 0) {
    const draft = itrDraftRepo.findByIdForUser(draft_id, req.user.id);
    if (draft) {
      itrDraftRepo.markExported(draft.id, req.user.id);
    }
  }

  res.json({
    valid,
    schemaValid: schemaResult.valid,
    schemaErrors: schemaResult.errors,
    businessRules,
    payload: valid ? finalized : null,
  });
});

// GET /api/itr/enums/:name — static enums (states, countries, nature-of-
// business, tds-sections). Cached at module load, served from memory.
const ENUM_MAP: Record<string, readonly unknown[]> = {
  states: STATES,
  countries: COUNTRIES,
  'nature-of-business': NATURE_OF_BUSINESS,
  'tds-sections': TDS_SECTIONS,
};
router.get('/enums/:name', (req: AuthRequest, res: Response) => {
  const list = ENUM_MAP[req.params.name];
  if (!list) {
    res.status(404).json({ error: `Unknown enum: ${req.params.name}` });
    return;
  }
  res.json({ options: list });
});

export default router;
