---
phase: 01-express-backend-api-key-migration
plan: "04"
subsystem: infra
tags: [pm2, apache, deploy, ecosystem, vite, express]

# Dependency graph
requires:
  - phase: 01-express-backend-api-key-migration
    provides: Express server with /api/chat SSE, /api/upload multer, Vite proxy, GEMINI_API_KEY removed from client bundle
provides:
  - PM2 ecosystem config for production process management via tsx
  - .env.example documenting all required environment variables
  - DEPLOY.md with Apache VirtualHost and SSE buffering config for aaPanel
  - .gitignore updated with logs/ entry for PM2 log files
  - Phase 1 security goal confirmed: npm run build + grep produces zero GEMINI_API_KEY matches in dist/
affects:
  - production-deploy
  - phase-02-architecture-refactor

# Tech tracking
tech-stack:
  added: [pm2, ecosystem.config.cjs]
  patterns: [PM2 with tsx interpreter for TypeScript production, Apache ProxyPass for /api/* only, SSE buffering disabled via ProxyBufferSize]

key-files:
  created:
    - ecosystem.config.cjs
    - DEPLOY.md
  modified:
    - .env.example
    - .gitignore

key-decisions:
  - "ecosystem.config.cjs uses .cjs extension because PM2 uses CommonJS require() to load ecosystem files even in ESM projects"
  - "GEMINI_API_KEY excluded from ecosystem.config.cjs — must be set in server .env only"
  - "Apache proxies only /api/* to Express; all other paths served statically from dist/"
  - "SSE buffering disabled via ProxyBufferSize 4096 so /api/chat streaming works in production"

patterns-established:
  - "PM2 pattern: tsx interpreter + script: server/index.ts for TypeScript without compile step"
  - "Apache pattern: selective ProxyPass for API routes only, static files via DocumentRoot dist/"

requirements-completed: [BACK-01, BACK-02, BACK-03, BACK-04]

# Metrics
duration: 10min
completed: 2026-04-04
---

# Phase 1 Plan 4: Production Deploy Config Summary

**PM2 ecosystem.config.cjs with tsx interpreter, Apache VirtualHost SSE config, and bundle security confirmed — grep dist/ returns zero GEMINI_API_KEY matches**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-04T08:10:07Z
- **Completed:** 2026-04-04T08:20:00Z
- **Tasks:** 1 of 2 completed (Task 2 is a human-verify checkpoint, pending)
- **Files modified:** 4

## Accomplishments
- Created ecosystem.config.cjs with PM2 process definition using tsx interpreter, 256M memory limit, and production env vars
- Updated .env.example to document all four required variables: GEMINI_API_KEY, PORT, NODE_ENV, APP_URL
- Added logs/ to .gitignore so PM2 log files are never committed
- Created DEPLOY.md with Apache VirtualHost config including SSE buffering disable for /api/chat
- Confirmed Phase 1 primary security goal: `npm run build && grep -r "GEMINI_API_KEY" dist/` returns zero matches

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ecosystem.config.cjs, update .env.example and .gitignore** - `77262ac` (chore)

**Plan metadata:** (pending — will be committed after human verification)

## Files Created/Modified
- `ecosystem.config.cjs` - PM2 process definition: tax-assistant-api, tsx interpreter, production env, 256M memory limit, log file paths
- `DEPLOY.md` - Apache VirtualHost snippet with ProxyPass /api, SSE buffering config, DocumentRoot for dist/
- `.env.example` - Documents GEMINI_API_KEY, PORT, NODE_ENV, APP_URL with comments
- `.gitignore` - Added `logs/` entry for PM2 log files

## Decisions Made
- ecosystem.config.cjs uses .cjs extension (PM2 requires CommonJS even in ESM projects)
- GEMINI_API_KEY intentionally absent from ecosystem.config.cjs — must be in .env only
- Apache ProxyPass scoped to /api/* only, not a blanket proxy, keeping static file serving fast via Apache DocumentRoot

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None — build completed cleanly. Bundle security check confirmed zero GEMINI_API_KEY matches in dist/.

## User Setup Required

None beyond the manual verification steps in Task 2 (human-verify checkpoint).

## Next Phase Readiness
- Phase 1 automated work complete; awaiting human end-to-end verification (Task 2 checkpoint)
- Once approved: Phase 2 architecture refactor can begin
- ecosystem.config.cjs ready for production deploy to aaPanel once human confirms dev environment works

---
*Phase: 01-express-backend-api-key-migration*
*Completed: 2026-04-04*
