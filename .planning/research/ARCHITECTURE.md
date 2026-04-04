# Architecture Research

**Domain:** React + Vite SPA with Express backend proxy — Indian tax assistant
**Researched:** 2026-04-04
**Confidence:** HIGH (verified against Vite official docs, @google/genai SDK docs, established patterns)

---

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────┐
│                         BROWSER                                   │
│                                                                   │
│  ┌────────────┐  ┌──────────────┐  ┌───────────────────────┐     │
│  │  ChatView  │  │  Calculator  │  │  Dashboard (Charts)   │     │
│  └─────┬──────┘  └──────┬───────┘  └──────────┬────────────┘     │
│        │                │                     │                   │
│  ┌─────▼────────────────▼─────────────────────▼────────────┐     │
│  │                    App Shell / Layout                    │     │
│  │         (tabs/view switching, plugin mode wrapper)       │     │
│  └──────────────────────────┬───────────────────────────────┘     │
│                             │                                     │
│  ┌──────────────────────────▼───────────────────────────────┐     │
│  │                   API Service Layer                       │     │
│  │       src/services/api.ts  (fetch → /api/*)               │     │
│  └──────────────────────────┬───────────────────────────────┘     │
└─────────────────────────────┼─────────────────────────────────────┘
                              │ HTTP (proxied in dev, direct in prod)
┌─────────────────────────────▼─────────────────────────────────────┐
│                      EXPRESS SERVER (server/)                      │
│                                                                   │
│  ┌──────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ POST /api/   │  │  POST /api/     │  │  POST /api/         │  │
│  │   chat       │  │  upload         │  │  calculate          │  │
│  └──────┬───────┘  └────────┬────────┘  └──────────┬──────────┘  │
│         │                   │                      │              │
│  ┌──────▼───────────────────▼──────────────────────▼──────────┐  │
│  │                 Gemini Service (server/services/gemini.ts)  │  │
│  │               GoogleGenAI SDK — API key stays server-side   │  │
│  └──────────────────────────┬───────────────────────────────────┘  │
└─────────────────────────────┼─────────────────────────────────────┘
                              │ HTTPS
                    ┌─────────▼──────────┐
                    │   Google Gemini API │
                    │ (gemini-3.1-pro-   │
                    │  preview)          │
                    └────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Location |
|-----------|---------------|----------|
| App shell | Plugin mode wrapper, theme, tab routing | `src/App.tsx` (refactored) |
| ChatView | Message list, input, streaming response render | `src/components/chat/` |
| ChartRenderer | Recharts wrapper, parses json-chart blocks | `src/components/charts/` |
| Dashboard | Interactive chart collection, tax breakdown | `src/components/dashboard/` |
| TaxCalculator | Form inputs, old vs new regime UI | `src/components/calculator/` |
| DocumentUpload | File picker, upload progress, doc Q&A | `src/components/documents/` |
| API service | All fetch calls, typed request/response | `src/services/api.ts` |
| Express server | Route handlers, no business logic | `server/index.ts` |
| Gemini service | GoogleGenAI SDK calls, stream handling | `server/services/gemini.ts` |

---

## Recommended Project Structure

```
tax-assistant/
├── server/                      # Express backend (NEW)
│   ├── index.ts                 # App entry: mounts middleware + routes, serves dist/ in prod
│   ├── routes/
│   │   ├── chat.ts              # POST /api/chat — proxies to Gemini, streams response
│   │   ├── upload.ts            # POST /api/upload — multer + Gemini Files API
│   │   └── calculate.ts         # POST /api/calculate — structured tax calculation
│   └── services/
│       └── gemini.ts            # GoogleGenAI SDK instance, shared across routes
│
├── src/                         # React frontend (REFACTORED from monolith)
│   ├── main.tsx                 # Unchanged
│   ├── index.css                # Unchanged
│   ├── App.tsx                  # Slimmed to shell: tab state, plugin mode, layout
│   │
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatView.tsx     # Extracted from App.tsx — message list + input
│   │   │   ├── MessageBubble.tsx
│   │   │   └── ChatInput.tsx
│   │   │
│   │   ├── charts/
│   │   │   ├── ChartRenderer.tsx  # Extracted from App.tsx — bar + pie
│   │   │   ├── WaterfallChart.tsx # NEW — for tax slab breakdowns
│   │   │   ├── LineChart.tsx      # NEW — for year-over-year comparison
│   │   │   └── ChartDashboard.tsx # NEW — combines charts into interactive view
│   │   │
│   │   ├── calculator/
│   │   │   ├── TaxCalculator.tsx  # NEW — main calculator view
│   │   │   ├── IncomeInputForm.tsx # NEW — salary, HRA, deductions form
│   │   │   └── RegimeComparison.tsx # NEW — old vs new regime result display
│   │   │
│   │   ├── documents/
│   │   │   ├── DocumentUpload.tsx  # NEW — drag-drop + file picker
│   │   │   ├── UploadProgress.tsx  # NEW — upload + processing state
│   │   │   └── DocQAView.tsx       # NEW — chat interface for uploaded doc
│   │   │
│   │   └── layout/
│   │       ├── Sidebar.tsx      # Extracted from App.tsx
│   │       ├── Header.tsx       # Extracted from App.tsx
│   │       └── PluginWrapper.tsx # NEW — handles iframe constraints
│   │
│   ├── hooks/
│   │   ├── useChat.ts           # NEW — message state, send, clear logic from App.tsx
│   │   ├── useTheme.ts          # NEW — dark mode logic extracted from App.tsx
│   │   └── usePluginMode.ts     # NEW — URL param detection, postMessage listener
│   │
│   ├── services/
│   │   └── api.ts               # NEW — typed fetch wrapper for all /api/* calls
│   │
│   └── types/
│       └── index.ts             # NEW — Message, ChartData, TaxInput, UploadedFile types
│
├── index.html                   # Unchanged
├── vite.config.ts               # MODIFIED — add server.proxy for dev
├── tsconfig.json                # MODIFIED — add server/ paths if needed
└── package.json                 # MODIFIED — add dev scripts, multer
```

### Structure Rationale

- **`server/`**: Kept flat because there are only three routes. A `routes/` subfolder separates concerns without premature nesting. The `services/gemini.ts` singleton avoids reinitializing the SDK on every request.
- **`src/components/[feature]/`**: Feature folders rather than type folders (`components/`, `containers/`). Each feature owns its subcomponents. This matches the roadmap's feature-by-feature delivery.
- **`src/hooks/`**: Business logic extracted from App.tsx goes here, not into components. `useChat.ts` is the most important — it owns the message array, send function, and loading state.
- **`src/services/api.ts`**: Single place for all fetch calls. Centralizing here means switching from fetch to axios or adding auth headers later is a one-file change.
- **`src/types/`**: Shared types prevent import cycles between components and hooks.

---

## Architectural Patterns

### Pattern 1: Vite Dev Proxy → Express

**What:** Vite's `server.proxy` intercepts `/api/*` requests during development and forwards them to the Express process on a different port. In production, Express serves both the built frontend and the API from the same port.

**When to use:** Always — this is the standard pattern for Vite + Express monorepos.

**Trade-offs:** Zero CORS configuration needed in dev. In production, one process serves everything (simpler deployment but single point of failure for scaling — acceptable for v1).

**vite.config.ts change:**
```typescript
server: {
  hmr: process.env.DISABLE_HMR !== 'true',
  proxy: {
    '/api': {
      target: 'http://localhost:4000',
      changeOrigin: true,
      // Do NOT rewrite — keep /api prefix so Express routes match
    },
  },
},
```

**Express production serve pattern (server/index.ts):**
```typescript
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// API routes first
app.use('/api/chat', chatRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/calculate', calculateRouter);

// Serve Vite build in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
```

**package.json dev scripts:**
```json
"dev:client": "vite --port=3000 --host=0.0.0.0",
"dev:server": "tsx watch server/index.ts",
"dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
"build": "vite build",
"start": "NODE_ENV=production node --import tsx/esm server/index.ts"
```

### Pattern 2: Gemini Proxy Route — Text Chat

**What:** Express receives the conversation history and new message from the client. It reconstructs the chat session with the system instruction server-side (which the client no longer needs to send) and streams the response back.

**When to use:** For all text chat — this is the security-critical change.

**Trade-offs:** Adds one network hop (client → Express → Gemini vs client → Gemini). The latency is negligible for streaming responses. The benefit is the API key never reaches the client bundle.

**Key change:** Remove `const ai = new GoogleGenAI(...)` from `src/App.tsx`. The `GEMINI_API_KEY` Vite define in `vite.config.ts` is removed entirely. The key lives only in `.env` on the server.

**server/routes/chat.ts sketch:**
```typescript
import { Router } from 'express';
import { geminiClient } from '../services/gemini.js';

const router = Router();

router.post('/', async (req, res) => {
  const { history, message } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  const chat = geminiClient.chats.create({
    model: 'gemini-3.1-pro-preview',
    config: { systemInstruction: SYSTEM_INSTRUCTION },
    history,
  });

  const stream = await chat.sendMessageStream({ message });
  for await (const chunk of stream) {
    res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
});
```

**src/services/api.ts sketch:**
```typescript
export async function sendChatMessage(
  history: Message[],
  message: string,
  onChunk: (text: string) => void
): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history, message }),
  });
  // Read SSE stream from response
  const reader = response.body!.getReader();
  // ... parse chunks, call onChunk
}
```

### Pattern 3: Document Upload via Multer → Gemini Files API

**What:** Client POSTs a `multipart/form-data` request to `/api/upload`. Express uses multer with `memoryStorage` to receive the file as a `Buffer`. The buffer is converted to a `Blob` (Node.js 18+ global) and passed to the Gemini `files.upload()` method. The returned file URI is stored in component state and sent with subsequent chat messages.

**When to use:** For Form 16 PDFs, salary slips, and general document Q&A.

**Trade-offs:** `memoryStorage` keeps the file in RAM temporarily — acceptable for documents under 10MB (Form 16, salary slips). For large files (future: ITR XMLs), switch to `diskStorage` and pass the file path to `files.upload()` directly. Files uploaded to Gemini expire after 48 hours — no permanent storage is needed for v1.

**server/routes/upload.ts sketch:**
```typescript
import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/', upload.single('document'), async (req, res) => {
  const { buffer, mimetype, originalname } = req.file!;
  const blob = new Blob([buffer], { type: mimetype });

  const uploaded = await geminiClient.files.upload({
    file: blob,
    config: { displayName: originalname, mimeType: mimetype },
  });

  res.json({ fileUri: uploaded.uri, displayName: originalname });
});
```

**Client data flow:**
```
DocumentUpload component
  → POST /api/upload (multipart)
  → receives { fileUri, displayName }
  → stores in useChat hook state as attachedDocument
  → ChatInput shows "1 document attached" badge
  → on send: message payload includes fileUri
  → server includes file reference in Gemini parts array
```

### Pattern 4: Plugin Mode (iframe Embed)

**What:** The app detects `?plugin=true` in the URL (already implemented). For production iframe mode, the parent Smart Assist page communicates via `window.postMessage` for theme sync and resize events. The app posts back its height when content changes.

**When to use:** When embedded as an iframe in Smart Assist.

**Trade-offs:** postMessage requires strict origin validation to prevent spoofing. The existing `isPluginMode` detection via URL param is correct — keep it. The sidebar is already hidden in plugin mode.

**Changes needed for production plugin mode:**
1. Extract plugin layout logic into `PluginWrapper.tsx`
2. Add postMessage listener in `usePluginMode.ts` with origin allowlist
3. Post height updates to parent when message list grows

```typescript
// src/hooks/usePluginMode.ts
const ALLOWED_ORIGINS = ['https://smart-assist.example.com']; // configure via env

useEffect(() => {
  if (!isPluginMode) return;
  const handler = (event: MessageEvent) => {
    if (!ALLOWED_ORIGINS.includes(event.origin)) return;
    if (event.data?.type === 'SET_THEME') {
      setIsDarkMode(event.data.dark);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}, [isPluginMode]);
```

---

## Data Flow

### Chat Message Flow (NEW — via backend proxy)

```
User types message
    ↓
ChatInput.tsx — onSend(text)
    ↓
useChat.ts — appendUserMessage(), call api.sendChatMessage()
    ↓
src/services/api.ts — POST /api/chat (JSON: { history, message })
    ↓ (Vite proxy in dev → direct in prod)
server/routes/chat.ts — reconstruct chat, call gemini.chats.create()
    ↓
Gemini API — streaming response
    ↓
SSE chunks → api.ts onChunk callback
    ↓
useChat.ts — appendToLastModelMessage(chunk)
    ↓
ChatView.tsx — re-renders with partial text
    ↓
renderContent() — splits json-chart blocks → ChartRenderer or Markdown
```

### Document Upload Flow (NEW)

```
DocumentUpload.tsx — user selects file
    ↓
api.ts — POST /api/upload (multipart/form-data)
    ↓
server/routes/upload.ts — multer receives buffer
    ↓
new Blob([buffer]) → geminiClient.files.upload()
    ↓
Gemini Files API — returns { uri, name }
    ↓
api.ts — returns { fileUri, displayName }
    ↓
useChat.ts — setAttachedDocument({ fileUri, displayName })
    ↓
ChatInput.tsx — shows document badge, enables send
    ↓
On send: POST /api/chat with { history, message, fileUri }
    ↓
server/routes/chat.ts — adds filePart to Gemini message parts
```

### Tax Calculator Flow (NEW — client-side only for v1)

```
TaxCalculator.tsx — user fills IncomeInputForm
    ↓
RegimeComparison.tsx — client-side calculation (no API needed for basic math)
    ↓
ChartDashboard.tsx — renders breakdown as waterfall/bar/pie
    ↓
Optional: "Explain this" button → useChat.ts.sendWithContext(calculationResult)
    ↓
Sends pre-formatted prompt to /api/chat for AI commentary
```

Note: Basic tax calculation (slabs, cess, 80C deductions) is deterministic math. Do it client-side. Reserve the `/api/calculate` endpoint for complex edge cases (surcharge, AMT, partnership firms) that benefit from AI explanation.

### State Management

No global state manager is needed. The three independent feature areas each own their state:

```
useChat.ts          → messages[], isLoading, attachedDocument, send(), clear()
TaxCalculator.tsx   → incomeData, calculationResult (local useState)
useTheme.ts         → isDarkMode (localStorage persistence, extracted from App.tsx)
usePluginMode.ts    → isPluginMode, postMessage bridge
```

Props flow down from App.tsx shell only for theme (dark mode class on root element). Feature components are self-contained.

---

## Build and Deploy Story

### Development (two processes, one origin)

```
npm run dev
  ├── tsx watch server/index.ts    → Express on :4000
  └── vite --port=3000             → Vite dev server on :3000
                                      (proxies /api/* → :4000)
```

Browser opens `http://localhost:3000`. All `/api/*` requests are proxied by Vite. Hot module reload works for React. Express restarts via `tsx watch` on server file changes.

### Production (single process)

```
npm run build          → vite build → dist/
NODE_ENV=production npm start
  └── Express on :PORT
        ├── /api/*    → route handlers
        └── /*        → serve dist/ (Vite build output)
```

One process, one port. Express serves the built React app as static files and handles all API calls. The Gemini API key is read from environment variables at startup — never in the build output.

### Environment Variables

```
# .env (server only, never in client bundle)
GEMINI_API_KEY=...
PORT=4000
NODE_ENV=development
ALLOWED_PLUGIN_ORIGINS=https://smart-assist.example.com
```

Remove from `vite.config.ts`:
```typescript
// DELETE THIS — key must not reach client
define: {
  'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
},
```

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-1k users | Current monolith is fine. Single Express process. |
| 1k-10k users | Add response caching for repeated tax calculations. Stream SSE correctly (backpressure). |
| 10k+ users | Extract Express to separate container. Gemini API rate limits become the bottleneck — add queue/retry layer. |

### Scaling Priorities

1. **First bottleneck:** Gemini API rate limits (60 QPM on free tier). Add exponential retry in `server/services/gemini.ts` before worrying about horizontal scaling.
2. **Second bottleneck:** Uploaded file storage — Gemini Files API files expire in 48 hours. If users expect persistence, add a database for file URI mapping. Defer to v2.

---

## Integration Points — New vs Modified

### New Components (net-new files)

| Component | Type | Depends On |
|-----------|------|-----------|
| `server/index.ts` | New file | Express, existing package.json dep |
| `server/routes/chat.ts` | New file | Gemini service |
| `server/routes/upload.ts` | New file | multer (new dep), Gemini service |
| `server/services/gemini.ts` | New file | @google/genai (existing dep) |
| `src/services/api.ts` | New file | Native fetch |
| `src/hooks/useChat.ts` | Extracted | api.ts |
| `src/components/calculator/TaxCalculator.tsx` | New feature | Recharts (existing dep) |
| `src/components/documents/DocumentUpload.tsx` | New feature | api.ts |
| `src/components/charts/WaterfallChart.tsx` | New chart type | Recharts (existing dep) |
| `src/components/layout/PluginWrapper.tsx` | New file | usePluginMode hook |

### Modified Files (changes to existing)

| File | What Changes | Risk |
|------|-------------|------|
| `src/App.tsx` | Extract ChatView, Sidebar, Header into components. Remove GoogleGenAI init. Add tab switching for Calculator/Chat views. | Medium — biggest refactor |
| `vite.config.ts` | Add `server.proxy` block. Remove `define.process.env.GEMINI_API_KEY`. | Low |
| `package.json` | Add `concurrently`, `multer`, `@types/multer`. Add dev/start scripts. | Low |
| `tsconfig.json` | Add `server/` to include if using shared types between client and server. | Low |

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Google Gemini API | SDK via `server/services/gemini.ts` | API key env var only. Model: `gemini-3.1-pro-preview` (keep existing). |
| Gemini Files API | `geminiClient.files.upload(blob)` | Files expire 48h. Store file URI in component state, not persistent DB. |
| Smart Assist (parent frame) | `postMessage` with origin validation | Allowlist origins via `ALLOWED_PLUGIN_ORIGINS` env var. |

---

## Anti-Patterns

### Anti-Pattern 1: Calling Gemini from the Client After Adding Express

**What people do:** Add the Express backend but keep the direct `GoogleGenAI` call in App.tsx as a fallback for development speed.

**Why it's wrong:** The API key stays in the client bundle. The whole point of adding Express is to move the key server-side. Two code paths to maintain.

**Do this instead:** Delete `const ai = new GoogleGenAI(...)` from App.tsx on day one of the Express integration. All Gemini calls go through `/api/*`.

### Anti-Pattern 2: Storing Uploaded Files on the Express Server

**What people do:** Configure multer `diskStorage` to save uploads to `server/uploads/`, then read them later for subsequent questions.

**Why it's wrong:** Files accumulate, disk fills up, no cleanup strategy, breaks in multi-instance deploys. For this use case, the Gemini Files API already provides 48-hour storage — use it.

**Do this instead:** Use `multer.memoryStorage()`, upload the buffer to Gemini Files API immediately, return only the `fileUri` to the client. The client passes the URI with each subsequent message.

### Anti-Pattern 3: Recreating the Gemini Chat Session on Every Request

**What people do:** Call `ai.chats.create()` inside a module-level singleton expecting it to persist conversation state across HTTP requests.

**Why it's wrong:** HTTP is stateless. The Express process handles many requests. A single chat session object is not safe to share across concurrent users.

**Do this instead:** Create a new `ai.chats.create()` call per request, passing the full `history` array sent from the client. The client owns conversation state; the server is stateless.

### Anti-Pattern 4: Adding React Router for Calculator/Dashboard Views

**What people do:** Reach for `react-router-dom` because there are now multiple "pages" (chat, calculator, dashboard).

**Why it's wrong:** PROJECT.md explicitly notes "Pages not needed yet — calculator and dashboard can be tabs/views." Adding a router changes URLs, breaks the back button behavior in plugin/iframe mode, and requires parent-frame URL sync.

**Do this instead:** Simple tab state in App.tsx: `const [activeView, setActiveView] = useState<'chat' | 'calculator' | 'dashboard'>('chat')`. Conditional render of the three views. Zero additional dependencies.

---

## Build Order for Implementation

Based on dependencies between components, implement in this order:

1. **Express skeleton + Vite proxy** — `server/index.ts`, `server/services/gemini.ts`, `vite.config.ts` proxy config, updated npm scripts. Verifies the dev setup works before any feature work.

2. **Chat route migration** — `server/routes/chat.ts`, `src/services/api.ts`, `src/hooks/useChat.ts`. This is the security-critical change (API key off client). Replace `handleSend` in App.tsx to call `api.ts` instead of GoogleGenAI directly.

3. **App.tsx component split** — Extract `Sidebar`, `Header`, `ChatView`, `MessageBubble`, `ChartRenderer` into their component folders. App.tsx becomes the shell. This is mechanical refactoring — no behavior change.

4. **Tax Calculator UI** — `TaxCalculator.tsx`, `IncomeInputForm.tsx`, `RegimeComparison.tsx`. Client-side only. Add tab switching to App.tsx.

5. **Enhanced Charts / Dashboard** — `WaterfallChart.tsx`, `LineChart.tsx`, `ChartDashboard.tsx`. Extends existing Recharts usage.

6. **Document Upload** — `server/routes/upload.ts` (multer), `DocumentUpload.tsx`, `DocQAView.tsx`. Requires multer dependency. Builds on the chat route established in step 2.

7. **Plugin mode hardening** — `usePluginMode.ts`, `PluginWrapper.tsx`. Origin validation, postMessage bridge. Can be done last since basic plugin mode already works.

---

## Sources

- [Vite Server Options — official proxy docs](https://vite.dev/config/server-options)
- [Vite Backend Integration guide](https://vite.dev/guide/backend-integration)
- [Gemini Files API — @google/genai release docs](https://googleapis.github.io/js-genai/release_docs/classes/files.Files.html)
- [Google AI Files API reference](https://ai.google.dev/api/files)
- [Multer memoryStorage — expressjs/multer](https://github.com/expressjs/multer)
- [React iframe best practices — LogRocket](https://blog.logrocket.com/best-practices-react-iframes/)

---

*Architecture research for: React + Vite + Express — Tax Assistant v1.0*
*Researched: 2026-04-04*
