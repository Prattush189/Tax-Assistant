# Stack Research

**Domain:** React chat app — Express backend proxy, enhanced visualizations, tax calculator UI, PDF document handling, iframe plugin hardening
**Researched:** 2026-04-04 (v1.0) · Updated: 2026-04-08 (v1.1 RAG additions)
**Confidence:** HIGH (all critical decisions verified against npm registry data and official docs)

---

> This file covers ONLY new additions. The existing stack (React 19, TypeScript, Vite, Tailwind CSS v4, @google/genai, Recharts 3.x, react-markdown, motion, lucide-react, clsx, tailwind-merge, multer, cors, helmet, express-rate-limit, pdf-parse, better-sqlite3, concurrently) is already installed and validated.

---

## v1.0 Stack (Established — Do Not Re-research)

See the section below the v1.1 additions for the complete v1.0 decisions. All packages listed in package.json are installed and working.

---

## v1.1 Stack Additions — RAG Data Completeness & Quality

This section covers ONLY what is new for the RAG improvement milestone. The goal is minimal new dependencies — most of the work is algorithmic improvements to the existing `server/rag/index.ts` and new data files, not new packages.

### Decision: No New npm Packages Required for Core RAG

**Verdict:** The existing stack is sufficient. The current keyword-based inverted index in `server/rag/index.ts` does not need to be replaced with BM25 or embeddings for this milestone. The milestone is about data coverage and chunking correctness — fixing what the retriever operates on, not the retrieval algorithm itself.

BM25 packages (okapibm25, wink-bm25-text-search, fast-bm25) were evaluated and rejected for this milestone. See "Alternatives Considered" below.

Embedding models (sentence-transformers, @xenova/transformers) were evaluated and rejected. See "What NOT to Add" below.

### What IS Needed

The work is in three areas: new data files, improved chunker logic, and improved scoring. All three are changes to existing TypeScript files, not new packages.

---

### Data Files — New Additions

| File | Format | Purpose | Where to Get It |
|------|--------|---------|----------------|
| `server/data/cgst-act.txt` | Plain text | CGST Act 2017 full text for GST query support | CBIC official PDF at cbic-gst.gov.in, extract with existing pdf-parse (already installed) |
| `server/data/igst-act.txt` | Plain text | IGST Act 2017 full text for inter-state supply queries | CBIC official PDF, same extraction process |
| `server/data/reference.json` | JSON | CII table, due dates calendar, ITR form matrix | Hand-authored from official CBDT sources, versioned in repo |

**Why plain text for Acts:** The existing pipeline reads `.txt` files with `readFileSync`. The CGST and IGST Acts are structured identically to the Income Tax Acts — numbered sections (`2.`, `9.`, `16.`), schedules at the end, and chapter headings. The same file format keeps the ingestion path unchanged.

**Why JSON for reference data:** CII values, due dates, and ITR form eligibility are lookup tables — highly structured, queried exactly, and update annually. Encoding them as JSON lets the retriever answer "what is the CII for FY 2023-24?" with a direct lookup rather than keyword search over prose text. The JSON is loaded at startup alongside the text files and formatted into readable prose chunks for RAG injection.

---

### Chunker Improvements — Pure TypeScript Changes

The current `splitIntoSections()` regex (`/^(\d+[A-Z]*(?:-[A-Z]+)?)\.\s/gm`) only matches numbered section starts. CGST/IGST Acts and IT Act schedules have additional structural patterns that produce "general" fallback chunks — large undifferentiated blobs that score poorly.

**What needs to change in `server/rag/index.ts` (no new packages):**

**1. Chapter header detection**

Pattern to add: `/^CHAPTER\s+[IVXLCDM]+\s*[-—]?\s*(.+)/gm`

Chapters in CGST Act: "CHAPTER I — PRELIMINARY", "CHAPTER VIII — RETURNS". These should become top-level grouping markers so sections within a chapter carry chapter context in their metadata.

**2. Schedule detection**

