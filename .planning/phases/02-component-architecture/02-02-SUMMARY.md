---
phase: 02-component-architecture
plan: 02
subsystem: ui
tags: [react, hooks, typescript, dark-mode, localStorage, URLSearchParams, streaming]

# Dependency graph
requires:
  - phase: 02-01
    provides: "Message type from types/index.ts, sendChatMessage from services/api.ts"
provides:
  - useTheme hook with localStorage-backed dark mode state and toggleTheme function
  - usePluginMode hook with URL search param detection via useMemo
  - useChat hook orchestrating full chat state, streaming integration with sendChatMessage
affects: [02-03, 02-04, 02-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Custom hooks as business logic containers; components become pure renderers
    - Lazy useState initializer for synchronous localStorage reads on mount
    - Functional updater form for all setMessages calls (required for streaming correctness)
    - useMemo with empty deps array for URL param detection (computed once, never stale)

key-files:
  created:
    - src/hooks/useTheme.ts
    - src/hooks/usePluginMode.ts
    - src/hooks/useChat.ts
  modified: []

key-decisions:
  - "clearChat does not prompt window.confirm — confirmation logic is UI concern, belongs in the component calling clearChat"
  - "chatContainerRef excluded from useChat — it was dead code in App.tsx (assigned but never read)"
  - "send() captures messages state snapshot at call time for history; functional updaters used for all appends to avoid stale closure issues during streaming"

patterns-established:
  - "Hook return shapes match plan-documented API exactly: { isDarkMode, toggleTheme }, { isPluginMode }, { messages, input, setInput, isLoading, messagesEndRef, send, clearChat }"
  - "All streaming state updates use functional updater form — prevents stale closure race conditions during rapid chunk delivery"

requirements-completed: [ARCH-02]

# Metrics
duration: 8min
completed: 2026-04-04
---

# Phase 2 Plan 02: Custom Hooks Extraction Summary

**Three React hooks extracted from App.tsx monolith: useTheme (localStorage dark mode), usePluginMode (URL param detection), useChat (full streaming chat orchestration with functional updaters)**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-04T06:57:28Z
- **Completed:** 2026-04-04T07:05:00Z
- **Tasks:** 2
- **Files modified:** 3 created

## Accomplishments
- useTheme hook with lazy localStorage initializer, prefers-color-scheme fallback, and dark class sync effect
- usePluginMode hook computing isPluginMode once via useMemo with empty deps, SSR-guarded
- useChat hook encapsulating all chat business logic: message state, streaming via sendChatMessage, functional updater pattern throughout, clearChat

## Task Commits

Each task was committed atomically:

1. **Task 1: useTheme and usePluginMode hooks** - `ef0b905` (feat)
2. **Task 2: useChat hook** - `2c7a7d9` (feat)

**Plan metadata:** (to be added in final commit)

## Files Created/Modified
- `src/hooks/useTheme.ts` - Dark mode state with lazy init from localStorage, effect syncing dark class
- `src/hooks/usePluginMode.ts` - Plugin mode detection from URLSearchParams.get('plugin') via useMemo
- `src/hooks/useChat.ts` - Full chat orchestration: messages, input, isLoading, send, clearChat, messagesEndRef

## Decisions Made
- `clearChat` does not call `window.confirm` — the confirmation dialog is UI behavior; the hook simply resets state. Components decide whether to prompt.
- `chatContainerRef` was excluded as dead code (present in App.tsx but never read, only assigned).
- `send()` captures the `messages` value at call time for the history parameter to `sendChatMessage`, which is the correct snapshot before the new user message is appended.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three hooks are ready for import in Plan 02-03 (component extraction)
- App.tsx can now replace its inline state/logic with `useTheme()`, `usePluginMode()`, and `useChat()` calls
- No blockers

---
*Phase: 02-component-architecture*
*Completed: 2026-04-04*
