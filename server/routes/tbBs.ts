/**
 * TB → BS wizard routes. Pure CRUD over a JSON ui_payload — no AI
 * calls, no streaming, no quota gating. Excel generation is
 * client-side and synchronous.
 *
 * Endpoints mirror cma.ts since the lifecycle is identical.
 */
import { Router, Response } from 'express';
import { tbBsDraftRepo, TbBsDraftRow } from '../db/repositories/tbBsDraftRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { getBillingUser } from '../lib/billing.js';
import { enforceTokenQuota } from '../lib/tokenQuota.js';
import { aiSuggestMappings } from '../lib/financialMapper.js';
import { costForModel } from '../lib/gemini.js';
import { AuthRequest } from '../types.js';

const router = Router();

function parseUiPayload(row: { ui_payload: string }): Record<string, unknown> {
  try { return JSON.parse(row.ui_payload); } catch { return {}; }
}

function serialize(row: TbBsDraftRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    ui_payload: parseUiPayload(row),
    exported_at: row.exported_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

router.get('/drafts', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  res.json({ drafts: tbBsDraftRepo.findByUserId(req.user.id).map(serialize) });
});

router.post('/drafts', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const { name, ui_payload } = req.body ?? {};
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' }); return;
  }
  const actor = userRepo.findById(req.user.id);
  if (!actor) { res.status(401).json({ error: 'User not found' }); return; }
  const billingUser = getBillingUser(actor);
  const payloadStr = typeof ui_payload === 'string' ? ui_payload : JSON.stringify(ui_payload ?? {});
  const draft = tbBsDraftRepo.create(req.user.id, name.trim(), payloadStr, billingUser.id);
  res.status(201).json(serialize(draft));
});

router.get('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = tbBsDraftRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }
  res.json(serialize(draft));
});

router.patch('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = tbBsDraftRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }
  const { name, ui_payload } = req.body ?? {};
  if (typeof name === 'string' && name.trim().length > 0) {
    tbBsDraftRepo.updateName(draft.id, req.user.id, name.trim());
  }
  if (ui_payload !== undefined) {
    const payloadStr = typeof ui_payload === 'string' ? ui_payload : JSON.stringify(ui_payload);
    tbBsDraftRepo.updatePayload(draft.id, req.user.id, payloadStr);
  }
  res.json({ success: true });
});

router.delete('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const deleted = tbBsDraftRepo.deleteById(req.params.id, req.user.id);
  if (!deleted) { res.status(404).json({ error: 'Draft not found' }); return; }
  res.json({ success: true });
});

router.post('/drafts/:id/mark-exported', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const ok = tbBsDraftRepo.markExported(req.params.id, req.user.id);
  if (!ok) { res.status(404).json({ error: 'Draft not found' }); return; }
  res.json({ success: true });
});

// ── AI-assisted mapping ────────────────────────────────────────
// Same shape as CMA's endpoint — frontend posts row labels + the
// Schedule III chart, we return suggested keys per row.
router.post('/drafts/:id/ai-suggest-mapping', async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = tbBsDraftRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }

  const { rows, options } = req.body ?? {};
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: 'rows array is required' }); return;
  }
  if (!Array.isArray(options) || options.length === 0) {
    res.status(400).json({ error: 'options (Schedule III chart) is required' }); return;
  }

  const estimate = rows.length * 50 + 500;
  const quota = enforceTokenQuota(req, res, estimate);
  if (!quota.ok) return;

  const callStartMs = Date.now();
  try {
    const result = await aiSuggestMappings(
      rows as Array<{ index: number; label: string }>,
      options as Array<{ key: string; label: string; group: string }>,
      'These are ledger accounts from an Indian Trial Balance being classified onto Schedule III line items (Companies Act 2013).',
    );
    try {
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
      const cost = costForModel(result.modelUsed, result.inputTokens, result.outputTokens);
      usageRepo.logWithBilling(
        clientIp, req.user.id, quota.billingUserId,
        result.inputTokens, result.outputTokens, cost, false,
        result.modelUsed, false, 'tb_bs_ai_mapping', rows.length,
        'success', quota.estimatedTokens, Date.now() - callStartMs,
      );
    } catch (err) { console.error('[tb-bs-ai-mapping] cost log failed:', err); }

    res.json({ suggestions: result.suggestions });
  } catch (err) {
    console.error('[tb-bs-ai-mapping] failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI mapping failed' });
  } finally {
    quota.release();
  }
});

export default router;
