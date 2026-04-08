# Pitfalls Research

**Domain:** Indian Tax Assistant — v1.1 RAG Data Completeness & Quality (Adding CGST/IGST text, supplementary reference data, schedule-aware chunking, improved retrieval)
**Researched:** 2026-04-08
**Confidence:** HIGH (chunker/scorer behavior from direct code inspection), MEDIUM (CGST Act structure), HIGH (retrieval regression patterns)

---

## Critical Pitfalls

### Pitfall 1: The Balanced-Retrieval Logic Breaks When a Fourth Source Is Added

**What goes wrong:**
The current `retrieve()` function hardcodes a three-bucket balancing strategy: one slot for `comparison`, one for `act-2025`, one for `act-1961`. When a fourth source (e.g., `cgst-act`) is added, it has no bucket. It can only appear in the "fill remaining slots" pass — which only fires if one of the three named buckets fails to produce a result. For most income tax queries, all three named buckets fire and fill all three topK=3 slots. Every GST query now competes for zero reserved slots, and GST chunks never surface even when they are the most relevant results for the query.

**Why it happens:**
The bucketing logic uses hardcoded source-name comparisons (`s.chunk.source === 'comparison'`, `s.chunk.source === 'act-2025'`, `s.chunk.source === 'act-1961'`). It was designed for exactly three sources. Adding a fourth source string does nothing to the balancing code.

**How to avoid:**
Before adding any new source file, refactor the balancing strategy. Replace hardcoded per-source buckets with a source-agnostic approach: score all candidates globally, then apply a diversity rule (e.g., at most N chunks from any single source). One concrete pattern:
```typescript
// Track how many slots each source has used
const sourceCount = new Map<string, number>();
const MAX_PER_SOURCE = 1; // or 2 for topK=5
const balanced: ScoredChunk[] = [];
for (const s of scored) {
  if (balanced.length >= topK) break;
  const used = sourceCount.get(s.chunk.source) ?? 0;
  if (used < MAX_PER_SOURCE) {
    balanced.push(s);
    sourceCount.set(s.chunk.source, used + 1);
  }
}
// Fill remaining with highest scorers regardless of source
```
This is source-count-agnostic and survives adding N new sources.

**Warning signs:**
- GST queries return zero RAG context despite CGST text being loaded
- Logs show CGST chunks being indexed but never appearing in results
- `fromComparison + from2025 + from1961 >= topK` is always true when new source is present

**Phase to address:**
Refactor balancing logic before adding any new source file. Make it the first code change of the data-addition phase.

---

### Pitfall 2: The Section Regex Silently Drops All Schedule, Chapter, and Preamble Content

**What goes wrong:**
`splitIntoSections()` uses the regex `/^(\d+[A-Z]*(?:-[A-Z]+)?)\.\s/gm` to find section starts. Any content that does not begin with a numeric section number is invisible to the chunker. This includes:
- CGST Act preamble (hundreds of words of definitions context)
- Chapter headings (e.g., "CHAPTER VI — REGISTRATION")
- Schedule content (GST rate schedules: SCHEDULE I, SCHEDULE II, etc.)
- CII tables (year-indexed numeric data, no section numbers)
- Due dates calendars (structured tabular data)
- ITR matrix (form-to-eligibility lookup table)

When `splitIntoSections()` finds zero matches, it returns the entire file as a single `{ section: 'general', text: entireFile }` chunk. For a 1MB CGST Act file, this creates one massive chunk that then gets naively sliced by `subChunk()` at 1200-character boundaries mid-sentence, destroying legal context.

**Why it happens:**
The regex was designed for the IT Acts which consistently use numeric section numbering. The CGST Act uses the same pattern for sections but supplements it with extensive schedules. Supplementary reference files (CII, due dates, ITR matrix) have no section numbers at all.

**How to avoid:**
Use distinct splitter functions per file type, selected by source identifier:
- `splitIntoSections()` — existing, for act-1961 and act-2025 (already works)
- `splitCGSTSections()` — identical regex but also extracts SCHEDULE blocks via `/^SCHEDULE\s+[IVX]+/gm`
- `splitStructuredReference()` — for CII, due dates, ITR matrix: split by blank-line-separated paragraphs or by logical row groups, keeping table headers attached to every chunk
- `splitComparisonSections()` — existing, for comparison.txt (already works)

