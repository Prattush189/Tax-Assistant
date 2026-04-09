---
phase: 09-reference-data
plan: 01
subsystem: rag
tags: [rag, reference-data, cii, due-dates, itr-forms, keyword-scoring]

# Dependency graph
requires:
  - phase: 07-rag-infrastructure-fixes
    provides: Dynamic SOURCE_CONFIGS registry, comparison splitter, boost field support
  - phase: 08-gst-act-data
    provides: 5-source RAG corpus (comparison + 2 IT Acts + 2 GST Acts)
provides:
  - reference-data.txt with CII table (25 rows FY 2001-02-2025-26), IT/GST/TDS/corporate due dates, ITR form matrix
  - 'reference' splitter case in buildChunks() routing to splitComparisonSections()
  - SOURCE_CONFIGS entry for reference source with label 'Tax Reference Guide'
  - validate-reference.ts validation script (13 checks, all passing)
  - 22 new chunks from 7 sections in reference-data.txt
  - RAG corpus now 6428 total chunks across 6 sources
affects: [10-scoring-integration-validation, rag, retrieval, chat-responses]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CII table format: 'CII FY XXXX-XX = YYY' prefix per row ensures strong 'cii' token frequency for keyword scoring"
    - "Reference splitter case routes to splitComparisonSections() -- same ====== delimiter format, zero new splitting code"
    - "Validation scripts in server/rag/validate-*.ts pattern for per-phase RAG regression checks"

key-files:
  created:
    - server/data/reference-data.txt
    - server/rag/validate-reference.ts
  modified:
    - server/rag/index.ts

key-decisions:
  - "Reference data uses splitter='reference' (semantic accuracy) with buildChunks case routing to splitComparisonSections() -- no new splitting code"
  - "boost: 1.3 added to reference SOURCE_CONFIGS entry -- CII section scored lower than calendar section for 'cii' query due to high '2025' token frequency in calendar; boost needed for success criteria; tuning deferred to Phase 10"
  - "CII table rows formatted as 'CII FY XXXX-XX = YYY' -- 'CII' prefix per row boosts 'cii' token frequency in section, enabling CII chunk to rank highest for CII-specific queries even without boost"
  - "FY 2026-27 CII explicitly omitted with 'NOT YET NOTIFIED' note -- locked user decision"
  - "AY 2025-26 belated filer rules explicitly noted -- ITR-1 did not allow LTCG in AY 2025-26, ITR-4 limited to 1 house property"

patterns-established:
  - "CII lookup pattern: 'CII FY XXXX-XX = YYY' format ensures retrieval works for both specific (FY 2025-26) and general CII queries"
  - "validate-reference.ts pattern: standalone tsx script calling initRAG() + retrieveContextWithRefs(); exits 0/1 for CI-friendly validation"

requirements-completed: [REF-01, REF-02, REF-03, REF-04]

# Metrics
duration: 7min
completed: 2026-04-09
---

# Phase 9 Plan 01: Reference Data Summary

**CII table (25 rows), IT/GST/TDS/corporate due dates calendar, and ITR form matrix (7 forms, AY 2026-27 + AY 2025-26 rules) added as RAG-indexed 'Tax Reference Guide' source -- all 3 success criteria queries pass**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-09T00:00:00Z
- **Completed:** 2026-04-09T00:07:00Z
- **Tasks:** 2
- **Files modified:** 3 (1 created data, 1 created validation, 1 modified index)

## Accomplishments
- Created server/data/reference-data.txt with 7 sections (22 chunks): CII table with 25 verified rows, 4 due-date sections (IT/GST/TDS/corporate), chronological calendar April 2025 - March 2027, ITR form selection matrix for 7 forms covering AY 2026-27 and AY 2025-26 belated filer rules
- Registered 'reference' SOURCE_CONFIGS entry in index.ts with splitter='reference' and boost=1.3; added 'reference' case in buildChunks() routing to existing splitComparisonSections() -- no new splitting code
- Created server/rag/validate-reference.ts: 13-check validation script verifying CII (376), Q3 advance tax date (15 December), and ITR form (ITR-1, 112A, 1.25L) retrieval from Tax Reference Guide source; all checks pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Create reference-data.txt and add SOURCE_CONFIGS entry** - `2cd1759` (feat)
2. **Task 2: Validate chunk loading and reference data retrieval** - `3486bce` (feat)

## Files Created/Modified
- `server/data/reference-data.txt` - Structured reference data: CII table (25 rows, FY 2001-02 to 2025-26), IT/GST/TDS/corporate due dates, chronological calendar, ITR form matrix (7 forms)
- `server/rag/validate-reference.ts` - Standalone validation script: 13 checks covering CII, due date, and ITR form retrieval; exits 0 if all pass
- `server/rag/index.ts` - Added 'reference' SOURCE_CONFIGS entry (boost: 1.3, splitter: 'reference'); added 'reference' case in buildChunks() routing to splitComparisonSections()

## Decisions Made
- **Boost 1.3 for reference source**: CII section initially scored lower than the chronological calendar section for "CII FY 2025-26?" query because "2025" token appeared ~40 times in calendar vs ~1 time in CII section. Added `boost: 1.3` + restructured CII table rows to "CII FY XXXX-XX = YYY" format (adding ~25 "cii" token occurrences to CII section). Defer fine-tuning to Phase 10 (SCOR-02/SCOR-03).
- **splitter: 'reference' (not 'comparison')**: Semantically correct per RESEARCH.md recommendation; buildChunks routes it to same splitComparisonSections() function -- no behavior difference, but correct type.
- **Section 7 (Quick Lookup)**: Added 7th section as a compact quick-reference summary of key values, providing redundant retrieval paths for common lookup queries.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CII retrieval: calendar section outscored CII section for 'cii' query**
- **Found during:** Task 2 (validate chunk loading and reference data retrieval)
- **Issue:** Query "What is the CII for FY 2025-26?" tokenizes to ["cii", "2025"]. The chronological calendar section contained ~40 occurrences of "2025" while CII section had ~1, causing calendar to rank highest within the reference source bucket. CII section never made it into top 5 results.
- **Fix:** (a) Restructured CII table rows from "FY 2025-26 | 376" to "CII FY 2025-26 = 376" format -- 25 rows x 1 "cii" token = 25 additional "cii" occurrences in CII section, ensuring it scores ~30+ for "cii" queries. (b) Added boost: 1.3 as backup to ensure reference chunks surface consistently. (c) Added explicit "CII FY 2025-26 = 376" entries in the quick lookup section.
- **Files modified:** server/data/reference-data.txt, server/rag/index.ts
- **Verification:** validate-reference.ts passes all 13 checks including "CII reference chunk contains value 376" and "CII chunk section label contains CII or COST INFLATION INDEX"
- **Committed in:** `3486bce` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 - scoring bug)
**Impact on plan:** Required fix for primary success criterion. boost: 1.3 is within RESEARCH.md's recommended range (1.2-1.3). No scope creep.

## Issues Encountered
- Initial validation failed with CII query returning calendar section chunks instead of CII section -- resolved by restructuring CII row format and adding boost (see Deviations above)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 6 sources loaded at startup: comparison (98), act-2025 (2179), act-1961 (3636), cgst-2017 (428), igst-2017 (65), reference (22) = 6428 total chunks
- validate-reference.ts exits 0 -- all 3 success criteria queries verified
- Phase 10 (Scoring & Integration Validation) can proceed with full corpus
- Pending from Phase 8: confirm topK=5 token budget impact check against usageRepo inputTok averages (noted in STATE.md Pending Todos)

---
*Phase: 09-reference-data*
*Completed: 2026-04-09*
