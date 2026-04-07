// server/index.ts
import 'dotenv/config';
import './db/index.js';
import express from 'express';
import chatRouter from './routes/chat.js';
import uploadRouter from './routes/upload.js';
import chatsRouter from './routes/chats.js';
import authRouter from './routes/auth.js';
import { authMiddleware } from './middleware/auth.js';
import { authLimiter, chatLimiter, uploadLimiter } from './middleware/rateLimiter.js';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ?? 4001;

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
const allowedOrigins =
  process.env.NODE_ENV === 'production'
    ? ['https://ai.smartbizin.com', 'https://smartbizin.com']
    : ['http://localhost:3000', 'http://localhost:5173'];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: false,
  })
);

// 3. Body parsing
app.use(express.json({ limit: '1mb' }));

// 4. API routes with per-route rate limiting
// Auth routes — public, with brute-force protection
app.use('/api/auth', authLimiter, authRouter);

// Protected routes — require JWT
app.use('/api', authMiddleware);
app.use('/api/chat', chatLimiter);
app.use('/api/upload', uploadLimiter);
app.use('/api', chatRouter);
app.use('/api', uploadRouter);
app.use('/api/chats', chatsRouter);

// 5. Production static serving
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[API] Server running on :${PORT} (${process.env.NODE_ENV ?? 'development'})`);
});

export default app;
