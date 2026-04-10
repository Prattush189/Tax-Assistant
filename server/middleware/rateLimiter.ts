import { rateLimit } from 'express-rate-limit';
import { AuthRequest } from '../types.js';

// Auth endpoints: prevent brute force — 10 req/min per IP
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a moment.' },
});

// Chat endpoint: 30 req/min per user
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? 'anon',
  validate: { xForwardedForHeader: false, ip: false },
  message: { error: "You're sending messages too fast. Please wait a moment." },
});

// Upload endpoint: 10 req/min per user
export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? 'anon',
  validate: { xForwardedForHeader: false, ip: false },
  message: { error: 'Too many uploads. Please wait a moment.' },
});