Pattern to add: `/^SCHEDULE\s+[IVXLCDM]+/gm` and `/^THE\s+\w+\s+SCHEDULE/gm`

CGST has 5 schedules (activities treated as supply, activities exempt from supply, etc.). Without schedule-aware splitting, each schedule becomes a single "general" chunk up to 1200 chars that gets arbitrarily sub-chunked at character boundaries, losing the schedule's semantic unit.

**3. Definition sections**

Pattern to add: detect and group `PART` headers in large definition sections: `/^PART\s+[IVXLCDM]+/gm`

**4. Source type extension**

Add `'cgst'` and `'igst'` and `'reference'` to the `Chunk['source']` union type. Update `buildChunks()` dispatch and `retrieveContext()` labels.

**5. Reference data loader**

New function `buildReferenceChunks(filePath: string): Chunk[]` that reads `reference.json`, iterates each table entry, and formats it as a prose string chunk (e.g., `"CII for FY 2023-24 is 348. CII for FY 2024-25 is 363."`). Each row becomes its own chunk with section = `"CII Table"` or `"ITR Form Matrix"` etc.

---

### Retrieval Scoring Improvements — Pure TypeScript Changes

**Current issues identified from code review:**

1. The `scoreChunk()` function treats all term matches equally. "HUF" or "CGST" appearing in a chunk body scores the same as a section-number direct match — but the section-number boost (+50) already corrects for this. The gap is query-type detection.

2. The balanced retriever (`fromComparison`, `from2025`, `from1961`) hardcodes one chunk per source. With GST data added, a GST-specific query will waste slots fetching from IT Act sources when no relevant IT Act content exists.

3. The score minimum threshold of `< 2` causes empty results for short queries. Queries like "CII 2024" or "ITR 3 eligibility" tokenize to 2 content words with limited overlap.

**What to change in `server/rag/index.ts`:**

**1. Source group cap — remove hardcoded balance**

Replace the 1-per-source balance logic with score-based selection: take top-K by score, but deduplicate so no more than 2 chunks from the same section (to avoid returning part 1 + part 2 + part 3 of the same section). This lets GST queries return 3 CGST chunks instead of being forced to return an irrelevant IT Act chunk.

**2. Chapter/source metadata in scoring**

Add `chapter` field to the `Chunk` type. When scoring, give +10 bonus to chunks whose `chapter` metadata matches a chapter keyword in the query (e.g., query contains "registration" → boost chunks in CHAPTER VI — REGISTRATION).

**3. Reference data priority**

For lookups that match a reference chunk (CII, due dates, ITR eligibility), boost score by 2x — these provide exact answers, not prose context, so they should win over related-but-indirect Act section text.

**4. Lower minimum score threshold for short queries**

Change `scored[0].score < 2` to `scored[0].score < 1`. Short numeric queries ("CII 2024") produce valid single-token matches. The current floor drops them.

---

### Supporting Libraries — Evaluation Results

**BM25 — Evaluated, Rejected for v1.1**

| Library | Version | ESM | Assessment |
|---------|---------|-----|------------|
| `okapibm25` | unknown (300K+ downloads/yr) | Unconfirmed | Pure function API, strongly typed. No index — re-computes on every call over entire corpus. Not suitable for incremental startup index used by this project. |
| `wink-bm25-text-search` | 3.1.2 | CJS only | Pulls in wink-nlp + wink-eng-lite-web-model (large NLP model ~40MB). The model download at startup is incompatible with the lightweight in-process design. |
| `fast-bm25` | last updated Nov 2024 | Unconfirmed ESM | Parallel processing via worker threads adds complexity. Field boosting is useful but the project's existing section-number boosting (+50) already achieves differentiated field weighting without a library. |

**Verdict:** The existing inverted index + tf-style counting already achieves retrieval quality suitable for a legal domain with structured section numbers. BM25's term frequency saturation benefit (diminishing returns for repeated terms) is marginal when documents are already chunked to 1200 chars. Add BM25 only if post-v1.1 evaluation shows consistent rank reversals.

