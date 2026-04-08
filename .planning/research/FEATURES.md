# Feature Research

**Domain:** Indian Tax Assistant Chatbot — RAG Data Completeness & Quality (v1.1)
**Researched:** 2026-04-08
**Confidence:** HIGH (existing codebase read directly; data sources verified via official CBIC/CBDT sources and competitor products)

---

## Context: What Already Exists (Do Not Regress)

This is a subsequent milestone. The following are already shipped and must be preserved:

| Already Built | Status |
|---|---|
| IT Act 1961 full text (49K lines, 942 sections) | Stable — `data/act-1961.txt` |
| IT Act 2025 full text (33K lines, 551 sections) | Stable — `data/act-2025.txt` |
| Comparison document (1285 lines, 40 sections) | Stable — `data/comparison.txt` |
| Keyword RAG: inverted index + section scoring | Stable — `server/rag/index.ts` |
| GST coverage via comparison.txt sections 10, 25 | Partial — rate structure, composition, RCM, e-invoicing, ITC restrictions, key section refs |
| RAG chunker: section-number regex (`^\d+[A-Z]*`) | Works for numbered sections; fails silently for schedules, chapter headings, tables, reference data |

**Key technical gap in existing chunker:** `splitIntoSections()` uses `/^(\d+[A-Z]*(?:-[A-Z]+)?)\.\s/gm` — any content that doesn't start with a section number (CGST schedules, IT Act schedules, CII table rows, due date tables, ITR matrix) falls through to a single `{ section: 'general', text: entireFile }` blob. This blob is unchunkable and unfindable by keyword scoring. Fixing this is a prerequisite for all new data files to work.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or gives wrong answers.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| GST section-level query coverage (CGST + IGST Act text) | Users ask about ITC eligibility, place of supply, GST registration, refunds, demand/recovery — these require actual section text, not the summary already in comparison.txt. Current RAG returns no context for queries like "what is Section 17(5)" or "place of supply for software services". | HIGH | CGST Act: 21 chapters, ~174 sections, 5 schedules. IGST Act: ~25 sections, place-of-supply rules in Sections 10-13. Official text from cbic-gst.gov.in. GST rate schedules restructured into 7 slabs effective 22 Sep 2025. Finance Act 2025 amendments effective 1 Apr 2025. |
| CII table for capital gains calculations | Capital gains queries ("what is my indexed acquisition cost?") require CII values for each FY since 2001-02. CBDT notified CII 376 for FY 2025-26. Without this table in RAG, the assistant must hallucinate or guess CII values. | LOW | Static lookup: FY 2001-02 (base year, index 100) through FY 2025-26 (index 376). ~25 rows. CBDT Notification No. 70/2025 dated 01 Jul 2025. Important: indexation removed from 23 Jul 2024 for most assets except land/building acquired before that date — this rule-change context already exists in comparison.txt capital gains section. |
| Tax compliance due dates calendar | "When is advance tax due?", "TDS deposit deadline?", "ITR filing last date?" are among the most frequent tax queries. Currently the assistant has no structured data for these — it relies on Gemini's training knowledge, which may be stale for FY 2025-26 specific dates. | LOW | Key FY 2025-26 dates: ITR Jul 31 2026 (individuals, non-audit), Sep 30 2026 (audit cases); advance tax Jun 15/Sep 15/Dec 15/Mar 15 (15%/45%/75%/100%); TDS deposit 7th following month (government same day); GSTR-1 11th monthly/13th QRMP; GSTR-3B 20th (large), 22nd/24th (small). Static structured data, fits in 2-3 chunks. |
| ITR form selection matrix | "Which ITR should I file?" is a top-5 tax query. The decision logic has meaningful complexity (ITR-1 vs ITR-2 vs ITR-3 vs ITR-4 depends on income sources, amount, residential status, company directorship). AY 2026-27 change: LTCG under Section 112A up to ₹1.25L is now ITR-1 eligible. Without a structured matrix in RAG, the assistant gives generic guidance. | LOW | ITR-1: salary ≤50L, LTCG 112A ≤1.25L, one house property. ITR-2: multiple house properties, capital gains (other), foreign income, income >50L, NRI/RNOR, company director. ITR-3: business/profession income (non-presumptive). ITR-4: presumptive scheme (44AD/44ADA/44AE) income ≤50L. ITR-5/6/7: firms/companies/trusts. |
| Schedule-aware RAG chunking | All new data files (CGST schedules, CII table, due dates, ITR matrix) plus existing IT Act schedules (14-16 of them) currently fall through to a `general` chunk. Unindexable. | MEDIUM | Fix `splitIntoSections()` to detect: `SCHEDULE [IVX]+`, `CHAPTER [IVX]+` headings, `===` delimiters (already handled for comparison.txt), table headers. Assign labels like `Schedule-III-CGST`, `CII-table`, `Due-dates-FY2025-26`, `ITR-selection-matrix`. The fix is surgical — modify the chunker to handle multiple content patterns. |
| Source-type-aware retrieval scoring | After adding CGST/IGST, CII, due dates, ITR matrix as new sources, the current balanced-retrieval logic (1 chunk from each of 3 sources) will under-serve queries targeting specific new sources. A GST query should weight CGST chunks; a capital gains query should weight CII and comparison chunks. | MEDIUM | Extend `Chunk` type with new source values: `cgst`, `igst`, `cii-table`, `due-dates`, `itr-matrix`. Extend `scoreChunk()` with source-type boosting based on query keyword heuristics. Replace rigid 1-per-source balancing with a smarter selection that fills topK from highest-scoring candidates with a soft diversity nudge. |

