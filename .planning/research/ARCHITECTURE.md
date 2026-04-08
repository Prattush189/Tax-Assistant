# Architecture Research

**Domain:** RAG pipeline for Indian tax legislation — chunking, indexing, retrieval
**Researched:** 2026-04-08
**Confidence:** HIGH (derived directly from reading the live codebase — server/rag/index.ts, server/routes/chat.ts, all three data files)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (React)                               │
│  ChatBox → POST /api/chat  (message + optional fileContext)          │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                    server/routes/chat.ts                             │
│  1. Auth + plan-limit check                                          │
│  2. retrieveContext(userMessage)   <-- RAG call (unchanged entry pt) │
│  3. Prepend RAG context to userContent                               │
│  4. Forward to Gemini via SSE stream                                 │
└──────────┬──────────────────────────────────┬───────────────────────┘
           │                                  │
┌──────────▼──────────────┐        ┌──────────▼──────────────────────┐
│   server/rag/index.ts   │        │         Google Gemini API        │
│                         │        │  gemini-2.5-flash (primary)      │
│  initRAG()              │        │  gemini-2.5-flash-lite (fallback)│
│  |- buildChunks()       │        └─────────────────────────────────-┘
│  |   |- splitter()      │
│  |   `- subChunk()      │
│  |- buildIndex()        │
│  `- retrieve()          │
│      `- scoreChunk()    │
│                         │
└──────────┬──────────────┘
           | readFileSync at startup
┌──────────▼──────────────────────────────────────────────────────────┐
│                      server/data/  (plain .txt)                      │
│  act-1961.txt    (2.95 MB, 49 217 lines) -- EXISTING                 │
│  act-2025.txt    (1.66 MB, 33 186 lines) -- EXISTING                 │
│  comparison.txt  (75 KB, ====== headers) -- EXISTING                 │
│  cgst-act.txt    (NEW)                                               │
│  igst-act.txt    (NEW)                                               │
│  cii-table.txt   (NEW)                                               │
│  due-dates.txt   (NEW)                                               │
│  itr-matrix.txt  (NEW)                                               │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Current State |
|-----------|---------------|---------------|
| `splitIntoSections()` | Divide Act text into per-section chunks | BUG: regex also matches schedule list items starting with `1.`, `2.` |
| `splitComparisonSections()` | Divide comparison.txt into topic blocks | Works correctly; splits on `===...===` lines |
| `subChunk()` | Break oversized sections into 1200-char sliding windows with 200-char overlap | Works correctly |
| `buildIndex()` | Build inverted token-to-chunk-ID map | Works correctly; all sources share one key space |
| `scoreChunk()` | Rank a candidate chunk for a query | Works; keyword frequency + section number boost (+50 exact, +15 in-text) + 1.5x comparison multiplier |
| `retrieve()` | Select top-K chunks with balanced source coverage | BUG: hard-codes three source buckets; fails to accommodate 5+ sources |
| `retrieveContext()` | Entry point called by chat route | Works; includes broadenSectionNumbers fallback |
| `initRAG()` | Load all data files and build index at server startup | Works; each file wrapped in try/catch |

---

## Recommended Project Structure (after milestone)

```
server/
|- data/
|   |- act-1961.txt        # UNCHANGED -- existing fallback
|   |- act-2025.txt        # UNCHANGED -- existing fallback
|   |- comparison.txt      # UNCHANGED -- existing fallback
|   |- cgst-act.txt        # NEW -- CGST Act full text
|   |- igst-act.txt        # NEW -- IGST Act full text
|   |- cii-table.txt       # NEW -- Cost Inflation Index table
|   |- due-dates.txt       # NEW -- compliance due dates calendar
|   `- itr-matrix.txt      # NEW -- ITR form selection matrix
|
`- rag/
    `- index.ts            # MODIFIED -- see change list below
```

### Structure Rationale

