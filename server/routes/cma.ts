/**
 * CMA (Credit Monitoring Arrangement) wizard routes — pure CRUD over
 * a JSON ui_payload. No AI calls, no streaming, no quota gating in
 * Phase 1 (Excel emit is computation, not Gemini spend). Phase 6
 * will add a /export endpoint that streams an xlsx download — also
 * synchronous, no token budget impact.
 *
 * Auth: every endpoint requires authMiddleware (mounted globally in
 * server/index.ts). Scoping is user-level via cmaDraftRepo's
 * findByIdForUser — the billing_user_id is set on create for usage
 * accounting but doesn't grant cross-user access to drafts.
 */
import { Router, Response, NextFunction } from 'express';
import { cmaDraftRepo, CmaDraftRow } from '../db/repositories/cmaDraftRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { getBillingUser } from '../lib/billing.js';
import { enforceTokenQuota } from '../lib/tokenQuota.js';
import { aiSuggestMappings } from '../lib/financialMapper.js';
import { costForModel } from '../lib/gemini.js';
import { callGeminiJson } from '../lib/geminiJson.js';
import { AuthRequest } from '../types.js';

const router = Router();

// Opt-in feature gate. CMA Report is disabled by default for every
// user including pro / enterprise — the AI-suggest mapping path
// burns disproportionate Gemini tokens (dozens of accounts per draft
// × heavy classification prompt). Two ways to gain access:
//   1. role === 'admin' (automatic, no flag check needed)
//   2. books_paid_enabled === 1 (flipped per-user via
//      server/scripts/grant-books.ts)
// Direct API callers without either are rejected with 403.
router.use((req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const actor = userRepo.findById(req.user.id);
  if (!actor) { res.status(401).json({ error: 'User not found' }); return; }
  if (actor.role !== 'admin' && actor.books_paid_enabled !== 1) {
    res.status(403).json({ error: 'CMA Report is not enabled for this account. Contact support to request access.' });
    return;
  }
  next();
});

function parseUiPayload(row: { ui_payload: string }): Record<string, unknown> {
  try {
    return JSON.parse(row.ui_payload);
  } catch {
    return {};
  }
}

function serialize(row: CmaDraftRow) {
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

// ── List user's drafts ───────────────────────────────────────────
router.get('/drafts', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const rows = cmaDraftRepo.findByUserId(req.user.id);
  res.json({ drafts: rows.map(serialize) });
});

// ── Create empty draft ───────────────────────────────────────────
// No AI call, no quota debit — drafts are free to create. The user
// pays in token budget only when they (eventually) export, and even
// then the cost is local computation, not Gemini.
router.post('/drafts', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const { name, ui_payload } = req.body ?? {};
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const actor = userRepo.findById(req.user.id);
  if (!actor) { res.status(401).json({ error: 'User not found' }); return; }
  const billingUser = getBillingUser(actor);
  const payloadStr =
    typeof ui_payload === 'string' ? ui_payload : JSON.stringify(ui_payload ?? {});
  const draft = cmaDraftRepo.create(req.user.id, name.trim(), payloadStr, billingUser.id);
  res.status(201).json(serialize(draft));
});

// ── Get single draft ─────────────────────────────────────────────
router.get('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = cmaDraftRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }
  res.json(serialize(draft));
});

// ── Autosave: name and/or ui_payload ─────────────────────────────
// Either field is independently optional. Frontend autosave fires
// payload updates on every form change (debounced client-side); name
// updates fire from the rename input.
router.patch('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = cmaDraftRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }
  const { name, ui_payload } = req.body ?? {};
  if (typeof name === 'string' && name.trim().length > 0) {
    cmaDraftRepo.updateName(draft.id, req.user.id, name.trim());
  }
  if (ui_payload !== undefined) {
    const payloadStr =
      typeof ui_payload === 'string' ? ui_payload : JSON.stringify(ui_payload);
    cmaDraftRepo.updatePayload(draft.id, req.user.id, payloadStr);
  }
  res.json({ success: true });
});

