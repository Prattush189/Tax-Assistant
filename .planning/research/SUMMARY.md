# Project Research Summary

**Project:** Indian Tax Assistant -- v1.1 RAG Data Completeness and Quality
**Domain:** Legal-domain RAG pipeline for Indian income tax and GST legislation
**Researched:** 2026-04-08
**Confidence:** HIGH

## Executive Summary

This milestone upgrades the existing tax assistant from a narrow income tax chatbot (IT Act 1961 + 2025) into a broader Indian tax coverage platform by adding GST legislation (CGST + IGST Acts) and structured reference data (CII table, due dates calendar, ITR form matrix). The existing keyword-based inverted-index RAG is proven and sufficient -- the work is entirely about expanding corpus coverage and fixing the chunker so new data is actually retrievable. No new npm packages are required; all changes are TypeScript modifications to server/rag/index.ts and new data files in server/data/.

The recommended approach is strictly incremental: fix the two known bugs in the existing chunker first (schedule-boundary bleed and hardcoded three-bucket retrieval), then add new data files in sequence. Both bugs are latent and will compound badly if new files are added before they are fixed. The chunker bug silently converts entire multi-hundred-KB files into single unchunkable blobs; the retrieval bug guarantees new sources never surface in results even when they are the most relevant match.

The primary risk cluster is data quality, not algorithm complexity. Government PDFs of GST Acts are likely to contain OCR artifacts, page-number insertions, and section-number formatting inconsistencies that defeat the existing section regex. Plan a validation gate -- a script that asserts extracted CGST text yields more than 150 section-matched chunks -- before writing any chunker code. The secondary risk is scoring regression: CGST text repeats common terms (supply, registered, taxable) at high frequency and will amplify CGST chunks over IT Act chunks in mixed-domain queries unless length-normalization is applied.

---

## Key Findings

### Recommended Stack

No new npm packages are needed for v1.1. The existing stack (React 19, TypeScript, Vite, Express, @google/genai, pdf-parse, better-sqlite3, Recharts) remains unchanged. The only new runtime artifacts are data files and TypeScript modifications to the existing RAG module. BM25 libraries and embedding models were evaluated and rejected: BM25 provides marginal benefit over the existing inverted index when legal documents are already chunked to 1200 chars with section-number boosting; embedding models introduce a 100MB+ dependency and 10-30 second startup time incompatible with the lightweight in-process design.

**Core technologies (unchanged):**
- server/rag/index.ts: in-memory inverted index RAG -- sufficient for keyword-precise legal queries; extend, do not replace
- pdf-parse (already installed): use to extract CGST/IGST Act text from official CBIC PDFs
- better-sqlite3: usage tracking only -- not used for RAG data

**New data (not packages):**
- server/data/cgst-act.txt: CGST Act 2017 full text -- extracted from CBIC PDF with existing pdf-parse
- server/data/igst-act.txt: IGST Act 2017 full text -- same extraction process, shorter Act (~25 sections)
- Reference files (CII table, due dates, ITR matrix): structured text with --- delimiters or JSON; schema fully specified in STACK.md

### Expected Features

**Must have (table stakes for v1.1):**
- Schedule-aware RAG chunker -- prerequisite; without it every new data file loads as a single unchunkable blob
- CGST Act full text (21 chapters, ~174 sections, 5 schedules) -- closes the largest current gap; Section 16 ITC, Section 17(5) blocked credits, Section 9 levy return no context today
- IGST Act full text (~25 sections) -- closes interstate supply and place-of-supply query gaps (Sections 10-13)
- CII table FY 2001-02 to FY 2025-26 -- completes capital gains query chain; CBDT notified CII 376 for FY 2025-26
- Due dates calendar FY 2025-26 -- highest query frequency category; advance tax, TDS deposit, ITR filing dates
- ITR form selection matrix AY 2026-27 -- top-5 query type; includes AY 2026-27 LTCG Section 112A change (up to 1.25L now ITR-1 eligible)
- Source-type-aware retrieval scoring -- ensures new sources compete fairly; extends existing 1.5x comparison-boost pattern

**Should have (competitive, post v1.1):**
- CGST Rules curated summary (Rule 36/42/43/86B) -- add after observing ITC reversal query gaps post-launch
- GST rate categories reference (top 20 frequently asked goods/services)
- Updated CII FY 2026-27 -- once CBDT notifies value (typically July)

**Defer (v2+):**
- Semantic/vector embedding retrieval -- keyword RAG adequate for precise legal terms; no benefit for section-number queries
- Full HSN-wise GST rate schedule -- requires dedicated lookup UI, not chat retrieval
- Finance Act amendment corpus -- amendment text is structured as patches, not readable prose; update comparison.txt manually instead