- **data/ stays flat**: All sources are plain text. No subdirectory needed. `initRAG()` loads them by name. Flat keeps the per-file try/catch pattern simple to follow.
- **rag/index.ts stays a single file**: The logic is cohesive. Splitting into chunker.ts / scorer.ts / retriever.ts adds file-switching overhead with no functional benefit at this scale (~340 lines).
- **New source names follow existing naming convention**: lowercase, hyphen-separated, `.txt` extension.

---

## Architectural Patterns

### Pattern 1: Source-Typed Chunk with Explicit Source Enum

**What:** Every `Chunk` carries a `source` discriminant that drives both scoring and balanced retrieval. New sources must be added to this union, or TypeScript will catch the gap.

**When to use:** Always — the source type is load-bearing for the bucket-selection logic in `retrieve()`.

**Trade-offs:** Adding a new source requires touching the type definition, the `buildChunks()` call in `initRAG()`, and the bucket caps in `retrieve()`. This is intentional — it keeps retrieval policy explicit and compiler-enforced.

**Change required:**
```typescript
// BEFORE
source: 'act-2025' | 'act-1961' | 'comparison';

// AFTER
source: 'act-2025' | 'act-1961' | 'comparison' | 'cgst' | 'igst' | 'reference';
// 'reference' covers cii-table, due-dates, itr-matrix (lookup data, not legislation)
```

### Pattern 2: Splitter Strategy per Source Type

**What:** Each source category uses a dedicated splitter. Act files use the section-regex splitter. The comparison file uses the header splitter. New sources need their own splitters because their structure differs fundamentally from numbered sections.

**When to use:** Any time a new file has a structure that cannot be parsed by existing splitters without producing garbage chunks.

**Trade-offs:** More splitter functions means more code, but blindly applying `splitIntoSections()` to a CII table produces chunks labelled "section 9" (matching `9. FY 2001-02 — 100`) that score incorrectly against section-number queries.

**New splitter needed for reference data:**
```typescript
function splitReferenceData(text: string): { section: string; text: string }[] {
  // Convention: reference files authored with --- between named blocks
  // or with ## Block Title headers.
  // Each logical unit (e.g. one year range of CII entries, one ITR form row)
  // becomes one chunk. These are short by nature -- subChunk() rarely fires.
  const parts = text.split(/^---$/gm);
  return parts
    .map(p => p.trim())
    .filter(p => p.length > 20)
    .map(p => {
      const firstLine = p.split('\n')[0].trim();
      return { section: firstLine.slice(0, 60), text: p };
    });
}
```

**GST Act splitter -- reuse `splitIntoSections()` but verify format first:**
CGST/IGST Acts use numbered sections (`9. Levy and collection of tax.`) matching the existing regex. Confirm the source file format matches before assuming. The schedule-stripping fix (Pattern 4) applies equally to GST Acts.

### Pattern 3: Map-Based Retrieval Buckets with Per-Source Caps

**What:** `retrieve()` currently fills results from three hard-coded source buckets. With 6 source types, this must become data-driven. Each source gets a configurable slot cap before remaining capacity is filled by highest-scoring uncapped results.

**When to use:** Required before adding any new source type beyond the existing three.

**Trade-offs:** Hard caps per source prevent any single large file (act-1961.txt at 2.95 MB generates many candidates) from dominating results. The caps are intentionally conservative for legislation files and more generous for reference data, which is dense and short.

**Change required:**
```typescript
// BEFORE: hard-coded three buckets
const fromComparison: typeof scored = [];
const from2025: typeof scored = [];
const from1961: typeof scored = [];

// AFTER: map-based, one bucket per source
const BUCKET_CAPS: Record<Chunk['source'], number> = {
  comparison: 1,
  'act-2025': 2,
  'act-1961': 1,
  cgst:       2,
  igst:       1,
  reference:  2,
};

const buckets = new Map<Chunk['source'], typeof scored>(
  Object.keys(BUCKET_CAPS).map(k => [k as Chunk['source'], []])
);

for (const s of scored) {
  const bucket = buckets.get(s.chunk.source)!;
  const cap = BUCKET_CAPS[s.chunk.source];
  if (bucket.length < cap) bucket.push(s);
}

const filled = [...buckets.values()].flat();
const used = new Set(filled.map(s => s.chunk.id));
const remaining = scored.filter(s => !used.has(s.chunk.id));

const combined = [...filled, ...remaining]
  .sort((a, b) => b.score - a.score)
  .slice(0, topK);
```

