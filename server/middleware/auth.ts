import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, AuthUser } from '../types.js';

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
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = { id: payload.id, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Optional auth — attaches user if token present, or validates plugin key, continues either way
export function optionalAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const pluginKey = req.headers['x-plugin-key'] as string | undefined;
  const PLUGIN_API_KEY = process.env.PLUGIN_API_KEY;

  // Check JWT first
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
      req.user = { id: payload.id, email: payload.email };
    } catch {
      // Invalid token — treat as guest
    }
    next();
    return;
  }

  // Plugin key is only checked when the request sends one (iframe embeds).
  // Main app guests (no plugin key header) are allowed through.
  if (pluginKey && PLUGIN_API_KEY && pluginKey !== PLUGIN_API_KEY) {
    res.status(403).json({ error: 'Invalid plugin key' });
    return;
  }

  next();
}
