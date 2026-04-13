import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, AuthUser } from '../types.js';
import { userRepo } from '../db/repositories/userRepo.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

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
    // Check suspension
    const user = userRepo.findById(payload.id);
    if (user?.suspended_until) {
      const until = new Date(user.suspended_until + '+05:30');
      if (until > new Date()) {
        res.status(403).json({ error: `Account suspended until ${user.suspended_until} IST` });
        return;
      }
      // Suspension expired — clear it
      userRepo.suspend(payload.id, null);
    }
    // Single-session enforcement: if the JWT's sessionToken doesn't match
    // the DB's session_token, the user logged in elsewhere and this session
    // is stale. Tokens minted before the session_token column existed have
    // no sessionToken field — allow them through (backwards compat).
    if (
      user?.session_token &&
      payload.sessionToken &&
      user.session_token !== payload.sessionToken
    ) {
      res.status(401).json({ error: 'Session expired — you logged in on another device' });
      return;
    }
    req.user = { id: payload.id, email: payload.email, role: user?.role ?? 'user' };
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
      if (user?.suspended_until) {
        const until = new Date(user.suspended_until + '+05:30');
        if (until > new Date()) {
          res.status(403).json({ error: `Account suspended until ${user.suspended_until} IST` });
          return;
        }
        userRepo.suspend(payload.id, null);
      }
      // Session check — stale sessions are treated as guest (not 401 in optional mode)
      if (user?.session_token && payload.sessionToken && user.session_token !== payload.sessionToken) {
        // Treat as guest — don't attach user
      } else {
        req.user = { id: payload.id, email: payload.email, role: user?.role ?? 'user' };
      }
    } catch {
      // Invalid token — treat as guest
    }
    next();
    return;
  }

  // Plugin key validation
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

// ITR access — enterprise plan required (admin always has access).
// Used for /api/itr/* and /api/board-resolutions/* routes.
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
  // Enterprise plan OR explicit itr_enabled flag
  const plan = user?.plan ?? 'free';
  if (plan === 'enterprise' || (user && user.itr_enabled === 1)) {
    next();
    return;
  }
  res.status(403).json({ error: 'Enterprise plan required for ITR filing' });
}

// Board Resolutions — enterprise plan required (admin always has access).
export function boardResolutionAccessMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.user.role === 'admin') {
    next();
    return;
  }
  const user = userRepo.findById(req.user.id);
  const plan = user?.plan ?? 'free';
  if (plan === 'enterprise') {
    next();
    return;
  }
  res.status(403).json({ error: 'Enterprise plan required for Board Resolutions' });
}
