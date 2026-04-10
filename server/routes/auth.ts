import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { userRepo } from '../db/repositories/userRepo.js';
import { authMiddleware } from '../middleware/auth.js';
import { AuthRequest } from '../types.js';
import { sanitizePluginLimits, getEffectivePlan } from '../lib/planLimits.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? process.env.VITE_GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';

// Plugin SSO
const PLUGIN_SSO_SECRET = process.env.PLUGIN_SSO_SECRET ?? '';
const PLUGIN_SSO_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes

function generateTokens(user: { id: string; email: string; role?: string; plan?: string }) {
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role ?? 'user', plan: user.plan ?? 'free' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN as string | number }
  );
  const refreshToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role ?? 'user', plan: user.plan ?? 'free' },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN as string | number }
  );
  return { accessToken, refreshToken };
}

const VALID_PLUGIN_PLANS = new Set(['free', 'pro', 'enterprise', 'enterprise-shared']);
const VALID_PLUGIN_ROLES = new Set(['consultant', 'staff', 'client']);

// POST /api/auth/signup
router.post('/signup', async (req: Request, res: Response) => {
  const { email, password, name } = req.body;

  // Validate
  if (!email || !password || !name) {
    res.status(400).json({ error: 'Name, email, and password are required' });
    return;
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }

  // Check uniqueness
  const existing = userRepo.findByEmail(email);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  // Hash & create
  const hashedPassword = await bcrypt.hash(password, 12);
  const user = userRepo.create(email, hashedPassword, name.trim());
  const tokens = generateTokens(user);

  res.status(201).json({
    ...tokens,
    user: { id: user.id, email: user.email, name: user.name, role: user.role ?? 'user', plan: user.plan ?? 'free' },
  });
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const user = userRepo.findByEmail(email);
  if (!user) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const tokens = generateTokens(user);
  res.json({
    ...tokens,
    user: { id: user.id, email: user.email, name: user.name, role: user.role ?? 'user', plan: user.plan ?? 'free' },
  });
});

// POST /api/auth/refresh
router.post('/refresh', (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ error: 'Refresh token is required' });
    return;
  }

  try {
    const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as { id: string; email: string };
    const user = userRepo.findById(payload.id);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    const tokens = generateTokens(user);
    res.json(tokens);
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// POST /api/auth/google
router.post('/google', async (req: Request, res: Response) => {
  const { code } = req.body;

  if (!code) {
    res.status(400).json({ error: 'Google authorization code is required' });
    return;
  }

  if (!GOOGLE_CLIENT_ID) {
    res.status(500).json({ error: 'Google OAuth is not configured on the server' });
    return;
  }

  try {
    // Exchange auth code for Google tokens
    const tokenResponse = await googleClient.getToken({
      code,
      redirect_uri: 'postmessage',
    });

    // Verify the ID token from the token exchange
    const ticket = await googleClient.verifyIdToken({
      idToken: tokenResponse.tokens.id_token!,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      res.status(401).json({ error: 'Invalid Google token' });
      return;
    }

    const { sub: googleId, email, name: googleName } = payload;
    const displayName = googleName || email.split('@')[0];

    // 1. Check if user exists by Google ID
    let user = userRepo.findByGoogleId(googleId!);

    if (!user) {
      // 2. Check if user exists by email → auto-link
      user = userRepo.findByEmail(email);
      if (user) {
        userRepo.linkGoogle(user.id, googleId!);
        user = userRepo.findById(user.id)!;
      }
    }

    if (!user) {
      // 3. Create new user (no password)
      user = userRepo.createFromGoogle(email, displayName, googleId!);
    }

    const tokens = generateTokens(user);
    res.json({
      ...tokens,
      user: { id: user.id, email: user.email, name: user.name, role: user.role ?? 'user', plan: user.plan ?? 'free' },
    });
  } catch (err: any) {
    console.error('[auth/google] Verification failed:', err.message);
    res.status(401).json({ error: 'Google authentication failed' });
  }
});

// GET /api/auth/me (protected)
router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  const user = userRepo.findById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role ?? 'user', plan: user.plan ?? 'free' });
});