### Architecture Approach

The architecture is a single Express server with an in-memory RAG module (server/rag/index.ts) that loads all data files synchronously at startup, builds one shared inverted index, and is called synchronously during each chat request before forwarding to Gemini. The v1.1 change set is confined to server/rag/index.ts (bug fixes and two new functions) and server/data/ (five new files); server/routes/chat.ts and server/index.ts are untouched.

**Major components:**

1. splitIntoSections() -- existing section splitter; needs schedule-boundary stripping to prevent false matches on SCHEDULE list items (latent bug affecting all Act files)
2. splitReferenceData() -- new function; splits CII/due-dates/ITR files by --- delimiter into labeled prose chunks; must not use section-number regex
3. retrieve() -- existing entry; replace hard-coded three-bucket logic with BUCKET_CAPS map supporting 6 source types; increase default topK from 3 to 5
4. scoreChunk() -- existing scorer; add length normalization to prevent CGST term-frequency amplification over IT Act chunks
5. initRAG() -- existing loader; add 5 new buildChunks() calls each wrapped in try/catch per existing pattern

### Critical Pitfalls

1. **Hardcoded three-bucket retrieval blocks all new sources** -- retrieve() only reserves slots for comparison, act-2025, and act-1961. A fourth source only appears in overflow slots never reached when all three named sources have results. Fix with a source-agnostic BUCKET_CAPS map before adding any new file.

2. **Section regex silently drops schedules and reference data** -- splitIntoSections() converts any content without a leading section number into a single general blob indexed as one unit and unfindable. Warning sign: log shows Loaded cgst-act: 1 chunks. Fix: dedicated splitter per file structure type.

3. **CGST PDF extraction artifacts defeat the chunker** -- Government PDFs commonly produce section numbers separated from text by newlines, repeated running headers, and page-number insertions. Validate extraction with a chunk-count assertion (more than 150 matches for full CGST Act) before writing chunker code.

4. **Raw term-frequency scoring amplifies CGST over IT Act chunks** -- CGST sections repeat supply/registered/taxable person at high frequency. On mixed IT+GST queries this crowds out comparison and IT Act chunks. Fix: normalize scores by sqrt(chunk.text.length); verify with 15-query golden set regression.

5. **Structured reference data not retrievable by keyword** -- CII queries tokenize to terms that appear in hundreds of IT Act amendment notes which outscore the CII chunk. Fix: JSON structured lookup for exact-match reference queries; prefix every chunk with table headers so LLM has context for numeric values.

---

## Implications for Roadmap

Based on research, the work follows a strict dependency order: chunker bugs must be fixed before data files are added, and retrieval infrastructure must be extended before new source types are registered. Four phases are recommended.

### Phase 1: Chunker and Retrieval Infrastructure Fixes
**Rationale:** Both the schedule-stripping bug and the hardcoded three-bucket retrieval are latent defects that silently corrupt all subsequent work if not fixed first. TypeScript union type exhaustiveness checking makes this a natural forcing function for registering new source types correctly.
**Delivers:** Correct chunking of existing three files (chunk count decreases as false schedule-section chunks are eliminated); retrieval infrastructure supporting 6 named source types; topK increased to 5.
**Addresses:** Schedule-aware RAG chunking (P1), source-type-aware retrieval scoring (P1)
**Avoids:** Pitfall 1 (blocked retrieval for new sources), Pitfall 2 (schedule content drop), Pitfall 3 (chunk ID corruption)

### Phase 2: CGST and IGST Act Data Preparation and Loading
**Rationale:** GST Act coverage is the largest current query gap. CGST and IGST are logically paired and should ship together. Data preparation and extraction validation must precede chunker code because extraction quality determines chunker requirements.
**Delivers:** Full CGST Act (~174 sections, 5 schedules) and IGST Act (~25 sections) indexed and retrievable; GST-domain queries return actual Act text context.
**Addresses:** GST section-level query coverage (P1), IGST place-of-supply differentiator
**Avoids:** Pitfall 6 (extraction artifacts) via section-count validation script; Pitfall 4 (CGST scoring amplification) via length normalization and golden query regression

### Phase 3: Reference Data (CII Table, Due Dates, ITR Matrix)
**Rationale:** All three reference datasets are independent of each other and of the GST Acts. They share a common loading pattern via splitReferenceData(). Due dates and ITR selection are top-5 query categories; low implementation cost relative to user value.
**Delivers:** Accurate CII-informed capital gains answers (FY 2001-02 to 2025-26); compliance deadline queries answered from structured data; ITR form selection with AY 2026-27 rules.
**Addresses:** CII table (P1), due dates calendar (P1), ITR form selection matrix (P1)
**Avoids:** Pitfall 5 (structured data not retrievable by keyword) via JSON structured lookup for exact-match queries