// ── Delete ───────────────────────────────────────────────────────
router.delete('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const deleted = cmaDraftRepo.deleteById(req.params.id, req.user.id);
  if (!deleted) { res.status(404).json({ error: 'Draft not found' }); return; }
  res.json({ success: true });
});

// ── Mark exported (called after xlsx download) ───────────────────
// Stamps exported_at so the dashboard list can show "last exported
// 3 days ago" badges and the user knows which drafts they've already
// shipped to the bank.
router.post('/drafts/:id/mark-exported', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const ok = cmaDraftRepo.markExported(req.params.id, req.user.id);
  if (!ok) { res.status(404).json({ error: 'Draft not found' }); return; }
  res.json({ success: true });
});

// ── AI-assisted mapping (opt-in, token-gated) ────────────────────
// Frontend sends the row labels + the canonical chart options. We
// call Gemini to classify in one shot. Returns the same shape the
// frontend's heuristic suggester returns, so the UI is dumb.
//
// Why the chart is in the request body, not server-side: keeping
// the canonical chart in src/components/cma/lib/canonicalAccounts.ts
// means there's exactly one source of truth. Re-shipping it across
// the wire each call costs ~2 KB on a typical CMA — well worth the
// duplication-avoidance.
router.post('/drafts/:id/ai-suggest-mapping', async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = cmaDraftRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }

  const { rows, options } = req.body ?? {};
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: 'rows array is required' }); return;
  }
  if (!Array.isArray(options) || options.length === 0) {
    res.status(400).json({ error: 'options (canonical chart) is required' }); return;
  }

  // Token-quota gate — pre-flight estimate of ~50 tokens per row +
  // ~500 fixed overhead. The actual cost is logged post-call.
  const estimate = rows.length * 50 + 500;
  const quota = enforceTokenQuota(req, res, estimate);
  if (!quota.ok) return;

  const callStartMs = Date.now();
  try {
    const result = await aiSuggestMappings(
      rows as Array<{ index: number; label: string }>,
      options as Array<{ key: string; label: string; group: string }>,
      'These are P&L and Balance Sheet line items from an Indian CMA filing.',
    );
    // Log the actual cost.
    try {
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
      const cost = costForModel(result.modelUsed, result.inputTokens, result.outputTokens);
      usageRepo.logWithBilling(
        clientIp, req.user.id, quota.billingUserId,
        result.inputTokens, result.outputTokens, cost, false,
        result.modelUsed, false, 'cma_ai_mapping', rows.length,
        'success', quota.estimatedTokens, Date.now() - callStartMs,
      );
    } catch (err) { console.error('[cma-ai-mapping] cost log failed:', err); }

    res.json({ suggestions: result.suggestions });
  } catch (err) {
    console.error('[cma-ai-mapping] failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI mapping failed' });
  } finally {
    quota.release();
  }
});

