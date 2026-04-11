/**
 * Team invitations for the shared-pool enterprise plan.
 *
 *   POST   /api/invitations            auth required — inviter creates
 *   GET    /api/invitations            auth required — list own invites + members
 *   DELETE /api/invitations/:id        auth required — revoke pending OR detach accepted
 *   POST   /api/invitations/accept     public — consume token, link/create user
 *
 * The accept endpoint is mounted BEFORE authMiddleware so unauthenticated
 * new users can consume an invite link. `server/index.ts` handles that via
 * route ordering.
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { invitationRepo, hashInviteToken, generateInviteToken, InvitationStatus } from '../db/repositories/invitationRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { canInvite, countSeats, SEAT_CAP } from '../lib/billing.js';
import { mailerConfigured, sendInviteEmail } from '../lib/mailer.js';
import { generateTokens } from './auth.js';
import { AuthRequest } from '../types.js';

const router = Router();

const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

/* ------------------------------------------------------------------------ *
 * Public route — POST /api/invitations/accept
 * Mounted as a path-level handler so it bypasses the global authMiddleware
 * applied to the router below (see server/index.ts).
 * ------------------------------------------------------------------------ */
export const publicInvitationRouter = Router();

publicInvitationRouter.post('/accept', async (req: Request, res: Response) => {
  const { token, password, name } = req.body ?? {};
  if (typeof token !== 'string' || token.length === 0) {
    res.status(400).json({ error: 'token is required' });
    return;
  }
  const tokenHash = hashInviteToken(token);
  const row = invitationRepo.findByTokenHash(tokenHash);
  if (!row) {
    res.status(404).json({ error: 'Invitation not found', code: 'not_found' });
    return;
  }
  if (row.status !== 'pending') {
    res.status(410).json({ error: `Invitation is ${row.status}`, code: row.status });
    return;
  }
  const expiresMs = new Date(row.expires_at + '+05:30').getTime();
  if (expiresMs <= Date.now()) {
    res.status(410).json({ error: 'Invitation has expired', code: 'expired' });
    return;
  }

  const inviter = userRepo.findById(row.inviter_user_id);
  if (!inviter) {
    res.status(410).json({ error: 'Inviter account no longer exists', code: 'inviter_missing' });
    return;
  }

  // Seat guard: reject if the pool has filled up since the invite was sent
  if (countSeats(inviter.id).total > SEAT_CAP) {
    res.status(409).json({ error: 'Seat limit reached', cap: SEAT_CAP });
    return;
  }

  // Match an existing user by email (if the invite had one)
  let user = row.email ? userRepo.findByEmail(row.email.toLowerCase()) : undefined;

  if (user) {
    // Existing user — attach the inviter
    userRepo.setInviterId(user.id, inviter.id);
    invitationRepo.markAccepted(row.id, user.id);
    const fresh = userRepo.findById(user.id)!;
    const tokens = generateTokens(fresh);
    res.json({
      ...tokens,
      user: {
        id: fresh.id,
        email: fresh.email,
        name: fresh.name,
        role: fresh.role ?? 'user',
        plan: fresh.plan ?? 'free',
      },
    });
    return;
  }

  // New user — require password + name
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password is required (min 8 characters)' });
    return;
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }

  if (!row.email) {
    res.status(400).json({ error: 'Cannot accept a phone-only invite without an email yet' });
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const created = userRepo.create(row.email.toLowerCase(), hashedPassword, name.trim());
  // Invited users skip email OTP — the inviter vouches for them
  userRepo.markEmailVerified(created.id);
  userRepo.setInviterId(created.id, inviter.id);
  invitationRepo.markAccepted(row.id, created.id);

  const fresh = userRepo.findById(created.id)!;
  const tokens = generateTokens(fresh);
  res.status(201).json({
    ...tokens,
    user: {
      id: fresh.id,
      email: fresh.email,
      name: fresh.name,
      role: fresh.role ?? 'user',
      plan: fresh.plan ?? 'free',
    },
  });
});

/* ------------------------------------------------------------------------ *
 * Authenticated routes below — mounted under authMiddleware via server/index.ts
 * ------------------------------------------------------------------------ */

