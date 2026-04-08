# Phase 7: RAG Infrastructure Fixes - Research

**Researched:** 2026-04-08
**Domain:** TypeScript RAG chunker and retrieval refactor (`server/rag/index.ts`)
**Confidence:** HIGH — all findings are from direct code inspection of the live codebase

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **topK increased from 3 to 5** — retrieval must default to 5, not 3
- **Labels use full Act name + section** — e.g., `[CGST Act 2017 — Section 16]` matching existing `[IT Act 2025 — Section 202]` pattern
- **GST section numbers prefixed with Act name** — store internally as `"CGST-16"` to avoid collision with IT Act section 16
- **Detailed startup logging** — log chunk counts per source + total index keys
- **Existing data files must NOT be modified** — act-1961.txt, act-2025.txt, comparison.txt are read-only

### Claude's Discretion
- Schedule boundary detection and handling approach
- Chapter header chunk strategy (standalone chunk vs attach to first section)
- Chunk size limits (keep 1200/200 or adjust)
- Reference data format and splitter design (Phase 9 prep — extensibility only)
- Retrieval balancing algorithm (best-score vs min-representation)
- Score threshold (keep 2 or lower)
- Comparison.txt boost retention (evaluate with 5+ sources)
- Source registration mechanism (config array vs convention-based)
- Reference data lookup architecture
- Backward compat test approach
- Old chunker replacement vs fallback strategy
- Chunk ID stability

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RAGI-01 | Retrieval function supports any number of data sources without hardcoded bucket limits | The `retrieve()` function has three hardcoded bucket variables that must become a source-agnostic loop |
| RAGI-02 | Chunker detects CHAPTER headers and creates chapter-level chunks with proper labels | CHAPTER lines at line start followed by a title line — pattern confirmed in both act files |
| RAGI-03 | Chunker detects SCHEDULE / PART boundaries and creates schedule-aware chunks separate from Act section numbering | Section regex hits 299 false matches in act-2025.txt schedules alone; boundary regex needed |
| RAGI-04 | Chunk source type is extensible (TypeScript union accepts new source types without code duplication) | Current `Chunk.source` is a 3-value union with hardcoded `if/else` branches throughout |
| RAGI-05 | Existing act-1961.txt, act-2025.txt, comparison.txt preserved unchanged as fallback | Current `initRAG()` loads them with `try/catch` — preserving this pattern is safe |
</phase_requirements>

---

## Summary

The entire RAG system lives in one file: `server/rag/index.ts` (337 lines). The current implementation was built for exactly three sources — hardcoded into the `Chunk` type, the `retrieve()` balancing loop, the `initRAG()` loader, and the label formatter in `retrieveContext()`. Adding a fourth source (Phase 8 GST Acts) requires touching all four sites.

The two functional bugs are distinct. The schedule bug is a false-positive problem: the section regex `/^(\d+[A-Z]*(?:-[A-Z]+)?)\.\s/gm` matches numbered items inside schedules (e.g., `1. (1) The eligible investment fund...`), splitting schedule text into dozens of phantom "sections" instead of keeping it as contiguous schedule content. This produces 299 false matches in act-2025.txt's schedule area alone. The chapter bug is a false-negative problem: CHAPTER headers (e.g., `CHAPTER IV\nCOMPUTATION OF TOTAL INCOME`) sit in the whitespace between the previous section and the next section's match, so the chunker never sees them at all.

The refactor strategy is clean replacement rather than incremental patching. The `buildChunks()` function should be split into source-type-specific splitters registered via a config array (or equivalent pattern). The `retrieve()` balancing loop should become source-agnostic: accumulate one slot per source up to topK=5 rather than naming specific sources. All chunk labels become data-driven from the source config.

**Primary recommendation:** Replace the three-hardcoded-bucket pattern with a `SourceConfig[]` array and derive all labels, balancing, and startup logging from config data. This satisfies RAGI-01 and RAGI-04 in one structural change, then RAGI-02 and RAGI-03 are purely chunker additions.

---

## Standard Stack

### Core — No New Dependencies

