# Phase 8: GST Act Data - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Add CGST Act 2017 and IGST Act 2017 full text as indexed RAG data sources. Users can ask GST-specific questions and receive answers grounded in actual CGST/IGST Act text with proper section references. No changes to the RAG infrastructure (done in Phase 7).

</domain>

<decisions>
## Implementation Decisions

### Data sourcing
- Extract CGST Act 2017 and IGST Act 2017 text from official government PDFs (CBIC cbic-gst.gov.in or India Code indiacode.nic.in)
- If PDF extraction quality is poor (< 150 section-matched chunks for CGST), fall back to India Code HTML source
- Text files go in server/data/ alongside existing act-1961.txt, act-2025.txt, comparison.txt
- File naming: cgst-act.txt and igst-act.txt

### Source registration
- Add two new entries to SOURCE_CONFIGS array in server/rag/index.ts
- CGST config: id='cgst-2017', label='CGST Act 2017', splitter='act', no boost
- IGST config: id='igst-2017', label='IGST Act 2017', splitter='act', no boost
- Section labels will use the Phase 7 chapter-aware splitter automatically

### Section labeling
- GST section numbers prefixed with Act name per locked decision: "CGST-16", "IGST-12"
- This is handled by the SourceConfig.id prefix in the label formatter
- Labels in retrieval output: "[CGST Act 2017 — Section 16]", "[IGST Act 2017 — Section 12]"

### Text preparation
- Extracted text should follow same format as IT Act files (section numbers at line start)
- CGST Act has 174 sections across 21 chapters + 5 schedules
- IGST Act has ~25 sections including place-of-supply rules (Sections 10-13)
- Both Acts include amendments up to Finance Act 2025 where available
- Schedule content will be handled by the Phase 7 splitActWithChaptersAndSchedules() splitter

### Quality gate
- CGST must produce > 150 section-matched chunks after loading (extraction quality assertion)
- IGST must produce > 20 section-matched chunks
- Both must load without errors at startup
- Log chunk counts per source at startup (already implemented in Phase 7)

### Claude's Discretion
- Exact text cleaning/formatting approach for extracted PDF text
- Whether to include explanatory notes or amendments annotations
- How to handle CGST Rules references within Act text (leave as-is, don't add Rules text)
- Sub-chunking parameters (use existing 1200/200 defaults unless testing shows issues)

</decisions>

<specifics>
## Specific Ideas

- The Phase 7 SourceConfig architecture makes this straightforward: one config entry per source, splitter='act' reuses the chapter/schedule-aware splitter
- CGST Act Sections 9 (levy), 16-17 (ITC), 31 (invoicing), 37/39/44 (returns), 49 (payment), 51-52 (TDS/TCS), 54 (refunds), 73-74 (demand/recovery) are the most queried sections
- IGST Act Sections 5 (levy), 7-8 (inter/intra-state), 10-13 (place of supply) are the most queried
- comparison.txt already has GST summaries in sections 10 and 25 — these serve as cross-reference context alongside the full Act text

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-gst-act-data*
*Context gathered: 2026-04-08*