// GET /api/invitations — list own invitations + accepted members
router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const inviter = userRepo.findById(req.user.id);
  if (!inviter) { res.status(404).json({ error: 'User not found' }); return; }

  // Expire stale invitations lazily on list fetch
  invitationRepo.expireStale();

  const rows = invitationRepo.listByInviter(inviter.id).map((r) => ({
    id: r.id,
    email: r.email,
    phone: r.phone,
    status: r.status as InvitationStatus,
    expires_at: r.expires_at,
    accepted_at: r.accepted_at,
    created_at: r.created_at,
  }));

  const members = userRepo.listInvitees(inviter.id);
  const seats = countSeats(inviter.id);

  res.json({
    invitations: rows,
    members,
    seats: {
      accepted: seats.accepted,   // incl. inviter
      pending: seats.pending,
      total: seats.total,
      cap: SEAT_CAP,
    },
    canInvite: canInvite(inviter),
  });
});

// POST /api/invitations — create a new invitation
router.post('/', async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const inviter = userRepo.findById(req.user.id);
  if (!inviter) { res.status(404).json({ error: 'User not found' }); return; }

  if (!canInvite(inviter)) {
    res.status(403).json({ error: 'Only enterprise accounts can invite team members' });
    return;
  }

  const seats = countSeats(inviter.id);
  if (seats.total >= SEAT_CAP) {
    res.status(409).json({ error: 'Seat limit reached', cap: SEAT_CAP });
    return;
  }

  const { email, phone } = req.body ?? {};
  const normalizedEmail = typeof email === 'string' && email.trim().length > 0
    ? email.toLowerCase().trim()
    : null;
  const normalizedPhone = typeof phone === 'string' && phone.trim().length > 0
    ? phone.trim()
    : null;

  if (!normalizedEmail && !normalizedPhone) {
    res.status(400).json({ error: 'email or phone is required' });
    return;
  }
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }

  // If the email already belongs to a user on this pool, there's nothing to do
  if (normalizedEmail) {
    const existing = userRepo.findByEmail(normalizedEmail);
    if (existing && existing.inviter_id === inviter.id) {
      res.status(409).json({ error: 'That email is already a member of your team' });
      return;
    }
  }

  const { plaintext: plainToken, hash: tokenHash } = generateInviteToken();
  const invitation = invitationRepo.create(
    inviter.id,
    normalizedEmail,
    normalizedPhone,
    tokenHash,
    INVITE_TTL_SECONDS,
  );

  // Email delivery — best-effort for email invites; phone-only invites
  // return the token so the UI can show a copy-link affordance
  const acceptUrl = `${APP_URL}/?invite=${encodeURIComponent(plainToken)}`;
  let emailSent = false;
  if (normalizedEmail && mailerConfigured) {
    const r = await sendInviteEmail(normalizedEmail, acceptUrl, inviter.name);
    emailSent = r.ok;
  }

  res.status(201).json({
    id: invitation.id,
    email: invitation.email,
    phone: invitation.phone,
    status: invitation.status,
    expires_at: invitation.expires_at,
    created_at: invitation.created_at,
    // Only surfaced on create so phone-only invites can be shared manually
    acceptUrl,
    token: plainToken,
    emailSent,
  });
});

// DELETE /api/invitations/:id — revoke pending OR detach accepted member
router.delete('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const row = invitationRepo.findById(req.params.id);
  if (!row || row.inviter_user_id !== req.user.id) {
    res.status(404).json({ error: 'Invitation not found' });
    return;
  }

  if (row.status === 'pending') {
    invitationRepo.revoke(row.id);
    res.json({ success: true, action: 'revoked' });
    return;
  }

  if (row.status === 'accepted' && row.accepted_user_id) {
    // Detach: clear inviter_id on the accepted user. Historical usage rows
    // keep their old billing_user_id for audit. Future usage routes to self.
    userRepo.clearInviterId(row.accepted_user_id);
    res.json({ success: true, action: 'detached' });
    return;
  }

  res.status(400).json({ error: `Cannot delete invitation in status: ${row.status}` });
});

export default router;
