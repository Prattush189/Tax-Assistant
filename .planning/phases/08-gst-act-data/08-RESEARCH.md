# Phase 8: GST Act Data - Research

**Researched:** 2026-04-08
**Domain:** Legal text extraction and RAG source registration (CGST Act 2017, IGST Act 2017)
**Confidence:** HIGH — infrastructure fully verified from Phase 7; GST data sourcing is MEDIUM (PDF extraction quality unknown until attempted)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Data sources:** CGST Act 2017 and IGST Act 2017 from official government PDFs (CBIC cbic-gst.gov.in or India Code indiacode.nic.in). If PDF extraction quality is poor (< 150 section-matched chunks for CGST), fall back to India Code HTML source.
- **File locations:** `server/data/cgst-act.txt` and `server/data/igst-act.txt`
- **Source registration:** Two new entries added to `SOURCE_CONFIGS` array in `server/rag/index.ts` — `id='cgst-2017'`, `label='CGST Act 2017'`, `splitter='act'`, no boost; `id='igst-2017'`, `label='IGST Act 2017'`, `splitter='act'`, no boost
- **Section labeling format:** `[CGST Act 2017 — Section 16]`, `[IGST Act 2017 — Section 12]` (derived from SourceConfig.label + chunk.section at retrieval time)
- **Text format:** Section numbers at line start, matching IT Act file format
- **Quality gate:** CGST > 150 section-matched chunks; IGST > 20 section-matched chunks; both load without errors at startup
- **Amendments:** Include up to Finance Act 2025 where available
- **No infrastructure changes:** Phase 7 is complete; no chunker or retrieval logic changes

