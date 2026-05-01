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

/**
 * Factory for per-user, per-feature rate limiters. The token budget is the
 * hard quota gate — these limiters exist to stop runaway clients, accidental
 * loops, and abuse from melting our LLM bill in a single minute. Limits are
 * intentionally generous for normal users.
 */
function featureLimiter(limit: number, message: string) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => (req as AuthRequest).user?.id ?? 'anon',
    validate: { xForwardedForHeader: false, ip: false },
    message: { error: message },
    skip: (req) => req.method === 'GET' || req.path.endsWith('/cancel'),
  });
}

// Chat endpoint: 30 req/min per user
export const chatLimiter = featureLimiter(30, "You're sending messages too fast. Please wait a moment.");

// Upload endpoint: 10 req/min per user
export const uploadLimiter = featureLimiter(10, 'Too many uploads. Please wait a moment.');

// Per-feature limiters for LLM-backed routes. These guard against runaway
// loops; the token budget remains the authoritative quota.
export const bankStatementsLimiter   = featureLimiter(15, 'Too many bank statement requests. Please wait a moment.');
export const ledgerScrutinyLimiter   = featureLimiter(15, 'Too many ledger scrutiny requests. Please wait a moment.');
export const noticesLimiter          = featureLimiter(20, 'Too many notice requests. Please wait a moment.');
export const boardResolutionsLimiter = featureLimiter(20, 'Too many board resolution requests. Please wait a moment.');
export const partnershipDeedsLimiter = featureLimiter(20, 'Too many partnership deed requests. Please wait a moment.');
export const suggestionsLimiter      = featureLimiter(20, 'Too many suggestion requests. Please wait a moment.');
export const itrLimiter              = featureLimiter(20, 'Too many ITR requests. Please wait a moment.');
export const itPortalLimiter         = featureLimiter(10, 'Too many IT portal import requests. Please wait a moment.');
export const form16ImportLimiter     = featureLimiter(10, 'Too many Form-16 import requests. Please wait a moment.');

