// server/index.ts
import 'dotenv/config';
import './db/index.js';
import { initRAG } from './rag/index.js';
import express from 'express';

// Initialize RAG chunks at startup
initRAG();
import chatRouter from './routes/chat.js';
import uploadRouter from './routes/upload.js';
import chatsRouter from './routes/chats.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import noticesRouter from './routes/notices.js';
import pdfRouter from './routes/pdf.js';
import suggestionsRouter from './routes/suggestions.js';
import profilesRouter from './routes/profiles.js';
import genericProfilesRouter from './routes/genericProfiles.js';
import usageRouter from './routes/usage.js';
import itrRouter from './routes/itr.js';
import boardResolutionsRouter from './routes/boardResolutions.js';
import paymentsRouter from './routes/payments.js';
import webhooksRouter from './routes/webhooks.js';
import itPortalImportRouter from './routes/itPortalImport.js';
import styleProfileRouter from './routes/styleProfile.js';
import form16ImportRouter from './routes/form16Import.js';
import clientsRouter from './routes/clients.js';
import invitationsRouter, { publicInvitationRouter } from './routes/invitations.js';
import { authMiddleware, adminMiddleware, trialCheckMiddleware } from './middleware/auth.js';
import { authLimiter, chatLimiter, uploadLimiter } from './middleware/rateLimiter.js';
import { warmupRazorpayPlans } from './lib/razorpayPlans.js';
import { startRenewalReminderJob } from './jobs/renewalReminder.js';
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
    ? ['https://ai.smartbizin.com', 'https://smartbizin.com']
    : ['http://localhost:3000', 'http://localhost:5173']),
  ...pluginAllowedOrigins,
]));

app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: false,
  })
);

// 3a. Webhook route — must come BEFORE express.json() so req.body stays a Buffer
//     for HMAC-SHA256 signature verification. express.raw() consumes the stream
//     and sets req._body = true so express.json() skips re-parsing this route.
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhooksRouter);

// 3b. Body parsing for all other routes
app.use(express.json({ limit: '1mb' }));

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
app.use('/api/notices', noticesRouter);
app.use('/api/pdfs', pdfRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/generic-profiles', genericProfilesRouter);
app.use('/api/usage', usageRouter);
app.use('/api/itr', itrRouter);
app.use('/api/board-resolutions', boardResolutionsRouter);
app.use('/api/it-portal', itPortalImportRouter);
app.use('/api/style-profile', styleProfileRouter);
app.use('/api/form16-import', form16ImportRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/invitations', invitationsRouter);
app.use('/api/payments', paymentsRouter);

// Admin — requires auth + admin role
app.use('/api/admin', authMiddleware, adminMiddleware, adminRouter);

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

  // Pre-create all 4 Razorpay Plans on startup so first payment has no delay
  void warmupRazorpayPlans();

  // Start 48-hour renewal reminder email job (runs hourly)
  startRenewalReminderJob();
});

export default app;
