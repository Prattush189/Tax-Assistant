# Phase 10: Scoring & Integration Validation - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate that all 6 RAG source types (IT Act 1961, IT Act 2025, Comparison Guide, CGST Act 2017, IGST Act 2017, Tax Reference Guide) compete fairly in retrieval. Confirm no IT Act regression, proactively tune boost factors, implement length normalization only if needed, and verify token budget at topK=5. This is a validation-and-tuning phase — no new data sources are added.

</domain>

<decisions>
## Implementation Decisions

### Golden Query Set
- 15 queries total, weighted distribution: 7 IT Act + 4 GST + 4 Reference
- Include 2-3 cross-domain queries (e.g., "Compare GST registration threshold vs income tax registration") per success criterion 3
- Include 2-3 intentionally tricky/ambiguous queries (e.g., "Section 16 input tax credit" which could be IT Act s.16 HRA or CGST s.16 ITC)
- Commit as a reusable JSON fixture (golden-queries.json) with query, expected domain, expected section references — reusable for future regression testing

### Regression Criteria
- "No regression" means: for each IT query, the top-ranked chunk must still come from a relevant source (IT Act 1961/2025/Comparison). Source match, not exact chunk match
- Define expected results from scratch — specify which source + section SHOULD appear in top results for each query (no historical baseline snapshot needed)
- Source shifts are acceptable if answer quality is equivalent (e.g., IT Act chunk shifting to Comparison Guide is fine if the answer would still be correct)

### Token Budget Threshold
- Target: ~3000 tokens average across all golden queries for topK=5 retrieval context
- Measure both average AND worst-case across all 15 queries
- Flag if worst-case exceeds threshold even if average is within budget

### Scoring Adjustments
- Proactively tune ALL boost factors — systematically test different boost combinations across all 6 sources
- Length normalization (SCOR-03): implement ONLY if golden query results show dense text crowding out relevant shorter chunks. Defer if not needed
- Trade-offs acceptable: if boost tuning improves GST/reference queries but slightly worsens one IT query, net improvement across all 15 queries takes priority
- SCOR-01 (topK=5): already implemented in Phase 7 — just confirm it's still set and working, no new implementation needed

### Claude's Discretion
- Exact golden query wording and selection within the distribution constraints
- Boost factor values to test and final values to ship
- Whether length normalization is actually needed based on test results
- Format and structure of the validation report

</decisions>

<specifics>
## Specific Ideas

- Phase 7 already set DEFAULT_TOP_K = 5 in server/rag/index.ts — SCOR-01 is a confirmation check, not new work
- Current boost factors: Comparison Guide 1.5x, Tax Reference Guide 1.3x, all others no boost
- The golden-queries.json fixture should be a lasting asset for future regression testing across milestones

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-scoring-integration-validation*
*Context gathered: 2026-04-09*
