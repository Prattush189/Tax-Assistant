---
phase: 01-express-backend-api-key-migration
plan: "02"
subsystem: backend-api
tags: [sse, streaming, gemini, security, api-key-migration]
dependency_graph:
  requires: ["01-01"]
  provides: ["POST /api/chat SSE endpoint", "client SSE consumer"]
  affects: ["src/App.tsx", "server/routes/chat.ts", "server/index.ts"]
tech_stack:
  added: []
  patterns: ["SSE streaming", "ReadableStream reader", "fetch-based API calls"]
key_files:
  created:
    - server/routes/chat.ts
  modified:
    - src/App.tsx
    - server/index.ts
decisions:
  - "Model gemini-2.0-flash used in server route (plan specified this; App.tsx had gemini-3.1-pro-preview which is not a valid model)"
  - "Placeholder model message added to state before streaming begins so words appear progressively"
  - "HTTP error body parsed for rate-limit (429) message display to user"
metrics:
  duration: "3 minutes"
  completed: "2026-04-04"
  tasks_completed: 2
  files_modified: 3
---

# Phase 1 Plan 02: SSE Chat Endpoint and Client Migration Summary

**One-liner:** POST /api/chat SSE streaming endpoint with Gemini sendMessageStream; App.tsx migrated to fetch + ReadableStream consumer with zero client-side API key exposure.

## What Was Built

### server/routes/chat.ts
- Express Router exposing `POST /chat`
- Reads `GEMINI_API_KEY` from `process.env` only (never touches client bundle)
- SYSTEM_INSTRUCTION moved here from App.tsx — single authoritative copy on the server
- SSE headers set including `X-Accel-Buffering: no` for production proxy compatibility
- Uses `ai.chats.create({ model: 'gemini-2.0-flash', ... }).sendMessageStream()` for streaming
- Each chunk written as `data: {"text":"..."}\n\n`; stream terminates with `data: [DONE]\n\n`
- Gemini API errors caught and returned as friendly JSON error event — no stack traces exposed
- `validateChatRequest` from middleware enforces empty/oversized message rules (400 response)

### server/index.ts
- Import for `chatRouter` added at top
- `app.use('/api', chatRouter)` registered after body-parser middleware
- TODO comments for Plan 03 preserved

### src/App.tsx
- `GoogleGenAI` import removed
- `ai = new GoogleGenAI(...)` instantiation removed
- `SYSTEM_INSTRUCTION` constant removed (moved to server)
- `COLORS` constant retained (still used by ChartRenderer)
- `handleSend` body replaced with fetch + ReadableStream SSE consumer
- Placeholder model message appended to state before fetch so UI shows typing indicator immediately
- SSE chunks appended to last model message via `setMessages` functional update
- HTTP errors (including 429 rate limit) parsed and displayed as friendly error in model message
- All UI components unchanged: ChartRenderer, dark mode, plugin mode, sidebar, animations

## Verification Results

| Check | Result |
|-------|--------|
| No GoogleGenAI in src/ | PASS |
| No GEMINI_API_KEY in src/ | PASS |
| SYSTEM_INSTRUCTION only in server/routes/chat.ts | PASS |
| fetch('/api/chat') present in App.tsx | PASS |
| sendMessageStream in server/routes/chat.ts | PASS |
| TypeScript (server tsconfig) | No errors |
| TypeScript (root tsconfig) | No errors |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Model message placeholder added before streaming**
- **Found during:** Task 2
- **Issue:** Plan's code snippet showed `setMessages` calls inside SSE loop to append chunks, but no initial placeholder was added — this would cause the functional update `lastMsg.role === 'model'` check to fail on first chunk (no model message in array yet)
- **Fix:** Added a placeholder model message with empty content immediately after setting isLoading=true, before the fetch call begins; chunks then append to it correctly
- **Files modified:** src/App.tsx
- **Commit:** da88a06

**2. [Rule 1 - Bug] HTTP error body read before discarding response**
- **Found during:** Task 2
- **Issue:** Plan's `if (!response.ok)` block threw a generic error, but the rate limiter and validation middleware return structured JSON error bodies (per CONTEXT.md). User would see a generic message instead of the descriptive rate-limit message.
- **Fix:** Parse the response JSON body when `!response.ok` to extract `error` field; fall back to generic message if parse fails. Sets error text directly in placeholder model message.
- **Files modified:** src/App.tsx
- **Commit:** da88a06

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1 | e497ec9 | feat(01-02): create POST /api/chat SSE streaming endpoint |
| Task 2 | da88a06 | feat(01-02): migrate App.tsx from GoogleGenAI SDK to fetch /api/chat SSE |

## Self-Check: PASSED

- server/routes/chat.ts: FOUND
- src/App.tsx: FOUND
- server/index.ts: FOUND
- 01-02-SUMMARY.md: FOUND
- Commit e497ec9: FOUND
- Commit da88a06: FOUND
