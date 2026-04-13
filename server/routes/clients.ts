/**
 * Client management for CA bulk ITR filing.
 * CAs can add clients, track filing status, create ITR drafts in bulk,
 * and manage the full filing lifecycle from one dashboard.
 */
import { Router, Response } from 'express';
import { clientRepo } from '../db/repositories/clientRepo.js';
import { profileRepoV2 } from '../db/repositories/profileRepoV2.js';
import { itrDraftRepo } from '../db/repositories/itrDraftRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { getBillingUser, getBillingUserId } from '../lib/billing.js';
import { AuthRequest } from '../types.js';

const router = Router();

const CLIENT_LIMITS: Record<string, number> = { free: 5, pro: 50, enterprise: 500 };

// GET /api/clients — list user's clients with status summary
router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const clients = clientRepo.findByUserId(req.user.id);
  const summary = clientRepo.statusSummary(req.user.id);
  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : undefined;
  const plan = billingUser?.plan ?? actor?.plan ?? 'free';
  const limit = CLIENT_LIMITS[plan] ?? 5;
  const used = billingUser
    ? clientRepo.countByBillingUser(billingUser.id)
    : clients.length;
  res.json({ clients, summary, limit, used });
});

// POST /api/clients — create a new client
router.post('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const { name, pan, email, phone, formType, assessmentYear } = req.body ?? {};
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'Client name is required' });
    return;
  }
  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : undefined;
  const billingUserId = billingUser?.id ?? req.user.id;
  const plan = billingUser?.plan ?? actor?.plan ?? 'free';
  const limit = CLIENT_LIMITS[plan] ?? 5;
  const count = clientRepo.countByBillingUser(billingUserId);
  if (count >= limit) {
    res.status(429).json({ error: `Client limit reached (${limit}). Upgrade for more.`, upgrade: true });
    return;
  }
  const client = clientRepo.create(req.user.id, billingUserId, {
    name: name.trim(),
    pan: typeof pan === 'string' ? pan.trim().toUpperCase() : undefined,
    email: typeof email === 'string' ? email.trim() : undefined,
    phone: typeof phone === 'string' ? phone.trim() : undefined,
    formType: typeof formType === 'string' ? formType : undefined,
    assessmentYear: typeof assessmentYear === 'string' ? assessmentYear : undefined,
  });
  res.status(201).json(client);
});

// PATCH /api/clients/:id — update client details or status
router.patch('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const existing = clientRepo.findByIdForUser(req.params.id, req.user.id);
  if (!existing) { res.status(404).json({ error: 'Client not found' }); return; }
  const ok = clientRepo.update(req.params.id, req.user.id, req.body ?? {});
  if (!ok) { res.status(500).json({ error: 'Update failed' }); return; }
  res.json(clientRepo.findByIdForUser(req.params.id, req.user.id));
});

// POST /api/clients/:id/create-draft — create an ITR draft for this client
router.post('/:id/create-draft', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const client = clientRepo.findByIdForUser(req.params.id, req.user.id);
  if (!client) { res.status(404).json({ error: 'Client not found' }); return; }

  // Create a profile if none linked
  let profileId = client.profile_id;
  if (!profileId) {
    const billingUserId = getBillingUserId(userRepo.findById(req.user.id) ?? { id: req.user.id, inviter_id: null });
    const profile = profileRepoV2.create(req.user.id, client.name, billingUserId);
    profileId = profile.id;
    // Store PAN in identity
    if (client.pan) {
      profileRepoV2.updateSlice(profileId, req.user.id, 'identity_data', JSON.stringify({ pan: client.pan, firstName: client.name }));
    }
    clientRepo.linkProfile(client.id, req.user.id, profileId);
  }

  // Create an ITR draft if none linked
  let draftId = client.itr_draft_id;
  if (!draftId) {
    const billingUserId = getBillingUserId(userRepo.findById(req.user.id) ?? { id: req.user.id, inviter_id: null });
    const draft = itrDraftRepo.create(
      req.user.id,
      client.form_type as 'ITR1' | 'ITR4',
      client.assessment_year,
      `${client.name} - ${client.form_type}`,
      billingUserId,
    );
    draftId = draft.id;
    clientRepo.linkDraft(client.id, req.user.id, draftId);
    clientRepo.updateStatus(client.id, req.user.id, 'draft');
  }

  res.json({ profileId, draftId, client: clientRepo.findByIdForUser(client.id, req.user.id) });
});

// POST /api/clients/bulk-create — create multiple clients from CSV data
router.post('/bulk-create', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const { clients: clientList } = req.body ?? {};
  if (!Array.isArray(clientList) || clientList.length === 0) {
    res.status(400).json({ error: 'Provide an array of clients' });
    return;
  }

  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : undefined;
  const billingUserId = billingUser?.id ?? req.user.id;
  const plan = billingUser?.plan ?? actor?.plan ?? 'free';
  const limit = CLIENT_LIMITS[plan] ?? 5;
  const existing = clientRepo.countByBillingUser(billingUserId);
  const available = Math.max(0, limit - existing);

  if (available === 0) {
    res.status(429).json({ error: `Client limit reached (${limit}).`, upgrade: true });
    return;
  }

  const toCreate = clientList.slice(0, available);
  const created: unknown[] = [];
  for (const c of toCreate) {
    if (!c.name || typeof c.name !== 'string') continue;
    const client = clientRepo.create(req.user.id, billingUserId, {
      name: c.name.trim(),
      pan: typeof c.pan === 'string' ? c.pan.trim().toUpperCase() : undefined,
      email: typeof c.email === 'string' ? c.email.trim() : undefined,
      phone: typeof c.phone === 'string' ? c.phone.trim() : undefined,
      formType: typeof c.formType === 'string' ? c.formType : undefined,
      assessmentYear: typeof c.assessmentYear === 'string' ? c.assessmentYear : undefined,
    });
    created.push(client);
  }

  res.status(201).json({
    created: created.length,
    skipped: clientList.length - toCreate.length,
    available: Math.max(0, limit - existing - created.length),
  });
});

// DELETE /api/clients/:id
router.delete('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const ok = clientRepo.deleteById(req.params.id, req.user.id);
  if (!ok) { res.status(404).json({ error: 'Client not found' }); return; }
  res.json({ ok: true });
});

export default router;