This phase is a pure refactor of existing TypeScript code. No new npm packages are needed. The RAG system deliberately avoids external libraries (see STATE.md: "BM25 libraries and embedding models explicitly rejected").

| Component | Current | Target |
|-----------|---------|--------|
| Language | TypeScript (Node ESM) | Same |
| File I/O | `fs.readFileSync` | Same |
| Index structure | `Map<string, Set<number>>` | Same (IDs become stable) |
| Chunk lookup | `chunks[id]` array index | `chunkMap.get(id)` Map lookup |

### Installation
```bash
# No new dependencies
```

---

## Architecture Patterns

### Current Structure (to be replaced)

```
server/rag/index.ts (337 lines)
├── Chunk interface (3-value union source)
├── STOPWORDS set
├── splitIntoSections() — section regex, fails in schedule areas
├── subChunk() — size-limited overlap chunker
├── splitComparisonSections() — ====== delimiter splitter
├── buildChunks(filePath, source) — dispatches on source === 'comparison'
├── invertedIndex: Map<string, Set<number>> — token → chunk IDs (array indices)
├── buildIndex(chunks) — populates invertedIndex
├── tokenize(), scoreChunk() — keyword scoring
├── retrieve(chunks, query, topK=3) — hardcoded 3-bucket balancing
├── initRAG() — 3 hardcoded buildChunks() calls
├── broadenSectionNumbers() — fallback broadening
└── retrieveContext(query, topK=3) — hardcoded label map
```

### Recommended Project Structure (after refactor)

```
server/rag/index.ts
├── Types
│   ├── SourceConfig interface — { id, filePath, label, splitter, boost? }
│   ├── Chunk interface — source: string (not union)
│   └── ScoredChunk internal type
├── Splitters
│   ├── splitActSections() — with CHAPTER/SCHEDULE pre-pass
│   ├── splitScheduleSections() — schedule-aware, no section regex
│   └── splitComparisonSections() — existing ====== logic
├── Source Registry
│   └── SOURCE_CONFIGS: SourceConfig[] — data-driven, no hardcoding
├── Chunking
│   └── buildChunks(config) — uses config.splitter
├── Index
│   ├── chunkMap: Map<number, Chunk> — stable ID lookup (replaces chunks[id])
│   └── invertedIndex: Map<string, Set<number>>
├── Scoring
│   ├── tokenize(), scoreChunk() — unchanged
│   └── retrieve() — source-agnostic balancing loop
├── Public API
│   ├── initRAG() — iterates SOURCE_CONFIGS, logs per-source + total
│   └── retrieveContext(query, topK=5) — labels from config
```

### Pattern 1: SourceConfig Registry (for RAGI-01 and RAGI-04)

**What:** Replace hardcoded source strings with a config array. Each entry specifies the file path, display label, internal ID, splitter function, and optional score boost.

**When to use:** Any time a new data source is added — no retrieval logic changes required.

```typescript
// Source: direct design from CONTEXT.md locked decisions
interface SourceConfig {
  id: string;           // internal ID stored in Chunk.source, e.g., 'act-1961', 'cgst-2017'
  filePath: string;     // relative to data dir
  label: string;        // display label for retrieveContext(), e.g., 'IT Act 1961'
  splitter: 'act' | 'comparison' | 'reference';  // which splitter to use
  boost?: number;       // optional score multiplier (comparison currently 1.5)
}

const SOURCE_CONFIGS: SourceConfig[] = [
  { id: 'comparison', filePath: 'comparison.txt', label: 'Comparison Guide', splitter: 'comparison', boost: 1.5 },
  { id: 'act-2025',   filePath: 'act-2025.txt',   label: 'IT Act 2025',      splitter: 'act' },
  { id: 'act-1961',   filePath: 'act-1961.txt',   label: 'IT Act 1961',      splitter: 'act' },
  // Phase 8 adds:
  // { id: 'cgst-2017', filePath: 'cgst-2017.txt', label: 'CGST Act 2017', splitter: 'act' },
];
```