### Differentiators (Competitive Advantage)

Features that set this assistant apart. Not required for basic function, but increase answer quality and user trust.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Both IT Acts (1961 + 2025) during transition period | No other tool covers both Acts simultaneously with cross-references. Payments before/after 1 Apr 2026 fall under different Acts. This is already built — it is a genuine differentiator vs Kar Saathi (2025 Act only) and ClearTax/TaxBuddy (neither Act text). | LOW (already exists) | Preserve comparison.txt as the cross-reference anchor. CGST/IGST addition extends this multi-layer coverage to GST. |
| GST place-of-supply answers from actual IGST text | "Is software support to a foreign client zero-rated?" "What is POS for events held in multiple states?" — these require Sections 12/13 IGST Act text with all conditions. Comparison.txt has a one-paragraph summary; the actual act text provides the sub-condition granularity. | MEDIUM | Covered once IGST Act is loaded. Chunker must keep POS sections cohesive (they have condition tables spanning multiple subsections). |
| CII-informed capital gains with correct Jul 2024 rule | Historical CII values + the rule change (indexation removed from Jul 23 2024 for most assets; land/building can choose 20% with indexation OR 12.5% without) together let the assistant give precise capital gains answers. Comparison.txt already has the rule-change context. Adding CII values completes it. | LOW | CII table is the missing piece. The rule context is already in RAG. Together these enable accurate answers like "you bought in FY 2010-11 (CII 167), selling now (CII 363), indexed cost = purchase × 363/167". |
| Query-type-aware retrieval boosting | Different query types need different source mixes. GST queries should weight CGST chunks. Capital gains queries should weight CII + comparison chunks. ITR queries should weight itr-matrix chunks. The current flat keyword scoring treats all sources equally, creating retrieval noise. | MEDIUM | Add a `detectQueryDomain()` function that classifies queries as `gst`, `capital-gains`, `itr-selection`, `due-dates`, `income-tax` based on keyword presence. Apply per-domain source-type multipliers to scores. This is an extension of the existing `1.5x comparison boost` pattern. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full CGST Rules 2017 as RAG data | Complete coverage feels more authoritative | Rules are ~250+ rules, verbose (~200K+ words), frequently amended via CGST Amendment Rules. Loading all rule text would dilute the chunk pool and create retrieval noise — the LLM already has strong knowledge of common rules from training data. | Load Act text (sections only). Add a curated rules-summary for the 5-6 highest-query topics: Rule 36 (ITC reconciliation), Rule 86B (1% cash payment), Rule 42/43 (ITC reversal), e-invoicing thresholds. Add to comparison.txt additions, not as raw rules text. |
| Finance Act amendment text as standalone RAG files | Keeps content current | Finance Act text is structured as patches ("in section X, substitute Y for Z") — unreadable as standalone context and actively confuses the LLM with partial sentences. | Update comparison.txt when significant amendments occur. This is already the established pattern — comparison.txt was manually crafted to capture the most important changes. |
| Full HSN-wise GST rate schedule | Users want exact rates by commodity | GST rate schedules restructured into 7 schedules with hundreds of HSN entries — a lookup problem, not a chat problem. Loading the full rate schedule creates enormous chunk volume with poor answer quality. | Cover common categories in comparison.txt (0%, 5%, 12%, 18%, 28% with representative goods/services). Refer users to CBIC GST rate finder for specific HSN queries. |
| Semantic/vector embedding RAG to replace keyword RAG | Better fuzzy query matching | Requires embedding model infrastructure (API costs, latency increase, dependency on embedding service). The existing keyword RAG with inverted index is fast, free, and works well for a legal domain where users use precise terms. "Section 17(5)" always wins over fuzzy matching in a tax corpus. | Improve keyword scoring heuristics (source-type boosting, query domain detection). Keep semantic search as a v2 option only if keyword RAG demonstrably fails on specific query patterns. |
| CBDT Circular corpus | Comprehensive coverage | CBDT has hundreds of circulars, many superseded. Loading all of them creates retrieval noise and stale-answer risk. The most critical circular content (CII values, transitional notices) is better embedded as structured reference data. | CII values go in `cii-table.txt`. Transitional Section 536 guidance already in comparison.txt. TDS operational guidance already in comparison.txt Section 3. |

