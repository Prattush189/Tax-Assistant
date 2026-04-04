# Phase 1: Express Backend + API Key Migration - Research

**Researched:** 2026-04-04
**Domain:** Express.js backend proxy, SSE streaming, multer file uploads, Vite proxy, production deployment
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**API Route Design**
- `/api/chat` streams responses via Server-Sent Events (SSE) — words appear as Gemini generates them
- Client sends full conversation history with each request — server stays stateless, no session storage
- `/api/upload` accepts file and immediately processes through Gemini Files API — returns file URI + initial analysis summary in one response
- Basic request validation: max message length (~4000 chars), max history (~50 messages), file size limit (10MB), MIME type validation (PDF + image)

**Dev Environment**
- Single `npm run dev` command starts both Vite (:3000) and Express (:4000) via concurrently
- Single `.env` file at project root — loaded by both Vite (non-secret vars) and Express (API key)
- Server code in TypeScript using `tsx watch` (already a dev dependency) — consistent with frontend
- Server code lives in `server/` at project root — clear separation from `src/` (frontend)
- Vite proxies `/api/*` to Express `:4000` in dev mode

**Production Deploy**
- Deploy target: aaPanel with Apache on shared hosting at `ai.smartbizin.com`
- Push to GitHub: `https://github.com/Prattush189/Tax-Assistant.git`
- Express runs as PM2 process (auto-restart, log management)
- Apache serves static files (dist/) directly and reverse-proxies only `/api/*` to Express — avoids impacting other sites on the same server
- Express port: Claude's discretion (pick a safe port unlikely to conflict with common services on shared hosting)

**Error Handling**
- Gemini API errors → friendly chat message: "I'm having trouble connecting. Please try again in a moment." — no technical details exposed
- Rate limit hit → friendly message: "You're sending messages too fast. Please wait a moment." — with retry hint
- File upload errors (wrong type, too large, corrupted) → inline error text below the upload area, not a chat message
- Server logging: console.error for failures — PM2 captures to log files automatically. No structured logging library needed at this scale.