// PATCH /api/auth/name (protected) — change display name
router.patch('/name', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }
  if (name.trim().length > 80) {
    res.status(400).json({ error: 'Name must be 80 characters or fewer' });
    return;
  }

  userRepo.updateName(req.user!.id, name.trim());
  const updated = userRepo.findById(req.user!.id)!;
  res.json({
    user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role ?? 'user', plan: updated.plan ?? 'free' },
  });
});

// PATCH /api/auth/email (protected) — change email address
router.patch('/email', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { newEmail, currentPassword } = req.body;

  if (!newEmail || typeof newEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    res.status(400).json({ error: 'Valid new email is required' });
    return;
  }
  if (!currentPassword || typeof currentPassword !== 'string') {
    res.status(400).json({ error: 'Current password is required to change email' });
    return;
  }

  const user = userRepo.findById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Google-only accounts have no password — can't change email via this flow
  if (!user.password) {
    res.status(400).json({ error: 'Your account was created with Google. Email cannot be changed here.' });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    res.status(401).json({ error: 'Incorrect current password' });
    return;
  }

  const normalizedEmail = newEmail.toLowerCase().trim();
  if (normalizedEmail === user.email) {
    res.status(400).json({ error: 'New email is the same as your current email' });
    return;
  }

  const existing = userRepo.findByEmail(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  userRepo.updateEmail(user.id, normalizedEmail);
  const updated = userRepo.findById(user.id)!;
  const tokens = generateTokens(updated);
  res.json({
    ...tokens,
    user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role ?? 'user', plan: updated.plan ?? 'free' },
  });
});

// PATCH /api/auth/password (protected) — change password
router.patch('/password', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || typeof currentPassword !== 'string') {
    res.status(400).json({ error: 'Current password is required' });
    return;
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters' });
    return;
  }

  const user = userRepo.findById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Google-only accounts can set a password for the first time here
  if (user.password) {
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      res.status(401).json({ error: 'Incorrect current password' });
      return;
    }
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);
  userRepo.updatePassword(user.id, hashedPassword);

  res.json({ success: true });
});

// DELETE /api/auth/account (protected) — permanently delete the account
router.delete('/account', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { currentPassword, confirmation } = req.body;

  // Require explicit typed confirmation phrase
  if (confirmation !== 'DELETE MY ACCOUNT') {
    res.status(400).json({ error: 'Please type "DELETE MY ACCOUNT" to confirm' });
    return;
  }

  const user = userRepo.findById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Admins cannot be deleted via this endpoint (safety)
  if (user.role === 'admin') {
    res.status(403).json({ error: 'Admin accounts cannot be self-deleted' });
    return;
  }

  // Password required for accounts that have one
  if (user.password) {
    if (!currentPassword || typeof currentPassword !== 'string') {
      res.status(400).json({ error: 'Current password is required' });
      return;
    }
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      res.status(401).json({ error: 'Incorrect current password' });
      return;
    }
  }

  // CASCADE delete handles chats, messages, notices, profiles, documents, usage, etc.
  userRepo.deleteById(user.id);
  res.json({ success: true });
});

