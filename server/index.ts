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
import { authMiddleware, adminMiddleware } from './middleware/auth.js';
import { authLimiter, chatLimiter, uploadLimiter } from './middleware/rateLimiter.js';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1); // Trust first proxy (Apache)
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

// 4. API routes
// Auth routes — public, with brute-force protection
app.use('/api/auth', authLimiter, authRouter);

// All API routes require auth
app.use('/api', authMiddleware);
app.use('/api/chat', chatLimiter);
app.use('/api/upload', uploadLimiter);
app.use('/api', chatRouter);
app.use('/api', uploadRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/notices', noticesRouter);
app.use('/api/pdfs', pdfRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/profiles', profilesRouter);

// Admin — requires auth + admin role
app.use('/api/admin', authMiddleware, adminMiddleware, adminRouter);

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