---

## Feature Dependencies

```
[Schedule-aware RAG chunker]  ← prerequisite for everything below
    └──required-by──> [CGST Act text] (5 schedules, chapter headers, rate tables)
    └──required-by──> [IGST Act text] (chapter headers, POS condition tables)
    └──required-by──> [CII table] (tabular data, no section numbers)
    └──required-by──> [Due dates calendar] (structured reference table, no section numbers)
    └──required-by──> [ITR form matrix] (decision table, no section numbers)
    └──also-fixes──> [IT Act 1961/2025 schedules] (currently fall to 'general' blob)

[CGST Act full text]
    └──enables──> [GST section-level queries] (S.9 levy, S.16 ITC, S.17 blocked credits, S.54 refunds)
    └──enables──> [Composition scheme detail queries] (S.10)
    └──enables──> [GST TDS/TCS queries] (S.51, S.52)
    └──depends-on──> [Schedule-aware chunker] (5 schedules would be swallowed by 'general' without it)

[IGST Act full text]
    └──enables──> [Place of supply queries] (S.10-13: goods, services, online services, import/export)
    └──enables──> [Interstate vs intrastate classification]
    └──depends-on──> [Schedule-aware chunker]

[CII table data]
    └──enables──> [Accurate indexed cost calculations]
    └──complements──> [comparison.txt capital gains section] (rule-change context already present)
    └──depends-on──> [Schedule-aware chunker] (tabular format)

[Due dates calendar]
    └──enables──> [Compliance deadline queries] (advance tax, TDS, ITR, GST returns)
    └──depends-on──> [Schedule-aware chunker]
    └──independent-of──> [CII table, ITR matrix, CGST Act]

[ITR form selection matrix]
    └──enables──> [Which ITR to file queries]
    └──cross-references──> [IT Act 2025 Section 263] (return filing provisions)
    └──depends-on──> [Schedule-aware chunker]
    └──independent-of──> [CGST Act, CII table, due dates]

[Source-type-aware retrieval scoring]
    └──enhances──> [All new data sources] (ensures new chunks compete fairly with existing IT Act chunks)
    └──depends-on──> [New source types registered in Chunk type]
    └──not-a-blocker──> system degrades gracefully without it (returns lower-relevance but not wrong context)
```

### Dependency Notes

- **Schedule-aware chunker is the only hard prerequisite.** Everything else depends on it. Without it, all new data files load as a single `general` chunk with zero retrievability.
- **CGST and IGST Acts are independent of each other** in loading order, but logically paired — CGST covers intra-state and general provisions; IGST covers inter-state and place-of-supply. Both should ship together.
- **CII table, due dates, and ITR matrix are fully independent.** They can be added in any order once the chunker handles non-section-numbered content.
- **Source-type scoring enhances but does not block.** The system works without it — new sources will be indexed and scored by keyword frequency, just without domain-based boosting. Ship after core data files are loaded and tested.

---

## MVP Definition

### Launch With (v1.1 — this milestone)

All items below are required for the stated milestone goal: "comprehensive RAG data coverage."

- [ ] Schedule-aware RAG chunker — prerequisite; all new files are unreachable without this
- [ ] CGST Act full text (21 chapters, ~174 sections, 5 schedules) — closes the largest GST query gap
- [ ] IGST Act full text (~25 sections including POS rules) — closes interstate supply and export/import gaps
- [ ] CII table FY 2001-02 to FY 2025-26 — low cost, high value, completes capital gains query chain
- [ ] Due dates calendar FY 2025-26 — highest query frequency category, lowest implementation cost
- [ ] ITR form selection matrix AY 2026-27 — high query frequency, structured decision logic
- [ ] Source-type-aware retrieval with new source labels — ensures new data competes fairly; extends existing score-boosting pattern

### Add After Validation (v1.x)

