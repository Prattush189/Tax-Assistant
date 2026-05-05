// server/index.ts
import 'dotenv/config';
import './db/index.js';
import express from 'express';

import chatRouter from './routes/chat.js';
import uploadRouter from './routes/upload.js';
import chatsRouter from './routes/chats.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import externalRouter from './routes/external.js';
import noticesRouter from './routes/notices.js';
import suggestionsRouter from './routes/suggestions.js';
import profilesRouter from './routes/profiles.js';
import genericProfilesRouter from './routes/genericProfiles.js';
import usageRouter from './routes/usage.js';
import itrRouter from './routes/itr.js';
import boardResolutionsRouter from './routes/boardResolutions.js';
import partnershipDeedsRouter from './routes/partnershipDeeds.js';
import paymentsRouter from './routes/payments.js';
import webhooksRouter from './routes/webhooks.js';
import itPortalImportRouter from './routes/itPortalImport.js';
import styleProfileRouter from './routes/styleProfile.js';
import form16ImportRouter from './routes/form16Import.js';
import clientsRouter from './routes/clients.js';
import bankStatementsRouter from './routes/bankStatements.js';
import ledgerScrutinyRouter from './routes/ledgerScrutiny.js';
import invitationsRouter, { publicInvitationRouter } from './routes/invitations.js';
import billingDetailsRouter from './routes/billingDetails.js';
import { authMiddleware, adminMiddleware, trialCheckMiddleware } from './middleware/auth.js';
import {
  authLimiter,
  chatLimiter,
  uploadLimiter,
  bankStatementsLimiter,
  ledgerScrutinyLimiter,
  noticesLimiter,
  boardResolutionsLimiter,
  partnershipDeedsLimiter,
  suggestionsLimiter,
  itrLimiter,
  itPortalLimiter,
  form16ImportLimiter,
} from './middleware/rateLimiter.js';
import { startRenewalReminderJob } from './jobs/renewalReminder.js';
import { startStuckJobSweeper } from './lib/sweepStuckJobs.js';
import { licenseKeyRepo } from './db/repositories/licenseKeyRepo.js';
import { usageRepo } from './db/repositories/usageRepo.js';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1); // Trust first proxy (Apache)
// In dev we always bind 4001 (Vite proxies /api → :4001). In production we
// honor the PORT env var from PM2. Claude Preview sets PORT when launching
// the dev server, which would otherwise collide with Vite on :3000.
const PORT =
  process.env.NODE_ENV === 'production' ? (process.env.PORT ?? 4001) : 4001;

// 1. Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: process.env.NODE_ENV === 'production'
          ? ["'self'", 'https://ai.smartbizin.com']
          : ["'self'", 'http://localhost:3000', 'http://localhost:5173'],
      },
    },
  })
);

// 2. CORS
const pluginAllowedOrigins = (process.env.PLUGIN_ALLOWED_ORIGINS ?? 'https://ai.smartbizin.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([
  ...(process.env.NODE_ENV === 'production'
    // assist.smartbizin.com is the dealer-facing console that calls
    // /api/external/* with a Bearer EXTKEY-…; included here so its
    // browser-side fetches don't fail CORS preflight.
    ? ['https://ai.smartbizin.com', 'https://smartbizin.com', 'https://assist.smartbizin.com']
    : ['http://localhost:3000', 'http://localhost:5173']),
  ...pluginAllowedOrigins,
]));

app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    credentials: false,
  })
);

// 3a. Webhook route — must come BEFORE express.json() so req.body stays a Buffer
//     for HMAC-SHA256 signature verification. express.raw() consumes the stream
//     and sets req._body = true so express.json() skips re-parsing this route.
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhooksRouter);

// 3b. Body parsing for all other routes. 20 MB headroom is needed for the
// ledger-scrutiny pdfText path: a 3 MB compressed Tally / Busy PDF can
// expand to 10-15 MB of plain text after pdfjs extraction, and we send
// that as JSON. Bank statements use the same pdfText pattern with much
// smaller files and stay well under the limit.
app.use(express.json({ limit: '20mb' }));

