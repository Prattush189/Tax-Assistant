# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-04)

**Core value:** Users get accurate, visual, step-by-step answers to Indian tax questions — from simple queries to complex calculations with document analysis.
**Current focus:** Phase 2 — Component Architecture

## Current Position

Phase: 2 of 6 (Component Architecture)
Plan: 3 of 5 in current phase (02-03 complete)
Status: In progress — 02-03 complete, ready for 02-04
Last activity: 2026-04-04 — Plan 02-03 complete: src/components/chat/ChartRenderer.tsx, ChatInput.tsx, MessageBubble.tsx, ChatView.tsx created

Progress: [███████░░░] 30% (phase 1 done, phase 2 plans 1-3 of 5 complete)

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
| Phase 02-component-architecture P02 | 8 | 2 tasks | 3 files |

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
- [Phase 01-04]: ecosystem.config.cjs uses .cjs extension because PM2 uses CommonJS require() even in ESM projects
- [Phase 01-04]: GEMINI_API_KEY excluded from ecosystem.config.cjs — must be in server .env only
- [Phase 01-04]: Apache ProxyPass scoped to /api/* only; static files served via DocumentRoot dist/
- [Phase 02-01]: api.ts uses callbacks (onChunk/onError) rather than React state — service layer stays framework-agnostic
- [Phase 02-01]: SSE buffer accumulation (decoder stream:true + lines.pop()) copied verbatim from App.tsx — must not be simplified
- [Phase 02-01]: HistoryItem conversion placed in api.ts — server API contract knowledge belongs in service layer
- [Phase 02-02]: clearChat excludes window.confirm — confirmation is UI concern, hook simply resets state
- [Phase 02-02]: chatContainerRef excluded from useChat — dead code in App.tsx (assigned but never read)
- [Phase 02-03]: ChatView owns useChat() call internally — chat state does not flow through props from App.tsx, keeping concerns separated
- [Phase 02-03]: renderContent kept as unexported local function in MessageBubble — implementation detail, not a public API
- [Phase 02-03]: Quick query buttons in empty state call setInput only (no immediate send) — matches App.tsx chat area behavior
- [Phase 02-03]: COLORS constant kept local to ChartRenderer — chart-specific palette does not belong in shared module

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 3: FY 2025-26 tax slab values and 87A rebate threshold need verification against Finance Act 2025 before coding constants (MEDIUM confidence)
- Phase 5: Gemini Files API behavior for password-protected Form 16 PDFs (TRACES format) is LOW confidence — test before planning tasks
- Phase 6: Smart Assist postMessage contract (origin domain, event types, data shapes) not yet confirmed with Smart Assist team — gate Phase 6 planning on this input

## Session Continuity

Last session: 2026-04-04
Stopped at: Completed 02-03-PLAN.md — all tasks done, ready for 02-04
Resume file: .planning/phases/02-component-architecture/02-04-PLAN.md
