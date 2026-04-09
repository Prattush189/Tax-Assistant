---
phase: 10-scoring-integration-validation
plan: 01
subsystem: testing
tags: [rag, validation, golden-queries, keyword-scoring, typescript]

# Dependency graph
requires:
  - phase: 09-reference-data
    provides: reference-data.txt loaded in RAG with 1.3x boost, Tax Reference Guide label
  - phase: 08-gst-act-data
    provides: cgst-2017 and igst-2017 sources in RAG
  - phase: 07-rag-infrastructure-fixes
    provides: DEFAULT_TOP_K=5, dynamic source bucket balancing, SOURCE_CONFIGS registry
provides:
  - 15-query golden set fixture (server/data/golden-queries.json) with expected domains, sources, section refs, and values
  - Validation harness (server/rag/validate-golden.ts) that asserts source/value expectations per query
  - Baseline diagnostic output: SCOR-01 confirmed (topK=5), SCOR-02 confirmed (labels human-readable), token budget avg=1449/max=1500 (target 3000)
  - Known baseline failure: REF-01 CII value '376' not returned in top-5 results (fix target for Plan 02)
affects:
  - 10-02-PLAN (scoring tuning — will use validate-golden.ts as regression harness)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "validate-golden.ts follows validate-reference.ts pattern: import from index.js, initRAG(), check() helper, exit 0/1"
    - "Golden query JSON fixture with expectedSources/expectedSectionRefs/expectedValues fields for structured assertions"
    - "RAG_DEBUG=1 env var pattern for per-chunk debug output without affecting exit code"

key-files:
  created:
    - server/data/golden-queries.json
    - server/rag/validate-golden.ts
  modified: []

key-decisions:
  - "REF-01 CII=376 fails at baseline: reference source is returned but CII section with the value is not in top-5 — expected Plan 02 fix target"
  - "Token budget well within target: avg=1449 max=1500 tokens vs 3000 target — no length normalization needed at this stage"
  - "SCOR-01 confirmed: topK=5 returns exactly 5 chunks for a generic 'income tax' query"
  - "SCOR-02 confirmed: all 15 queries return refs with human-readable labels (not raw source IDs)"
  - "golden-queries.json uses readFileSync + JSON.parse (not import assert) to avoid ESM JSON import complexity — matches plan spec"

patterns-established:
  - "Golden query fixture pattern: id, query, expectedDomain, expectedSources, expectedSectionRefs, notes fields required; expectedValues optional"
  - "Baseline-first validation: script exits 1 on failures but never crashes — baseline failures are documented, not fixed in Plan 01"

requirements-completed: [SCOR-01, SCOR-02, SCOR-04]

# Metrics
duration: 2min
completed: 2026-04-09
---

# Phase 10 Plan 01: Golden Query Fixture & Baseline Diagnostic Summary

**15-query RAG regression fixture with validation harness confirming SCOR-01 (topK=5), SCOR-02 (human-readable labels), and token budget (avg=1449 tokens) at baseline before scoring tuning**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-09T11:06:22Z
- **Completed:** 2026-04-09T11:08:22Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created golden-queries.json with exactly 15 queries (7 IT Act + 4 GST + 4 Reference) matching the CONTEXT.md distribution, with cross-domain and ambiguity notes
- Created validate-golden.ts harness that runs all 15 queries, checks source presence, label quality (SCOR-02), expected values, and token budget
- Confirmed SCOR-01 (topK=5 returns exactly 5 chunks) and SCOR-02 (all refs have human-readable labels like "IT Act 1961" not raw "act-1961")
- Baseline diagnostic completed: token budget is healthy (avg=1449 max=1500 vs 3000 target); 1 known failure (REF-01 CII=376) documented as Plan 02 fix target

## Task Commits

Each task was committed atomically:

1. **Task 1: Create golden-queries.json fixture with 15 queries** - `97365c7` (feat)
2. **Task 2: Create validate-golden.ts harness and run baseline diagnostic** - `7b0d9b7` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `server/data/golden-queries.json` - 15-query golden set fixture with expected domains, sources, section refs, and values; includes cross-domain and ambiguity notes
- `server/rag/validate-golden.ts` - Validation harness: loads golden-queries.json, runs all 15 queries against live RAG, reports SCOR-01/SCOR-02/token budget/per-query pass/fail

## Decisions Made
- Token budget is well within the 3000-token target (avg=1449, max=1500) — length normalization is NOT needed at this stage; defer to Plan 02 if scoring changes push budget higher
- REF-01 CII=376 is the primary scoring fix target for Plan 02: the reference source is correctly returned but the specific CII section containing "376" is not making it into top-5
- The validate-golden.ts script exits 1 on failures (as required) but never crashes — all failures are informational baseline data for Plan 02
- `__dirname` pattern from index.ts reused in validate-golden.ts (fileURLToPath + import.meta.url) for correct ESM path resolution

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- None. The baseline diagnostic output matched expectations: 34/35 checks passed, 1 known failure (REF-01 CII value), which is the documented baseline before Plan 02 scoring tuning.

## Baseline Diagnostic Summary

| Check | Result |
|-------|--------|
| SCOR-01: topK=5 returns 5 chunks | PASS |
| IT-01 through IT-07: expected source present | PASS (all 7) |
| IT-01 through IT-07: labels human-readable | PASS (all 7) |
| GST-01 through GST-04: expected source present | PASS (all 4) |
| GST-01 through GST-04: labels human-readable | PASS (all 4) |
| REF-01 through REF-04: expected source present | PASS (all 4) |
| REF-01 through REF-04: labels human-readable | PASS (all 4) |
| REF-01: CII value '376' found in results | FAIL (baseline) |
| REF-02: '15 December' found in results | PASS |
| REF-03: 'ITR-1' found in results | PASS |
| Token budget: avg=1449 max=1500 target=3000 | PASS |
| **Total** | **34/35 passed** |

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- validate-golden.ts is the regression harness for Plan 02 scoring tuning — run it before and after any boost factor changes
- Primary fix target for Plan 02: REF-01 (CII=376 not appearing in top-5) — likely requires boost or section-aware retrieval for CII section specifically
- Token budget is healthy — no urgency on length normalization; revisit only if Plan 02 changes push avg above 2500 tokens
- validate-reference.ts not modified and still runs (confirmed: exits 1 with same pre-existing CII failures)

---
*Phase: 10-scoring-integration-validation*
*Completed: 2026-04-09*