Never let a splitter return a single chunk for a file over 10KB without explicit logging.

**Warning signs:**
- Log line: `[RAG] Loaded cgst-act: 1 chunks` (should be hundreds)
- Log line: `[RAG] Loaded cii-table: 1 chunks`
- Queries about GST schedules or CII values return irrelevant IT Act sections instead of the actual data

**Phase to address:**
Schedule-aware chunking phase. Write a chunk-count assertion in the loader: throw if any source file produces fewer than 10 chunks per 50KB of input.

---

### Pitfall 3: Chunk IDs Are Array Indices — New Sources Corrupt the Inverted Index

**What goes wrong:**
Each `Chunk` has an `id` field assigned as the running array index across all sources (`let id = 0; ... id++`). The inverted index maps token → `Set<number>` where those numbers are chunk IDs. The `retrieve()` function looks up chunks by `chunks[id]`. This works as long as the `allChunks` array is stable after `buildIndex()`.

When a new source file is added, its chunks are appended to `allChunks`. If `buildIndex()` is called incrementally rather than from scratch, or if source loading order changes, the ID-to-chunk mapping becomes inconsistent. A token might point to chunk ID 1450, but `allChunks[1450]` is now a CGST chunk while the index says it's an IT Act chunk. The `.filter(Boolean)` call in `retrieve()` silently swallows missing entries.

**Why it happens:**
Array index as ID is a fragile pattern — it only works if all chunks are built in one pass and the array is never mutated after indexing. It breaks if: chunks are built in parallel, `initRAG()` is called more than once (e.g., hot reload in dev), or sources are loaded conditionally.

**How to avoid:**
Assign IDs as stable, absolute values during `buildChunks()` by passing an offset:
```typescript
function buildChunks(filePath, source, idOffset = 0): Chunk[] {
  // ... id = idOffset + localIndex
}
// In initRAG():
let offset = 0;
const compChunks = buildChunks(compPath, 'comparison', offset);
offset += compChunks.length;
const chunks2025 = buildChunks(act2025Path, 'act-2025', offset);
offset += chunks2025.length;
// etc.
```
Or switch the inverted index value from `Set<number>` (IDs) to `Set<Chunk>` references directly, eliminating the ID lookup step entirely.

**Warning signs:**
- `chunks[id]` returns `undefined` for valid IDs after adding a new source
- Retrieval returns results from wrong source (GST chunk labeled as IT Act)
- Results become inconsistent between server restarts

**Phase to address:**
Data integration phase. Add a post-build assertion: `allChunks.every((c, i) => c.id === i)` and throw if it fails.

---

### Pitfall 4: Raw Chunk Frequency Scoring Amplifies CGST Over IT Acts

**What goes wrong:**
The scorer counts raw token occurrences in chunk text: every time a token appears in a chunk, `score++`. The current `comparison` source gets a 1.5x multiplier to compensate. But CGST Act sections dealing with GST registration, returns, and invoicing repeat common terms ("taxable person", "registered", "supply", "goods") at extremely high frequency — far more than equivalent IT Act sections use "income", "assessee", or "deduction".

For mixed IT+GST queries like "GST registration for a salaried person" or "capital gains on property sold to GST-registered buyer", CGST chunks will outscore IT Act chunks heavily on raw token frequency even though both sources are needed. The IT Act context gets crowded out of topK=3.

**Why it happens:**
Raw frequency scoring (count occurrences) is not length-normalized. A 1200-character CGST chunk with 8 occurrences of "registered" scores higher than a 900-character IT Act chunk with 5 occurrences of "capital gains" — even if the IT Act chunk is more relevant to the query's primary intent.

**How to avoid:**
Normalize scores by chunk length (characters or word count) before comparing across sources. Implement a simple TF-style normalization:
```typescript
const normalizedScore = rawScore / Math.sqrt(chunk.text.length);
```
Alternatively, set per-source score caps: no single source can contribute more than 60% of total topK slots regardless of raw score. Measure this against a golden query set (at least 10 queries known to need IT Act context) before and after CGST data is added.

**Warning signs:**
- IT Act queries about deductions or TDS now return CGST chunks
- Queries like "Section 80C deduction limit" return CGST registration sections
- Comparison document chunks disappear from results entirely