**Embedding Models — Evaluated, Rejected**

Semantic embeddings (sentence-transformers via @xenova/transformers, or OpenAI text-embedding-3-small) were evaluated. Rejected because:

- Indian tax law uses precise section numbers and defined terms. "Section 16(4)" does not benefit from semantic similarity — it is an exact token. Embeddings smooth over this precision.
- @xenova/transformers bundles a 100MB+ model for in-process inference. Startup time would increase from ~200ms to 10-30 seconds.
- OpenAI embeddings add a third-party API dependency and per-query latency for a system already calling Gemini.
- The existing keyword system correctly retrieves specific sections when users query by number, which is the dominant pattern for tax law queries.

Add embeddings only in a future milestone if evaluation shows that conceptual/paraphrase queries (e.g., "when do I need to pay advance tax?") consistently fail to surface relevant chunks.

---

## Installation

```bash
# No new npm packages required for v1.1

# The only new runtime dependency is the data files themselves:
# server/data/cgst-act.txt   — extract from CBIC PDF using existing pdf-parse
# server/data/igst-act.txt   — extract from CBIC PDF using existing pdf-parse
# server/data/reference.json — hand-authored structured lookup data
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Plain text `.txt` for CGST/IGST Acts | Store in SQLite as sections | SQLite makes sense only if sections need to be queried by ID independently of the RAG retriever. This project loads everything into memory at startup — SQLite's query layer adds overhead without benefit. |
| JSON for reference tables | Embed reference data in `.txt` files | Prose text works for embeddings-based RAG. For keyword RAG, structured rows in JSON produce better precision because each row becomes its own chunk with an exact label. |
| Extend existing `splitIntoSections()` | New dedicated CGST chunker | A single extended chunker with multiple regex patterns is simpler to maintain than separate chunkers per Act. The pattern priority determines which regex wins — section numbers take precedence over chapter headers, which take precedence over schedule markers. |
| Score-based top-K selection | Maintain source-balanced 1-per-source retrieval | Source balancing made sense when the only sources were act-1961/act-2025/comparison. With 5+ sources (cgst, igst, reference added), balance becomes too constraining. Score-based with deduplication-by-section is strictly better. |
| Keyword retrieval (extended) | Hybrid keyword + embedding retrieval | Hybrid is the long-term target but requires embedding infrastructure (model loading, vector storage). Out of scope for v1.1 which focuses on data coverage. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@xenova/transformers` | 100MB+ model, 10-30s startup, adds Wasm/WebWorker complexity to a Node.js Express server | Extend existing keyword retriever |
| `langchain` or `llamaindex` | Framework overhead for a bespoke retriever that already works. These frameworks assume you want their chunking, embedding, and vector DB abstractions — this project has its own, simpler pipeline. | Modify `server/rag/index.ts` directly |
| `vectorize` / `pinecone` / `qdrant` | Vector databases require external infrastructure. The current in-memory index loads 84K lines of text in <1 second at startup. No persistence or external service is needed at this scale. | In-memory Map with inverted index (existing) |
| `natural` (NLP library) | Adds Porter stemmer and tokenizer, but legal text does not benefit from stemming. "Tax" and "taxes" are indexed differently on purpose in legal context — "section" and "sections" refer to different things. Stemming would collapse these. | Current whitespace tokenizer with stopword filter |
| `pdf-lib` or `pdfkit` | PDF creation libraries. This project only reads PDFs (existing `pdf-parse`). | `pdf-parse` (already installed) |
| Separate Express router for RAG | RAG runs as a module called inside the existing chat route. A dedicated REST endpoint for RAG context would expose internal retrieval data and add latency for no UX benefit. | Keep `retrieveContext()` as a synchronous import |

---

## Data Sources for CGST/IGST Acts

