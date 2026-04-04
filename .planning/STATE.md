# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-04)

**Core value:** Users get accurate, visual, step-by-step answers to Indian tax questions — from simple queries to complex calculations with document analysis.
**Current focus:** Phase 1 — Express Backend + API Key Migration

## Current Position

Phase: 1 of 6 (Express Backend + API Key Migration)
Plan: 3 of 4 in current phase
Status: In progress
Last activity: 2026-04-04 — Plan 01-03 complete: upload endpoint with multer + Vite proxy + GEMINI_API_KEY removed from bundle

Progress: [███░░░░░░░] 12% (3/4 plans in phase 1)

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01-express-backend-api-key-migration P03 | 2 | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: Express backend before any feature work — API key must leave client bundle first
- Roadmap: Architecture refactor (Phase 2) before new features — prevents monolith from becoming unmanageable
- Roadmap: Tax calculator (Phase 3) is client-side only — no new backend dependencies needed
- Roadmap: Dashboard (Phase 4) builds on stable calculator output — charts with real data only
- 01-01: Port 4001 chosen to avoid common port conflicts on shared hosting (MySQL :3306, dev :3000/:4000, Nginx :8080)
- 01-01: server/tsconfig.json uses Node16 moduleResolution; root tsconfig preserved for Vite (bundler resolution)
- 01-01: CSP frameAncestors wildcard initially; tighten to specific embedding domain in Phase 6
- [Phase 01-03]: multer memoryStorage chosen so Phase 5 can forward buffer directly to Gemini Files API without disk temp files
- [Phase 01-03]: vite.config.ts converted to plain object after removing define block - loadEnv no longer needed since no client env vars remain
- [Phase 01-03]: concurrently --kill-others-on-fail used so dev environment fails fast if either Vite or Express crashes

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 3: FY 2025-26 tax slab values and 87A rebate threshold need verification against Finance Act 2025 before coding constants (MEDIUM confidence)
- Phase 5: Gemini Files API behavior for password-protected Form 16 PDFs (TRACES format) is LOW confidence — test before planning tasks
- Phase 6: Smart Assist postMessage contract (origin domain, event types, data shapes) not yet confirmed with Smart Assist team — gate Phase 6 planning on this input

## Session Continuity

Last session: 2026-04-04
Stopped at: Completed 01-03-PLAN.md
Resume file: .planning/phases/01-express-backend-api-key-migration/01-04-PLAN.md