**Chunk.source becomes `string`** (not a union), because the valid values are now the `id` fields in SOURCE_CONFIGS. TypeScript type safety is preserved at config definition time, not at the union level.

### Pattern 2: Chapter/Schedule Pre-Pass (for RAGI-02 and RAGI-03)

**What:** Before running the section regex, detect CHAPTER and SCHEDULE boundary lines to split the text into logical top-level segments. Each segment knows whether it is Act body or Schedule content. Act body segments use the section regex; Schedule segments use a schedule-specific splitter.

**Chapter header format** (confirmed from both files):
```
CHAPTER IV            ← matches /^CHAPTER [IVX]+(?:-[A-Z]+)?$/m
COMPUTATION OF TOTAL INCOME  ← title on next line
14. (1) Save as...    ← first section starts here
```

**Schedule header formats** (confirmed from both files):
- act-2025.txt: `SCHEDULE I`, `SCHEDULE II` ... `SCHEDULE XVI` — matches `/^SCHEDULE [IVX]+$/m`
- act-1961.txt: `THE FIRST SCHEDULE`, `THE SECOND SCHEDULE` — matches `/^THE \w+ SCHEDULE$/m`
- Within schedules: `PART A`, `PART B`, `PART I`, `PART II` — matches `/^PART [A-Z]+$/m`

**Pre-pass algorithm:**

```typescript
// Source: derived from file inspection
function splitActText(text: string): { section: string; text: string }[] {
  const results: { section: string; text: string }[] = [];

  // 1. Detect schedule boundary — everything before the first SCHEDULE is Act body
  const scheduleStart = findScheduleBoundary(text); // returns index or text.length
  const actBody = text.slice(0, scheduleStart);
  const scheduleBody = text.slice(scheduleStart);

  // 2. Process Act body: detect CHAPTER headers as named chunks, then section chunks
  results.push(...splitActBodyWithChapters(actBody));

  // 3. Process Schedule area: split by SCHEDULE/PART boundaries, skip section regex
  if (scheduleBody.trim()) {
    results.push(...splitScheduleArea(scheduleBody));
  }

  return results;
}
```

