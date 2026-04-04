---
phase: 01-express-backend-api-key-migration
plan: 03
subsystem: api
tags: [multer, express, vite, file-upload, proxy, concurrently, security]

# Dependency graph
requires:
  - phase: 01-01
    provides: Express server with security middleware on :4001
provides:
  - POST /api/upload endpoint with multer memoryStorage, MIME validation, 10MB limit
  - vite.config.ts proxy forwarding /api/* to Express :4001
  - Single npm run dev command starts both Vite :3000 and Express :4001 via concurrently
  - GEMINI_API_KEY removed from Vite client bundle (Phase 1 primary security goal)
affects: [phase-5-document-analysis, any plan referencing upload endpoint or dev workflow]

# Tech tracking
tech-stack:
  added: [multer (memoryStorage), concurrently (dev script orchestration)]
  patterns: [multipart form upload with MIME allowlist and error mapping, Vite proxy to Express for unified dev URL]

key-files:
  created:
    - server/routes/upload.ts
  modified:
    - server/index.ts
    - vite.config.ts
    - package.json

key-decisions:
  - "multer memoryStorage chosen — files buffer in RAM and passed directly to Gemini Files API in Phase 5; no disk I/O"
  - "MIME allowlist (PDF, JPEG, PNG, WebP, HEIC) enforced server-side on fileFilter; client UI filters are advisory only"
  - "vite.config.ts converted from callback form to plain object — loadEnv and mode param removed entirely since no client env vars remain"
  - "concurrently --kill-others-on-fail ensures both processes die together if either crashes"

patterns-established:
  - "Route error handling: multer errors caught in router-level error handler, mapped to { error: string } JSON responses"
  - "Import convention: server routes use .js extension in import paths (ESM Node16 moduleResolution requirement)"

requirements-completed: [BACK-03, BACK-04]

# Metrics
duration: 2min
completed: 2026-04-04
---

# Phase 1 Plan 03: Upload Endpoint and Vite Bundle Security Summary

**multer memory-storage POST /api/upload with MIME/size validation, Vite proxy to Express, and GEMINI_API_KEY removed from client bundle**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-04T08:04:54Z
- **Completed:** 2026-04-04T08:07:17Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created POST /api/upload with multer memoryStorage — validates MIME type (PDF + 4 image formats) and rejects files over 10MB with friendly 400 error messages
- Registered uploadRouter in server/index.ts alongside chatRouter
- Removed GEMINI_API_KEY define block and loadEnv from vite.config.ts — key no longer injected into client bundle (Phase 1 primary security criterion)
- Added /api proxy in vite.config.ts so dev requests to Vite :3000/api/* forward transparently to Express :4001
- Replaced single-process dev script with concurrently-powered dual-process: [WEB] Vite :3000 + [API] Express :4001

## Task Commits

Each task was committed atomically:

1. **Task 1: Create server/routes/upload.ts and register in server/index.ts** - `6499eef` (feat)
2. **Task 2: Update vite.config.ts (proxy, remove define) and npm dev script** - `75470f4` (feat)

## Files Created/Modified
- `server/routes/upload.ts` - POST /api/upload with multer memoryStorage, MIME allowlist, 10MB limit, error handler
- `server/index.ts` - Added uploadRouter import and app.use('/api', uploadRouter)
- `vite.config.ts` - Removed define block + loadEnv, added server.proxy for /api/* -> :4001, simplified to plain object
- `package.json` - Updated dev script to use concurrently; added dev:web and dev:api individual scripts

## Decisions Made
- multer memoryStorage used so Phase 5 can forward buffer directly to Gemini Files API without disk temp files
- vite.config.ts converted from callback (mode) => {...} to plain object since no client env vars remain after removing the define block — cleaner and avoids the loadEnv call entirely
- concurrently --kill-others-on-fail flag ensures the dev environment doesn't silently half-die if one process crashes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- server/index.ts had already been updated by plan 02 execution (chatRouter was already imported and registered). The TODO comments for plan 03 were replaced with the actual uploadRouter registration cleanly.
- Pre-existing TypeScript errors in src/App.tsx (references to `ai` and `SYSTEM_INSTRUCTION` variables) are out of scope for this plan and deferred to plan 02 followup work.

## User Setup Required
None - no external service configuration required. The /api proxy and concurrently dev script work with the existing .env GEMINI_API_KEY (read server-side only).

## Next Phase Readiness
- POST /api/upload is ready for Phase 5 (DOC-01 through DOC-04) to extend with Gemini Files API integration
- GEMINI_API_KEY is server-side only — Phase 1 primary security criterion satisfied
- npm run dev starts both Vite and Express in one command — dev workflow is complete
- Phase 1 plan 04 (any remaining items) can proceed

---
*Phase: 01-express-backend-api-key-migration*
*Completed: 2026-04-04*
