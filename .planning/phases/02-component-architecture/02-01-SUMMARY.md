---
phase: 02-component-architecture
plan: 01
subsystem: api
tags: [typescript, clsx, tailwind-merge, fetch, SSE, types]

# Dependency graph
requires:
  - phase: 01-express-backend-api-key-migration
    provides: /api/chat SSE endpoint and /api/upload endpoint that api.ts wraps

provides:
  - src/types/index.ts — Message, UploadResponse, HistoryItem interfaces
  - src/lib/utils.ts — cn() class composition utility
  - src/services/api.ts — sendChatMessage() and uploadFile() encapsulating all /api/* fetch calls

affects:
  - 02-component-architecture (all subsequent plans import from these three modules)
  - 03-tax-calculator (will use Message type and cn() utility)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Centralized type definitions in src/types/index.ts — single import source for all components"
    - "cn() utility in src/lib/utils.ts — prevents clsx/twMerge duplication across components"
    - "Service layer pattern: api.ts wraps all fetch calls with callback interface (onChunk/onError)"

key-files:
  created:
    - src/types/index.ts
    - src/lib/utils.ts
    - src/services/api.ts
  modified: []

key-decisions:
  - "api.ts uses callbacks (onChunk/onError) rather than React state — keeps service layer framework-agnostic"
  - "SSE buffer accumulation logic (decoder stream:true + lines.pop()) copied verbatim from App.tsx — preserves battle-tested parsing behavior"
  - "HistoryItem conversion (Message[] to role+parts[] shape) placed in api.ts — API contract knowledge belongs in service layer, not components"

patterns-established:
  - "Single-file type exports: all shared interfaces in src/types/index.ts"
  - "Callback-based service functions: async functions accept onChunk/onError instead of using React state"
  - "SSE streaming pattern: buffer accumulator with decoder.decode(value, {stream:true}) and lines.pop() remainder"

requirements-completed: [ARCH-03]

# Metrics
duration: 8min
completed: 2026-04-04
---

# Phase 2 Plan 01: Foundation Modules Summary

**Three importable modules established — shared TypeScript interfaces (Message, UploadResponse, HistoryItem), cn() utility via clsx+tailwind-merge, and an SSE-capable API service layer encapsulating all /api/* fetch calls**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-04T08:53:26Z
- **Completed:** 2026-04-04T09:01:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created `src/types/index.ts` with Message, UploadResponse, and HistoryItem interfaces derived from App.tsx data shapes
- Created `src/lib/utils.ts` with cn() function using clsx + tailwind-merge (already in package.json)
- Created `src/services/api.ts` extracting /api/chat SSE stream logic and /api/upload FormData logic from App.tsx with callback-based interface

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared types module and cn() utility** - `66a88a8` (feat)
2. **Task 2: API service module** - `a50cf6c` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified
- `src/types/index.ts` - Message, UploadResponse, HistoryItem TypeScript interfaces
- `src/lib/utils.ts` - cn() class composition utility using clsx + tailwind-merge
- `src/services/api.ts` - sendChatMessage() with SSE streaming and uploadFile() with FormData

## Decisions Made
- api.ts uses callbacks (onChunk/onError) rather than React state — service layer stays framework-agnostic and testable in isolation
- SSE buffer accumulation logic copied verbatim from App.tsx — the `decoder.decode(value, { stream: true })` flag and `lines.pop() ?? ''` remainder pattern are battle-tested and must not be simplified
- History conversion from Message[] to HistoryItem[] (role + parts[{text}]) placed in api.ts — the server API contract knowledge belongs in the service layer

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — clsx and tailwind-merge were already present in package.json. TypeScript compiled with zero errors after both tasks.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All three foundation modules are ready for import by hooks and components in Plans 02-05
- App.tsx still has its own cn() definition and raw fetch calls — these will be removed during hook extraction (Plan 04) and component extraction (Plan 02)
- No blockers for continuing Phase 2

---
*Phase: 02-component-architecture*
*Completed: 2026-04-04*
