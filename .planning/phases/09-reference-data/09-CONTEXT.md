# Phase 9: Reference Data - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Add three structured reference data sources (CII table, due dates calendar, ITR form selection matrix) as a single RAG-indexed file, enabling exact-answer retrieval for lookup queries instead of approximate keyword matches from Act text. Uses the existing comparison splitter (====== delimiters) and SOURCE_CONFIGS registration pattern.

</domain>

<decisions>
## Implementation Decisions

### CII Table Scope
- Full range: FY 2001-02 (base year, index=100) through FY 2025-26 (index=376)
- FY 2026-27 omitted until officially notified by CBDT — no estimates
- Include brief context: base year explanation, indexation formula (indexed cost = cost x CII of sale year / CII of purchase year), when indexation applies
- Include note about Budget 2024 change: indexation for property is now optional (old regime with indexation vs new 12.5% flat rate) to prevent user confusion on recent property sales

### Due Dates Coverage
- Cover all three categories: Income Tax, GST returns, and corporate compliance deadlines
- Organize both ways: by category (grouped by type) AND chronological (month-by-month calendar)
- Include both generic recurring rules AND current Tax Year 2025-26 specific dates
- Note the AY (Assessment Year) to Tax Year transition in Indian income tax law
- Show statutory dates only — extensions/changes are out of scope (admin UI management is a deferred idea)

### ITR Form Matrix
- Cover all assessee types: individuals, HUFs, firms, LLPs, companies, trusts, AOPs
- Include both old and new tax regime form eligibility rules
- Include specific income thresholds that trigger form changes (e.g., ITR-1 if total income <= 50L, only salary/one house property/other sources, no LTCG, agriculture income <= 5000)
- Cover both current Tax Year 2025-26 and previous AY 2025-26 (for late/belated filers)

### Data Format & Splitter
- All three datasets in one file (reference-data.txt) with ====== section delimiters
- Use existing 'comparison' splitter — no new splitter code needed
- One SOURCE_CONFIGS entry with splitter='comparison'

### Claude's Discretion
- Boost factor for reference data (whether to add a boost like comparison's 1.5x, or defer to Phase 10)
- Source label text (e.g., "Reference Guide" vs "Tax Reference Data")
- Exact formatting of tables and matrices within the text file
- How to handle corporate compliance dates that vary by company type

</decisions>

<specifics>
## Specific Ideas

- Existing SectionReference system (SectionModal, retrieveContextWithRefs) will display reference chunks in chat — label choice matters for chip display
- Reference data is structured lookup data, not legislation — should feel different from Act chunks when surfaced
- CII values must be exact (e.g., FY 2025-26 = 376) — this is the primary quality gate

</specifics>

<deferred>
## Deferred Ideas

- Admin UI for managing extended/changed deadlines — new capability, own phase
- PDF page rendering with highlighted sections in SectionModal (instead of raw text) — significant frontend feature, requires PDF.js + chunk-to-page mapping

</deferred>

---

*Phase: 09-reference-data*
*Context gathered: 2026-04-09*