### Claude's Discretion
- Express production port number (something safe for shared hosting)
- Apache ProxyPass configuration details
- Exact rate limit thresholds (requests per minute)
- SSE event format and reconnection strategy
- CORS allowed origins list structure

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BACK-01 | Express server proxies all Gemini API calls — API key never reaches client bundle | Vite `define` removal + Express proxy pattern with @google/genai server-side |
| BACK-02 | Server applies CORS, Helmet (CSP + frame-ancestors), and rate limiting on all /api/* routes | helmet v8, cors v2, express-rate-limit v7 middleware stack |
| BACK-03 | Server accepts PDF/image file uploads via multer with 10MB size limit and MIME type validation | multer memoryStorage with fileFilter + magic-number-based MIME check |
| BACK-04 | Vite dev server proxies /api/* requests to Express; production Express serves built Vite assets | Vite server.proxy config + express.static(dist/) fallback pattern |
</phase_requirements>

---

## Summary

The project currently has `process.env.GEMINI_API_KEY` injected directly into the Vite client bundle via `vite.config.ts` `define` block, and `GoogleGenAI` is instantiated in `src/App.tsx`. This phase removes that injection, creates a `server/` directory with an Express app in TypeScript (using the already-present `tsx` dev dependency), and routes all Gemini calls through server-side endpoints.

The `@google/genai` SDK v1.48.0 is already in `package.json` and supports `ai.chats.create()` with `sendMessageStream()` — an async generator that yields chunks. The server wraps this in Server-Sent Events (SSE) headers. The client replaces `GoogleGenAI` direct calls with `fetch('/api/chat')` using the `EventSource` API or a `ReadableStream` reader. Concurrently (already standard in this stack) orchestrates `tsx watch server/index.ts` and `vite --port=3000` under a single `npm run dev`. In production, Express serves `dist/` via `express.static` and Apache routes only `/api/*` to the Express process via ProxyPass.

Port **4001** is recommended for Express — avoids collision with common shared hosting services (MySQL on 3306, Apache on 80/443, common Node defaults on 3000/4000, Nginx on 8080). Helmet needs `frame-ancestors` in CSP because the app supports `?plugin=true` iframe embedding. Rate limit of **30 requests per minute** per IP is reasonable for a chat interface (generous enough for normal use, tight enough to prevent abuse).

**Primary recommendation:** Create `server/index.ts` with Express middleware stack (helmet + cors + rate-limit), `server/routes/chat.ts` for SSE streaming, and `server/routes/upload.ts` for multer. Remove the `define` block from `vite.config.ts`. Add Vite proxy and update `npm run dev` script.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | ^4.21.2 (already installed) | HTTP server framework | Already in package.json; established, stable, TypeScript-typed |
| @google/genai | ^1.29.0 (already installed) | Gemini API SDK | Already in use; v1.48.0 latest; has `sendMessageStream` |
| tsx | ^4.21.0 (already in devDeps) | TypeScript execution with watch | Already a dev dependency; no ts-node or separate compile step needed |
| concurrently | ^9.x | Run vite + tsx watch in parallel | ~1.6M weekly downloads; v9.2.1 as of 2026; battle-tested, cross-platform |
| multer | ^1.x | Multipart form-data / file upload handling | Official Express team recommendation; in expressjs.com middleware list |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| helmet | ^8.x | HTTP security headers (CSP, X-Frame-Options, HSTS, etc.) | Required on all /api/* routes for BACK-02 |
| cors | ^2.x | Cross-Origin Resource Sharing control | Required — client on :3000 calls server on :4001 in dev |
| express-rate-limit | ^7.x | Per-IP request rate limiting | Required for BACK-02; v7 has clean TypeScript import |
| @types/multer | ^1.x | TypeScript types for multer | Needed since multer is a JS package |
| @types/cors | ^2.x | TypeScript types for cors | Needed since cors is a JS package |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| concurrently | npm-run-all2 | concurrently is more actively maintained in 2026; both work fine |
| multer memoryStorage | multer diskStorage | memoryStorage is correct here — files are passed directly to Gemini API, not persisted to disk |
| express-rate-limit | rate-limiter-flexible | express-rate-limit is simpler, sufficient for this scale; no Redis needed |
| manual SSE headers | better-sse library | Manual headers are 5 lines and have zero dependencies; better-sse adds 3rd-party dep for marginal benefit |

**Installation (packages not yet in package.json):**
```bash
npm install concurrently helmet cors express-rate-limit multer
npm install --save-dev @types/multer @types/cors
```

Note: `express`, `@types/express`, `@google/genai`, `tsx`, and `dotenv` are already installed.

---

## Architecture Patterns

### Recommended Project Structure
```
server/
├── index.ts          # Express app setup, middleware stack, static serving
├── routes/
│   ├── chat.ts       # POST /api/chat — SSE streaming endpoint
│   └── upload.ts     # POST /api/upload — multer + Gemini Files API
└── middleware/
    └── validation.ts # Request validation (message length, history size)

src/                  # Frontend unchanged in structure; API calls migrated
├── App.tsx           # GoogleGenAI import removed; fetch('/api/chat') instead
└── ...

.env                  # GEMINI_API_KEY (server only), APP_URL
vite.config.ts        # Remove define block; add server.proxy for /api/*
package.json          # Updated scripts: dev uses concurrently
```

### Pattern 1: SSE Streaming Endpoint

**What:** Express endpoint sets SSE headers, calls `chat.sendMessageStream()`, and pipes each text chunk as an SSE `data:` event. Client reads with `EventSource` or `fetch` + `ReadableStream`.

**When to use:** Any time the server needs to push incremental text to the browser without WebSockets.

**Example:**
```typescript
// server/routes/chat.ts
// Source: https://googleapis.github.io/js-genai/release_docs/classes/chats.Chat.html
// Source: https://oneuptime.com/blog/post/2026-01-24-nodejs-server-sent-events/view

import { Router, Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';

const router = Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

router.post('/chat', async (req: Request, res: Response) => {
  const { message, history } = req.body;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disables Nginx/Apache buffering

  const chat = ai.chats.create({
    model: 'gemini-2.0-flash',
    config: { systemInstruction: SYSTEM_INSTRUCTION },
    history: history ?? [],
  });

  try {
    const stream = await chat.sendMessageStream({ message });
    for await (const chunk of stream) {
      if (chunk.text) {
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: true })}\n\n`);
  } finally {
    res.end();
  }
});

export default router;
```

### Pattern 2: Vite Proxy + Production Static Serving

**What:** Two modes — dev uses Vite's `server.proxy` to forward `/api/*` to Express on :4001; production has Express serve `dist/` with `express.static` and a catch-all `index.html` fallback.

**When to use:** Monorepo setup where React frontend and Express backend share a single process in production.

**Example:**
```typescript
// vite.config.ts (dev proxy addition)
// Source: https://vite.dev/config/server-options
server: {
  hmr: process.env.DISABLE_HMR !== 'true',
  proxy: {
    '/api': {
      target: 'http://localhost:4001',
      changeOrigin: true,
    },
  },
},
```

```typescript
// server/index.ts (production static serving)
import path from 'path';
import express from 'express';

const app = express();
const PORT = process.env.PORT ?? 4001;

// ... middleware stack (helmet, cors, rate-limit) ...
// ... API routes ...

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => console.log(`Server running on :${PORT}`));
```

### Pattern 3: Multer Memory Storage for Direct Gemini Upload

**What:** Multer stores the upload in memory (as `req.file.buffer`) rather than on disk. Buffer is converted to base64 and passed to the Gemini Files API inline, or to `generateContent` with inlineData.

**When to use:** Files are processed immediately and not persisted — exactly the DOC-04 requirement.

**Example:**
```typescript
// server/routes/upload.ts
// Source: https://expressjs.com/en/resources/middleware/multer.html

import multer from 'multer';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_MIME_TYPE'));
    }
  },
});
```

### Pattern 4: Express Middleware Stack Order

**What:** Security middleware must be applied in the correct order for it to work correctly.

**When to use:** Always — this is the standard initialisation sequence.

**Example:**
```typescript
// server/index.ts
// Source: https://www.pkgpulse.com/blog/helmet-vs-cors-vs-express-rate-limit-nodejs-security-middleware-2026

import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit'; // v7 named export

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      frameAncestors: ["'self'", 'https://smartbizin.com'], // supports iframe embed
    },
  },
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://ai.smartbizin.com', 'https://smartbizin.com']
    : ['http://localhost:3000'],
  methods: ['GET', 'POST'],
}));

const limiter = rateLimit({
  windowMs: 60 * 1000,    // 1 minute window
  limit: 30,               // 30 requests per IP per minute
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: "You're sending messages too fast. Please wait a moment." },
});
app.use('/api', limiter);

app.use(express.json({ limit: '1mb' }));
```

### Pattern 5: Remove API Key from Vite Bundle

**What:** Remove the `define` block from `vite.config.ts` that injects `GEMINI_API_KEY` into the client bundle. Also remove the `GoogleGenAI` instantiation from `App.tsx`.

**When to use:** This is the core security migration — the entire reason for Phase 1.

**Example — vite.config.ts before:**
```typescript
define: {
  'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
},
```

**After:** Remove the `define` block entirely. The `loadEnv` call and `env` variable can also be removed since no client-side env vars are needed at this stage.

### Anti-Patterns to Avoid

- **Proxying ALL Vite traffic through Express:** Route only `/api/*` to Express. Static assets should be served by Vite in dev and `express.static` in production — not double-proxied.
- **Using `rewrite: (path) => path.replace(/^\/api/, '')` in Vite proxy:** Do NOT strip `/api` prefix — Express routes should be defined with the `/api` prefix so production and dev are identical.
- **Committing `.env` to git:** The `.env.example` already exists. Add `.env` to `.gitignore` if not already present.
- **Trusting client-provided MIME type alone:** Always validate against the allowed MIME type list in `fileFilter`. This is the MIME type the client reports — for extra security you can check magic bytes, but for this scale the MIME + extension check is sufficient.
- **Forgetting `X-Accel-Buffering: no` header on SSE:** Apache and Nginx buffer responses by default. Without this header, SSE chunks are batched before reaching the client, destroying the streaming effect.
- **Leaving `GoogleGenAI` import in `App.tsx`:** After migration, any remaining import of `GoogleGenAI` in client code means the SDK may still try to use the key — remove it completely.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File upload parsing | Custom multipart parser | multer | Boundary parsing, temp file cleanup, size limits, streaming — all edge cases |
| Rate limiting | Manual request counter with setTimeout | express-rate-limit | Race conditions, IP extraction, IPv6 subnet grouping, header standardisation |
| HTTP security headers | Manual `res.setHeader` calls | helmet | 15+ headers with correct values and sensible defaults; easy to misconfigure CSP |
| Running multiple processes | Shell scripts / Makefile | concurrently | Cross-platform (Windows vs Unix), signal propagation on Ctrl+C, output prefixing |

**Key insight:** The security surface for file uploads and rate limiting has many subtle edge cases. The listed libraries encode years of community-discovered edge cases. Writing custom solutions for these is how vulnerabilities and race conditions are introduced.

---

## Common Pitfalls

### Pitfall 1: SSE Buffering by Apache/Nginx
**What goes wrong:** Client doesn't see streamed words — the entire response arrives at once after the request completes.
**Why it happens:** Apache's `mod_proxy` buffers the upstream response by default. Same with Nginx.
**How to avoid:** Add `X-Accel-Buffering: no` response header on SSE endpoints. In Apache VirtualHost config, add `ProxyBufferSize 4096` and `SetEnv proxy-sendcl 1` or use `RequestHeader set Connection close` in the ProxyPass location block.
**Warning signs:** Streaming works in dev (Vite proxy doesn't buffer) but not in production.

### Pitfall 2: API Key Leaking via Vite Source Maps
**What goes wrong:** Even after removing `define`, if source maps include the old `App.tsx` with the `GoogleGenAI` instantiation, key references can appear in `.map` files.
**Why it happens:** Vite generates source maps for debugging; stale code in the diff.
**How to avoid:** Verify with `grep -r "GEMINI_API_KEY" dist/` after build. This is the Phase 1 success criterion.
**Warning signs:** `grep -r "GEMINI_API_KEY" dist/` returns any matches.

### Pitfall 3: CORS Pre-flight Failure with SSE
**What goes wrong:** Browser blocks the SSE connection because the server sends no CORS headers on the `OPTIONS` pre-flight.
**Why it happens:** `fetch` with custom headers (like `Content-Type: application/json`) triggers a pre-flight request. The `cors()` middleware handles this, but must be registered before the route.
**How to avoid:** Ensure `app.use(cors(...))` is before all route definitions. Test with the browser devtools Network tab.
**Warning signs:** Network tab shows `OPTIONS /api/chat` returning 404 or no CORS headers.

### Pitfall 4: `tsx watch` Restarting Breaks Active SSE Connections
**What goes wrong:** During development, saving `server/` files causes `tsx watch` to restart, killing open SSE streams mid-response.
**Why it happens:** `tsx watch` restarts the process on file change — a new process means existing sockets are closed.
**How to avoid:** This is expected dev behaviour. The client should handle `EventSource.onerror` by showing a reconnection indicator. Do NOT use `--ignore` flags to suppress restarts — restarts are correct. Plan a simple reconnect handler in the client.
**Warning signs:** Console shows `ERR_INCOMPLETE_CHUNKED_ENCODING` after a server restart during streaming.

### Pitfall 5: Multer Error Not Caught by Express Error Handler
**What goes wrong:** File validation errors (wrong MIME type, too large) crash with an unhandled error or return a generic 500.
**Why it happens:** Multer calls `next(err)` rather than throwing, and multer errors have a `.code` property (e.g. `LIMIT_FILE_SIZE`) that must be handled specifically.
**How to avoid:** Add a dedicated error-handling middleware that checks `err.code` and maps it to the correct user-facing message. Call `upload.single('file')` in route handler and wrap with try/catch or use an error middleware.
**Warning signs:** A file that is too large returns `Cannot read property 'code' of undefined` or a raw multer error string.

### Pitfall 6: TypeScript `moduleResolution` Mismatch for Server Code
**What goes wrong:** `tsx` works fine but TypeScript `tsc --noEmit` (the `lint` script) reports import errors in `server/` files.
**Why it happens:** Current `tsconfig.json` uses `"moduleResolution": "bundler"` which is correct for Vite but may not resolve bare specifiers the same way as Node.js runtime for server code.
**How to avoid:** Create a `server/tsconfig.json` extending the root that overrides `"moduleResolution": "Node16"` or `"Bundler"` as appropriate. Or verify that the existing config works with server-side imports before creating a separate one.
**Warning signs:** `npm run lint` passes but `tsx` fails to start, or vice versa.

---

## Code Examples

Verified patterns from official sources:

### Gemini Streaming Chat (server-side)
```typescript
// Source: https://googleapis.github.io/js-genai/release_docs/classes/chats.Chat.html
// @google/genai v1.48.0

const chat = ai.chats.create({
  model: 'gemini-2.0-flash',
  config: { systemInstruction: 'You are a helpful assistant.' },
  history: [
    { role: 'user', parts: [{ text: 'Hello' }] },
    { role: 'model', parts: [{ text: 'Hi there!' }] },
  ],
});

const stream = await chat.sendMessageStream({ message: 'Tell me about taxes' });
for await (const chunk of stream) {
  // chunk.text is the incremental text delta
  process.stdout.write(chunk.text ?? '');
}
```

### express-rate-limit v7 (named import)
```typescript
// Source: https://express-rate-limit.mintlify.app/overview
import { rateLimit } from 'express-rate-limit'; // v7 uses named export

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: "You're sending messages too fast. Please wait a moment." },
});
```

### Vite Proxy Configuration
```typescript
// Source: https://vite.dev/config/server-options
// vite.config.ts — add proxy to existing server block
server: {
  hmr: process.env.DISABLE_HMR !== 'true',
  proxy: {
    '/api': {
      target: 'http://localhost:4001',
      changeOrigin: true,
      // Do NOT rewrite — keep /api prefix so dev and prod routes match
    },
  },
},
```

### concurrently dev script
```json
// package.json scripts
{
  "dev": "concurrently --kill-others-on-fail --names \"WEB,API\" \"vite --port=3000 --host=0.0.0.0\" \"tsx watch server/index.ts\"",
  "dev:web": "vite --port=3000 --host=0.0.0.0",
  "dev:api": "tsx watch server/index.ts"
}
```

### Apache VirtualHost for aaPanel (proxy only /api/*)
```apache
# Source: https://www.serverlab.ca/tutorials/development/nodejs/run-nodejs-with-pm2-and-apache-2-4-on-ubuntu-18-04/
# Add to existing VirtualHost for ai.smartbizin.com

ProxyPreserveHost On

# Proxy only /api/* to Express — static files served by Apache from dist/
ProxyPass /api http://127.0.0.1:4001/api
ProxyPassReverse /api http://127.0.0.1:4001/api

# Disable buffering for SSE endpoints
<Location /api/chat>
  ProxyBufferSize 4096
  ProxyBusyBuffersSize 4096
</Location>

# Serve Vite build static files
DocumentRoot /path/to/tax-assistant/dist
<Directory /path/to/tax-assistant/dist>
  Options -Indexes
  AllowOverride All
  Require all granted
  # SPA fallback
  FallbackResource /index.html
</Directory>
```

### PM2 ecosystem file
```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'tax-assistant-api',
    script: 'server/index.ts',
    interpreter: 'tsx',
    env_production: {
      NODE_ENV: 'production',
      PORT: 4001,
    },
  }],
};
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side API key in Vite `define` | Server-side key in Express env | This migration | Key no longer in JS bundle |
| `@google/generative-ai` (deprecated) | `@google/genai` v1.x | 2024-2025 | Project already uses the new SDK |
| `ChatSession.sendMessageStream()` (deprecated SDK) | `Chat.sendMessageStream()` in `@google/genai` | 2024 | API is similar but different import |
| `ts-node` for TypeScript execution | `tsx` | 2023-present | tsx is faster, requires no separate tsconfig, already installed |
| `nodemon + ts-node` | `tsx watch` | 2023-present | Single dep, faster restarts |

**Deprecated/outdated:**
- `@google/generative-ai`: The old Gemini SDK — replaced by `@google/genai`. The project correctly uses the new SDK already.
- Vite `define` for server secrets: This is what we are removing. It is not a Vite bug — it was the only option for client-side apps. With a backend proxy it is no longer appropriate.

---

## Open Questions

1. **Apache modules available on aaPanel shared hosting**
   - What we know: aaPanel uses Apache; `mod_proxy` and `mod_proxy_http` are required for ProxyPass
   - What's unclear: Whether the specific hosting account has these modules pre-enabled
   - Recommendation: Planner should include a task to verify `a2enmod proxy proxy_http` or equivalent before finalising the Apache config

2. **`?plugin=true` iframe parent origin for Helmet CSP `frame-ancestors`**
   - What we know: The app has plugin mode; Helmet CSP must allow it in an iframe
   - What's unclear: The exact parent origin domain that will embed the iframe
   - Recommendation: Set `frameAncestors` to `["'self'", "*"]` initially (permissive) and tighten once the embedding domain is known. Log this as a follow-up task.

3. **Gemini model version in server code**
   - What we know: `App.tsx` currently uses `"gemini-3.1-pro-preview"` which appears to be a non-standard model name (likely a placeholder or AI Studio preview string)
   - What's unclear: The correct stable model name to use in production server code
   - Recommendation: Use `"gemini-2.0-flash"` as the default (current standard fast model as of 2026); the system instruction context fits a flash-tier model well

---

## Sources

### Primary (HIGH confidence)
- https://googleapis.github.io/js-genai/release_docs/classes/chats.Chat.html — `sendMessageStream` method signature and usage
- https://vite.dev/config/server-options — `server.proxy` configuration options
- https://expressjs.com/en/resources/middleware/multer.html — multer official documentation
- https://express-rate-limit.mintlify.app/overview — express-rate-limit v7 configuration API
- https://github.com/googleapis/js-genai — @google/genai SDK, version 1.48.0 confirmed

### Secondary (MEDIUM confidence)
- https://www.pkgpulse.com/blog/helmet-vs-cors-vs-express-rate-limit-nodejs-security-middleware-2026 — current versions: helmet v8, cors v2, express-rate-limit v7
- https://oneuptime.com/blog/post/2026-01-24-nodejs-server-sent-events/view — SSE headers pattern including `X-Accel-Buffering`
- https://www.serverlab.ca/tutorials/development/nodejs/run-nodejs-with-pm2-and-apache-2-4-on-ubuntu-18-04/ — Apache ProxyPass + PM2 configuration
- https://www.npmjs.com/package/concurrently — version 9.2.1 confirmed, ~1.6M weekly downloads
- https://dev.to/ayanabilothman/file-type-validation-in-multer-is-not-safe-3h8l — multer MIME validation security caveat

### Tertiary (LOW confidence)
- aaPanel-specific Apache module availability — inferred from aaPanel forum posts; validate on target server
- PM2 `interpreter: 'tsx'` syntax — based on PM2 docs pattern for custom interpreters; verify with `pm2 start --interpreter tsx server/index.ts` test

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are already in package.json or are well-established; versions verified from official sources
- Architecture: HIGH — SSE + Vite proxy + express.static pattern is well-documented with multiple sources
- Pitfalls: HIGH — Apache SSE buffering, CORS pre-flight, multer error handling are documented in official and community sources
- Production deploy (aaPanel/Apache): MEDIUM — Apache ProxyPass pattern is solid; aaPanel-specific details depend on hosting environment

**Research date:** 2026-04-04
**Valid until:** 2026-05-04 (30 days — stable ecosystem; express/multer/helmet change slowly)