Also increase default topK from 3 to 5 in the `retrieveContext()` call signature. Cross-domain queries (e.g. "GST and TDS treatment of X") need chunks from more than 3 sources.

### Pattern 4: SCHEDULE Boundary Stripping in Section Splitter

**What:** The current regex `/^(\d+[A-Z]*(?:-[A-Z]+)?)\.\s/gm` matches both Act sections and schedule list items. After the last numbered section (e.g. Section 536 in act-2025.txt), the Act text contains SCHEDULE blocks with items numbered `1. (1) The eligible...`, `2. ...`. These are incorrectly split into hundreds of false-positive "section" chunks.

**When to use:** This is a bug fix that applies to all Act-format source files (act-1961.txt, act-2025.txt, cgst-act.txt, igst-act.txt).

**Verification:** In act-2025.txt, `SCHEDULE I` appears at line 27778 with list items starting `1. (1) The eligible investment fund...`. The regex currently matches these as section 1 chunks.

**Fix:**
```typescript
function splitIntoSections(text: string): { section: string; text: string }[] {
  // Strip schedule content: find first SCHEDULE heading and discard everything after.
  // Schedules use numbered items (1., 2.) identical in format to section starts,
  // but they are not sections.
  const scheduleStart = text.search(/^SCHEDULE\s+[IVXLC0-9]/m);
  const bodyText = scheduleStart > 0 ? text.slice(0, scheduleStart) : text;

  const sectionRegex = /^(\d+[A-Z]*(?:-[A-Z]+)?)\.\s/gm;
  const matches = [...bodyText.matchAll(sectionRegex)];
  // ... rest of function unchanged, using bodyText instead of text
}
```

### Pattern 5: Preamble and CHAPTER Block Preservation

**What:** Content before the first numbered section (preamble text: "Be it enacted...", long title, "CHAPTER I — PRELIMINARY" heading) is currently either dropped or merged into section 1's chunk. CHAPTER headings between sections are also dropped. This makes queries like "what chapter covers capital gains" or "what is the preliminary provision" return nothing.

**When to use:** Required for completeness. Adds a small number of stub chunks (one per chapter transition block). These are short and naturally stay under the 1200-char limit.

**Fix:**
```typescript
// Capture preamble (everything before first section)
const firstSectionStart = matches[0]?.index ?? bodyText.length;
const preamble = bodyText.slice(0, firstSectionStart).trim();
if (preamble.length > 50) {
  sections.push({ section: 'preamble', text: preamble });
}

// During section loop: detect CHAPTER lines within section text
// and optionally emit them as stub chunks or prepend to following section.
// Simplest approach: CHAPTER headers naturally appear at the start of the
// section that follows them -- the subChunk text will contain the chapter heading.
// No additional action needed unless a CHAPTER header appears between two sections
// with no text in between (rare).
```

---

## Data Flow

### Startup Flow (one-time, synchronous at process start)

```
server/index.ts: initRAG()
    |
    For each source file (try/catch per file):
        readFileSync(filePath, 'utf-8')
            |
        splitter(text)  ->  [{ section, text }, ...]
            |               splitIntoSections()         for Act files
            |               splitComparisonSections()   for comparison.txt
            |               splitReferenceData()        for reference files (NEW)
            |
        subChunk()      ->  [{ section, text }, ...]  (split large sections)
            |
        push to allChunks[] with { id, source, section, text, lowerText }
            |
    buildIndex(allChunks)
        -> invertedIndex: Map<token, Set<chunkId>>
```

### Per-Request RAG Flow (unchanged entry point, improved internals)

