import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { userRepo, normalizePhone } from '../db/repositories/userRepo.js';
import { verificationRepo } from '../db/repositories/verificationRepo.js';
import { authMiddleware } from '../middleware/auth.js';
import { notifyAssistOfLogin } from '../lib/assistNotify.js';
import { AuthRequest } from '../types.js';
import { sanitizePluginLimits, getEffectivePlan, getTrialEndsAt } from '../lib/planLimits.js';
import { issueSignupLicense } from '../lib/issueLicense.js';
import { mailerConfigured, sendOtpEmail, sendPasswordResetEmail } from '../lib/mailer.js';

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

export function generateTokens(user: { id: string; email: string; role?: string; plan?: string; sessionToken?: string }) {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role ?? 'user',
    plan: user.plan ?? 'free',
    ...(user.sessionToken ? { sessionToken: user.sessionToken } : {}),
  };
  const accessToken = jwt.sign(
    payload,
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN as string | number }
  );
  const refreshToken = jwt.sign(
    payload,
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN as string | number }
  );
  return { accessToken, refreshToken };
}

/**
 * Rotate the session token (invalidating all other sessions) and generate
 * fresh JWTs that include the new token. Every login path should call this
 * instead of bare `generateTokens()`.
 */
function loginAndIssueTokens(user: { id: string; email: string; role?: string; plan?: string }) {
  const sessionToken = userRepo.rotateSessionToken(user.id);
  return generateTokens({ ...user, sessionToken });
}

const VALID_PLUGIN_PLANS = new Set(['free', 'pro', 'enterprise']);
const VALID_PLUGIN_ROLES = new Set(['consultant', 'staff', 'client']);

/**
 * Canonical user payload returned by every auth response. Keeping this in
 * one place makes it impossible to forget `itr_enabled` on some paths.
 */
export function toUserResponse(u: {
  id: string;
  email: string;
  name: string;
  role?: 'user' | 'admin' | null;
  plan?: string | null;
  itr_enabled?: number | null;
  created_at?: string | null;
  plan_expires_at?: string | null;
}) {
  const createdAt = u.created_at ?? new Date().toISOString();
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role ?? 'user',
    plan: u.plan ?? 'free',
    itr_enabled: u.itr_enabled === 1,
    trial_ends_at: getTrialEndsAt(createdAt),
    plan_expires_at: u.plan_expires_at ?? null,
  };
}

const OTP_TTL_SECONDS = 10 * 60;           // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;  // 60 seconds
const OTP_MAX_ATTEMPTS = 5;

