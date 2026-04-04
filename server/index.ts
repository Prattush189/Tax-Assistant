// server/index.ts
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ?? 4001;

// 1. Security headers — helmet first so headers apply to all responses
// frame-ancestors set to allow iframe embedding for ?plugin=true mode.
// Using permissive '*' initially; tighten to specific origin once embedding
// domain is confirmed (tracked: PLUG-02 in Phase 6).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'self'", '*'],
      },
    },
  })
);

// 2. CORS — before routes so OPTIONS pre-flight gets CORS headers
const allowedOrigins =
  process.env.NODE_ENV === 'production'
    ? ['https://ai.smartbizin.com', 'https://smartbizin.com']
    : ['http://localhost:3000', 'http://localhost:5173'];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: false,
  })
);

// 3. Rate limiting on /api/* — 30 req/min per IP
// Friendly message per CONTEXT.md error handling decisions
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: "You're sending messages too fast. Please wait a moment.",
  },
});
app.use('/api', limiter);

// 4. Body parsing — 1MB limit (chat history is text; no binary here)
app.use(express.json({ limit: '1mb' }));

// 5. API routes — imported in subsequent plans
// TODO Plan 02: import chatRouter from './routes/chat.js';
// TODO Plan 02: app.use('/api', chatRouter);
// TODO Plan 03: import uploadRouter from './routes/upload.js';
// TODO Plan 03: app.use('/api', uploadRouter);

// 6. Production static serving — Express serves Vite build output
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  // SPA fallback — serve index.html for any unmatched GET
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[API] Server running on :${PORT} (${process.env.NODE_ENV ?? 'development'})`);
});

export default app;
