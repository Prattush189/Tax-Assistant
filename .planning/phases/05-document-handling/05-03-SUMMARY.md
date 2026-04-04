---
phase: 05-document-handling
plan: 03
subsystem: api
tags: [react, typescript, hooks, document-context, file-upload, sse]

# Dependency graph
requires:
  - phase: 05-01
    provides: uploadFile endpoint returning fileUri + extractedData; DocumentContext and UploadResponse types
  - phase: 05-02
    provides: chat route accepting fileContext and injecting it into Gemini messageParts
provides:
  - sendChatMessage with optional fileContext param forwarded to /api/chat request body
  - useChat hook exposing activeDocument state, attachDocument(), detachDocument()
  - fileContext derived from activeDocument passed to every sendChatMessage call when document is active
  - clearChat clears activeDocument alongside messages and input
affects: [05-04-DocumentsView, ChatView]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - ephemeral-document-state: activeDocument held in React useState only, never persisted (DOC-04)
    - fileContext-forwarding: useChat derives { uri, mimeType } from activeDocument and passes to api.ts layer

key-files:
  created: []
  modified:
    - src/services/api.ts
    - src/hooks/useChat.ts

key-decisions:
  - "activeDocument stored in React useState only — never written to localStorage or sessionStorage (DOC-04 requirement)"
  - "fileContext param on sendChatMessage uses separate { uri, mimeType } shape (not DocumentContext) to keep service layer framework-agnostic"
  - "DocumentContext import added to api.ts for type path clarity — not re-exported, types imported directly from types/index.ts"

patterns-established:
  - "Service layer accepts primitive shape { uri, mimeType } — React types (DocumentContext) not leaked into api.ts"
  - "clearChat resets all ephemeral state including document context"

requirements-completed: [DOC-02, DOC-04]

# Metrics
duration: 8min
completed: 2026-04-04
---

# Phase 5 Plan 03: Document Handling — Client Service Layer Summary

**sendChatMessage extended with optional fileContext param; useChat gains ephemeral activeDocument state with attach/detach, forwarding document URI to every chat API call**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-04T12:11:04Z
- **Completed:** 2026-04-04T12:19:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extended sendChatMessage in api.ts with optional 5th parameter fileContext forwarded in fetch body JSON
- Added activeDocument React state (ephemeral, never persisted) to useChat with attachDocument/detachDocument helpers
- Wired send() to derive fileContext from activeDocument and pass it as 5th argument to sendChatMessage
- clearChat now resets activeDocument to null alongside messages and input (DOC-04 compliance)
- DocumentContext imported in api.ts for type path clarity

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend src/services/api.ts with fileContext support** - `f86ddb7` (feat)
2. **Task 2: Extend useChat.ts with activeDocument state and attach/detach functions** - `7e09094` (feat)

**Plan metadata:** `(pending)` (docs: complete plan)

## Files Created/Modified
- `src/services/api.ts` - Added optional fileContext param to sendChatMessage, passes it in fetch body; added DocumentContext import
- `src/hooks/useChat.ts` - Added activeDocument state, attachDocument(), detachDocument(); send() forwards fileContext; clearChat clears document

## Decisions Made
- activeDocument stored in React useState only — never written to localStorage or sessionStorage (DOC-04 requirement enforced)
- fileContext param shape is { uri: string; mimeType: string } rather than DocumentContext — keeps service layer framework-agnostic per Phase 02-01 pattern
- DocumentContext import added to api.ts purely for type path clarity; no re-export needed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## Self-Check: PASSED
- src/services/api.ts: FOUND
- src/hooks/useChat.ts: FOUND
- 05-03-SUMMARY.md: FOUND
- Commit f86ddb7: FOUND
- Commit 7e09094: FOUND

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Client service layer complete: api.ts and useChat.ts now carry document context end-to-end
- Plan 05-04 (DocumentsView UI) can now call attachDocument() from useChat to connect the upload flow to chat
- DOC-02 client side satisfied: fileContext flows from React state through api.ts to /api/chat body
- DOC-04 satisfied: activeDocument is React state only, cleared on clearChat, never persisted

---
*Phase: 05-document-handling*
*Completed: 2026-04-04*
