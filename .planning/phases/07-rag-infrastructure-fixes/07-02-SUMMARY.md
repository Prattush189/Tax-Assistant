---
phase: 07-rag-infrastructure-fixes
plan: 02
subsystem: infra
tags: [rag, typescript, chunker, schedule-aware, chapter-aware]

requires:
  - phase: 07-01
    provides: SOURCE_CONFIGS-driven RAG architecture with stable chunkMap and config-driven splitter dispatch

provides:
  - splitActWithChaptersAndSchedules() replacing splitIntoSections() for Act files
  - splitScheduleArea() — schedule content split by SCHEDULE/PART boundaries, no section regex applied
  - splitActBodyWithChapters() — chapter context tracked and annotated in section labels
  - Schedule boundary regex covering both act-2025.txt (SCHEDULE I format) and act-1961.txt (THE FIRST SCHEDULE format)
  - Elimination of 299 false section matches in act-2025.txt schedule area

affects:
  - 08-gst-act-data
  - 10-scoring-integration-validation

tech-stack:
  added: []
  patterns:
    - "Schedule-before-section splitting: detect schedule boundary first, apply section regex only to act body portion"
    - "Chapter context tracking: CHAPTER header positions collected, then each section annotated with chapter label based on char index"
    - "Context-before-filter: update currentSchedule/currentPart before checking segment length, so PART chunks inherit correct schedule name even when SCHEDULE header is too short to emit"

key-files:
  created: []
  modified:
    - server/rag/index.ts

key-decisions:
  - "Section regex applied only to Act body portion (before first SCHEDULE boundary) — eliminates false matches in schedule numbered items"
  - "Chapter annotation format: '14 [CHAPTER IV — Computation of Total Income]' — both Roman numeral and title for maximum retrievability, truncated at 60 chars"
  - "Schedule labels kept uppercase as found in text (SCHEDULE I, not Schedule I) — consistent with source document"
  - "splitIntoSections() retained as private helper — splitActBodyWithChapters() calls it for Act body; no external behavior change for comparison.txt"
  - "Context tracking bug fix: currentSchedule updated before length check so PART chunks under short SCHEDULE headers get correct parent"

patterns-established:
  - "Boundary-first splitting: always detect major boundaries (schedule, chapter) before applying fine-grained splitters (section regex)"
  - "Context-before-filter pattern: update state variables before the 'continue' guard so downstream segments inherit correct context"

requirements-completed:
  - RAGI-02
  - RAGI-03

duration: 4min
completed: 2026-04-08
---

# Phase 7 Plan 02: Chapter/Schedule-Aware Act Splitter Summary

**Chapter-annotated section labels and schedule-boundary chunking: eliminates 299 false section matches in act-2025.txt schedules and adds chapter context to every Act section label**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-08T16:14:30Z
- **Completed:** 2026-04-08T16:18:44Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Eliminated 299 false section matches that were produced by the schedule numbered items (e.g., "1. (1) The eligible investment fund...") in act-2025.txt's 16 schedule areas
- Added chapter context to every section label — section 80C now appears as "80C [CHAPTER VI — AGGREGATION OF INCOME AND SET OFF OR...]" enabling chapter-level retrieval
- Schedule content (16 schedules in act-2025, 14 schedules in act-1961) now produces properly labeled chunks ("SCHEDULE I", "SCHEDULE XI -- PART A") instead of phantom section numbers
- Fixed a context tracking bug where PART chunks immediately following a short SCHEDULE header would inherit the previous schedule's name rather than the correct one

## Task Commits

Each task was committed atomically:

1. **Task 1: Chapter/schedule pre-pass splitter for Act files** - `63e6421` (feat)
2. **Task 2: Backward compatibility validation** - No code changes; validation passed in Task 1 commit

**Plan metadata:** (docs commit to follow)

## Files Created/Modified
- `server/rag/index.ts` — Added `splitScheduleArea()`, `splitActBodyWithChapters()`, `splitActWithChaptersAndSchedules()`, `SCHEDULE_BOUNDARY_REGEX`, `CHAPTER_LINE_REGEX`; wired `splitActWithChaptersAndSchedules()` into `buildChunks()` dispatch for `splitter === 'act'`

## Decisions Made
- Section regex applied to Act body only (before first SCHEDULE boundary) — the root cause fix for the 299 false matches
- Schedule labels use the text as found ("SCHEDULE I" uppercase) for consistency with source documents
- Chapter annotation uses both Roman numeral and title: "CHAPTER IV — Computation of Total Income" — provides maximum indexable tokens for retrieval
- Chapter title truncated at 60 chars with ellipsis — prevents extremely long section labels
- `splitIntoSections()` kept as private helper called by the new function (not deleted) — clean refactor with single call site change in `buildChunks()`
- Context tracking order: update `currentSchedule`/`currentPart` before the `< 50 chars` length filter — required for SCHEDULE XI case where header line is immediately followed by PART A with only 2 lines between them

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed schedule context inheritance when SCHEDULE header segment is too short**
- **Found during:** Task 1 (testing splitScheduleArea)
- **Issue:** SCHEDULE XI header text was < 50 chars (immediately followed by PART A), so currentSchedule was not updated before the `continue` guard; SCHEDULE XI's PART A/B/C chunks were labeled "SCHEDULE X -- PART A/B/C" instead of "SCHEDULE XI -- PART A/B/C"
- **Fix:** Moved the `currentSchedule`/`currentPart` update before the `if (segmentText.length < 50) continue;` check
- **Files modified:** server/rag/index.ts
- **Verification:** Schedule chunks for act-2025 now show "SCHEDULE XI -- PART A" and "SCHEDULE XII -- PART A/B" correctly
- **Committed in:** 63e6421 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Required for correctness; the fix was trivially small (reorder 3 lines). No scope creep.

## Issues Encountered
- Pre-existing TypeScript errors in server/routes/auth.ts and server/routes/upload.ts appeared in compiler output but are unrelated to RAG — same as Phase 07-01, out of scope.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 8 (GST Act Data) can now load CGST/IGST Act text files by adding entries to SOURCE_CONFIGS; `splitter: 'act'` will automatically use chapter and schedule detection
- Schedule content is now properly chunked and labeled — queries about specific schedules will return relevant chunks instead of phantom section numbers
- act-2025.txt: 2179 chunks; act-1961.txt: 3636 chunks; comparison: 98 chunks; total: 5913 chunks with 26404 index keys

---
*Phase: 07-rag-infrastructure-fixes*
*Completed: 2026-04-08*