**Phase to address:**
Retrieval quality improvement phase. Establish a regression baseline with 15+ query-source pairs before adding CGST data.

---

### Pitfall 5: Structured Reference Data (CII Table, Due Dates) Cannot Be Retrieved by Keyword

**What goes wrong:**
The CII table contains rows like `2001-02 | 100`, `2023-24 | 348`, `2024-25 | 363`. The due date calendar contains entries like `15 June | Advance tax — 15% of estimated liability`. The ITR matrix contains form-eligibility rules like `ITR-1 | Resident individual | Salary + one house property`.

These are all lookup structures. A user query like "What is the CII for FY 2023-24?" tokenizes to `['cii', 'fy', '2023', '24']`. The inverted index will find chunks containing "cii" or "2023" — but "2023" appears in hundreds of IT Act amendment notes. The CII chunk scores 1 for "2023" plus 1 for "24"; an IT Act amendment section discussing 2023 amendments scores higher because it mentions "2023" four times. The correct CII chunk loses.

Even if it wins, the retrieved text is a raw table fragment: `2022-23 | 331\n2023-24 | 348\n2024-25 | 363`. The LLM gets the right data only if the table header ("Cost Inflation Index Table") was included in that exact chunk. Without header context, Gemini cannot tell the user what the numbers mean.

**Why it happens:**
Keyword scoring was designed for prose legal text where relevant sections discuss the query topic in full sentences. Reference tables have minimal prose — mostly numbers and short labels. The query terms and document terms don't overlap naturally.

**How to avoid:**
1. Keep table headers attached to every chunk: when chunking the CII table, prefix every chunk with the header row even if it means repeating text.
2. Add a query type detector for reference queries: if query matches patterns like "CII for FY \d{4}", "due date for \w+", "which ITR form for \w+", route to a dedicated lookup handler that does exact/regex matching against the structured file rather than keyword scoring.
3. For due dates and ITR matrix, store as JSON or structured data file and do lookup by key, bypassing keyword RAG entirely.

**Warning signs:**
- "What is CII for FY 2024-25?" returns IT Act amendment sections instead of the CII value
- Users report wrong or missing due dates
- ITR form eligibility answers don't match actual matrix

**Phase to address:**
Supplementary reference data phase. Build the structured lookup handler before adding the data files.

---

### Pitfall 6: CGST Act File Quality Is Unknown Until Extraction — Extraction Artifacts Break the Chunker

**What goes wrong:**
The IT Acts were already extracted and are in `act-1961.txt` and `act-2025.txt`. The CGST Act must be obtained from CBIC PDFs or bare law compilations. PDF-to-text extraction of legal documents commonly produces:
- Section numbers separated from their text by newlines: `\n73.\n(1) Where any tax payable...` (the regex `/^(\d+[A-Z]*)\.\s/gm` requires the number and dot to be followed by a space on the same line)
- Headers repeated on every page (running headers like "CHAPTER V — INPUT TAX CREDIT" inserted mid-section)
- Line numbers or page numbers embedded in text: `Page 47 of 162` appearing between subsections
- Ligatures and Unicode issues: `fi` → `ﬁ`, section symbol `§` → garbage characters
- Table content flattened: GST rate schedules become walls of unparseable text

If the extraction produces garbled text and `splitIntoSections()` finds only 3 matches in a 200-section Act, it will silently generate 3 enormous chunks that get sliced at arbitrary character boundaries.

**Why it happens:**
PDF extraction quality varies wildly by tool and source PDF quality. Legal PDFs from government sources often have OCR artifacts or column layouts that confuse linear text extractors.

**How to avoid:**
1. Validate extraction quality before writing the chunker: open the extracted text file and manually verify 5 randomly selected sections appear intact.
2. Write a validation script that counts section matches against expected count: CGST Act has ~174 sections — if extraction produces fewer than 100 matches, flag it.
3. Use a multi-step cleaning pipeline: normalize Unicode, strip page headers (detect repeated phrases), join split section numbers, before passing to the chunker.
4. Test with the same `splitIntoSections()` function on a 10-section sample before committing to the full file.

