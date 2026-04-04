---
phase: 01-express-backend-api-key-migration
verified: 2026-04-04T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
human_verification:
  - test: "Run npm run dev and send a tax question in the chat UI"
    expected: "Words stream in progressively (not all at once); chart appears if response includes data; no console errors in browser DevTools"
    why_human: "SSE streaming visual behaviour and chart rendering cannot be verified by static analysis"
  - test: "Open http://localhost:3000, toggle dark/light mode, confirm plugin mode (?plugin=true) still works"
    expected: "Dark/light toggle works; sidebar hides in plugin mode; no regression to existing UI"
    why_human: "UI state and layout regressions require visual inspection"
  - test: "Upload a PDF via the chat UI (if upload is wired to UI) or POST directly: curl -X POST http://localhost:3000/api/upload -F 'file=@test.pdf'"
    expected: "HTTP 200 with {success:true, filename, mimeType, sizeBytes, summary}; a non-PDF receives HTTP 400 with friendly error"
    why_human: "End-to-end upload flow through the Vite proxy needs a real file to confirm multer processes it correctly"
  - test: "Run: npm run build && grep -r 'GEMINI_API_KEY' dist/"
    expected: "Zero matches — confirms the primary Phase 1 security goal on a fresh build"
    why_human: "dist/ currently exists from a prior build; a fresh build confirms the define block removal is durable and not a one-time artifact"
---

# Phase 1: Express Backend + API Key Migration — Verification Report