// POST /api/auth/plugin-sso
// Accepts a signed handshake from a trusted parent app and returns a full JWT.
// Required: { userId, email, name, timestamp, nonce, signature }
// Optional (for consultant/enterprise-shared plans):
//   { plan, limits, role, consultantId }
//
// Signature base string (all optional fields stringified, empty string if missing):
//   `${userId}:${email}:${name}:${timestamp}:${nonce}:${plan ?? ''}:${JSON.stringify(limits ?? '')}:${role ?? ''}:${consultantId ?? ''}`
// signature = HMAC-SHA256(baseString, PLUGIN_SSO_SECRET).hex()
router.post('/plugin-sso', (req: Request, res: Response) => {
  if (!PLUGIN_SSO_SECRET) {
    res.status(500).json({ error: 'Plugin SSO is not configured on the server' });
    return;
  }

  const {
    userId, email, name, timestamp, nonce, signature,
    plan, limits, role, consultantId,
  } = req.body ?? {};

  // Basic shape validation
  if (
    typeof userId !== 'string' || !userId ||
    typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof name !== 'string' || !name.trim() ||
    typeof timestamp !== 'number' ||
    typeof nonce !== 'string' || !nonce ||
    typeof signature !== 'string' || !signature
  ) {
    res.status(400).json({ error: 'Invalid plugin SSO payload' });
    return;
  }

  // Validate optional fields
  if (plan !== undefined && (typeof plan !== 'string' || !VALID_PLUGIN_PLANS.has(plan))) {
    res.status(400).json({ error: `plan must be one of ${Array.from(VALID_PLUGIN_PLANS).join(', ')}` });
    return;
  }
  if (role !== undefined && (typeof role !== 'string' || !VALID_PLUGIN_ROLES.has(role))) {
    res.status(400).json({ error: `role must be one of ${Array.from(VALID_PLUGIN_ROLES).join(', ')}` });
    return;
  }
  if (consultantId !== undefined && typeof consultantId !== 'string') {
    res.status(400).json({ error: 'consultantId must be a string' });
    return;
  }

  // Replay protection: timestamp must be within ±5 minutes of server time
  if (Math.abs(Date.now() - timestamp) > PLUGIN_SSO_MAX_CLOCK_SKEW_MS) {
    res.status(401).json({ error: 'SSO token expired or clock skew too large' });
    return;
  }

  // Verify HMAC signature (timing-safe)
  // Optional fields are canonicalized: missing → empty string; limits → JSON.stringify
  const baseString = [
    userId,
    email,
    name,
    String(timestamp),
    nonce,
    plan ?? '',
    limits !== undefined ? JSON.stringify(limits) : '',
    role ?? '',
    consultantId ?? '',
  ].join(':');

  const expected = crypto
    .createHmac('sha256', PLUGIN_SSO_SECRET)
    .update(baseString)
    .digest('hex');

  let signatureValid = false;
  try {
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    signatureValid = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    res.status(401).json({ error: 'Invalid SSO signature' });
    return;
  }

  // 1. Lookup by external_id
  let user = userRepo.findByExternalId(userId);

  // 2. Fall back to email → auto-link silently
  if (!user) {
    user = userRepo.findByEmail(email);
    if (user) {
      userRepo.linkExternalId(user.id, userId);
      user = userRepo.findById(user.id)!;
    }
  }

  // 3. Create new user scoped to the external id
  if (!user) {
    user = userRepo.createFromExternal(email, name.trim(), userId);
  }

  // 4. Persist plugin overrides (plan / limits / role / consultantId)
  //    Always write — passing null clears a previously-set field. This keeps
  //    the parent app in full control on every handshake.
  const sanitizedLimits = limits !== undefined ? sanitizePluginLimits(limits) : null;
  userRepo.updatePluginOverrides(
    user.id,
    typeof plan === 'string' ? plan : null,
    sanitizedLimits ? JSON.stringify(sanitizedLimits) : null,
    typeof role === 'string' ? role : null,
    typeof consultantId === 'string' ? consultantId : null,
  );

  // Re-read so generateTokens + response reflect the latest overrides
  const fresh = userRepo.findById(user.id)!;
  const effectivePlan = getEffectivePlan(fresh);
  const tokens = generateTokens({ ...fresh, plan: effectivePlan });

  res.json({
    ...tokens,
    user: {
      id: fresh.id,
      email: fresh.email,
      name: fresh.name,
      role: fresh.role ?? 'user',
      plan: effectivePlan,
      pluginRole: fresh.plugin_role ?? undefined,
      consultantId: fresh.plugin_consultant_id ?? undefined,
    },
  });
});

export default router;
