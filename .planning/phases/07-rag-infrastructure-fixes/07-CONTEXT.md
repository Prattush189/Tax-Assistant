# Phase 7: RAG Infrastructure Fixes - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the RAG chunker and retrieval function to correctly handle any number of source types, including schedules, chapters, and non-section-numbered content. This is a prerequisite for Phases 8-10 (new data sources). No new data files are added in this phase — only infrastructure changes to `server/rag/index.ts`.

</domain>

<decisions>
## Implementation Decisions

### Chunking strategy
- Schedule handling, chapter header treatment, chunk size tuning, and reference data splitter design are all at Claude's discretion
- Key constraint: the schedule numbering collision problem (schedule item "1." vs Act section "1.") must be resolved — Claude picks the best approach based on the Act text structure
- Reference data (Phase 9) will have no section numbers — the chunker must support a non-section-based splitting path (delimiter-based, per-entry, or custom — Claude decides format)
- Chapter headers (e.g., "CHAPTER IV") currently lost between sections — Claude decides whether to create standalone chapter chunks or attach to first section

### Retrieval balancing
- **topK increased from 3 to 5** — user decision, locked
- Source balancing strategy (best-score-wins vs minimum representation) and score threshold tuning are at Claude's discretion
- Whether comparison.txt keeps its 1.5x boost is at Claude's discretion — evaluate whether it helps or hurts with 5+ sources

### Source type design
- **Labels use full Act name + section** — e.g., "[CGST Act 2017 — Section 16]" matching the current "[IT Act 2025 — Section 202]" pattern. User decision, locked.
- **GST section numbers prefixed with Act name** — store as "CGST-16" internally to avoid collision with IT Act section 16. User decision, locked.
- Source registration approach (config array vs convention-based) is at Claude's discretion
- Reference data lookup path (same RAG pipeline vs separate direct-lookup) is at Claude's discretion

### Backward compatibility
- Existing data files (act-1961.txt, act-2025.txt, comparison.txt) must NOT be modified
- **Detailed startup logging** — log chunk counts per source + total index keys. User decision, locked.
- Backward compat strictness, old chunker fallback strategy, and chunk ID stability are at Claude's discretion

### Claude's Discretion
- Schedule boundary detection and handling approach
- Chapter header chunk strategy
- Chunk size limits (keep 1200/200 or adjust)
- Reference data format and splitter design
- Retrieval balancing algorithm (best-score vs min-representation)
- Score threshold (keep 2 or lower)
- Comparison.txt boost retention
- Source registration mechanism
- Reference data lookup architecture
- Backward compat test approach
- Old chunker replacement vs fallback strategy
- Chunk ID stability

</decisions>

<specifics>
## Specific Ideas

- The current `retrieve()` function has three hardcoded bucket variables (`fromComparison`, `from2025`, `from1961`) — this must become source-agnostic
- The section regex `/^(\d+[A-Z]*(?:-[A-Z]+)?)\.\s/gm` matches schedule numbered items — confirmed bug from research
- CGST/IGST Act text files will follow a section-numbered structure similar to IT Acts but with different section numbers
- The inverted index uses array indices as chunk IDs — `.filter(Boolean)` silently drops corrupted lookups if IDs shift

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-rag-infrastructure-fixes*
*Context gathered: 2026-04-08*