**Phase Goal:** The Gemini API key is removed from the client bundle and all AI calls route through a secure Express proxy
**Verified:** 2026-04-04
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Built client bundle contains no Gemini API key string | VERIFIED | `grep -r "GEMINI_API_KEY" dist/` returned zero matches; `dist/` exists from prior build; no `define` block in `vite.config.ts`; no `GoogleGenAI` or `GEMINI_API_KEY` anywhere in `src/` |
| 2 | Chat responses work end-to-end with API key only in server env vars | WIRED (human confirm) | `server/routes/chat.ts` reads only `process.env.GEMINI_API_KEY`; `src/App.tsx` uses `fetch('/api/chat')` + ReadableStream SSE consumer; SSE chunks append to message state; `[DONE]` sentinel terminates stream — runtime streaming behaviour needs human confirmation |
| 3 | File uploads up to 10MB accepted with MIME type validation | VERIFIED | `server/routes/upload.ts` uses `multer.memoryStorage()`, `limits: { fileSize: 10 * 1024 * 1024 }`, MIME allowlist (`application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `image/heic`), `LIMIT_FILE_SIZE` and `INVALID_MIME_TYPE` error codes mapped to friendly 400 responses |
| 4 | Single `npm run dev` starts both Vite and Express; /api/* reaches Express | VERIFIED | `package.json` dev script: `concurrently --kill-others-on-fail --names "WEB,API" "vite --port=3000 ..."  "tsx watch server/index.ts"`; `vite.config.ts` proxy: `/api` → `http://localhost:4001`; no `changeOrigin` path rewrite |
| 5 | Production build serves both React app and /api/* from single Express process | VERIFIED | `server/index.ts` production block: `express.static(distPath)` + SPA `app.get('*')` fallback; both `chatRouter` and `uploadRouter` mounted at `/api`; `ecosystem.config.cjs` manages process via PM2 + tsx; Apache config in `DEPLOY.md` proxies only `/api/*`, serves static files from `dist/` |

**Score:** 5/5 truths verified (Truth 2 automated checks pass; runtime confirmation is the human item)

---

### Required Artifacts

| Artifact | Provides | Exists | Substantive | Wired | Status |
|----------|----------|--------|-------------|-------|--------|
| `server/index.ts` | Express app with full middleware stack | Yes | Yes — helmet (CSP + frameAncestors), cors, rateLimit on `/api/*`, `express.json` 1MB | Yes — chatRouter and uploadRouter both registered | VERIFIED |
| `server/middleware/validation.ts` | Request validation for chat endpoint | Yes | Yes — exports `validateChatRequest`, enforces 4000-char message limit and 50-message history limit | Yes — imported and called in `server/routes/chat.ts` | VERIFIED |
| `server/tsconfig.json` | TypeScript config for server with Node16 module resolution | Yes | Yes — `"moduleResolution": "Node16"`, `"module": "Node16"`, extends root tsconfig | Yes — governs all `server/**/*.ts` compilation | VERIFIED |
| `server/routes/chat.ts` | POST /api/chat SSE streaming endpoint | Yes | Yes — `sendMessageStream`, SSE headers including `X-Accel-Buffering: no`, `[DONE]` sentinel, Gemini error handling, `validateChatRequest` call | Yes — imported and mounted as `app.use('/api', chatRouter)` in `server/index.ts` | VERIFIED |
| `src/App.tsx` | Client chat using fetch + ReadableStream (no GoogleGenAI SDK) | Yes | Yes — `fetch('/api/chat')`, ReadableStream reader, SSE chunk accumulation via `setMessages`, HTTP error parsing for 429 | Yes — the primary chat handler; no GoogleGenAI import remains | VERIFIED |
| `server/routes/upload.ts` | POST /api/upload with multer memoryStorage | Yes | Yes — `multer.memoryStorage()`, 10MB `fileSize` limit, MIME fileFilter, router-level error handler for `MulterError` and `INVALID_MIME_TYPE` | Yes — imported and mounted as `app.use('/api', uploadRouter)` in `server/index.ts` | VERIFIED |
| `vite.config.ts` | Vite config with /api/* proxy, no define block | Yes | Yes — `server.proxy` `/api` → `:4001`, no `define` block, no `loadEnv` | Yes — active Vite configuration | VERIFIED |
| `ecosystem.config.cjs` | PM2 process definition for production | Yes | Yes — `name: 'tax-assistant-api'`, `interpreter: 'tsx'`, `max_memory_restart: '256M'`, log file paths | Yes — used by `pm2 start ecosystem.config.cjs --env production` | VERIFIED |
| `.env.example` | Documentation of all required env vars | Yes | Yes — `GEMINI_API_KEY`, `PORT`, `NODE_ENV`, `APP_URL` documented with comments | Yes — `.gitignore` explicitly allows this file via `!.env.example` | VERIFIED |

---

### Key Link Verification

| From | To | Via | Status | Detail |
|------|----|-----|--------|--------|
| `src/App.tsx` | `/api/chat` | `fetch('/api/chat')` + ReadableStream | WIRED | Line 176: `const response = await fetch('/api/chat', {...})`; SSE loop appends to message state |
| `server/routes/chat.ts` | GoogleGenAI | `ai.chats.create().sendMessageStream()` | WIRED | Line 57–63: `ai.chats.create({...}).sendMessageStream({message})` with async iteration |
| `server/index.ts` | `server/routes/chat.ts` | `app.use('/api', chatRouter)` | WIRED | Line 4: import; line 68: `app.use('/api', chatRouter)` |
| `server/index.ts` | `server/routes/upload.ts` | `app.use('/api', uploadRouter)` | WIRED | Line 5: import; line 69: `app.use('/api', uploadRouter)` |
| `vite.config.ts` | Express :4001 | `server.proxy /api -> http://localhost:4001` | WIRED | Lines 17–22: proxy block confirmed, no path rewrite |
| `server/routes/upload.ts` | multer | `upload.single('file')` middleware | WIRED | Line 37: `upload.single('file')(req, res, (err) => ...)` |
| `ecosystem.config.cjs` | `server/index.ts` | PM2 `script: 'server/index.ts'`, `interpreter: 'tsx'` | WIRED | Lines 13–14 confirmed |
| `server/index.ts` | `server/middleware/validation.ts` | imported in `server/routes/chat.ts` | WIRED | `validateChatRequest` called at line 41 of `chat.ts` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BACK-01 | 01-02, 01-04 | Express server proxies all Gemini API calls — API key never reaches client bundle | SATISFIED | `GEMINI_API_KEY` read only in `server/routes/chat.ts` from `process.env`; zero matches in `src/` and `dist/`; GoogleGenAI SDK absent from client bundle |
| BACK-02 | 01-01, 01-04 | Server applies CORS, Helmet (CSP + frame-ancestors), and rate limiting on all /api/* routes | SATISFIED | `server/index.ts`: `helmet()` with CSP + `frameAncestors`, `cors()` with origin allowlist, `rateLimit` scoped to `app.use('/api', limiter)` — all three applied before routes |
| BACK-03 | 01-03, 01-04 | Server accepts PDF/image uploads via multer with 10MB size limit and MIME type validation | SATISFIED | `server/routes/upload.ts`: `multer.memoryStorage()`, `limits: {fileSize: 10*1024*1024}`, MIME allowlist of 5 types, error handler maps `LIMIT_FILE_SIZE` and `INVALID_MIME_TYPE` to 400 |
| BACK-04 | 01-03, 01-04 | Vite dev server proxies /api/* to Express; production Express serves built Vite assets | SATISFIED | `vite.config.ts` proxy confirmed; `server/index.ts` production block: `express.static(distPath)` + SPA fallback `app.get('*')` |

All four requirements for Phase 1 are satisfied. No orphaned requirements detected — REQUIREMENTS.md maps BACK-01 through BACK-04 exclusively to Phase 1, and all four are claimed by the plans in this phase.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `server/routes/upload.ts` | 48–63 | Comment: "placeholder summary" / "Full document AI analysis coming in Phase 5" | Info | Expected and intentional — BACK-03 only requires acceptance and validation, not Gemini Files API integration (that is DOC-01 through DOC-04 in Phase 5). The validation and MIME/size enforcement logic is real and substantive. |

No blockers or warnings found. The upload "placeholder summary" is a deliberate Phase 5 deferral, not a stub of BACK-03 functionality — the actual MIME type validation, 10MB enforcement, and error mapping are all fully implemented.

---

### Human Verification Required

The following items pass all automated checks but require human confirmation:

#### 1. SSE Streaming Works in Browser

**Test:** Run `npm run dev`, open http://localhost:3000, type "What is the standard deduction for FY 2025-26?"
**Expected:** Words appear progressively in the chat UI (not as a single block after a delay); response completes naturally; browser DevTools Network tab shows the /api/chat request using `text/event-stream` content type
**Why human:** Streaming visual behaviour, SSE connection lifetime, and incremental UI updates cannot be verified by static code analysis

#### 2. UI Regression Check

**Test:** Toggle dark/light mode; open http://localhost:3000/?plugin=true to test plugin mode
**Expected:** Dark/light toggle switches theme correctly; plugin mode hides sidebar and resource links; no JavaScript errors in console
**Why human:** Layout behaviour and CSS class application require visual inspection

#### 3. Upload Endpoint Accessible via Dev Proxy

**Test:** `curl -s -X POST http://localhost:3000/api/upload -F "file=@some.pdf;type=application/pdf"` and `curl -s -X POST http://localhost:3000/api/upload -F "file=@test.txt;type=text/plain"`
**Expected:** PDF returns HTTP 200 `{success:true,...}`; text file returns HTTP 400 `{error:"Invalid file type..."}`
**Why human:** Confirming the Vite proxy correctly forwards multipart/form-data through to Express requires a running dev environment

#### 4. Fresh Bundle Security Check

**Test:** `npm run build && grep -r "GEMINI_API_KEY" dist/`
**Expected:** Zero matches
**Why human:** `dist/` exists from a prior build and the grep already passes, but confirming on a freshly produced bundle rules out any cached artifact and provides a definitive security confirmation

---

### Summary

Phase 1 automated verification passes on all five roadmap success criteria and all four requirements (BACK-01 through BACK-04).

**Security goal achieved:** `GEMINI_API_KEY` is absent from `src/`, absent from `dist/`, absent from `vite.config.ts`, and absent from `ecosystem.config.cjs`. It exists only in `server/routes/chat.ts` as `process.env.GEMINI_API_KEY` and in `.env.example` as documentation — both correct locations.

**Wiring is complete:** All seven key links verified. Both routers are imported and mounted. The Vite proxy is correctly configured. The client SSE consumer is wired to the server endpoint.

**Four human items remain** — all are runtime/visual confirmations of behaviour that the static analysis already shows is correctly implemented. None are expected to reveal gaps; they are the standard human gate required before marking a security-sensitive phase complete.

---

_Verified: 2026-04-04_
_Verifier: Claude (gsd-verifier)_
