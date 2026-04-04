---
phase: 05-document-handling
plan: 02
subsystem: api
tags: [gemini, files-api, sse, streaming, chat, document-qa]

# Dependency graph
requires:
  - phase: 01-express-backend-api-key-migration
    provides: chat route with SSE streaming and history support
provides:
  - server/routes/chat.ts extended to accept optional fileContext payload
  - createPartFromUri injection into current user message parts (not history)
  - Expired file URI detection returning user-friendly error message
affects: [05-03-document-handling, 05-04-document-handling, useChat hook extension]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "messageParts array pattern: build Part[] array, conditionally prepend file part, always append text part"
    - "Expired URI detection: check errMsg for '404' or 'file not found' before choosing client error message"

key-files:
  created: []
  modified:
    - server/routes/chat.ts

key-decisions:
  - "Use SDK Part type (imported from @google/genai) for messageParts array — avoids type incompatibility with FileData.fileUri being optional in SDK types"
  - "File part injected only into current message parts, not into chat history reconstruction — prevents sending same PDF reference N times per multi-turn conversation"
  - "Expired URI detection checks both '404' string and 'file not found' (case-insensitive) — covers both HTTP status codes and Gemini error text variants"

patterns-established:
  - "Pattern: Chat fileContext injection — pass createPartFromUri result as first element in messageParts[] when fileContext.uri and fileContext.mimeType are present"

requirements-completed: [DOC-02]

# Metrics
duration: 2min
completed: 2026-04-04
---

# Phase 5 Plan 02: Chat Route fileContext Injection Summary

**Server chat route extended to accept optional fileContext payload, injecting Gemini Files API URI as a Part into the current user message for document-aware Q&A**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-04T12:06:02Z
- **Completed:** 2026-04-04T12:08:13Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Extended `POST /api/chat` to accept optional `fileContext: { uri, mimeType }` in request body
- `createPartFromUri` part prepended to current message only — history reconstruction untouched, preventing duplicate PDF references
- Expired file URI detection in catch block returns specific user-friendly message rather than generic error

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend server/routes/chat.ts with optional fileContext injection** - `ac0ad5b` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified
- `server/routes/chat.ts` - Added createPartFromUri + Part imports, fileContext destructuring, messageParts array construction, expired URI error detection

## Decisions Made
- Used the SDK's own `Part` type for the `messageParts` array rather than the inline type specified in the plan — the plan's inline type `{ text?: string; fileData?: { fileUri: string; mimeType: string } }` conflicts with the SDK's `FileData` interface where `fileUri` is optional, causing a TS2345 error. Importing `Part` from `@google/genai` resolves this cleanly.
- Expired URI detection pattern kept narrow (404 + "file not found") to avoid misclassifying unrelated errors as document expiry.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript type mismatch in messageParts array**
- **Found during:** Task 1 (TypeScript compile check)
- **Issue:** Plan specified inline type `{ text?: string; fileData?: { fileUri: string; mimeType: string } }` but SDK's `FileData` interface has `fileUri?: string` (optional), making the inline type incompatible with `Part` returned by `createPartFromUri`
- **Fix:** Imported `Part` type from `@google/genai` and used `Part[]` as the array type — correct match for `createPartFromUri` return type
- **Files modified:** server/routes/chat.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors after fix
- **Committed in:** ac0ad5b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 type bug)
**Impact on plan:** Type fix required for correctness. No scope creep — same logic, correct type annotation.

## Issues Encountered
- Plan's inline Part type conflicted with SDK's FileData interface (optional vs required `fileUri`). Resolved by importing the canonical `Part` type from `@google/genai`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Server chat route is now document-aware: clients can send `fileContext: { uri, mimeType }` and the file will be injected as a Part into the current message
- DOC-02 server side is complete — ready for Plan 03 (client-side `useChat` extension with `activeDocument` state) and Plan 04 (DocumentsView UI)
- Expired URI handling is in place: if a stale file URI is passed, the client receives "The uploaded document has expired. Please upload it again to continue document Q&A."

---
*Phase: 05-document-handling*
*Completed: 2026-04-04*