```
POST /api/chat { message }
    |
retrieveContext(message, topK=5)
    |
tokenize(message)           -> string[]  (lowercase, stopwords removed, len>2)
broadenSectionNumbers()     -> broader section variants for fallback
    |
invertedIndex.get(token)    -> Set<candidateChunkId>  for each token
    |
scoreChunk() for each candidate
    -> keyword frequency
    -> section number exact/in-text boost
    -> comparison source 1.5x multiplier
    |
fill per-source buckets up to BUCKET_CAPS
    |
merge buckets, fill remaining slots from highest-scoring overflow
    |
sort by score, slice to topK (5)
    |
format: "[Source Label -- Section]\ntext\n\n---\n\n..."
    |
prepend to userContent in chat route
    |
Gemini receives: [RAG context block] + [user message]
```

### Key Data Flows

1. **New file addition:** Add file to `server/data/`, add its source literal to `Chunk['source']` union, add a `buildChunks()` call in `initRAG()`, add its bucket cap in `BUCKET_CAPS`. Four touch points, all in `rag/index.ts` plus the data directory.

2. **Reference data queries (CII, due dates, ITR matrix):** These files produce short, dense chunks that score well on exact-match lookups (e.g. "CII 2023-24", "ITR-2 NRI"). They use the `reference` source type. The comparison 1.5x multiplier does not apply -- these are factual tables, not cross-reference prose. Their BUCKET_CAPS value of 2 gives them priority over any single Act file at 1.

3. **GST Act queries:** CGST and IGST produce chunks via the same `splitIntoSections()` path as IT Acts (after schedule-stripping fix). They get separate source types (`cgst`, `igst`) so their bucket caps are tunable independently of the IT Acts.

---

## Integration Points: New vs Modified

### NEW -- data files (no code change needed for the files themselves)

| File | Format | Splitter | Source Type |
|------|--------|----------|-------------|
| `cgst-act.txt` | Numbered sections (`9. Levy...`) | `splitIntoSections()` with schedule fix | `cgst` |
| `igst-act.txt` | Numbered sections | `splitIntoSections()` with schedule fix | `igst` |
| `cii-table.txt` | Year-value blocks separated by `---` | `splitReferenceData()` NEW | `reference` |
| `due-dates.txt` | Calendar blocks separated by `---` | `splitReferenceData()` NEW | `reference` |
| `itr-matrix.txt` | Form-criteria rows separated by `---` | `splitReferenceData()` NEW | `reference` |

### MODIFIED -- `server/rag/index.ts`

| Change | Why | Risk |
|--------|-----|------|
| Extend `Chunk['source']` union | Required for new source types | Low -- TypeScript catches missing cases at compile time |
| Add SCHEDULE-boundary stripping to `splitIntoSections()` | Fix false-positive section chunks from schedule list items | Medium -- test against existing files; expect chunk count to decrease |
| Add preamble capture before first section | Preserve currently-dropped pre-section content | Low -- adds chunks, removes nothing |
| Add `splitReferenceData()` function | Handle tabular/calendar reference files | Low -- new function, no existing code changed |
| Replace hard-coded three-bucket logic with `BUCKET_CAPS` map | Support 5+ sources without hard-coded slots | Medium -- core retrieval path; regression-test required |
| Add `SOURCE_LABELS` lookup table in `retrieveContext()` | Extend label formatting without cascading else-if | Low -- format change only |
| Increase default topK from 3 to 5 | Cross-domain queries need more chunks | Low -- only affects context length; monitor token usage |
| Add new `buildChunks()` calls in `initRAG()` for 5 files | Load new files | Low -- each wrapped in try/catch; non-fatal if file missing |

### NOT MODIFIED

| Component | Reason untouched |
|-----------|-----------------|
| `server/routes/chat.ts` | The `retrieveContext()` call site is already correct. Label formatting moves inside `retrieveContext()` using `SOURCE_LABELS`. No change to chat route needed. |
| `server/index.ts` | `initRAG()` is already called at startup. No change needed. |
| `server/data/act-1961.txt` | Preserved per milestone requirement |
| `server/data/act-2025.txt` | Preserved per milestone requirement |
| `server/data/comparison.txt` | Preserved per milestone requirement |
| Gemini system prompt | Already instructs the model to use reference context without mentioning it; "If the reference is not relevant, IGNORE it" handles reference data gracefully |