**Warning signs:**
- `[RAG] Loaded cgst-act: N chunks` where N < 100 for the full CGST Act
- Chunks contain strings like "Page 47 of 162" or repeated chapter headers
- Section numbers appear on their own line without associated text

**Phase to address:**
CGST data preparation phase, before any chunker code is written.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoded source names in balancing logic | Works for current 3 sources | Every new source requires code changes; easy to forget | Never — takes 30 minutes to make source-agnostic |
| Array index as chunk ID | Simple to implement | Fragile when source loading order changes or is conditional | Only if loading order is strictly fixed and tested |
| Single `splitIntoSections()` for all files | No new code | Silently drops all schedule/structured content | Never for files with different structures |
| topK=3 unchanged when adding 2+ new sources | No tuning required | Every query saturates slots; new sources never appear | Acceptable only if sources are mutually exclusive by topic |
| Storing CII/due-dates in prose-style text | Uniform data loading | Keyword RAG cannot retrieve exact values reliably | Never — use structured lookup for tabular reference data |
| No chunk-count assertions in loader | Faster startup | Silent data loss when extraction fails | Never — add one log line per source |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| CGST Act text file | Assume PDF extraction produces clean numbered sections | Validate extraction: count section matches, inspect 5 random sections manually before building chunker |
| CII / due dates / ITR matrix | Load as text files and run through keyword RAG | Implement structured lookup (JSON + key match) for reference data; keyword RAG is for prose legal text |
| New source in `initRAG()` | Append `allChunks.push(...newChunks)` after `buildIndex()` was already called | Always call `buildIndex(allChunks)` after all sources are loaded; never call it mid-load |
| `Chunk.source` type union | Add new source string without updating TypeScript type | Update `source` type first: `'act-2025' | 'act-1961' | 'comparison' | 'cgst-act' | 'reference'` — TypeScript will surface every place that needs updating |
| `retrieveContext()` label string | `comparison` → "Comparison Guide", `act-2025` → "IT Act 2025" mapping is hardcoded | Add new source to label map before it can appear in results; unlabeled source will show raw source ID to Gemini |
| Balanced retrieval with new source | Add source to `buildChunks()` but not to balancing buckets | Refactor balancing to be source-count-agnostic before adding any new source |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Inverted index size grows quadratically with corpus | Startup time increases; `buildIndex()` takes 2-5 seconds | Index only non-stopword tokens > 2 chars (already done); add token deduplication per chunk | Around 10,000+ chunks (CGST adds ~800-1200, total becomes ~4000+ — still fine) |
| `subChunk()` creates too many 1200-char slices from large CGST sections | Hundreds of near-duplicate chunks with overlapping text; index becomes noisy | Increase `MAX_CHUNK_SIZE` to 2000 for legal text (sections have meaningful sub-structure); use paragraph boundaries for split points | Immediately visible if CGST section 73 (recovery of tax) generates 15+ parts |
| All chunks scored even through inverted index fast-path | O(n) fallback scoring when query tokens are common words | Ensure stopwords list covers CGST-specific filler terms ("supply", "goods", "person", "act") that appear in every CGST chunk | When CGST adds 1000+ chunks all containing "supply", every GST query becomes O(1000) |
| `readFileSync` at startup for all data files | Acceptable at 3 files/4.7MB; slower as files grow | Current approach is fine for up to ~15MB; log startup time as CGST adds 2-4MB | Above 20MB total, consider lazy loading or pre-built chunk cache |

---

## "Looks Done But Isn't" Checklist

