import { Router, Response } from 'express';
import { profileRepo } from '../db/repositories/profileRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { AuthRequest } from '../types.js';

const router = Router();

// Plan-based profile limits
const PROFILE_LIMITS: Record<string, number> = { free: 1, pro: 10, enterprise: 50 };

// GET /api/profiles — list user's profiles
router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const profiles = profileRepo.findByUserId(req.user.id);
  const user = userRepo.findById(req.user.id);
  const limit = PROFILE_LIMITS[user?.plan ?? 'free'] ?? 1;
  res.json({ profiles, limit, used: profiles.length });
});

// GET /api/profiles/:id — get single profile
router.get('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const profile = profileRepo.findById(req.params.id);
  if (!profile || profile.user_id !== req.user.id) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }
  res.json(profile);
});

// POST /api/profiles — create new profile
router.post('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }

  const { name, description, fy, gross_salary, other_income, age_category, deductions_data, hra_data } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'Profile name is required' });
    return;
  }

  // Check plan limit
  const user = userRepo.findById(req.user.id);
  const plan = user?.plan ?? 'free';
  const limit = PROFILE_LIMITS[plan] ?? 1;
  const count = profileRepo.countByUser(req.user.id);

  if (count >= limit) {
    res.status(429).json({
      error: `You've reached your profile limit (${limit}). Upgrade your plan for more.`,
      upgrade: true,
    });
    return;
  }

  const profile = profileRepo.create(req.user.id, name.trim(), description || null, {
    fy: fy ?? '2026-27',
    gross_salary: gross_salary ?? '',
    other_income: other_income ?? '',
    age_category: age_category ?? 'below60',
    deductions_data: typeof deductions_data === 'string' ? deductions_data : JSON.stringify(deductions_data ?? {}),
    hra_data: typeof hra_data === 'string' ? hra_data : JSON.stringify(hra_data ?? {}),
  });

  res.status(201).json(profile);
});

// PATCH /api/profiles/:id — update profile
router.patch('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const profile = profileRepo.findById(req.params.id);
  if (!profile || profile.user_id !== req.user.id) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  const updates: Record<string, string> = {};
  for (const key of ['name', 'description', 'fy', 'gross_salary', 'other_income', 'age_category']) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (req.body.deductions_data !== undefined) {
    updates.deductions_data = typeof req.body.deductions_data === 'string'
      ? req.body.deductions_data
      : JSON.stringify(req.body.deductions_data);
  }
  if (req.body.hra_data !== undefined) {
    updates.hra_data = typeof req.body.hra_data === 'string'
      ? req.body.hra_data
      : JSON.stringify(req.body.hra_data);
  }

  profileRepo.update(profile.id, updates);
  res.json({ success: true });
});

// DELETE /api/profiles/:id — delete profile
router.delete('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const deleted = profileRepo.deleteById(req.params.id, req.user.id);
  if (!deleted) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }
  res.json({ success: true });
});

export default router;
