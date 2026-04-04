---
phase: 05-document-handling
plan: 01
subsystem: api
tags: [gemini, files-api, upload, typescript, document-extraction, multimodal]

# Dependency graph
requires:
  - phase: 01-express-backend-api-key-migration
    provides: multer memoryStorage upload route with req.file.buffer and GEMINI_API_KEY on server
provides:
  - Full Gemini Files API pipeline: Buffer->Blob->ai.files.upload()->generateContent()->fileUri+extractedData response
  - DocumentSummary, DocumentContext, updated UploadResponse types in src/types/index.ts
  - server/routes/upload.ts upgraded from placeholder stub to production pipeline
affects:
  - 05-02 (DocumentsView UI consumes UploadResponse.extractedData and fileUri)
  - 05-03 (chat route fileContext extension needs fileUri from this pipeline)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Buffer-to-Blob wrapping pattern before ai.files.upload() — critical SDK constraint
    - Markdown fence stripping before JSON.parse on Gemini extraction responses
    - Two-step Gemini pipeline: Files API upload then generateContent with createPartFromUri
    - fileUri returned to client for session-only follow-up chat (never persisted server-side)

key-files:
  created: []
  modified:
    - src/types/index.ts
    - server/routes/upload.ts

key-decisions:
  - "Buffer-to-Blob wrapping: ai.files.upload() accepts Blob not raw Buffer — new Blob([req.file.buffer]) is mandatory"
  - "fileUri NOT deleted after summary: DOC-02 follow-up chat requires the URI to remain valid; React state is the session boundary per DOC-04"
  - "Markdown fence stripping added: Gemini occasionally wraps JSON in ```json...``` blocks; response.text.replace() before JSON.parse prevents silent parse failures"

patterns-established:
  - "Pattern: Buffer->Blob->ai.files.upload() for all server-side Gemini document uploads"
  - "Pattern: Strip markdown fences (```json...```) before parsing Gemini JSON responses"

requirements-completed: [DOC-01, DOC-03, DOC-04]

# Metrics
duration: 15min
completed: 2026-04-04
---

# Phase 05 Plan 01: Document Handling — Server Pipeline Summary

**Gemini Files API pipeline with Buffer-to-Blob conversion, structured JSON extraction, and updated TypeScript types for Form 16 and tax document analysis**

## Performance

- **Duration:** 15 min
- **Started:** 2026-04-04T00:00:00Z
- **Completed:** 2026-04-04T00:15:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extended src/types/index.ts: replaced UploadResponse.summary with fileUri + extractedData; added DocumentSummary (12 fields) and DocumentContext interfaces
- Replaced placeholder upload stub with full three-step Gemini pipeline: multer Buffer wrapped in Blob, ai.files.upload(), generateContent() with createPartFromUri, JSON parse with markdown fence stripping
- fileUri returned to client for DOC-02 follow-up chat; file not deleted immediately (React state acts as session boundary per DOC-04 interpretation)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend types/index.ts with DocumentSummary, DocumentContext, updated UploadResponse** - `aef04d8` (feat)
2. **Task 2: Implement Gemini Files API pipeline in server/routes/upload.ts** - `bc98521` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `src/types/index.ts` - Added DocumentSummary (12 fields), DocumentContext, updated UploadResponse (fileUri + extractedData replacing summary: string)
- `server/routes/upload.ts` - Full Gemini Files API pipeline replacing placeholder stub; imports GoogleGenAI and createPartFromUri; EXTRACTION_PROMPT constant; Buffer->Blob->upload->generateContent->JSON parse->response

## Decisions Made
- fileUri is NOT deleted server-side after summary generation — DOC-02 requires the URI for follow-up chat; DOC-04's "not persisted beyond session" is satisfied by React state (not localStorage); Gemini auto-expires files after 48h anyway
- Markdown fence stripping added proactively — RESEARCH.md documented Pitfall 4 (Gemini wraps JSON in ```json blocks); response.text.replace pattern applied before JSON.parse
- On extractedData parse failure, fallback to `{ summary: 'Document uploaded but summary could not be generated.' }` — graceful degradation, upload still succeeds

## Deviations from Plan

None - plan executed exactly as written.

The plan's Task 2 included a note clarifying DOC-04 behavior (do NOT delete immediately) which aligned with RESEARCH.md's recommended approach. This was already part of the plan, not a deviation.

## Issues Encountered
None — @google/genai was already installed (v1.48.0), Node.js 18+ Blob global is available, no new dependencies needed.

## User Setup Required
None - GEMINI_API_KEY is already configured in server .env from Phase 1.

## Next Phase Readiness
- server/routes/upload.ts now returns `{ fileUri, extractedData }` — Plan 02 (DocumentsView UI) can consume extractedData directly
- DocumentSummary and DocumentContext types are exported and ready for DocumentsView and useChat extension
- fileUri is available for Plan 03 chat route extension (DOC-02 document-aware chat)

---
*Phase: 05-document-handling*
*Completed: 2026-04-04*