- [ ] CGST Rules curated summary (Rule 36/42/43/86B) — add if retrieval gaps on ITC reversal and cash payment rule questions are observed post-launch
- [ ] Updated CII table for FY 2026-27 — add once CBDT notifies the value (typically by July of the tax year)
- [ ] GST rate categories reference (top 20 frequently asked goods/services) — add if users frequently ask HSN-level questions not covered by Act context

### Future Consideration (v2+)

- [ ] Semantic/vector embedding retrieval — defer; keyword RAG is adequate for precise legal terminology and requires no infrastructure cost
- [ ] Full HSN-wise GST rate schedule — requires dedicated lookup UI, not chat retrieval
- [ ] Finance Act amendment corpus — amendment text is not useful as raw RAG context; update comparison.txt manually instead

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Schedule-aware RAG chunker | HIGH (prerequisite) | MEDIUM | P1 |
| CGST Act full text | HIGH | MEDIUM | P1 |
| IGST Act full text | HIGH | LOW (smaller act) | P1 |
| Due dates calendar | HIGH | LOW | P1 |
| CII table | MEDIUM | LOW | P1 |
| ITR form matrix | HIGH | LOW | P1 |
| Source-type retrieval scoring | MEDIUM | LOW | P1 |
| CGST Rules curated summary | MEDIUM | MEDIUM | P2 |
| GST rate categories reference | MEDIUM | LOW | P2 |
| Semantic search | HIGH (long-term) | HIGH | P3 |
| Full HSN rate schedule | MEDIUM | HIGH (lookup infra) | P3 |

**Priority key:**
- P1: Must have for v1.1 milestone
- P2: Should have, add after v1.1 ships and retrieval gaps are observed
- P3: Requires significant new infrastructure, defer to later milestone

---

## Competitor Feature Analysis

| Feature | Kar Saathi (CBDT, Apr 2026) | ClearTax / TaxBuddy | Our Approach |
|---------|------------------------------|---------------------|--------------|
| IT Act 2025 coverage | Yes (primary focus) | Calculator-based (no act text) | Full text in RAG |
| IT Act 1961 coverage | No (only 2025) | No | Full text in RAG + comparison doc |
| GST section-level queries | Basic FAQ | Calculator-based | CGST + IGST Act text via RAG |
| Capital gains with CII | Basic | Calculator (user inputs CII) | CII table in RAG for conversational answers |
| Compliance due dates | Static help page | Static calendar page | Embedded in RAG for natural query answers |
| ITR form selection | FAQ wizard | Guided questionnaire | RAG matrix + AI reasoning |
| Section citations in answers | No | No | Yes (section numbers cited in responses) |
| Both Acts during transition | No | No | Core differentiator — comparison.txt + both act texts |

---

## Sources

- [Kar Saathi AI chatbot launch — BusinessToday, Apr 2026](https://www.businesstoday.in/personal-finance/tax/story/income-tax-dept-launches-kar-saathi-ai-chatbot-with-new-website-ahead-of-itr-season-523728-2026-04-02)
- [CBDT CII notification FY 2025-26 (CII = 376) — RSM India](https://www.rsm.global/india/insights/cbdt-notifies-cost-inflation-index-cii-376-fy-2025-26)
- [CII table — Income Tax India official](https://incometaxindia.gov.in/charts%20%20tables/cost-inflation-index.htm)
- [Which ITR form to file FY 2025-26 — ClearTax](https://cleartax.in/s/which-itr-to-file)
- [ITR filing due dates FY 2025-26 — ClearTax](https://cleartax.in/s/due-date-tax-filing)
- [Tax compliance calendar FY 2025-26 — ClearTax](https://cleartax.in/s/compliance-calendar)
- [CGST Act full text — CBIC official](https://cbic-gst.gov.in/gst-acts.html)
- [CGST Act all sections — AUBSP](https://www.aubsp.com/all-sections-cgst-act/)
- [GST rate restructure Sep 2025 — Lexology](https://www.lexology.com/library/detail.aspx?g=69360233-eb7c-41f8-a2b7-4e3f76480c5c)
- [RAG chunking for legal documents — Milvus](https://milvus.io/ai-quick-reference/what-are-best-practices-for-chunking-lengthy-legal-documents-for-vectorization)
- [Best chunking strategies RAG 2025 — Firecrawl](https://www.firecrawl.dev/blog/best-chunking-strategies-rag)
- [ITR form selection AY 2026-27 — ClearTax](https://cleartax.in/s/itr2)

---

*Feature research for: Indian Tax Assistant — v1.1 milestone (RAG Data Completeness & Quality)*
*Researched: 2026-04-08*
