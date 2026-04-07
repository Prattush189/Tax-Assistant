import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, AuthUser } from '../types.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

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