**Chapter chunk strategy (Claude's discretion — recommendation: attach to first section):**

Standalone chapter chunks (e.g., "CHAPTER IV — COMPUTATION OF TOTAL INCOME") add noise for queries that aren't asking about chapter structure. Attaching the chapter name to the section label of the first section in that chapter is lower noise and ensures chapter keywords appear in a retrievable chunk: `section: "CHAPTER IV / 14"` or simply augment the section text prefix.

Better approach: track the current chapter as context, prepend chapter name to EACH section label within that chapter: `"14 [Chapter IV]"`. This makes chapter-aware retrieval work without creating empty chapter chunks.

**Schedule chunk strategy (Claude's discretion — recommendation: per-schedule single chunk or PART subdivision):**

Each schedule is a distinct legal artifact. Split at SCHEDULE/PART boundaries, label as `"Schedule I"`, `"Schedule I — Part A"`. Do NOT apply the section regex within schedule content — schedule numbered items (e.g., `1. (1) The eligible fund...`) are definitional sub-paragraphs, not Act sections.

```typescript
// Schedule splitter — no section regex
function splitScheduleArea(text: string): { section: string; text: string }[] {
  // Split on: SCHEDULE [Roman] or THE [Ordinal] SCHEDULE or PART [Alpha/Roman]
  const boundaryRegex = /^(?:(?:THE\s+\w+\s+)?SCHEDULE\s*[IVXLC]*|PART\s+[A-Z]+)$/gm;
  // ... accumulate segments between boundary markers
}
```

### Pattern 3: Source-Agnostic Retrieve (for RAGI-01)

**What:** Replace the three named bucket variables with a dynamic Map keyed by source ID.

```typescript
// Current (hardcoded):
const fromComparison: typeof scored = [];
const from2025: typeof scored = [];
const from1961: typeof scored = [];

// Replacement:
const buckets = new Map<string, (typeof scored)>();
for (const config of SOURCE_CONFIGS) {
  buckets.set(config.id, []);
}

for (const s of scored) {
  const bucket = buckets.get(s.chunk.source);
  if (bucket && bucket.length < 1) bucket.push(s);
  const totalFilled = [...buckets.values()].reduce((sum, b) => sum + b.length, 0);
  if (totalFilled >= topK) break;
}
```

### Pattern 4: Stable Chunk ID Map (fixing the silent filter bug)

**What:** The current code stores chunks in a plain array and uses array index as ID. `chunks[id]` returns `undefined` if any rebuild shifts indices. Replace with a `Map<number, Chunk>` keyed by stable monotonically-assigned IDs.

```typescript
// Current (fragile):
const candidates = [...candidateIds].map(id => chunks[id]).filter(Boolean);
// .filter(Boolean) silently drops undefined — masks corruption

// Replacement:
const chunkMap = new Map<number, Chunk>();
// ...during buildChunks, assign id = globalIdCounter++
const candidates = [...candidateIds]
  .map(id => chunkMap.get(id))
  .filter((c): c is Chunk => c !== undefined);
// explicit type guard — TypeScript catches misuse
```

### Anti-Patterns to Avoid

- **Don't keep the 3-bucket variable pattern:** Even with a comment, it will be broken the moment a 4th source is added in Phase 8.
- **Don't apply the section regex to schedule text:** 299 false matches in act-2025.txt schedules confirms this is the root cause of schedule retrieval failures.
- **Don't use `chunks[id]` for lookup after adding new sources:** New source loading changes array positions — use Map.
- **Don't create standalone CHAPTER chunks:** Adds retrieval noise; attaching chapter context to section labels is cleaner.
- **Don't lower the minimum score threshold below 2 for now:** The existing threshold prevents garbage retrieval; only tune in Phase 10 with full corpus.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schedule boundary detection | Custom ML/heuristic | Regex on known header patterns | File format is fixed; patterns are stable |
| Source type discrimination | Runtime instanceof checks | Config lookup by `id` string | Simpler, O(1), no class hierarchy needed |
| Chunk deduplication | Similarity hashing | N/A — each source is unique | No duplicate content risk in current corpus |
| Token/BM25 scoring | tf-idf library | Existing keyword counter | STATE.md explicitly rejects BM25 libraries |

**Key insight:** The current RAG system works well for its domain. This phase is about extensibility surgery, not algorithmic improvement — do not introduce new scoring logic.

---

## Common Pitfalls

### Pitfall 1: Section Regex Collision in Schedules
**What goes wrong:** The regex `/^(\d+[A-Z]*(?:-[A-Z]+)?)\.\s/gm` matches schedule items like `1. (1) The eligible...`, `2. In this Schedule...`, creating phantom sections with IDs `"1"`, `"2"` that collide with Act sections 1 and 2.
**Why it happens:** Schedules use numbered paragraphs with the same syntactic pattern as Act section numbers.
**How to avoid:** Split text at schedule boundary first. Only apply section regex to the Act body portion (before `SCHEDULE I` / `THE FIRST SCHEDULE`).
**Warning signs:** Section count > actual Act sections (act-2025.txt has 536 sections, but 1238 are found); sections labeled `"1"` or `"2"` appearing after section 536.

### Pitfall 2: Array Index Drift
**What goes wrong:** When `initRAG()` is called or sources are re-ordered, chunk IDs (which ARE array indices) shift. Tokens in the inverted index still point to old indices. `chunks[oldId]` returns a different chunk or `undefined`, silently dropped by `.filter(Boolean)`.
**Why it happens:** The inverted index is built once and never invalidated — but chunk array order is loading-order dependent.
**How to avoid:** Use `Map<number, Chunk>` with monotonically assigned IDs, and rebuild both chunkMap and invertedIndex together in `initRAG()`.
**Warning signs:** Retrieval returns wrong chunks, or chunks from wrong source.

### Pitfall 3: Label Hardcoding Survives Refactor
**What goes wrong:** The label map in `retrieveContext()` is updated for the new source types but the `scoreChunk()` comparison boost still references `chunk.source === 'comparison'` by string literal.
**Why it happens:** There are two sites where source strings appear: scoring AND labeling. Developers commonly update one and miss the other.
**How to avoid:** Derive boost from `SOURCE_CONFIGS` lookup: `const config = sourceConfigMap.get(chunk.source); if (config?.boost) score = Math.ceil(score * config.boost);`
**Warning signs:** comparison.txt chunks score correctly but new source chunks don't get their boost; or vice versa.

### Pitfall 4: topK Default in Two Places
**What goes wrong:** `retrieve()` defaults `topK = 3` AND `retrieveContext()` defaults `topK = 3`. The locked decision is topK=5. If only one site is updated, the call chain uses the wrong value.
**How to avoid:** Define `const DEFAULT_TOP_K = 5` at module top and reference it in both signatures.
**Warning signs:** Only 3 chunks returned despite topK=5 being set.

### Pitfall 5: CHAPTER Header Detection vs Roman Numeral Section Numbers
**What goes wrong:** A regex for `^CHAPTER [IVX]+` could match if an Act section label started with "CHAPTER" (unlikely but possible in edge cases like amendment text).
**How to avoid:** CHAPTER headers are always on a line by themselves with NO period after — `^CHAPTER\s+[IVX]+(?:-[A-Z]+)?\s*$` (end-of-line anchor). Section numbers always have a period: `^(\d+...)\.\s`.
**Warning signs:** A chapter header gets split as if it were a section start.

---

## Code Examples

### Existing Section Splitter (current, for reference)
```typescript
// Source: server/rag/index.ts line 33-57 (confirmed)
function splitIntoSections(text: string): { section: string; text: string }[] {
  const sectionRegex = /^(\d+[A-Z]*(?:-[A-Z]+)?)\.\s/gm;
  // ... fails in schedule areas, misses CHAPTER headers
}
```

### Chapter/Schedule Pre-Pass Pattern
```typescript
// Source: derived from confirmed file structure inspection
const CHAPTER_REGEX = /^(CHAPTER\s+[IVX]+(?:-[A-Z]+)?)\s*$/m;
const SCHEDULE_BOUNDARY_REGEX = /^(?:(?:THE\s+\w+\s+)?SCHEDULE\s*[IVXLC]*|SCHEDULE\s+[IVXLC]+)\s*$/m;

function findScheduleBoundary(text: string): number {
  const match = SCHEDULE_BOUNDARY_REGEX.exec(text);
  return match ? match.index : text.length;
}
```

### Source-Agnostic Balancing Loop
```typescript
// Source: derived from CONTEXT.md requirement + current retrieve() logic
function buildBalancedResult(scored: ScoredChunk[], topK: number): ScoredChunk[] {
  const buckets = new Map<string, ScoredChunk[]>();
  // Pre-populate from SOURCE_CONFIGS so ordering is deterministic
  for (const cfg of SOURCE_CONFIGS) buckets.set(cfg.id, []);

  for (const s of scored) {
    const bucket = buckets.get(s.chunk.source);
    if (bucket && bucket.length < 1) bucket.push(s);
    const filled = [...buckets.values()].reduce((n, b) => n + b.length, 0);
    if (filled >= topK) break;
  }

  const used = new Set([...buckets.values()].flat().map(s => s.chunk.id));
  const overflow = scored.filter(s => !used.has(s.chunk.id));
  const combined = [...buckets.values()].flat();
  for (const s of overflow) {
    if (combined.length >= topK) break;
    combined.push(s);
  }
  return combined.sort((a, b) => b.score - a.score).slice(0, topK);
}
```

### Startup Logging (locked decision)
```typescript
// Locked: "log chunk counts per source + total index keys"
export function initRAG(): void {
  const dataDir = join(__dirname, '..', 'data');
  allChunks = [];
  chunkMap.clear();
  invertedIndex.clear();

  for (const cfg of SOURCE_CONFIGS) {
    try {
      const chunks = buildChunks(join(dataDir, cfg.filePath), cfg);
      console.log(`[RAG] Loaded ${cfg.id}: ${chunks.length} chunks`);
      for (const c of chunks) {
        chunkMap.set(c.id, c);
        allChunks.push(c);  // kept for backward-compat iterate patterns
      }
    } catch {
      console.warn(`[RAG] ${cfg.filePath} not found, skipping`);
    }
  }

  buildIndex([...chunkMap.values()]);
  console.log(`[RAG] Total chunks: ${chunkMap.size}, index keys: ${invertedIndex.size}`);
}
```

---

## State of the Art

| Old Approach | Current Approach | Implication |
|--------------|------------------|-------------|
| 3-value union + hardcoded buckets | SourceConfig[] registry | One array entry = one new source, zero retrieval code changes |
| Single splitter for all Act files | Pre-pass to detect schedule boundary | Schedule chunks no longer pollute Act section namespace |
| CHAPTER headers silently swallowed | Track current chapter, annotate section labels | Chapter context survives into retrieval |
| `chunks[id]` array index lookup | `chunkMap.get(id)` Map lookup | No silent `undefined` from index drift |
| topK=3 default (hardcoded x2) | `DEFAULT_TOP_K = 5` constant | One edit point for future tuning |

**Deprecated/outdated in this refactor:**
- `Chunk.source` as a TypeScript string union — becomes `string` (validated by config, not by type system)
- `fromComparison`, `from2025`, `from1961` variable names — replaced by generic Map
- `buildChunks(filePath, source: Chunk['source'])` signature — replaced by `buildChunks(config: SourceConfig)`

---

## Open Questions

1. **Comparison.txt boost — keep 1.5x or remove?**
   - What we know: comparison.txt scores well because it's dense topic summaries; 1.5x may crowd out primary Act sources when topK=5
   - What's unclear: whether comparison results improve or hurt answer quality at topK=5 vs topK=3
   - Recommendation: Keep the boost for Phase 7, flag for evaluation in Phase 10 (SCOR-03 is explicitly a Phase 10 concern)

2. **Chapter label format for section annotation**
   - What we know: CHAPTER IV has a title line ("COMPUTATION OF TOTAL INCOME") on the next line
   - What's unclear: whether to use Roman numeral (`CHAPTER IV`) or title (`Computation of Total Income`) in section labels
   - Recommendation: Use both — `"14 [Chapter IV — Computation of Total Income]"` for maximum retrievability; truncate if too long

3. **Act-1961.txt schedule format differs from act-2025.txt**
   - act-2025.txt uses `SCHEDULE I` ... `SCHEDULE XVI`
   - act-1961.txt uses `THE FIRST SCHEDULE` ... `THE FOURTEENTH SCHEDULE`
   - Resolution: The schedule boundary regex must handle both formats. Single regex with alternation covers both.

---

## Sources

### Primary (HIGH confidence)
- `server/rag/index.ts` — complete file inspection (all 337 lines read)
- `server/data/act-2025.txt` — inspected schedule structure at line 27778; CHAPTER headers at lines 1181, 7610 etc.
- `server/data/act-1961.txt` — inspected CHAPTER headers at lines 1287, 7366; schedule headers at lines 47046-47133
- `server/data/comparison.txt` — confirmed `======` delimiter format
- `.planning/phases/07-rag-infrastructure-fixes/07-CONTEXT.md` — locked decisions, constraints, specifics

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — decision rationale for rejecting BM25 and embedding libraries
- `.planning/REQUIREMENTS.md` — RAGI-01 through RAGI-05 definitions

---

## Metadata

**Confidence breakdown:**
- Bug identification (schedule regex, chapter loss): HIGH — confirmed by running section count (1238 found vs 536 actual sections in act-2025.txt; 299 false matches in schedule area)
- Refactor pattern (SourceConfig registry): HIGH — standard TypeScript config pattern, directly addresses all four code sites
- Chapter handling recommendation: MEDIUM — "attach to first section" is reasonable but not uniquely correct; alternatives are viable
- Schedule splitter design: HIGH — file format is stable, regex patterns are confirmed

**Research date:** 2026-04-08
**Valid until:** Until act-1961.txt, act-2025.txt, or comparison.txt file formats change (stable — these are final legislative texts)