### Claude's Discretion
- Exact text cleaning/formatting approach for extracted PDF text
- Whether to include explanatory notes or amendment annotations
- How to handle CGST Rules references within Act text (leave as-is, don't add Rules text)
- Sub-chunking parameters (use existing 1200/200 defaults unless testing shows issues)

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GST-01 | CGST Act 2017 full text (174+ sections, 5 schedules) loaded as RAG data source | Adding `{ id: 'cgst-2017', filePath: 'cgst-act.txt', label: 'CGST Act 2017', splitter: 'act' }` to SOURCE_CONFIGS triggers automatic chapter/schedule-aware chunking via Phase 7 infrastructure |
| GST-02 | IGST Act 2017 full text (~25 sections including place-of-supply rules) loaded as RAG data source | Same pattern: `{ id: 'igst-2017', filePath: 'igst-act.txt', label: 'IGST Act 2017', splitter: 'act' }` |
| GST-03 | GST source chunks have proper section labels distinguishable from IT Act section numbers | Labels include Act name prefix from SourceConfig.label: `[CGST Act 2017 — 16 [CHAPTER V — Input Tax Credit]]` vs `[IT Act 1961 — 16 [CHAPTER III — ...]]`; section NUMBER collision is harmless because source label disambiguates |
| GST-04 | User can ask GST-specific questions and receive RAG-augmented answers with CGST/IGST references | Verified retrieval path: chat.ts calls `retrieveContext(query)` → scored chunks returned with labels → injected into Gemini prompt |
</phase_requirements>

---

## Summary

Phase 8 is a data preparation and registration phase, not an infrastructure phase. The entire RAG infrastructure needed for adding new Act sources was completed in Phase 7. The implementation reduces to two tasks: (1) prepare clean text files for CGST Act 2017 and IGST Act 2017, and (2) add two entries to the `SOURCE_CONFIGS` array.

The highest-risk element is text extraction quality. The CGST Act PDF from CBIC (cbic-gst.gov.in) may produce garbled text, misaligned section numbers, or formatting noise that prevents the section regex from matching. The quality gate (> 150 section-matched chunks for CGST) will catch extraction failures at startup. If extraction fails the gate, the fallback path is India Code HTML (indiacode.nic.in), which is human-readable HTML that can be scraped or copy-pasted into structured text.

The IGST Act is small (~25 sections) and straightforward. Sections 5 (levy), 7-8 (inter/intra-state supply), and 10-13 (place of supply) are the core retrieval targets. The CGST Act is large (174 sections, 5 schedules, 21 chapters) and must produce more than 150 section-matched chunks to confirm extraction integrity.

**Primary recommendation:** Attempt PDF extraction first using a documented process (pdf-parse or manual copy from official PDF). If chunk count validation fails, switch to India Code HTML scraping and re-clean. Do not invest in automated PDF tooling — the Acts are stable texts that will not need re-extraction.

---

## Standard Stack

### Core — No New Dependencies

This phase intentionally adds zero new npm packages. Text extraction is a one-time manual process producing static `.txt` files. The existing RAG infrastructure handles the rest.

| Component | Role | Status |
|-----------|------|--------|
| `server/rag/index.ts` | SOURCE_CONFIGS registration + chunk loading | Fully implemented (Phase 7) |
| `splitActWithChaptersAndSchedules()` | Splits CGST/IGST text into section + schedule chunks | Implemented in Phase 7; handles any Act in standard format |
| `server/data/cgst-act.txt` | CGST Act 2017 text file | Must be created in this phase |
| `server/data/igst-act.txt` | IGST Act 2017 text file | Must be created in this phase |

### Optional Text Extraction Tool (if needed)
```bash
# Only if programmatic extraction is needed — not a project dependency
npx pdf-parse <pdf-file>
# OR use Python: pdfplumber, pdfminer.six for complex PDFs
```

### Installation
```bash
# No new dependencies for this phase
```

---

## Architecture Patterns

### How Source Registration Works (verified from server/rag/index.ts)

```
SOURCE_CONFIGS array (server/rag/index.ts)
    ↓ initRAG() iterates SOURCE_CONFIGS
    ↓ buildChunks(join(dataDir, cfg.filePath), cfg)
    ↓ cfg.splitter === 'act' → splitActWithChaptersAndSchedules(text)
    ↓ splitActBodyWithChapters() for body + splitScheduleArea() for schedules
    ↓ subChunk() breaks sections > 1200 chars with 200-char overlap
    ↓ Chunk stored in chunkMap with id=cgst-2017, section label with chapter context
    ↓ buildIndex() adds all tokens to invertedIndex
    ↓ console.log(`[RAG] Loaded cgst-2017: N chunks`)
```

### Adding a New Source — Exact Pattern

```typescript
// Source: server/rag/index.ts — SOURCE_CONFIGS array (confirmed, Phase 7 complete)
const SOURCE_CONFIGS: SourceConfig[] = [
  { id: 'comparison', filePath: 'comparison.txt', label: 'Comparison Guide', splitter: 'comparison', boost: 1.5 },
  { id: 'act-2025',   filePath: 'act-2025.txt',   label: 'IT Act 2025',      splitter: 'act' },
  { id: 'act-1961',   filePath: 'act-1961.txt',   label: 'IT Act 1961',      splitter: 'act' },
  // Phase 8 additions:
  { id: 'cgst-2017',  filePath: 'cgst-act.txt',   label: 'CGST Act 2017',    splitter: 'act' },
  { id: 'igst-2017',  filePath: 'igst-act.txt',   label: 'IGST Act 2017',    splitter: 'act' },
];
```

No other code changes are needed. The retrieval balancing loop, label formatter, and startup logger are all data-driven from this array.

### Recommended Text File Structure

GST Act text files must follow the same structural conventions as act-1961.txt and act-2025.txt for the section regex and chapter/schedule detection to work correctly:

```
CENTRAL GOODS AND SERVICES TAX ACT, 2017

CHAPTER I
PRELIMINARY

1. Short title, extent and commencement.
(1) This Act may be called the Central Goods and Services Tax Act, 2017.
...

CHAPTER II
ADMINISTRATION

...

CHAPTER V
INPUT TAX CREDIT

16. Eligibility and conditions for taking input tax credit.
(1) Every registered person shall, subject to such conditions and restrictions...
...

SCHEDULE I
ACTIVITIES TO BE TREATED AS SUPPLY EVEN IF MADE WITHOUT CONSIDERATION

1. Permanent transfer or disposal of business assets...
```

Key structural requirements:
- **Chapter headers:** `CHAPTER [Roman numeral]` on its own line, followed by title on next line
- **Section starts:** `[number]. ` at the start of a line (e.g., `16. `)
- **Schedule starts:** `SCHEDULE [Roman numeral]` on its own line (e.g., `SCHEDULE I`)
- **No leading whitespace** on section/chapter/schedule marker lines

### CGST Act Structure (174 sections, 21 chapters, 5 schedules)

| Range | Chapter | Key sections |
|-------|---------|-------------|
| 1-2 | I — Preliminary | Definitions |
| 3-6 | II — Administration | Officers |
| 7-17 | III-V — Levy/Supply/ITC | Sec 9 (levy), 16 (ITC eligibility), 17 (blocked credits) |
| 18-30 | VI-VIII — Registration/Returns | Sec 22 (registration), 37 (GSTR-1), 39 (GSTR-3B) |
| 31-50 | IX-XII — Payment/Refunds | Sec 49 (payment), 54 (refunds) |
| 51-53 | XIII — TDS/TCS | Sec 51 (TDS), 52 (TCS) |
| 54-121 | XIV-XVIII — Misc | Sec 73/74 (demand) |
| 122-174 | XIX-XXI — Offences/Appeals | |
| Schedules | I-V | Supply without consideration, negative list, nil rated, exempt, non-GST |

### IGST Act Structure (~25 sections, 4 chapters)

| Range | Chapter | Key sections |
|-------|---------|-------------|
| 1-2 | I — Preliminary | Definitions |
| 3 | II — Administration | Officers |
| 4-8 | III — Levy and Collection | Sec 5 (levy), 7 (inter-state supply), 8 (intra-state supply) |
| 9-13 | IV — Place of Supply | Sec 10 (goods), 11 (goods out of India), 12 (services B2B), 13 (services B2C) |
| 14-25 | V-VI — Misc | Zero-rated supply, refunds |

### How Labels Appear in Retrieval Output

```typescript
// Source: server/rag/index.ts — retrieveContext() (confirmed)
const context = chunks
  .map(c => {
    const cfg = sourceConfigMap.get(c.source);
    const label = cfg?.label ?? c.source;
    return `[${label} \u2014 ${c.section}]\n${c.text}`;
  })
  .join('\n\n---\n\n');
```

For a CGST Act Section 16 chunk with chapter context (after Phase 7 splitter):
- `c.source` = `'cgst-2017'`
- `c.section` = `'16 [CHAPTER V — Input Tax Credit]'`
- Output label: `[CGST Act 2017 — 16 [CHAPTER V — Input Tax Credit]]`

This satisfies GST-03: label contains "CGST Act 2017" which is distinct from "IT Act 1961" and "IT Act 2025".

### Current RAG State (from Phase 7 SUMMARY.md)

| Source | Chunks | Notes |
|--------|--------|-------|
| act-2025 | 2,179 | IT Act 2025, chapter/schedule-aware |
| act-1961 | 3,636 | IT Act 1961, chapter/schedule-aware |
| comparison | 98 | Comparison Guide with 1.5x boost |
| **Total** | **5,913** | Index keys: 26,404 |

After Phase 8, expected totals:
- CGST Act: ~300-500 chunks (174 sections × 1-3 sub-chunks each + 5 schedules)
- IGST Act: ~40-60 chunks (25 sections, some multi-part)
- New total: ~6,200-6,400 chunks

### Anti-Patterns to Avoid

- **Don't set a boost for CGST or IGST sources.** The comparison.txt boost (1.5x) exists because it is a dense summary document. GST Act sections should compete on relevance alone. Adding boost would crowd out IT Act results for hybrid IT+GST queries.
- **Don't add more than two SOURCE_CONFIGS entries.** CGST Rules, HSN schedules, and Finance Act amendment text are all explicitly deferred to v2 in REQUIREMENTS.md and STATE.md.
- **Don't modify the section regex.** The existing regex `^(\d+[A-Z]*(?:-[A-Z]+)?)\.\s` matches GST Act section numbers (1., 2., 16., 17A.) correctly — same format as IT Act sections.
- **Don't strip section cross-references from the text.** References like "section 16 of the CGST Act" within IGST text are valuable retrieval signals.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Chapter/schedule detection for CGST | New splitter | Existing `splitActWithChaptersAndSchedules()` | Phase 7 built exactly this for any Act in standard format |
| Source label formatting | Custom label function | Existing `retrieveContext()` label logic | Already derives label from SourceConfig.label + chunk.section |
| Startup chunk count logging | New logging code | Existing `console.log('[RAG] Loaded ...')` | initRAG() already logs per-source chunk count |
| Chunk quality validation | Runtime assertion in prod code | Startup log inspection + manual chunk count check | Quality gate is a verification step, not prod assertion |

**Key insight:** The entire Phase 8 infrastructure work was done in Phase 7. This phase is a data preparation task wearing an engineering hat.

---

## Common Pitfalls

### Pitfall 1: PDF Text Extraction Garbles Section Numbers
**What goes wrong:** PDF → text conversion wraps long lines, joins section numbers with preceding text, or uses ligatures. The section regex `^(\d+[A-Z]*)\.\s` requires the number at line start — if the PDF produces `...taxation. 16. Every registered person...` on a single line, section 16 is not detected.
**Why it happens:** CBIC PDFs use multi-column layouts and justified text that plain extractors can't handle cleanly.
**How to avoid:** After extraction, validate chunk count immediately. If `grep -cE "^[0-9]+\. " cgst-act.txt` returns fewer than 150, the extraction failed. Switch to India Code HTML source.
**Warning signs:** CGST loads fewer than 150 chunks (quality gate fails); sections labeled `'general'` dominate the chunk list.

### Pitfall 2: Section Number Collision Misread as Bug
**What goes wrong:** CGST Section 16 (ITC) and IT Act 1961 Section 16 (salary income) have the same section number. A developer assumes this is a collision bug.
**Why it happens:** The section number is stored without Act prefix — `chunk.section = '16 [CHAPTER V...]'`, `chunk.source = 'cgst-2017'`.
**How to avoid:** This is NOT a bug. The source field (`chunk.source = 'cgst-2017'`) disambiguates at retrieval time. The label in RAG output includes the Act name: `[CGST Act 2017 — 16 [...]]`. Scoring: if query mentions "Section 16 GST", the GST chunk scores higher because its text contains "input tax credit", "ITC", "registered person" — GST-domain vocabulary.
**Warning signs:** None — this is expected behavior. Only investigate if wrong-source chunks appear for domain-specific queries.

### Pitfall 3: CGST Schedule Numbering Clashes with Section Regex
**What goes wrong:** CGST Act schedules contain numbered items (`1. Permanent transfer...`, `2. Supply of goods...`) that match the section regex if not split at the schedule boundary first.
**Why it happens:** Same root cause as the IT Act schedule false-positive bug fixed in Phase 7.
**How to avoid:** The Phase 7 `splitActWithChaptersAndSchedules()` function already handles this — it detects the first `SCHEDULE [Roman]` line and applies the section regex only to Act body. As long as the extracted text has `SCHEDULE I` on its own line (standard CGST Act format), this is automatically handled.
**Warning signs:** More than ~200 chunks from CGST (schedules being split into phantom sections rather than 5 schedule-level chunks).

### Pitfall 4: Text Includes Headers/Footers from PDF
**What goes wrong:** Every page of the PDF starts with "CENTRAL GOODS AND SERVICES TAX ACT, 2017" or page numbers. These become orphan text between sections that bloats chunks and confuses the splitter.
**Why it happens:** PDF text extraction is linear — page headers repeat on every page.
**How to avoid:** After extraction, scan for repeated lines and strip them. A Python or sed pass on `cgst-act.txt` to remove repeated header strings before using the file. Check with `sort | uniq -c | sort -rn | head -20` to find most-repeated lines.
**Warning signs:** Many short chunks with only header text; section label `'general'` appears repeatedly.

### Pitfall 5: igst-act.txt Has Fewer Than 20 Section-Matched Chunks
**What goes wrong:** IGST Act is only 25 sections. After schedule and preamble chunking, there may be borderline cases near the 20-chunk gate.
**Why it happens:** The IGST Act is short; some sections are very brief (1-2 lines) and fall below the 50-char minimum in `splitIntoSections()`.
**How to avoid:** Very short sections (e.g., "Section 23. Power to make rules.") will be discarded if under 50 chars. This is correct behavior — they have no retrieval value. Count only sections with substantive content. If natural count is 22-24, the gate of 20 will still pass.
**Warning signs:** IGST loads 0-10 chunks (extraction failure, not natural sparsity).

---

## Code Examples

### Exact SOURCE_CONFIGS Addition
```typescript
// Source: server/rag/index.ts — SOURCE_CONFIGS array (confirmed current state)
const SOURCE_CONFIGS: SourceConfig[] = [
  { id: 'comparison', filePath: 'comparison.txt', label: 'Comparison Guide', splitter: 'comparison', boost: 1.5 },
  { id: 'act-2025',   filePath: 'act-2025.txt',   label: 'IT Act 2025',      splitter: 'act' },
  { id: 'act-1961',   filePath: 'act-1961.txt',   label: 'IT Act 1961',      splitter: 'act' },
  { id: 'cgst-2017',  filePath: 'cgst-act.txt',   label: 'CGST Act 2017',    splitter: 'act' },  // GST-01
  { id: 'igst-2017',  filePath: 'igst-act.txt',   label: 'IGST Act 2017',    splitter: 'act' },  // GST-02
];
```

### Startup Log Verification Pattern (Quality Gate)
```
[RAG] Loaded comparison: 98 chunks
[RAG] Loaded act-2025: 2179 chunks
[RAG] Loaded act-1961: 3636 chunks
[RAG] Loaded cgst-2017: XXX chunks   ← must be > 150 for quality gate (GST-01)
[RAG] Loaded igst-2017: XX chunks    ← must be > 20 for quality gate (GST-02)
[RAG] Total chunks: NNNN, index keys: MMMMM
```

### Text Format Validation Command
```bash
# Count section-matched lines in extracted text
grep -cE "^[0-9]+[A-Z]*\. " server/data/cgst-act.txt
# Expected: > 150 (174 sections, many with sub-sections labeled 16A, 17A, etc.)

grep -cE "^[0-9]+[A-Z]*\. " server/data/igst-act.txt
# Expected: > 20 (25 sections)

# Check chapter headers exist
grep -E "^CHAPTER [IVX]+" server/data/cgst-act.txt | head -10
# Expected: CHAPTER I, CHAPTER II ... CHAPTER XXI

# Check schedule headers exist
grep -E "^SCHEDULE [IVX]+" server/data/cgst-act.txt
# Expected: SCHEDULE I through SCHEDULE V
```

### Text Cleaning Pattern (Python — optional tool, not project dependency)
```python
# One-time cleaning script (not committed to project)
import re

with open('cgst-raw.txt', 'r') as f:
    text = f.read()

# Remove repeated page headers
text = re.sub(r'CENTRAL GOODS AND SERVICES TAX ACT, 2017\s*\n', '', text)
# Remove page numbers
text = re.sub(r'^\s*\d+\s*$', '', text, flags=re.MULTILINE)
# Normalize whitespace between sections
text = re.sub(r'\n{3,}', '\n\n', text)

with open('server/data/cgst-act.txt', 'w') as f:
    f.write(text)
```

### Retrieval Output Example (GST-04 verification)

Query: "What is input tax credit under GST?"

Expected retrieved chunks (with Phase 8 deployed):
```
[CGST Act 2017 — 16 [CHAPTER V — Input Tax Credit]]
16. Eligibility and conditions for taking input tax credit.
(1) Every registered person shall, subject to such conditions and restrictions as may be prescribed...

[CGST Act 2017 — 17 [CHAPTER V — Input Tax Credit]]
17. Apportionment of credit and blocked credits.
(1) Where the goods or services or both are used by the registered person partly for the purpose of...

[Comparison Guide — GST — KEY PROVISIONS (SEPARATE ACT, NOT RENUMBERED)]
...Section 16 CGST: Input Tax Credit (ITC) eligibility and conditions...
```

---

## State of the Art

| Aspect | Current State | After Phase 8 |
|--------|---------------|---------------|
| GST coverage | comparison.txt summaries only (sections 10 and 25) | Full CGST + IGST Act text with section-level retrieval |
| Source count | 3 sources (comparison, act-2025, act-1961) | 5 sources |
| Total chunks | ~5,913 | ~6,300-6,500 (estimated) |
| GST query answers | Grounded in summary text only | Grounded in primary Act text with section citations |
| Section label uniqueness | IT Act labels only | CGST/IGST labels distinguished by Act name prefix |

---

## Open Questions

1. **CBIC PDF extraction quality**
   - What we know: CBIC cbic-gst.gov.in hosts official PDFs for CGST Act 2017 and IGST Act 2017 including Finance Act 2025 amendments
   - What's unclear: Whether PDF-to-text produces clean line-start section numbers or wraps/garbles them
   - Recommendation: Attempt extraction, validate immediately with `grep -cE "^[0-9]+[A-Z]*\. "`. If < 150 for CGST, switch to India Code HTML (indiacode.nic.in/acts/1892). STATE.md documents this as the planned fallback.

2. **CGST Act amendment text format**
   - What we know: Finance Act 2025 amendments to CGST Act exist and should be included (per CONTEXT.md: "amendments up to Finance Act 2025 where available")
   - What's unclear: Whether CBIC PDF incorporates amendments inline (preferred) or as separate amendment sections (noisy)
   - Recommendation: Prefer consolidated version (with amendments incorporated) over bare Act + separate amendment text. India Code usually provides consolidated versions.

3. **Sub-chunking parameters for dense GST text**
   - What we know: Current MAX_CHUNK_SIZE=1200, CHUNK_OVERLAP=200 works well for IT Acts
   - What's unclear: CGST Section 17(5) (blocked credits) lists 8+ items and may produce very long section text that sub-chunks into many parts
   - Recommendation: Use existing defaults. Phase 10 (SCOR-03) is the designated place for length normalization tuning. Do not change chunker parameters in Phase 8.

---

## Sources

### Primary (HIGH confidence)
- `server/rag/index.ts` — Complete file read (551 lines); SOURCE_CONFIGS, splitter dispatch, initRAG, retrieve, retrieveContext all verified
- `.planning/phases/08-gst-act-data/08-CONTEXT.md` — Locked decisions, quality gates, file naming, source config spec
- `.planning/phases/07-rag-infrastructure-fixes/07-02-SUMMARY.md` — Confirms Phase 7 complete; exact chunk counts for existing sources
- `server/data/comparison.txt` — Confirmed GST content in sections 10 and 25; IGST place-of-supply rules documented
- `server/data/act-1961.txt` — Confirmed section regex matches 1552+ lines; CHAPTER format verified

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — Confirmed: CGST PDF extraction quality is flagged as MEDIUM risk; fallback path documented
- `.planning/REQUIREMENTS.md` — GST-01 through GST-04 definitions; confirmed CGST Rules/HSN deferred to v2

### Tertiary (LOW confidence — not verified against live sources in this session)
- CBIC PDF availability: cbic-gst.gov.in hosts CGST Act 2017 consolidated versions (not verified live)
- India Code HTML: indiacode.nic.in/acts/1892 provides consolidated CGST Act (not verified live)
- CGST Act section count: 174 sections across 21 chapters as documented in CONTEXT.md (not independently verified)
- IGST Act section count: ~25 sections as documented in CONTEXT.md (not independently verified)

---

## Metadata

**Confidence breakdown:**
- SOURCE_CONFIGS registration pattern: HIGH — code read directly, pattern fully verified
- splitActWithChaptersAndSchedules compatibility with CGST/IGST: HIGH — function handles any standard Act format; section regex is format-agnostic
- PDF extraction quality: LOW — unknown until attempted; documented fallback path exists
- CGST section count (174): MEDIUM — from CONTEXT.md, consistent with known Act structure
- Quality gate thresholds (150/20): HIGH — from CONTEXT.md locked decisions

**Research date:** 2026-04-08
**Valid until:** Phase infrastructure (index.ts) is stable; data files are one-time extractions from stable legislative texts. Valid indefinitely unless CGST/IGST Acts are substantially amended.