---

## Build Order

Dependencies between work items determine sequence. Items with no dependencies can be built in parallel.

### Step 1 -- Fix the chunker (prerequisite for everything else)

Fix `splitIntoSections()` before adding any new files. The schedule-stripping bug affects act-1961.txt and act-2025.txt right now. Adding more files while the chunker is broken compounds the problem.

1. Add SCHEDULE-boundary stripping to `splitIntoSections()`
2. Add preamble + CHAPTER block capture
3. Run `initRAG()` and inspect console output -- chunk count for act-2025 and act-1961 should decrease as false schedule-section chunks are eliminated
4. Run sample queries against existing three files to confirm no retrieval regression

Deliverable: Correct chunks from existing three files. No new files yet.

### Step 2 -- Extend retrieval for multiple sources (prerequisite for Step 3 and Step 4)

The hard-coded three-bucket logic must be replaced before adding new source types.

1. Extend `Chunk['source']` union with `'cgst' | 'igst' | 'reference'`
2. Replace `fromComparison / from2025 / from1961` buckets with `BUCKET_CAPS` map logic
3. Increase default topK from 3 to 5 in `retrieveContext()`
4. Add `SOURCE_LABELS` lookup table in `retrieveContext()` to replace inline label formatting
5. Verify with mock chunk objects covering all 6 source types

Deliverable: Retrieval infrastructure ready for 6 source types.

### Step 3 -- Add GST Act files (can run in parallel with Step 4 after Step 2 is done)

1. Obtain and clean CGST Act plain text -> `cgst-act.txt`
2. Obtain and clean IGST Act plain text -> `igst-act.txt`
3. Add `buildChunks(join(dataDir, 'cgst-act.txt'), 'cgst')` call in `initRAG()`
4. Add `buildChunks(join(dataDir, 'igst-act.txt'), 'igst')` call in `initRAG()`
5. Spot-check chunk splits (verify section 9 CGST chunks correctly, verify no schedule bleed)
6. Test GST queries end-to-end ("GST rate on software services", "Section 9 CGST levy", "ITC reversal IGST")

### Step 4 -- Add reference data files (can run in parallel with Step 3 after Step 2 is done)

1. Write `splitReferenceData()` -- the delimiter convention (`---` between blocks) must be decided here, before authoring the files
2. Create `cii-table.txt` in the agreed delimiter format
3. Create `due-dates.txt` in the agreed delimiter format
4. Create `itr-matrix.txt` in the agreed delimiter format
5. Add three `buildChunks()` calls in `initRAG()` with `source: 'reference'`
6. Test lookup queries ("CII for FY 2023-24", "due date for advance tax Q3", "which ITR form for salaried NRI")

### Step 5 -- Integration and quality validation

1. Full server startup with all 8 files; confirm all load without errors
2. Cross-domain query test ("GST and TDS on professional services", "CII-adjusted capital gains for FY 2025-26")
3. Confirm topK=5 context does not meaningfully inflate token costs -- check `inputTok` in usageRepo
4. Confirm comparison.txt 1.5x multiplier still surfaces comparison chunks where appropriate
5. Confirm no existing query patterns regressed from the schedule-stripping change

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (8 files, ~5 MB total, in-process) | Synchronous readFileSync at startup is fine. Index fits comfortably in memory (~30-50 MB for inverted index). No change needed. |
| 20+ files or 50+ MB total data | Evaluate lazy loading by source category. At that volume, consider a proper vector store (Qdrant, Weaviate) with embedding-based retrieval replacing the keyword index. |
| 100k+ daily queries | The in-process index is a read-only shared data structure -- scales horizontally with Node.js cluster or multiple server instances without change. The bottleneck becomes Gemini API quota, not RAG. |

