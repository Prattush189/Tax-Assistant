---
phase: 07-rag-infrastructure-fixes
plan: 01
subsystem: infra
tags: [rag, typescript, inverted-index, config-driven]

requires: []
provides:
  - SOURCE_CONFIGS array as single registry for all RAG data sources
  - SourceConfig interface with id, filePath, label, splitter, boost fields
  - source-agnostic initRAG() using for-of over SOURCE_CONFIGS
  - dynamic bucket balancing in retrieve() from SOURCE_CONFIGS keys
  - stable chunkMap (Map<number, Chunk>) replacing array index lookup
  - DEFAULT_TOP_K = 5 constant
  - per-source startup logging (chunk counts + total index keys)
affects:
  - 08-gst-act-data
  - 09-reference-data
  - 10-scoring-integration-validation

tech-stack:
  added: []
  patterns:
    - "Config-driven source registration: SOURCE_CONFIGS array drives init, scoring, labeling, balancing"
    - "Stable Map-based chunk storage: chunkMap.get(id) with type guard instead of array index"
    - "Dynamic bucket balancing: pre-populated from SOURCE_CONFIGS, works with N sources"

key-files:
  created: []
  modified:
    - server/rag/index.ts

key-decisions:
  - "Chunk.source changed from 3-value union to string — valid values come from SOURCE_CONFIGS.id"
  - "retrieve() signature simplified to (query, topK) — no longer takes chunks param since it reads from module-level chunkMap"
  - "comparison.txt boost retained at 1.5x via cfg.boost field in SourceConfig (not hardcoded in scoreChunk)"
  - "reference splitter throws not-implemented error — Phase 9 will add it"
  - "DEFAULT_TOP_K = 5 locked per user decision in CONTEXT.md"

patterns-established:
  - "New source = add entry to SOURCE_CONFIGS only, zero retrieval/init/scoring code changes needed"
  - "chunkMap.get(id) with .filter((c): c is Chunk => c !== undefined) type guard for safe chunk lookup"

requirements-completed:
  - RAGI-01
  - RAGI-04
  - RAGI-05

duration: 1min
completed: 2026-04-08
---

# Phase 7 Plan 01: RAG Infrastructure Refactor Summary

**SOURCE_CONFIGS-driven RAG system: single registry controls init, retrieval balancing, scoring boost, and context labeling for any number of sources**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-04-08T16:09:28Z
- **Completed:** 2026-04-08T16:10:45Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Replaced hardcoded 3-source architecture with SOURCE_CONFIGS array; adding a 4th source (Phase 8 GST Acts) now requires only a new array entry
- Replaced three named bucket variables (fromComparison, from2025, from1961) with a dynamic Map built from SOURCE_CONFIGS, supporting N sources at any topK
- Replaced fragile array index chunk lookup with stable chunkMap (Map<number, Chunk>) using explicit type guard
- Changed DEFAULT_TOP_K from 3 to 5 per locked user decision
- Added per-source startup logging: `[RAG] Loaded comparison: X chunks` and `[RAG] Total chunks: N, index keys: M`

## Task Commits

Each task was committed atomically:

1. **Task 1 + Task 2: SourceConfig registry, stable chunk Map, source-agnostic initRAG and retrieve()** - `68b1799` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified
- `server/rag/index.ts` - Full refactor: SourceConfig interface, SOURCE_CONFIGS array, sourceConfigMap, DEFAULT_TOP_K, chunkMap, config-driven buildChunks/initRAG/scoreChunk/retrieve/retrieveContext

## Decisions Made
- Tasks 1 and 2 implemented in a single file rewrite since they both modified `server/rag/index.ts` and were tightly coupled
- `retrieve()` signature simplified from `(chunks, query, topK)` to `(query, topK)` — internal reads from module-level `chunkMap` directly; no external callers of `retrieve()` exist
- `reference` splitter in `buildChunks()` throws a not-implemented error rather than silently failing — Phase 9 will add the implementation

## Deviations from Plan

None - plan executed exactly as written. Both tasks implemented in one pass since they modified the same file.

## Issues Encountered
Pre-existing TypeScript errors in `server/routes/auth.ts` and `server/routes/upload.ts` appeared in compiler output but are unrelated to RAG and out of scope for this plan. Zero errors in `server/rag/index.ts`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 8 (GST Act Data) can now add CGST/IGST sources by adding entries to SOURCE_CONFIGS array only
- Phase 9 (Reference Data) needs to implement the `reference` splitter in buildChunks() (currently throws not-implemented)
- Phase 10 (Scoring & Integration Validation) can validate topK=5 token budget impact

---
*Phase: 07-rag-infrastructure-fixes*
*Completed: 2026-04-08*