function generateOtpCode(): string {
  // cryptographically random 6-digit code, zero-padded
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** An account is exempt from OTP email verification if it was created via
 *  Google OAuth, plugin SSO, or has a synthetic phone-only email. */
function isVerificationExempt(user: {
  email: string;
  google_id: string | null;
  external_id: string | null;
}): boolean {
  if (user.google_id) return true;
  if (user.external_id) return true;
  if (user.email.endsWith('@phone.local')) return true;
  return false;
}

// POST /api/auth/signup — creates a user in unverified state and emails an
// OTP. Responds with { needsEmailVerification: true } — NO JWT is issued
// until the code is verified via /api/auth/verify-email.
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

  // Email service must be configured — otherwise the user would be created
  // in a state we can't get them out of. Fail fast with 503.
  if (!mailerConfigured) {
    res.status(503).json({ error: 'Email service is not configured. Please contact support.' });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Check uniqueness
  const existing = userRepo.findByEmail(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  // Hash & create
  const hashedPassword = await bcrypt.hash(password, 12);
  const user = userRepo.create(normalizedEmail, hashedPassword, name.trim());
  issueSignupLicense(user.id, user.created_at);

  // Generate + store + send the 6-digit OTP
  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  verificationRepo.create(user.id, 'signup', codeHash, OTP_TTL_SECONDS);
  const sendResult = await sendOtpEmail(normalizedEmail, code);

  if (!sendResult.ok) {
    // Best-effort rollback so the user isn't stuck half-created
    try {
      userRepo.deleteById(user.id);
    } catch {
      // ignore
    }
    res.status(503).json({ error: 'Failed to send verification email. Please try again shortly.' });
    return;
  }

  res.status(201).json({
    needsEmailVerification: true,
    email: normalizedEmail,
  });
});

// POST /api/auth/verify-email — consumes a valid OTP and returns JWT tokens.
router.post('/verify-email', async (req: Request, res: Response) => {
  const { email, code } = req.body ?? {};
  if (typeof email !== 'string' || typeof code !== 'string') {
    res.status(400).json({ error: 'email and code are required' });
    return;
  }
  const user = userRepo.findByEmail(email.toLowerCase().trim());
  if (!user) {
    res.status(404).json({ error: 'No account found for this email' });
    return;
  }
  if (user.email_verified === 1) {
    res.status(400).json({ error: 'Email already verified' });
    return;
  }

  const row = verificationRepo.findActive(user.id, 'signup');
  if (!row) {
    res.status(410).json({ error: 'No active verification code — request a new one' });
    return;
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    // Burn the row so future attempts also fail until resend
    verificationRepo.markConsumed(row.id);
    res.status(410).json({ error: 'Too many failed attempts — request a new code' });
    return;
  }

  const valid = await bcrypt.compare(code.trim(), row.code_hash);
  if (!valid) {
    verificationRepo.incrementAttempts(row.id);
    res.status(401).json({ error: 'Incorrect verification code' });
    return;
  }

  verificationRepo.markConsumed(row.id);
  userRepo.markEmailVerified(user.id);
  const fresh = userRepo.findById(user.id)!;
  const tokens = loginAndIssueTokens(fresh);
  res.json({
    ...tokens,
    user: toUserResponse(fresh),
  });
});

// POST /api/auth/resend-verification — rate-limited to 1 per 60 seconds
// per user. Accepts `{email}` and re-sends the OTP.
router.post('/resend-verification', async (req: Request, res: Response) => {
  const { email } = req.body ?? {};
  if (typeof email !== 'string') {
    res.status(400).json({ error: 'email is required' });
    return;
  }
  if (!mailerConfigured) {
    res.status(503).json({ error: 'Email service is not configured' });
    return;
  }
  const user = userRepo.findByEmail(email.toLowerCase().trim());
  if (!user) {
    // Don't leak account existence; pretend success
    res.json({ ok: true });
    return;
  }
  if (user.email_verified === 1) {
    res.status(400).json({ error: 'Email already verified' });
    return;
  }

  const latest = verificationRepo.latestCreatedAt(user.id);
  if (latest) {
    // latest is an IST-adjusted string — compare against current IST-adjusted time
    const latestMs = new Date(latest + '+05:30').getTime();
    if (Date.now() - latestMs < OTP_RESEND_COOLDOWN_MS) {
      res.status(429).json({ error: 'Please wait before requesting another code' });
      return;
    }
  }

  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  verificationRepo.create(user.id, 'resend', codeHash, OTP_TTL_SECONDS);
  const result = await sendOtpEmail(user.email, code);
  if (!result.ok) {
    res.status(503).json({ error: 'Failed to send verification email' });
    return;
  }
  res.json({ ok: true });
});

// POST /api/auth/forgot-password — issues a 6-digit OTP for password reset.
// Always responds 200 to avoid leaking whether the email is registered.
// Silently no-ops for Google-only accounts (they have no password to reset).
router.post('/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body ?? {};
  if (typeof email !== 'string') {
    res.status(400).json({ error: 'email is required' });
    return;
  }
  if (!mailerConfigured) {
    res.status(503).json({ error: 'Email service is not configured' });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = userRepo.findByEmail(normalizedEmail);

  // Return success regardless so enumeration of account existence is not
  // possible. If the user doesn't exist, we just don't send anything.
  if (!user) {
    res.json({ ok: true });
    return;
  }

  // Google-only / plugin-only accounts don't have a password in our DB —
  // password reset doesn't apply to them. We still return 200 to avoid
  // signaling which accounts are SSO-only.
  const isPasswordAccount = Boolean(user.password) && !user.email.endsWith('@phone.local');
  if (!isPasswordAccount) {
    res.json({ ok: true });
    return;
  }

  // Rate-limit: 60 seconds between any two code-sends (signup or reset).
  const latest = verificationRepo.latestCreatedAt(user.id);
  if (latest) {
    const latestMs = new Date(latest + '+05:30').getTime();
    if (Date.now() - latestMs < OTP_RESEND_COOLDOWN_MS) {
      res.status(429).json({ error: 'Please wait before requesting another code' });
      return;
    }
  }

  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  verificationRepo.create(user.id, 'reset', codeHash, OTP_TTL_SECONDS);
  const result = await sendPasswordResetEmail(user.email, code);
  if (!result.ok) {
    res.status(503).json({ error: 'Failed to send reset email' });
    return;
  }
  res.json({ ok: true });
});

// POST /api/auth/reset-password — consumes a valid reset OTP and updates
// the password. On success, logs the user in by returning fresh JWT tokens.
router.post('/reset-password', async (req: Request, res: Response) => {
  const { email, code, newPassword } = req.body ?? {};
  if (typeof email !== 'string' || typeof code !== 'string' || typeof newPassword !== 'string') {
    res.status(400).json({ error: 'email, code and newPassword are required' });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters' });
    return;
  }

  const user = userRepo.findByEmail(email.toLowerCase().trim());
  if (!user) {
    res.status(404).json({ error: 'No account found for this email' });
    return;
  }

  const row = verificationRepo.findActive(user.id, 'reset');
  if (!row) {
    res.status(410).json({ error: 'No active reset code — request a new one' });
    return;
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    verificationRepo.markConsumed(row.id);
    res.status(410).json({ error: 'Too many failed attempts — request a new code' });
    return;
  }

  const valid = await bcrypt.compare(code.trim(), row.code_hash);
  if (!valid) {
    verificationRepo.incrementAttempts(row.id);
    res.status(401).json({ error: 'Incorrect reset code' });
    return;
  }

  // Success — burn the code, update the password, and issue fresh tokens.
  verificationRepo.markConsumed(row.id);
  const hashedPassword = await bcrypt.hash(newPassword, 12);
  userRepo.updatePassword(user.id, hashedPassword);
  // A password reset is a strong signal of ownership — flip email_verified
  // if it was off for any reason, so the user can actually log in.
  if (user.email_verified === 0) {
    userRepo.markEmailVerified(user.id);
  }

  const fresh = userRepo.findById(user.id)!;
  const tokens = loginAndIssueTokens(fresh);
  res.json({
    ...tokens,
    user: toUserResponse(fresh),
  });
});

// POST /api/auth/login — accepts either {identifier, password} (new shape;
// identifier can be an email OR a phone number) or {email, password}
// (legacy, preserved for backwards compatibility).
router.post('/login', async (req: Request, res: Response) => {
  const { identifier, email, password } = req.body ?? {};

  const rawId =
    typeof identifier === 'string' && identifier.trim().length > 0
      ? identifier.trim()
      : typeof email === 'string'
        ? email.trim()
        : '';

  if (!rawId || !password) {
    res.status(400).json({ error: 'Email/phone and password are required' });
    return;
  }

  const user = rawId.includes('@')
    ? userRepo.findByEmail(rawId.toLowerCase())
    : userRepo.findByPhone(rawId);

  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // Require email verification unless exempt (Google / plugin / phone-only)
  if (user.email_verified === 0 && !isVerificationExempt(user)) {
    res.status(403).json({
      error: 'Email not verified',
      needsEmailVerification: true,
      email: user.email,
    });
    return;
  }

  const tokens = loginAndIssueTokens(user);
  notifyAssistOfLogin({
    email: user.email,
    ipAddress: ((req.headers['x-forwarded-for'] as string) ?? req.ip ?? '').toString().split(',')[0].trim() || null,
    role: user.role,
  });
  res.json({
    ...tokens,
    user: toUserResponse(user),
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
    const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as {
      id: string; email: string; sessionToken?: string;
    };
    const user = userRepo.findById(payload.id);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    // Validate session is still active — if the user logged in elsewhere,
    // user.session_token has changed and this refresh token is stale.
    if (user.session_token && payload.sessionToken && user.session_token !== payload.sessionToken) {
      res.status(401).json({ error: 'Session expired — you logged in on another device' });
      return;
    }
    // Reissue with the SAME session token (refresh doesn't create a new session)
    const tokens = generateTokens({ ...user, sessionToken: user.session_token ?? undefined });
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
      issueSignupLicense(user.id, user.created_at);
    }

    const tokens = loginAndIssueTokens(user);
    notifyAssistOfLogin({
      email: user.email,
      ipAddress: ((req.headers['x-forwarded-for'] as string) ?? req.ip ?? '').toString().split(',')[0].trim() || null,
      role: user.role,
    });
    res.json({
      ...tokens,
      user: toUserResponse(user),
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
  res.json(toUserResponse(user));
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
    user: toUserResponse(updated),
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
  const tokens = loginAndIssueTokens(updated);
  res.json({
    ...tokens,
    user: toUserResponse(updated),
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
// Required: { userId, name, timestamp, nonce, signature } + at least one of
// { email, phone }.
// Optional (for consultant-pool plugin overrides):
//   { plan, limits, role, consultantId, inviterUserId, phone }
//
// Signature base string (11 fields — all optional stringified as empty when
// missing, limits → JSON.stringify):
//   userId:email:name:timestamp:nonce:plan:limits:role:consultantId:inviterUserId:phone
//
// Backward compat: if the 11-field HMAC fails AND the request body has
// neither inviterUserId nor phone, we retry with the legacy 9-field base
// string (pre-v2 parent apps). This closes the downgrade attack: a legacy
// sig can only authorize a legacy payload.
router.post('/plugin-sso', (req: Request, res: Response) => {
  if (!PLUGIN_SSO_SECRET) {
    res.status(500).json({ error: 'Plugin SSO is not configured on the server' });
    return;
  }

  const {
    userId, email, name, timestamp, nonce, signature,
    plan, limits, role, consultantId,
    inviterUserId, phone,
  } = req.body ?? {};

  // Basic shape validation — must have userId + name + timestamp + nonce + sig
  // plus at least one of email or phone
  const hasEmail = typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const hasPhone = typeof phone === 'string' && phone.trim().length > 0;
  if (
    typeof userId !== 'string' || !userId ||
    typeof name !== 'string' || !name.trim() ||
    typeof timestamp !== 'number' ||
    typeof nonce !== 'string' || !nonce ||
    typeof signature !== 'string' || !signature ||
    (!hasEmail && !hasPhone)
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
  if (inviterUserId !== undefined && typeof inviterUserId !== 'string') {
    res.status(400).json({ error: 'inviterUserId must be a string' });
    return;
  }

  // Replay protection: timestamp must be within ±5 minutes of server time
  if (Math.abs(Date.now() - timestamp) > PLUGIN_SSO_MAX_CLOCK_SKEW_MS) {
    res.status(401).json({ error: 'SSO token expired or clock skew too large' });
    return;
  }

  // Verify HMAC signature — try the new 11-field base string first; fall
  // back to legacy 9-field only when the new fields (phone, inviterUserId)
  // are absent.
  const emailForBase = hasEmail ? (email as string) : '';
  const limitsForBase = limits !== undefined ? JSON.stringify(limits) : '';
  const baseString11 = [
    userId,
    emailForBase,
    name,
    String(timestamp),
    nonce,
    plan ?? '',
    limitsForBase,
    role ?? '',
    consultantId ?? '',
    inviterUserId ?? '',
    hasPhone ? (phone as string) : '',
  ].join(':');

  function hmac(base: string): string {
    return crypto.createHmac('sha256', PLUGIN_SSO_SECRET).update(base).digest('hex');
  }

  function timingEqual(a: string, b: string): boolean {
    try {
      const ba = Buffer.from(a, 'hex');
      const bb = Buffer.from(b, 'hex');
      return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
    } catch {
      return false;
    }
  }

  let signatureValid = timingEqual(signature, hmac(baseString11));

  if (!signatureValid && !hasPhone && !inviterUserId) {
    // Legacy 9-field parent app — only allowed when the new fields are absent
    const baseString9 = [
      userId,
      emailForBase,
      name,
      String(timestamp),
      nonce,
      plan ?? '',
      limitsForBase,
      role ?? '',
      consultantId ?? '',
    ].join(':');
    signatureValid = timingEqual(signature, hmac(baseString9));
  }

  if (!signatureValid) {
    res.status(401).json({ error: 'Invalid SSO signature' });
    return;
  }

  // 1. Lookup by external_id
  let user = userRepo.findByExternalId(userId);

  // 2. Fall back to email → auto-link silently
  if (!user && hasEmail) {
    user = userRepo.findByEmail((email as string).toLowerCase());
    if (user) {
      userRepo.linkExternalId(user.id, userId);
      user = userRepo.findById(user.id)!;
    }
  }

  // 2b. Fall back to phone lookup when email is absent
  if (!user && hasPhone) {
    user = userRepo.findByPhone(phone as string);
    if (user) {
      userRepo.linkExternalId(user.id, userId);
      user = userRepo.findById(user.id)!;
    }
  }

  // 3. Create new user scoped to the external id
  if (!user) {
    if (hasEmail) {
      user = userRepo.createFromExternal((email as string).toLowerCase(), name.trim(), userId);
      // Set phone if also provided
      if (hasPhone) {
        try { userRepo.setPhone(user.id, phone as string); } catch { /* phone may collide; ignore */ }
      }
    } else {
      // Phone-only user: create via the synthetic @phone.local path, then
      // link to the external id.
      user = userRepo.createFromPhone(phone as string, '', name.trim());
      userRepo.linkExternalId(user.id, userId);
    }
    issueSignupLicense(user.id, user.created_at);
  }

  // 3b. Pre-accept as an invitee of inviterUserId when supplied (plugin parity
  //     with the web invite flow — parent-app-created users auto-link to the
  //     consultant's shared pool).
  if (inviterUserId && typeof inviterUserId === 'string' && inviterUserId !== user.id) {
    const inviter = userRepo.findById(inviterUserId);
    if (inviter) {
      userRepo.setInviterId(user.id, inviter.id);
      user = userRepo.findById(user.id)!;
    }
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

  // Re-read so loginAndIssueTokens + response reflect the latest overrides
  const fresh = userRepo.findById(user.id)!;
  const effectivePlan = getEffectivePlan(fresh);
  const sessionToken = userRepo.rotateSessionToken(user.id);
  const tokens = generateTokens({ ...fresh, plan: effectivePlan, sessionToken });

  res.json({
    ...tokens,
    user: {
      ...toUserResponse({ ...fresh, plan: effectivePlan }),
      pluginRole: fresh.plugin_role ?? undefined,
      consultantId: fresh.plugin_consultant_id ?? undefined,
    },
  });
});

export default router;