### Scaling Priorities

1. **First bottleneck:** Gemini API rate limits (429 errors). The retry logic already handles this. topK=5 increases prompt token count by roughly 25% over topK=3 -- monitor `usageRepo` inputTok averages after deploying.
2. **Second bottleneck:** Index memory. At 8 files (~5 MB total), the in-memory inverted index is approximately 30-50 MB -- negligible. If data grows to 50+ MB (e.g. adding state GST Acts, CBDT circulars), profile index size before adding more files.

---

## Anti-Patterns

### Anti-Pattern 1: Applying `splitIntoSections()` to Reference Data Without Format Verification

**What people do:** Reuse the existing section-regex splitter for CII tables and due-date calendars because "it already handles all text files."
**Why it's wrong:** The regex matches `9. FY 2001-02 -- 100` as section number 9. A CII table row labelled "section 9" scores against unrelated section-number queries ("Section 9 CGST levy").
**Do this instead:** Author reference files with a consistent block delimiter and write `splitReferenceData()` to split on those delimiters.

### Anti-Pattern 2: Raising topK Without Monitoring Token Budget

**What people do:** Increase topK to 10 or higher to maximize recall.
**Why it's wrong:** Each chunk is up to 1200 characters (~300 tokens). At topK=10, RAG context adds ~3000 tokens to every request. The risk is cost increase and potential response truncation if the combined input + system prompt approaches model limits. Gemini 2.5 Flash has a large input window, but cost scales linearly with input tokens.
**Do this instead:** Increase topK incrementally (3 -> 5), monitor `inputTok` averages in `usageRepo`, and confirm answer quality improves before going higher.

### Anti-Pattern 3: Hard-Coding Source Labels as Cascading else-if in `retrieveContext()`

**What people do:** Add `else if (c.source === 'cgst') return 'CGST Act'` branches each time a source is added.
**Why it's wrong:** Each new source requires editing the formatting block. Easy to miss one, resulting in `undefined` labels in the context string passed to Gemini.
**Do this instead:** Use a lookup table:
```typescript
const SOURCE_LABELS: Record<Chunk['source'], string> = {
  'act-2025':   'IT Act 2025',
  'act-1961':   'IT Act 1961',
  'comparison': 'Comparison Guide',
  'cgst':       'CGST Act',
  'igst':       'IGST Act',
  'reference':  'Reference Data',
};
const label = SOURCE_LABELS[c.source] ?? c.source;
```

### Anti-Pattern 4: Loading New Files Outside the Existing try/catch Pattern

**What people do:** Add `buildChunks()` calls directly (not wrapped), causing server startup to crash if a data file is absent.
**Why it's wrong:** The existing pattern wraps each file load in try/catch with a `console.warn`. This allows the server to start with partial data -- a degraded experience, not a crash.
**Do this instead:** Follow the existing pattern exactly for every new `buildChunks()` call:
```typescript
try {
  const chunksGST = buildChunks(join(dataDir, 'cgst-act.txt'), 'cgst');
  console.log(`[RAG] Loaded cgst: ${chunksGST.length} chunks`);
  allChunks.push(...chunksGST);
} catch (err) {
  console.warn('[RAG] cgst-act.txt not found, skipping');
}
```

---

## Sources

- Live codebase: `D:/tax-assistant/server/rag/index.ts` — read directly, HIGH confidence
- Live codebase: `D:/tax-assistant/server/routes/chat.ts` — read directly, HIGH confidence
- Live codebase: `D:/tax-assistant/server/data/act-2025.txt` — schedule structure verified at line 27778, HIGH confidence
- Live codebase: `D:/tax-assistant/server/data/act-1961.txt` — structure verified by inspection, HIGH confidence
- Live codebase: `D:/tax-assistant/.planning/PROJECT.md` — milestone requirements, HIGH confidence

---
*Architecture research for: Indian tax assistant RAG pipeline (v1.1 milestone)*
*Researched: 2026-04-08*