| Act | Official PDF Source | Notes |
|-----|--------------------|----|
| CGST Act 2017 (updated) | https://cbic-gst.gov.in/pdf/CGST-Act-Updated-30092020.pdf | Official CBIC hosted PDF. Use pdf-parse to extract. Strip headers/footers/page numbers. |
| IGST Act 2017 | https://d23z1tp9il9etb.cloudfront.net/download/pdf24/23.%20IGST%20Act.pdf | Official CAG-hosted PDF. Shorter Act (~25 sections). |
| India Code (both Acts) | https://www.indiacode.nic.in/handle/123456789/2251 | HTML version available — alternative to PDF extraction if text quality is poor. |

> Note on PDF quality: Government PDFs may contain OCR artifacts, inconsistent spacing, and encoding issues. After extraction, run a normalization pass to: collapse multiple spaces, remove form-feed characters, fix common OCR substitutions (0 for O in section references). The existing act-1961.txt and act-2025.txt were already cleaned — apply the same process to GST Acts.

---

## Reference JSON Schema

The `server/data/reference.json` file should follow this structure so the reference chunk builder can iterate predictably:

```json
{
  "cii": {
    "label": "Cost Inflation Index (CII)",
    "source": "CBDT Notification",
    "entries": [
      { "fy": "2001-02", "ay": "2002-03", "value": 100 },
      { "fy": "2022-23", "ay": "2023-24", "value": 331 },
      { "fy": "2023-24", "ay": "2024-25", "value": 348 },
      { "fy": "2024-25", "ay": "2025-26", "value": 363 }
    ]
  },
  "due_dates": {
    "label": "Income Tax Due Dates",
    "source": "IT Act 2025 / CBDT Circular",
    "entries": [
      { "event": "Advance tax Q1", "due": "15 June", "who": "All assessees except 44AD/44ADA" },
      { "event": "Advance tax Q2", "due": "15 September", "who": "All assessees except 44AD/44ADA" },
      { "event": "Advance tax Q3", "due": "15 December", "who": "All assessees except 44AD/44ADA" },
      { "event": "Advance tax Q4", "due": "15 March", "who": "All assessees except 44AD/44ADA" },
      { "event": "ITR filing (non-audit)", "due": "31 July", "who": "Individuals, HUF, non-audit cases" },
      { "event": "ITR filing (audit)", "due": "31 October", "who": "Companies, audit cases" },
      { "event": "TDS deposit", "due": "7th of following month", "who": "Deductors (government: same day)" }
    ]
  },
  "itr_forms": {
    "label": "ITR Form Eligibility Matrix",
    "source": "CBDT / IT Act 2025",
    "entries": [
      { "form": "ITR-1 (Sahaj)", "who": "Resident individual, salary + one house property + other sources, total income ≤ ₹50L", "not_for": "Director of company, foreign income, capital gains" },
      { "form": "ITR-2", "who": "Individual / HUF not having business income, capital gains, multiple house property", "not_for": "Business or profession income (use ITR-3)" },
      { "form": "ITR-3", "who": "Individual / HUF with income from business or profession", "not_for": "Presumptive taxation cases (use ITR-4)" },
      { "form": "ITR-4 (Sugam)", "who": "Individual / HUF / Firm (not LLP) opting for presumptive taxation under 44AD/44ADA/44AE, income ≤ ₹50L", "not_for": "Director, foreign assets, capital gains" },
      { "form": "ITR-5", "who": "Firms, LLP, AOP, BOI, AJP, investment fund", "not_for": "Individuals, HUF, companies" },
      { "form": "ITR-6", "who": "Companies (other than claiming exemption under Section 11)", "not_for": "Charitable trusts (use ITR-7)" },
      { "form": "ITR-7", "who": "Charitable/religious trusts, political parties, research associations", "not_for": "Companies, individuals" }
    ]
  }
}
```

This schema is versioned in source control. When CII values update (annually via CBDT notification), update only the `entries` array. The chunk builder regenerates at server startup — no migration needed.

---

## Chunk Type Extension

The existing `Chunk` type in `server/rag/index.ts` needs:

