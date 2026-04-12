import { Router, Response } from 'express';
import { profileRepoV2, ProfileSlice } from '../db/repositories/profileRepoV2.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { getBillingUserId, getBillingUser } from '../lib/billing.js';
import { AuthRequest } from '../types.js';

const router = Router();

const PROFILE_LIMITS: Record<string, number> = { free: 1, pro: 10, enterprise: 50 };

const VALID_SLICES: ProfileSlice[] = [
  'identity_data',
  'address_data',
  'banks_data',
  'notice_defaults',
  'per_ay_data',
];

function isSlice(v: unknown): v is ProfileSlice {
  return typeof v === 'string' && (VALID_SLICES as readonly string[]).includes(v);
}

function inflateRow(row: {
  id: string;
  user_id: string;
  name: string;
  identity_data: string;
  address_data: string;
  banks_data: string;
  notice_defaults: string;
  per_ay_data: string;
  created_at: string;
  updated_at: string;
}) {
  const safeParse = <T,>(s: string, fallback: T): T => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return fallback;
    }
  };
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    identity: safeParse<Record<string, unknown>>(row.identity_data, {}),
    address: safeParse<Record<string, unknown>>(row.address_data, {}),
    banks: safeParse<unknown[]>(row.banks_data, []),
    noticeDefaults: safeParse<Record<string, unknown>>(row.notice_defaults, {}),
    perAy: safeParse<Record<string, Record<string, unknown>>>(row.per_ay_data, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// GET /api/generic-profiles — list user's profiles (inflated)
router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const rows = profileRepoV2.findByUserId(req.user.id);
  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : undefined;
  const plan = billingUser?.plan ?? actor?.plan ?? 'free';
  const limit = PROFILE_LIMITS[plan] ?? 1;
  const used = billingUser
    ? profileRepoV2.countByBillingUser(billingUser.id)
    : rows.length;
  res.json({ profiles: rows.map(inflateRow), limit, used });
});

// POST /api/generic-profiles — create (rate-limited by plan)
router.post('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const { name } = req.body ?? {};
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'Profile name is required' });
    return;
  }
  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : undefined;
  const billingUserId = billingUser?.id ?? req.user.id;
  const plan = billingUser?.plan ?? actor?.plan ?? 'free';
  const limit = PROFILE_LIMITS[plan] ?? 1;
  const count = profileRepoV2.countByBillingUser(billingUserId);
  if (count >= limit) {
    res.status(429).json({
      error: `You've reached your profile limit (${limit}). Upgrade your plan for more.`,
      upgrade: true,
    });
    return;
  }
  const row = profileRepoV2.create(req.user.id, name.trim(), billingUserId);
  res.status(201).json(inflateRow(row));
});

// GET /api/generic-profiles/:id
router.get('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const row = profileRepoV2.findByIdForUser(req.params.id, req.user.id);
  if (!row) { res.status(404).json({ error: 'Profile not found' }); return; }
  res.json(inflateRow(row));
});

// PATCH /api/generic-profiles/:id — partial update.
// Body fields: name?, identity?, address?, banks?, noticeDefaults?, perAy?
// Each present field triggers a slice update. Any JSON is stringified server-side.
router.patch('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const row = profileRepoV2.findByIdForUser(req.params.id, req.user.id);
  if (!row) { res.status(404).json({ error: 'Profile not found' }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;

  if (typeof body.name === 'string' && body.name.trim().length > 0) {
    profileRepoV2.updateName(row.id, req.user.id, body.name.trim());
  }

  const sliceMap: Array<[string, ProfileSlice]> = [
    ['identity', 'identity_data'],
    ['address', 'address_data'],
    ['banks', 'banks_data'],
    ['noticeDefaults', 'notice_defaults'],
    ['perAy', 'per_ay_data'],
  ];

  for (const [bodyKey, slice] of sliceMap) {
    if (body[bodyKey] !== undefined) {
      const value = body[bodyKey];
      const serialized =
        typeof value === 'string' ? value : JSON.stringify(value ?? (slice === 'banks_data' ? [] : {}));
      profileRepoV2.updateSlice(row.id, req.user.id, slice, serialized);
    }
  }

  const updated = profileRepoV2.findByIdForUser(row.id, req.user.id);
  res.json(updated ? inflateRow(updated) : { success: true });
});

// PATCH /api/generic-profiles/:id/slice/:slice — raw slice write (UI autosave path)
router.patch('/:id/slice/:slice', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  if (!isSlice(req.params.slice)) {
    res.status(400).json({ error: `Unknown slice: ${req.params.slice}` });
    return;
  }
  const row = profileRepoV2.findByIdForUser(req.params.id, req.user.id);
  if (!row) { res.status(404).json({ error: 'Profile not found' }); return; }
  const payload = req.body ?? (req.params.slice === 'banks_data' ? [] : {});
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  profileRepoV2.updateSlice(row.id, req.user.id, req.params.slice, serialized);
  res.json({ success: true });
});

// PATCH /api/generic-profiles/:id/per-ay/:year — merge patch into one AY slice
router.patch('/:id/per-ay/:year', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const year = req.params.year;
  if (!/^\d{4}-\d{2}$/.test(year)) {
    res.status(400).json({ error: 'AY must be in format YYYY-YY' });
    return;
  }
  const row = profileRepoV2.findByIdForUser(req.params.id, req.user.id);
  if (!row) { res.status(404).json({ error: 'Profile not found' }); return; }
  const patch = (req.body ?? {}) as Record<string, unknown>;
  profileRepoV2.updatePerAyYear(row.id, req.user.id, year, patch);
  const updated = profileRepoV2.findByIdForUser(row.id, req.user.id);
  res.json(updated ? inflateRow(updated) : { success: true });
});

// DELETE /api/generic-profiles/:id
router.delete('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const ok = profileRepoV2.deleteById(req.params.id, req.user.id);
  if (!ok) { res.status(404).json({ error: 'Profile not found' }); return; }
  res.json({ success: true });
});

export default router;
