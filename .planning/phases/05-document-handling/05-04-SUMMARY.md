---
phase: 05-document-handling
plan: 04
subsystem: ui
tags: [react, typescript, lucide-react, drag-and-drop, document-upload, gemini]

# Dependency graph
requires:
  - phase: 05-03
    provides: useChat activeDocument state with attachDocument/detachDocument; uploadFile service function in api.ts
  - phase: 05-02
    provides: server-side fileContext injection into chat route
  - phase: 05-01
    provides: upload route with Gemini Files API pipeline returning DocumentSummary

provides:
  - DocumentsView component with drag-and-drop upload zone and two-phase upload UX
  - DocumentCard component rendering all DocumentSummary fields with INR formatting
  - Documents tab wired in Header navigation
  - ChatInput green badge showing attached filename when activeDocument is set
  - Lifted useChat to App.tsx for single shared instance across DocumentsView and ChatView

affects: [phase-06-smart-assist-plugin]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lift shared hook to App shell — single useChat instance passed as chatHook prop to ChatView and DocumentsView; prevents dual-instance document context mismatch"
    - "Two-phase upload UX — setTimeout heuristic transitions 'uploading' -> 'analyzing' at 1500ms since server does both steps in one request"
    - "Inline error display — red text below upload zone; no toast, no chat bubble"
    - "Upload zone self-hides when activeDocument is set; DocumentCard replaces it"

key-files:
  created:
    - src/components/documents/DocumentCard.tsx
    - src/components/documents/DocumentsView.tsx
  modified:
    - src/App.tsx
    - src/components/layout/Header.tsx
    - src/components/chat/ChatView.tsx
    - src/components/chat/ChatInput.tsx

key-decisions:
  - "useChat lifted to App.tsx as single chatHook instance — ChatView receives it as prop rather than calling useChat() internally; prevents dual-instance document context split where DocumentsView attach wouldn't flow to ChatView send"
  - "ChatView.tsx accepts chatHook: ReturnType<typeof useChat> prop — clean type-safe approach without prop drilling individual values"
  - "ChatInput textarea gets rounded-t-none when activeDocument badge is shown — badge and textarea visually join as single connected element"

patterns-established:
  - "Document badge above ChatInput: green bg-green-50 bar with FileText icon and filename; connects visually to textarea with rounded-t-none"
  - "DocumentCard grid layout: 2-column key/value pairs for financial data; emerald color for TDS Deducted to draw attention"

requirements-completed: [DOC-01, DOC-02, DOC-03]

# Metrics
duration: 4min
completed: 2026-04-04
---

# Phase 5 Plan 04: DocumentsView UI Summary

**DocumentsView with drag-and-drop upload, two-phase Gemini processing UX, DocumentCard summary, and document-aware ChatInput badge — completing the end-to-end Phase 5 document handling flow**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-04T10:16:52Z
- **Completed:** 2026-04-04T10:20:52Z
- **Tasks:** 2 auto + 1 checkpoint (auto-approved)
- **Files modified:** 6

## Accomplishments

- Created DocumentCard.tsx rendering all DocumentSummary fields (employer, employee, PAN, gross salary, taxable salary, TDS, 80C, 80D) with INR formatting using Intl.NumberFormat
- Created DocumentsView.tsx with drag-and-drop zone, two-phase upload spinner ("Uploading document..." / "Analyzing with AI..."), inline red error display, and DocumentCard shown on success
- Lifted useChat to App.tsx as single shared instance — eliminated dual-instance document context split that would have prevented document-aware chat from working after attaching in DocumentsView
- Wired Documents tab in Header, updated ActiveView type across App.tsx and Header.tsx, added green badge in ChatInput showing attached document filename

## Task Commits

Each task was committed atomically:

1. **Task 1: Create DocumentCard and DocumentsView** - `5181468` (feat)
2. **Task 2: Wire App.tsx, Header.tsx, ChatView.tsx, ChatInput.tsx** - `e802b21` (feat)
3. **Task 3: Human verification checkpoint** - auto-approved per user instruction

## Files Created/Modified

- `src/components/documents/DocumentCard.tsx` — Renders DocumentSummary fields with INR formatting and Dismiss button
- `src/components/documents/DocumentsView.tsx` — Upload zone with drag-and-drop, two-phase UX, inline error, DocumentCard display
- `src/App.tsx` — Lifts useChat to single instance; adds 'documents' ActiveView; renders DocumentsView with chatHook props
- `src/components/layout/Header.tsx` — Adds Documents tab; extends ActiveView type to include 'documents'
- `src/components/chat/ChatView.tsx` — Accepts chatHook prop instead of calling useChat() internally
- `src/components/chat/ChatInput.tsx` — Adds optional activeDocument prop; renders green badge above textarea

## Decisions Made

- useChat lifted to App.tsx as single chatHook instance — ChatView receives it as prop rather than calling useChat() internally; prevents dual-instance document context split where DocumentsView attach wouldn't flow to ChatView send
- ChatView.tsx accepts `chatHook: ReturnType<typeof useChat>` prop — clean type-safe approach without prop drilling individual values
- ChatInput textarea gets `rounded-t-none` when activeDocument badge is shown — badge and textarea visually join as single connected element

## Deviations from Plan

None — plan executed exactly as written. The architectural note in the plan about needing to lift useChat was preemptively addressed in the plan itself (with the "Chosen approach" and "Correct fix" discussion), so implementing the lift was part of the planned task rather than a deviation.

## Issues Encountered

None — TypeScript compile passed cleanly with zero errors after both tasks.

## User Setup Required

None — no external service configuration required for this plan.

## Next Phase Readiness

- Phase 5 document handling is now fully complete end-to-end: upload route (05-01), chat route fileContext injection (05-02), client service layer (05-03), DocumentsView UI (05-04)
- All four DOC requirements (DOC-01, DOC-02, DOC-03, DOC-04) are now observable from the UI
- Phase 6 (Smart Assist Plugin) can proceed — the tab navigation pattern from Header.tsx provides a model for adding plugin-mode behavior

---
*Phase: 05-document-handling*
*Completed: 2026-04-04*