```typescript
interface Chunk {
  id: number;
  source: 'act-2025' | 'act-1961' | 'comparison' | 'cgst' | 'igst' | 'reference';
  section: string;
  chapter?: string;      // NEW: chapter context (e.g. "CHAPTER VIII — RETURNS")
  text: string;
  lowerText: string;
}
```

The `chapter` field is optional (not all sources have chapters) and is stored on the chunk at parse time. It is not indexed separately in the inverted index but is used during scoring as a metadata boost.

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Existing `server/rag/index.ts` | No new packages needed | All changes are to existing TypeScript code. `"type": "module"` in package.json means all imports must use `.js` extensions in compiled output — the existing code already does this correctly. |
| `reference.json` | `readFileSync` + `JSON.parse` | Built-in Node.js. No additional parser library needed. |
| New chunk types (`cgst`, `igst`, `reference`) | Existing `buildIndex()` | `buildIndex()` is type-agnostic — it iterates `allChunks` regardless of source. No changes needed to the index builder. |

---

## Sources

**v1.1 Research Sources:**

- [CBIC CGST Act PDF](https://cbic-gst.gov.in/pdf/CGST-Act-Updated-30092020.pdf) — Official government source for CGST Act text (HIGH confidence)
- [IGST Act PDF via CAG](https://cag.gov.in/uploads/media/23-IGST-other-than-POS-Akashy-JAin-20211013111740.pdf) — Official IGST Act text source (HIGH confidence)
- [India Code — IGST Act](https://www.indiacode.nic.in/handle/123456789/2251) — Alternative HTML source for IGST (HIGH confidence)
- [Weaviate: Chunking Strategies for RAG](https://weaviate.io/blog/chunking-strategies-for-rag) — Hierarchical/structure-aware chunking for legal docs (MEDIUM confidence)
- [OkapiBM25 GitHub](https://github.com/FurkanToprak/OkapiBM25) — API review, rejection rationale (MEDIUM confidence, WebFetch verified)
- [wink-bm25-text-search GitHub package.json](https://github.com/winkjs/wink-bm25-text-search/blob/master/package.json) — Version 3.1.2, CJS, heavy NLP model dependency confirmed (HIGH confidence, WebFetch verified)
- [fast-bm25 on npm](https://www.npmjs.com/package/fast-bm25) — Last updated Nov 2024, parallel processing design (MEDIUM confidence, WebSearch)
- [SpringerLink: Structuring Indian Legal Documents](https://link.springer.com/chapter/10.1007/978-3-031-82153-0_14) — Research on Indian legal text structure complexity (MEDIUM confidence)
- [Unstructured: Metadata in RAG](https://unstructured.io/insights/how-to-use-metadata-in-rag-for-better-contextual-results) — Chapter/source metadata filtering patterns (MEDIUM confidence)
- [RAG for Structured Data (AI21)](https://www.ai21.com/knowledge/rag-for-structured-data/) — JSON lookup tables vs vector RAG for structured reference data (MEDIUM confidence)

**v1.0 Research Sources (unchanged):**

- [multer on npm](https://www.npmjs.com/package/multer) — version 2.1.1 confirmed
- [cors on npm](https://www.npmjs.com/package/cors) — version 2.8.6 confirmed
- [helmet on npm / helmetjs.github.io](https://helmetjs.github.io/) — version 8.1.0 confirmed
- [express-rate-limit on npm](https://www.npmjs.com/package/express-rate-limit) — version 8.3.2 confirmed
- [pdf-parse on npm](https://www.npmjs.com/package/pdf-parse) — version 2.4.5
- [Recharts Waterfall example](https://recharts.github.io/en-US/examples/Waterfall/) — HIGH confidence (official docs)
- [Gemini File API — official docs](https://ai.google.dev/gemini-api/docs/files) — HIGH confidence
- [Vite proxy configuration guide](https://vite.dev/guide/backend-integration) — HIGH confidence (official Vite docs)

---
*Stack research for: Tax Assistant v1.1 — RAG Data Completeness & Quality*
*Researched: 2026-04-08*