- [ ] **CGST chunker:** `[RAG] Loaded cgst-act: N chunks` — verify N > 150 (CGST has ~174 sections + schedules); if N < 50, extraction failed silently
- [ ] **CII retrieval:** Test query "What is the CII for FY 2023-24?" — verify response contains `348` (the actual value); if it returns IT Act amendment text, the structured lookup is not wired
- [ ] **Balanced retrieval with 4+ sources:** Test "GST registration requirements" — verify CGST chunk appears in context; if only IT Act chunks returned, balancing logic still hardcoded to 3 sources
- [ ] **Schedule retrieval:** Test "What is GST rate on services in Schedule II?" — verify schedule content appears; if no result, schedule splitter not implemented
- [ ] **Existing query regression:** Run baseline query set (Section 80C limit, TDS Section 194C, old vs new Act comparison) — verify comparison and IT Act chunks still appear; if CGST chunks crowd them out, scoring normalization needed
- [ ] **Source label in context:** Check Gemini prompt for new source — verify label is human-readable ("CGST Act 2017", not "cgst-act"); unlabeled source confuses Gemini's citation behavior
- [ ] **TypeScript type exhaustiveness:** `Chunk.source` union updated — verify `tsc --noEmit` passes with new source value; TypeScript will catch all unhandled switch cases

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Balancing logic blocks new source from appearing | LOW | Refactor to source-agnostic bucketing (2-3 hours); no data changes needed |
| CGST extraction produced garbage text | MEDIUM | Re-extract using different tool (pdftotext, PDF.js, or manual copy from CBIC HTML); re-validate; 1-2 days |
| Existing queries regressed after adding CGST | MEDIUM | Add per-source score cap or length normalization; re-run golden query set; 4-8 hours |
| CII/due-dates returning wrong results | LOW | Move to structured JSON lookup; keyword RAG path unchanged; 2-4 hours |
| Chunk IDs corrupt after source reorder | LOW | Rebuild index from scratch (already happens at startup); fix ID assignment to use offsets; 1-2 hours |
| Schedule content silently dropped | LOW | Add schedule-specific splitter; verify chunk count after; 2-4 hours |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Balanced retrieval hardcoded to 3 sources | Phase 1: Retrieval refactor (before any new source added) | Test with mock 4th source; verify it appears in topK results |
| Section regex drops schedules/chapters | Phase 2: Schedule-aware chunker | Assert chunk count > 150 for CGST; assert schedule sections present |
| Array index chunk IDs | Phase 1: Retrieval refactor | Post-build assertion `allChunks.every((c,i) => c.id === i)` |
| Raw frequency scoring amplifies CGST | Phase 3: Scoring normalization | Run 15-query golden set before/after CGST addition; zero regressions |
| Structured reference data keyword failure | Phase 4: Supplementary data with structured lookup | Integration test: CII query returns exact numeric value |
| CGST extraction artifacts | Phase 2 prerequisite: Data preparation | Manual inspection + section count validation script before any code |

---

## Sources

- Direct code inspection: `D:/tax-assistant/server/rag/index.ts` (retrieval logic, balancing, scoring, chunker)
- [Legal Chunking: Evaluating Methods for Effective Legal Text Retrieval](https://www.researchgate.net/publication/386472016_Legal_Chunking_Evaluating_Methods_for_Effective_Legal_Text_Retrieval) — MEDIUM confidence, WebSearch verified
- [Towards Reliable Retrieval in RAG Systems for Large Legal Datasets](https://arxiv.org/html/2510.06999v1) — Document-Level Retrieval Mismatch (DRM) research
- [RAG for Legal Documents](https://ipchimp.co.uk/2024/02/16/rag-for-legal-documents/) — Legal RAG structural challenges
- [Practical BM25 — The BM25 Algorithm and its Variables](https://www.elastic.co/blog/practical-bm25-part-2-the-bm25-algorithm-and-its-variables) — IDF instability when corpus grows
- [Optimizing Retrieval Augmentation with Dynamic Top-K Tuning](https://medium.com/@sauravjoshi23/optimizing-retrieval-augmentation-with-dynamic-top-k-tuning-for-efficient-question-answering-11961503d4ae) — Rank shifting when new docs added
- [RAG for Structured Data: Benefits, Challenges](https://www.ai21.com/knowledge/rag-for-structured-data/) — Tables/structured data in RAG pipelines
- [Preserving Table Structure for Better Retrieval](https://unstructured.io/blog/preserving-table-structure-for-better-retrieval) — Table chunking pitfalls
- [Building a Golden Dataset for AI Evaluation](https://www.getmaxim.ai/articles/building-a-golden-dataset-for-ai-evaluation-a-step-by-step-guide/) — Regression testing with golden query sets
- CBIC CGST Act structure: [cbic-gst.gov.in/gst-acts.html](https://cbic-gst.gov.in/gst-acts.html)

---
*Pitfalls research for: Indian Tax Assistant v1.1 — RAG Data Completeness & Quality*
*Researched: 2026-04-08*
