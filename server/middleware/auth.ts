import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, AuthUser } from '../types.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { userSessionRepo } from '../db/repositories/userSessionRepo.js';
import { isTrialExpired, getTrialEndsAt } from '../lib/planLimits.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

/**
 * Paths (relative to /api mount) that bypass the trial-expiry gate.
 * Users need access to auth, usage (plan page), and payments even when
 * their trial has expired so they can still see their status and upgrade.
 */
const TRIAL_EXEMPT_PREFIXES = [
  '/api/auth',
  '/api/usage',
  '/api/payments',
  '/api/billing-details', // needed so trial-expired users can save billing details before paying
];

// Strict auth — rejects if no valid token
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser & { sessionToken?: string };
    const user = userRepo.findById(payload.id);

    // Auto-downgrade expired paid plans before any other check
    if (user && user.plan !== 'free') {
      userRepo.downgradePlanIfExpired(payload.id);
    }

    // Re-fetch after potential downgrade
    const freshUser = userRepo.findById(payload.id);

    // Check suspension
    if (freshUser?.suspended_until) {
      const until = new Date(freshUser.suspended_until + '+05:30');
      if (until > new Date()) {
        res.status(403).json({ error: `Account suspended until ${freshUser.suspended_until} IST` });
        return;
      }
      userRepo.suspend(payload.id, null);
    }

    // Multi-session validation: the JWT carries a sessionToken that
    // MUST exist in user_sessions. Revoking a session (logout, "sign
    // out of all other devices", admin suspend) deletes the row,
    // making every JWT bearing that token immediately invalid. JWTs
    // issued before the multi-session migration that DON'T carry a
    // sessionToken are rejected so we don't fall through to a
    // permissive path.
    if (!payload.sessionToken) {
      res.status(401).json({ error: 'Session expired — please sign in again' });
      return;
    }
    const session = userSessionRepo.findByToken(payload.sessionToken);
    if (!session || session.user_id !== payload.id) {
      res.status(401).json({ error: 'Session expired — please sign in again' });
      return;
    }
    // Touch last_seen_at. Internally rate-limited to 1 write per 60s
    // so streaming chat requests don't write hundreds of times per
    // minute. (req.user is set BEFORE the touch so the rest of the
    // request still works if the touch throws.)
    req.user = { id: payload.id, email: payload.email, role: freshUser?.role ?? 'user' };
    userSessionRepo.touch(payload.sessionToken);
    // Stash the session token on the request for downstream handlers
    // (the /api/sessions list endpoint marks the current session, and
    // "sign out of all others" needs the token to know which row to
    // keep).
    (req as AuthRequest & { sessionToken?: string }).sessionToken = payload.sessionToken;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Optional auth — attaches user if token present, validates plugin key
export function optionalAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const pluginKey = req.headers['x-plugin-key'] as string | undefined;
  const PLUGIN_API_KEY = process.env.PLUGIN_API_KEY;

  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET) as AuthUser & { sessionToken?: string };
      const user = userRepo.findById(payload.id);

      if (user && user.plan !== 'free') {
        userRepo.downgradePlanIfExpired(payload.id);
      }
      const freshUser = userRepo.findById(payload.id);

      if (freshUser?.suspended_until) {
        const until = new Date(freshUser.suspended_until + '+05:30');
        if (until > new Date()) {
          res.status(403).json({ error: `Account suspended until ${freshUser.suspended_until} IST` });
          return;
        }
        userRepo.suspend(payload.id, null);
      }
      // Multi-session validation (same logic as authMiddleware
      // above, but failure here just treats the request as guest
      // instead of returning 401 — keeps optionalAuth permissive).
      const session = payload.sessionToken ? userSessionRepo.findByToken(payload.sessionToken) : null;
      if (session && session.user_id === payload.id) {
        req.user = { id: payload.id, email: payload.email, role: freshUser?.role ?? 'user' };
        userSessionRepo.touch(payload.sessionToken!);
        (req as AuthRequest & { sessionToken?: string }).sessionToken = payload.sessionToken;
      }
    } catch {
      // Invalid token — treat as guest
    }
    next();
    return;
  }

  if (pluginKey && PLUGIN_API_KEY && pluginKey !== PLUGIN_API_KEY) {
    res.status(403).json({ error: 'Invalid plugin key' });
    return;
  }

  next();
}

// Admin-only — must be used after authMiddleware
export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

/**
 * Trial-expiry gate — blocks free-plan users whose 30-day trial has ended.
 * Must run AFTER authMiddleware. Exempt routes (auth, usage, payments) pass through.
 * Admins and paid-plan users always pass through.
 */
export function trialCheckMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) { next(); return; }

  // Admins are never blocked
  if (req.user.role === 'admin') { next(); return; }

  // Exempt specific API paths so users can still log in, see status, and pay
  const fullPath = req.originalUrl.split('?')[0];
  if (TRIAL_EXEMPT_PREFIXES.some(p => fullPath.startsWith(p))) { next(); return; }

  const user = userRepo.findById(req.user.id);
  if (!user) { next(); return; }

  // Only free-plan users are subject to the trial gate
  if (user.plan !== 'free') { next(); return; }

  if (isTrialExpired(user.created_at)) {
    res.status(403).json({
      error: 'trial_expired',
      trialEnded: true,
      trialEndsAt: getTrialEndsAt(user.created_at),
    });
    return;
  }

  next();
}

// ITR access — admin only OR explicit itr_enabled grant via script.
// Not tied to enterprise plan — ITR is not yet fully released to general users.
export function itrAccessMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.user.role === 'admin') {
    next();
    return;
  }
  const user = userRepo.findById(req.user.id);
  if (user && user.itr_enabled === 1) {
    next();
    return;
  }
  res.status(403).json({ error: 'ITR filing access not enabled for this account' });
}

/**
 * Board Resolutions — open to all authenticated users (plan limits enforced
 * at the route level, not here). Admins always have access.
 */
export function boardResolutionAccessMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  // All authenticated users may access board resolutions — limits enforced in the route
  next();
}