// ── AI narrative generator for the Introduction sheet ─────────
//
// Generates a brief profile + machinery / premises / ROI narrative
// for the CMA Project Report. The output replaces the template-driven
// defaults from phase2Defaults.ts when the user clicks "Generate with
// AI" on ReviewStep. All fields are returned in one Gemini call to
// keep cost predictable.
//
// Inputs from the client:
//   { firmName, businessNature, state, applicationContext,
//     projectionHorizon, latestRevenueLacs, proposedLoanLacs }
//
// Output:
//   { briefProfile, machineryDetails, premises, powerConnection,
//     rateOfInterestNotes }
//
// All fields are short (1-4 sentences each). User edits on
// ReviewStep before export. We DON'T persist directly — caller is
// expected to merge into draft.projectReport via the existing draft
// save path so server-side billing already covers the storage write.
router.post('/drafts/:id/ai-narrative', async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = cmaDraftRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }

  const body = req.body ?? {};
  const firmName = typeof body.firmName === 'string' ? body.firmName.trim() : '';
  const businessNature = typeof body.businessNature === 'string' ? body.businessNature.trim() : '';
  const state = typeof body.state === 'string' ? body.state.trim() : '';
  const applicationContext = typeof body.applicationContext === 'string' ? body.applicationContext.trim() : '';
  const latestRevenueLacs = Number.isFinite(body.latestRevenueLacs) ? Number(body.latestRevenueLacs) : null;
  const proposedLoanLacs = Number.isFinite(body.proposedLoanLacs) ? Number(body.proposedLoanLacs) : null;

  if (!firmName || !businessNature) {
    res.status(400).json({ error: 'firmName and businessNature are required to generate a narrative.' });
    return;
  }

  // Pre-flight token quota gate. Narrative is short (~600 input + 400
  // output tokens typical) so the estimate is generous.
  const estimate = 1200;
  const quota = enforceTokenQuota(req, res, estimate);
  if (!quota.ok) return;

  const callStartMs = Date.now();
  try {
    const userPrompt = `Generate a project-report narrative for an Indian CMA filing. Inputs:
- Firm Name: ${firmName}
- Nature of Business: ${businessNature}
- State / Location: ${state || 'India'}
- Credit Request: ${applicationContext || 'as separately specified'}
- Latest Annual Revenue (Rs. Lacs): ${latestRevenueLacs ?? 'not specified'}
- Proposed Loan (Rs. Lacs): ${proposedLoanLacs ?? 'not specified'}

Return STRICT JSON with these keys ONLY:
{
  "briefProfile": "3-5 short sentences about the firm, promoter, scale, market positioning. Plausible for an Indian SME. No promotional language. Avoid superlatives. Each sentence on a new line.",
  "machineryDetails": "1-2 sentences describing machinery suitable for this business nature.",
  "premises": "1-2 sentences about the premises being suitable for the operations.",
  "powerConnection": "1 sentence about power load adequacy.",
  "rateOfInterestNotes": "1 sentence about ROI assumptions in the CMA."
}

Hard rules:
- Use plain ASCII (no Unicode rupee symbol — write "Rs." instead).
- Do not invent specific names of promoters, towns, supplier vendors, machine models, or other facts not given.
- Keep it bankable in tone — terse, factual, no marketing.
- Do not include URLs, citations, or footnotes.
- Output ONLY the JSON object. No markdown, no prose around it.`;

    const result = await callGeminiJson<{
      briefProfile?: string;
      machineryDetails?: string;
      premises?: string;
      powerConnection?: string;
      rateOfInterestNotes?: string;
    }>(
      [{ role: 'user', content: userPrompt }],
      { maxTokens: 1024 },
    );

    // Log cost under a dedicated feature tag — matches the rest of
    // the codebase's per-feature billing taxonomy.
    try {
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
      const cost = costForModel(result.modelUsed, result.inputTokens, result.outputTokens);
      usageRepo.logWithBilling(
        clientIp, req.user.id, quota.billingUserId,
        result.inputTokens, result.outputTokens, cost, false,
        result.modelUsed, false, 'cma_ai_narrative', 0,
        'success', quota.estimatedTokens, Date.now() - callStartMs,
      );
    } catch (err) { console.error('[cma-ai-narrative] cost log failed:', err); }

    // Defensive shape — trim, drop unknown keys, replace Unicode
    // rupee just in case the model emitted it despite the instruction.
    const sanitize = (s: unknown): string =>
      typeof s === 'string' ? s.replace(/₹/g, 'Rs.').trim() : '';
    res.json({
      briefProfile: sanitize(result.data.briefProfile),
      machineryDetails: sanitize(result.data.machineryDetails),
      premises: sanitize(result.data.premises),
      powerConnection: sanitize(result.data.powerConnection),
      rateOfInterestNotes: sanitize(result.data.rateOfInterestNotes),
    });
  } catch (err) {
    console.error('[cma-ai-narrative] failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI narrative generation failed' });
  } finally {
    quota.release();
  }
});

export default router;
