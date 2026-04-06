---
phase: 06-iframe-plugin-mode-hardening
plan: 01
subsystem: infra
tags: [postMessage, iframe, ResizeObserver, CSP, helmet, react-hooks]

# Dependency graph
requires:
  - phase: 02-component-architecture
    provides: useTheme and usePluginMode hooks as foundation to extend
  - phase: 01-express-backend-api-key-migration
    provides: server/index.ts with helmet CSP setup to tighten

provides:
  - useTheme exposes setIsDarkMode setter for external theme control
  - usePluginMode sends TAX_ASSISTANT_READY on mount and TAX_ASSISTANT_HEIGHT on every body resize
  - usePluginMode validates inbound postMessage origins against ALLOWED_ORIGINS allowlist
  - usePluginMode applies theme updates from parent via onSetTheme callback
  - server CSP frame-ancestors is env-conditional — no wildcard in production

affects:
  - 06-02-PLAN (PLUG-03 plugin-mode UI constraints use the same isPluginMode value)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - ResizeObserver on document.body to push height to parent frame
    - ALLOWED_ORIGINS array with .includes() for strict origin equality — no wildcard
    - TAX_ASSISTANT_READY sent before ResizeObserver fires so parent listener is ready
    - Env-conditional CSP frameAncestors (production vs dev localhost)
    - useState setter passed as callback into hook — stable identity avoids useCallback wrapper

key-files:
  created: []
  modified:
    - src/hooks/useTheme.ts
    - src/hooks/usePluginMode.ts
    - src/App.tsx
    - server/index.ts

key-decisions:
  - "usePluginMode accepts onSetTheme? callback rather than importing useTheme internally — avoids dual theme state and keeps hook composable"
  - "TAX_ASSISTANT_READY sent immediately before ResizeObserver fires — parent can register listener before height messages begin"
  - "ALLOWED_ORIGINS is an array literal with .includes() — explicit per-origin equality, no substring/glob matching"
  - "postMessage targetOrigin is always PARENT_ORIGIN constant, never '*' — prevents any embedding page from intercepting height messages"
  - "frameAncestors is env-conditional: production locks to ai.smartbizin.com; dev allows localhost:3000 and localhost:5173"

patterns-established:
  - "Plugin postMessage: always use exact PARENT_ORIGIN string as postMessage second argument"
  - "Origin validation: ALLOWED_ORIGINS.includes(event.origin) guard before any message handling action"
  - "Hook composition: pass React setState setter directly as callback — identity is stable, no useCallback wrapping needed"

requirements-completed: [PLUG-01, PLUG-02, PLUG-04]

# Metrics
duration: 2min
completed: 2026-04-04
---

# Phase 6 Plan 01: postMessage Infrastructure Summary

**ResizeObserver height reporter, origin-validated inbound message handler, and theme sync wired into usePluginMode; server CSP frame-ancestors locked to production Smart Assist origin only**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-04T07:26:26Z
- **Completed:** 2026-04-04T07:28:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- useTheme now exposes `setIsDarkMode` in its return so callers can drive theme externally
- usePluginMode sends TAX_ASSISTANT_READY on mount and TAX_ASSISTANT_HEIGHT via ResizeObserver on every body height change (PLUG-01)
- usePluginMode validates postMessage origin against ALLOWED_ORIGINS before applying any action (PLUG-02) and calls onSetTheme for SET_THEME messages (PLUG-04)
- server CSP frame-ancestors removed wildcard; production restricts to `https://ai.smartbizin.com`, dev allows localhost variants

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend useTheme + usePluginMode with ResizeObserver, origin validator, and theme sync; wire App.tsx** - `5bc4192` (feat)
2. **Task 2: Tighten server CSP frame-ancestors from wildcard to exact origin allowlist** - `d7d528a` (fix)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/hooks/useTheme.ts` - Added `setIsDarkMode` to return object
- `src/hooks/usePluginMode.ts` - Rewritten with ResizeObserver effect, origin-validated message listener, onSetTheme callback param
- `src/App.tsx` - Destructures setIsDarkMode from useTheme; passes it to usePluginMode(setIsDarkMode)
- `server/index.ts` - frameAncestors changed from `['self', '*']` to env-conditional with production Smart Assist origin

## Decisions Made
- usePluginMode accepts `onSetTheme?` as a parameter rather than calling useTheme internally — single source of truth for theme state lives in App.tsx, no duplicate useState
- TAX_ASSISTANT_READY posted before ResizeObserver observes — ensures parent frame can register listener before height messages arrive
- ALLOWED_ORIGINS is an array literal with `.includes()` — explicit string equality per origin, straightforward to extend
- postMessage always uses `PARENT_ORIGIN` constant as second argument — wildcard `'*'` never used anywhere
- frameAncestors env-conditional: tightening production only would break localhost iframe test pages; dev fallback covers both Vite (5173) and Express (3000)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The verification script in Task 2 used `!` in a bash string which caused a shell escape syntax error; verified manually via `grep` and file read instead. Result was correct — no wildcard in frameAncestors, ai.smartbizin.com present.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- PLUG-01, PLUG-02, PLUG-04 complete; postMessage infrastructure is production-grade
- 06-02-PLAN covers PLUG-03 (plugin-mode UI constraints — hiding sidebar, compact header) — can execute immediately
- No blockers

---
*Phase: 06-iframe-plugin-mode-hardening*
*Completed: 2026-04-04*

## Self-Check: PASSED

All files verified present on disk. Both task commits (5bc4192, d7d528a) confirmed in git log.