// 4. API routes
// Auth routes — public, with brute-force protection
app.use('/api/auth', authLimiter, authRouter);

// Invitation accept route is PUBLIC — anyone with a valid token can consume
// it without being logged in. Mount BEFORE the global authMiddleware gate.
app.use('/api/invitations', publicInvitationRouter);

// All remaining API routes require auth
app.use('/api', authMiddleware);
// Trial gate — free-plan users blocked after 30 days (exempt: auth, usage, payments)
app.use('/api', trialCheckMiddleware);
app.use('/api/chat', chatLimiter);
app.use('/api/upload', uploadLimiter);
app.use('/api', chatRouter);
app.use('/api', uploadRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/notices', noticesLimiter, noticesRouter);
app.use('/api/suggestions', suggestionsLimiter, suggestionsRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/generic-profiles', genericProfilesRouter);
app.use('/api/usage', usageRouter);
app.use('/api/itr', itrLimiter, itrRouter);
app.use('/api/board-resolutions', boardResolutionsLimiter, boardResolutionsRouter);
app.use('/api/partnership-deeds', partnershipDeedsLimiter, partnershipDeedsRouter);
app.use('/api/it-portal', itPortalLimiter, itPortalImportRouter);
app.use('/api/style-profile', styleProfileRouter);
app.use('/api/form16-import', form16ImportLimiter, form16ImportRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/bank-statements', bankStatementsLimiter, bankStatementsRouter);
app.use('/api/ledger-scrutiny', ledgerScrutinyLimiter, ledgerScrutinyRouter);
app.use('/api/invitations', invitationsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/billing-details', billingDetailsRouter);

// Admin — requires auth + admin role
app.use('/api/admin', authMiddleware, adminMiddleware, adminRouter);

// External API namespace — for sister apps (assist.smartbizin.com,
// future integrations). Auth via Bearer EXTKEY-... validated by the
// requireExternalApiKey middleware mounted inside the router. No
// user JWT, no session.
app.use('/api/external', externalRouter);

// 5. Production static serving
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');

  // Hashed assets (JS, CSS, images in /assets/) get long cache — filename changes on each build
  app.use('/assets', express.static(path.join(distPath, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));

  // Other static files (logo, favicon, etc.) — short cache
  app.use(express.static(distPath, {
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      // index.html must NEVER be cached — it contains the hashed filenames
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    },
  }));

  // SPA fallback — always serve fresh index.html
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[API] Server running on :${PORT} (${process.env.NODE_ENV ?? 'development'})`);

  // License-key backfill — issues keys for any user that's been
  // around since before the licensing system shipped. Idempotent.
  // Sweeps expired keys before returning so the gate has a clean
  // baseline for the first request.
  try {
    licenseKeyRepo.backfillExistingUsers();
  } catch (e) {
    console.error('[boot] license-key backfill failed:', (e as Error).message);
  }

  // Reconcile plan/license mismatches — covers users whose plan
  // column was edited directly (DB or pre-410'd /plan endpoint)
  // without going through license issuance. Idempotent.
  try {
    licenseKeyRepo.reconcilePlanMismatches();
  } catch (e) {
    console.error('[boot] license reconcile failed:', (e as Error).message);
  }

  // Weighted-tokens backfill — populates the new column on every
  // historic api_usage row so the gate sums consistently across
  // the migration. Idempotent on subsequent boots.
  try {
    usageRepo.backfillWeightedTokens();
  } catch (e) {
    console.error('[boot] weighted-tokens backfill failed:', (e as Error).message);
  }

  // Start 48-hour renewal reminder email job (runs hourly)
  startRenewalReminderJob();

  // Sweep stuck AI jobs (ledger / bank statement / notice / partnership
  // deed rows that got orphaned by a crash, redeploy, or runaway
  // Gemini retry loop). Runs once now and every 5 min thereafter so a
  // reload or a new login doesn't leave the user staring at a forever-
  // 'generating' row.
  startStuckJobSweeper();
});

export default app;