### Phase 4: Integration Validation and Scoring Tuning
**Rationale:** After all data files are loaded, cross-domain queries must be tested to confirm no retrieval regressions, token budget is acceptable at topK=5, and source labels appear correctly in Gemini prompts.
**Delivers:** 15+ golden query regression baseline validated; inputTok delta confirmed; source labels verified in Gemini prompt; TypeScript tsc clean.
**Addresses:** Query-type-aware retrieval boosting (differentiator feature)
**Avoids:** Pitfall 4 (CGST scoring amplification discovered post-integration), Anti-Pattern 2 (topK raised without token monitoring)

### Phase Ordering Rationale

- Phase 1 must precede all others: the retrieval and chunker bugs compound with every new file added. Running Phase 2 before Phase 1 produces silent data loss that is hard to diagnose.
- Phases 2 and 3 are sequenced but could run in parallel within a team; CGST data preparation is the highest-risk item and benefits from focused attention.
- Phase 4 is always last: it requires all data to be loaded to catch cross-domain scoring interference.

### Research Flags

Phases with standard patterns (no additional research needed):
- **Phase 1:** Pure TypeScript refactor of a directly-inspected file; all change specifications with concrete code snippets are in ARCHITECTURE.md.
- **Phase 3:** Schema fully specified in STACK.md; splitReferenceData() function specified in ARCHITECTURE.md; no unknowns.
- **Phase 4:** Integration testing only -- no external research required.

Phases that may need targeted investigation during execution:
- **Phase 2 (data prep):** CBIC PDF extraction quality is unknown until attempted. If pdf-parse produces garbled text, the alternative is CBIC HTML via India Code (indiacode.nic.in). The section-count validation script is the early-warning gate.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All decisions verified against npm registry and official docs. No new packages means zero installation uncertainty. |
| Features | HIGH | Existing codebase read directly; competitor products reviewed; official CBDT/CBIC sources confirmed for CII, due dates, ITR forms. |
| Architecture | HIGH | Derived from live code inspection of server/rag/index.ts and server/routes/chat.ts -- not inferred. All bugs and fix patterns are code-level specific. |
| Pitfalls | HIGH (code bugs) / MEDIUM (CGST extraction) | Chunker and retrieval bugs confirmed by direct code inspection. CGST PDF extraction quality is unknown until attempted. |

**Overall confidence:** HIGH

### Gaps to Address

- **CGST Act PDF extraction quality:** Unknown until extraction is attempted. The section-count validation gate (assert more than 150 matches before writing chunker code) is the correct handling strategy.
- **Scoring normalization tuning:** Length normalization is recommended but per-source cap values should be tuned empirically against the 15-query golden set, not pre-determined.
- **topK=5 token budget impact:** Expected ~25% increase on input tokens. Confirm against usageRepo inputTok averages after Phase 2 deploys, before Phase 4 closes.

---

## Sources

### Primary (HIGH confidence)
- Live codebase D:/tax-assistant/server/rag/index.ts -- all bug identification and change specifications
- Live codebase D:/tax-assistant/server/routes/chat.ts -- integration point verification
- https://cbic-gst.gov.in/pdf/CGST-Act-Updated-30092020.pdf -- official source for CGST Act text
- https://www.rsm.global/india/insights/cbdt-notifies-cost-inflation-index-cii-376-fy-2025-26 -- CII 376 for FY 2025-26 confirmed
- Kar Saathi launch BusinessToday Apr 2026 -- competitor feature baseline

### Secondary (MEDIUM confidence)
- https://weaviate.io/blog/chunking-strategies-for-rag -- hierarchical/structure-aware chunking for legal docs
- https://www.ai21.com/knowledge/rag-for-structured-data/ -- JSON lookup vs vector RAG for reference tables
- Legal Chunking Evaluating Methods ResearchGate 2024 -- legal RAG chunking evaluation
- https://cleartax.in/s/which-itr-to-file -- ITR matrix validation
- https://cleartax.in/s/due-date-tax-filing -- due dates calendar validation

### Tertiary (context/fallback)
- https://www.indiacode.nic.in/handle/123456789/2251 -- alternative HTML source for IGST Act if CBIC PDF extraction fails

---
*Research completed: 2026-04-08*
*Ready for roadmap: yes*