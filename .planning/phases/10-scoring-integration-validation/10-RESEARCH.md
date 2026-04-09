# Phase 10: Scoring & Integration Validation — Research

**Researched:** 2026-04-09
**Domain:** Keyword RAG retrieval scoring, boost factor tuning, golden query validation, token budget analysis
**Confidence:** HIGH — all findings drawn from live code inspection and actual RAG execution output

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Golden Query Set**
- 15 queries total, weighted distribution: 7 IT Act + 4 GST + 4 Reference
- Include 2-3 cross-domain queries (e.g., "Compare GST registration threshold vs income tax registration") per success criterion 3
- Include 2-3 intentionally tricky/ambiguous queries (e.g., "Section 16 input tax credit" which could be IT Act s.16 HRA or CGST s.16 ITC)
- Commit as a reusable JSON fixture (golden-queries.json) with query, expected domain, expected section references — reusable for future regression testing

**Regression Criteria**
- "No regression" means: for each IT query, the top-ranked chunk must still come from a relevant source (IT Act 1961/2025/Comparison). Source match, not exact chunk match
- Define expected results from scratch — specify which source + section SHOULD appear in top results for each query (no historical baseline snapshot needed)
- Source shifts are acceptable if answer quality is equivalent (e.g., IT Act chunk shifting to Comparison Guide is fine if the answer would still be correct)

**Token Budget Threshold**
- Target: ~3000 tokens average across all golden queries for topK=5 retrieval context
- Measure both average AND worst-case across all 15 queries
- Flag if worst-case exceeds threshold even if average is within budget

**Scoring Adjustments**
- Proactively tune ALL boost factors — systematically test different boost combinations across all 6 sources
- Length normalization (SCOR-03): implement ONLY if golden query results show dense text crowding out relevant shorter chunks. Defer if not needed
- Trade-offs acceptable: if boost tuning improves GST/reference queries but slightly worsens one IT query, net improvement across all 15 queries takes priority
- SCOR-01 (topK=5): already implemented in Phase 7 — just confirm it's still set and working, no new implementation needed

### Claude's Discretion
- Exact golden query wording and selection within the distribution constraints
- Boost factor values to test and final values to ship
- Whether length normalization is actually needed based on test results
- Format and structure of the validation report

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCOR-01 | Retrieval uses configurable topK (increased from 3 to 5) | DEFAULT_TOP_K = 5 already set in index.ts line 76 — confirm only, no new code |
| SCOR-02 | Source-type labels in retrieval output distinguish IT Act 1961, IT Act 2025, Comparison, CGST, IGST, and Reference sources | Labels flow from SOURCE_CONFIGS.label via retrieveContextWithRefs(); working now but SGST/amendment sources not in the required six |
| SCOR-03 | Length normalization prevents dense GST/legal text from crowding out relevant IT Act chunks | Live probes show SGST crowding GST queries and calendar section crowding CII query — needs investigation |
| SCOR-04 | Adding new data sources does not regress retrieval quality for existing IT Act queries | Regression probes show IT Act sources still appear in top-5 for IT queries — 4/4 regression checks pass |
</phase_requirements>

---

## Summary

Phase 10 is a validation-and-tuning phase with no new data sources. The full corpus currently loads 9,527 chunks across 23 registered sources (not 6 as originally planned — the SOURCE_CONFIGS in index.ts was expanded beyond the 6 core sources to include SGST state acts, amendment acts, UTGST, and Finance Acts). This expansion creates the primary scoring challenges the phase must address.

Live RAG execution reveals three concrete problems that must be fixed: (1) CII query regression — the validate-reference.ts script that passed in Phase 9 now fails 2/13 checks because a chronological calendar chunk outscores the CII section chunk; (2) SGST source crowding — GST queries return 3-4 SGST state act chunks (Punjab, Haryana, Himachal Pradesh, J&K) taking up slots from CGST/IGST Act chunks; (3) cross-domain queries return zero IT Act chunks despite having mixed-domain keywords. Token budget is well within range (~1,400-1,600 tokens per query at topK=5, versus the 3,000 target).

The primary technical work for Phase 10 is: write the 15-query golden-queries.json fixture, run the validation harness, then tune boost factors to fix the SGST crowding and CII regression. Length normalization (SCOR-03) may be needed for the calendar-vs-CII issue but should be determined after boost tuning.

**Primary recommendation:** Fix boost factors first (raise reference from 1.3x, lower or zero-out SGST/amendment/finance-act sources), then validate against golden queries. Length normalization is a fallback if boost tuning alone cannot fix the calendar-vs-CII ranking.

---

## Standard Stack

### Core (all already installed — this phase adds no dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tsx | project devDep | Run TypeScript validation scripts directly | Pattern established in Phases 8-9; `npx tsx server/rag/validate-reference.ts` |
| TypeScript | project dep | Type-safe scoring logic | All RAG code is TypeScript |

### Validation Script Pattern (from Phase 9)

The `server/rag/validate-*.ts` pattern is established:
- Import `initRAG, retrieveContextWithRefs` from `./index.js`
- Call `initRAG()` at startup
- Run assertions with `check(name, passed, detail)` helper
- Exit `process.exit(0)` on all pass, `process.exit(1)` on any fail
- Run via `npx tsx server/rag/validate-*.ts`

**No new installation needed for this phase.**

---

## Architecture Patterns

### Current RAG Pipeline (from live code, HIGH confidence)

```
Query string
  → tokenize() — lowercase, strip punctuation, remove stopwords, filter len > 2
  → sectionNumbers = query.match(/\b\d+[A-Z]*\b/)
  → candidateIds via invertedIndex lookup
  → scoreChunk() per candidate:
      • +1 per token occurrence (full-text keyword frequency)
      • +50 section-label exact match
      • +15 "section N" / "sec. N" in text
      • +10 bare number N in text
      • × cfg.boost (if score > 0 and boost defined)
  → dynamic bucket balancing: 1 guaranteed slot per source, fill remaining by score
  → return top topK by score
```

### Current Boost Configuration (from SOURCE_CONFIGS, live code)

| Source ID | Source Label | Boost | Chunks |
|-----------|-------------|-------|--------|
| comparison | Comparison Guide | 1.5x | 98 |
| act-2025 | IT Act 2025 | none | 2,123 |
| act-1961 | IT Act 1961 | none | 3,640 |
| cgst-2017 | CGST Act 2017 | none | 399 |
| igst-2017 | IGST Act 2017 | none | 60 |
| reference | Tax Reference Guide | 1.3x | 22 |
| cgst-amend-2018 | CGST Amendment 2018 | none | 28 |
| cgst-amend-2023 | CGST Amendment 2023 | none | 5 |
| igst-amend-2018 | IGST Amendment 2018 | none | 4 |
| cgst-jk-2017 | CGST J&K Extension 2017 | none | 3 |
| utgst-2017 | UTGST Act 2017 | none | 49 |
| utgst-amend-2018 | UTGST Amendment 2018 | none | 3 |
| sgst-delhi | Delhi SGST | none | 561 |
| sgst-haryana | Haryana SGST | none | 730 |
| sgst-himachal | Himachal Pradesh SGST | none | 491 |
| sgst-madhya | Madhya Pradesh SGST | none | 1 |
| sgst-punjab | Punjab SGST | none | 389 |
| sgst-jk | J&K SGST | none | 417 |
| fa-2019 | Finance Act 2019 | none | 51 |
| fa-2020 | Finance Act 2020 | none | 366 |
| fa-2021 | Finance Act 2021 | none | 18 |
| fa-2022 | Finance Act 2022 | none | 33 |
| fa-2023 | Finance Act 2023 | none | 36 |
| **Total** | | | **9,527** |

**Key insight:** The "6 sources" mental model from the phase description is outdated. There are 23 registered sources. SGST state acts alone contribute 2,589 chunks (27% of corpus) and contain near-identical section text to CGST Act. Finance Acts contribute 504 chunks. These secondary sources are competing with primary sources in retrieval.

### Dynamic Bucket Balancing (CRITICAL — HIGH confidence from live code)

The `retrieve()` function in index.ts guarantees one slot per source if that source has any scoring candidate. With 23 sources and topK=5, the first-pass guarantee can fill ALL 5 slots with one chunk from 5 different low-quality sources before the second pass fills from highest-scoring chunks.

**This is the root cause of SGST crowding**: With topK=5 and 23 sources, the guarantee phase can assign all 5 slots to 5 different SGST/amendment sources before CGST/IGST ever compete in the second pass.

### Recommended Project Structure for Phase 10 Artifacts

```
server/
└── rag/
    ├── index.ts                 (modified — boost values tuned)
    ├── validate-reference.ts    (existing — must pass again after tuning)
    └── validate-golden.ts       (new — 15-query golden set validation)
server/
└── data/
    └── golden-queries.json      (new — 15 golden queries fixture)
```

---

## Problem Analysis: Confirmed Issues (HIGH confidence — from live execution)

### Problem 1: CII Retrieval Regression (SCOR-02/SCOR-03)

**Query:** "What is the CII for FY 2025-26?"
**Current result:** Top reference chunk is the chronological calendar section, not the CII table section.
**Root cause:** The calendar section contains ~40 occurrences of "2025" (every April 2025 to March 2027 date entry), while the CII section contains ~25 "cii" occurrences plus fewer "2025" occurrences. After boost 1.3x, calendar section outscores CII section.
**validate-reference.ts status:** 11/13 checks pass, 2 FAIL (CII value 376 not found, CII section label not matched).

**Fix options (in priority order):**
1. Raise reference boost from 1.3x to 1.5x or 1.6x — may be sufficient if CII section has any score advantage at all
2. Apply section-specific boost multiplier for exact section keyword matches — more surgical
3. Add length normalization: score / sqrt(chunk.text.length) — reduces calendar's advantage from high token density

### Problem 2: SGST Source Crowding (SCOR-03/SCOR-04)

**Query:** "What is input tax credit under GST?"
**Current result:** 1 comparison, 1 cgst-2017, 3 SGST state acts (Delhi, Himachal, Punjab)
**Root cause:** Dynamic bucket balancing guarantees 1 slot per source. SGST acts have near-identical ITC sections (copy-pasted from CGST with minor state-specific modifications), so they score similarly to CGST and each gets a guaranteed slot.

**Impact:**
- GST queries return 3+ SGST chunks instead of CGST/IGST chunks
- Cross-domain query returns ZERO IT Act chunks (4 SGST slots + 1 comparison)
- validate-reference.ts is unaffected (reference queries don't compete with SGST on those keywords)

**Fix options (in priority order):**
1. Set boost to 0 (effectively disabled) for SGST state acts — they are structural duplicates of CGST; CGST is canonical for national law
2. Remove SGST entries from SOURCE_CONFIGS entirely — simplest, SCOR-02 only requires 6 specific source labels
3. Bucket balancing fix: group SGST/amendment sources under a shared "gst-supplementary" bucket, giving them collectively 1 slot

### Problem 3: Finance Act Slots in IT Queries

**Query:** "What is the standard deduction for salaried employees?"
**Current result:** `[comparison, act-1961, act-2025, fa-2019, fa-2020]`
**Issue:** Finance Acts take 2 of 5 slots for a core IT query. Finance Act sections are amendment text, not primary law text.
**Severity:** MEDIUM — IT Act sources are still present (top 3), so regression test passes. But Finance Acts dilute context quality.

**Fix:** Set boost to 0 for Finance Acts, or exclude via bucket grouping.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Custom tokenizer for budget calculation | chars/4 approximation | 1 char = ~0.25 GPT-4 tokens is accurate enough for budget validation; actual Gemini token counts not needed for this validation phase |
| Regression baseline | Snapshot comparison tool | Define expected domains per query in golden-queries.json | No historical baseline exists; source-type match is sufficient per user decision |
| Statistical test framework | Test runner library | validate-*.ts pattern with process.exit(0/1) | Established pattern from Phase 9; no external test framework present in project |

---

## Common Pitfalls

### Pitfall 1: Treating 23 Sources as 6 Sources
**What goes wrong:** Planning and CONTEXT.md both refer to "6 source types." The actual SOURCE_CONFIGS has 23 entries. Any fix that only considers 6 sources will miss the SGST crowding problem entirely.
**How to avoid:** Work from the actual SOURCE_CONFIGS array, not the conceptual 6-source model. The 6 sources in SCOR-02 are the ones that need correct labels; the other 17 are secondary sources whose boost/slot behavior needs controlling.

### Pitfall 2: Fixing CII with Boost Alone May Not Work
**What goes wrong:** Raising reference boost from 1.3x to 1.5x may not fix the CII vs. calendar ranking if calendar still outscores CII before the multiplier. The raw score difference must be examined.
**How to avoid:** Test the specific scoring: for query "CII FY 2025-26", what is the raw score of the CII section vs. the calendar section before boost is applied? If calendar raw score is, e.g., 45 and CII raw is 30, then 1.3x gives 39 vs. 45 — still fails. Need boost > 1.5x, or length normalization.

### Pitfall 3: Dynamic Bucket Balancing with Boost = 0
**What goes wrong:** The boost is only applied if `score > 0`. Setting boost to 0 does NOT prevent a source from getting its guaranteed bucket slot — the bucket logic runs before boost application. Boost = 0 would mean the score multiplier is 0, making every score 0, which triggers the `score > 0` guard and returns 0 — effectively excluding the source.
**HOWEVER:** Looking at the code: `if (cfg?.boost && score > 0) { score = Math.ceil(score * cfg.boost); }`. Setting boost = 0 would make `cfg.boost` falsy, so no multiplication. The source still competes on raw score.
**How to avoid:** To suppress a source entirely, set boost to a very small value (e.g., 0.01) so final scores round to 0, or remove the source from SOURCE_CONFIGS entirely for the validation phase.

### Pitfall 4: Token Budget Already Well Under Target
**What goes wrong:** Phase documentation emphasizes token budget as a concern. Live probes show ~1,400-1,600 tokens per query (chars 5,400-6,400 / 4). The 3,000 token target is already met with significant headroom.
**How to avoid:** Report this as "SCOR-01 confirmed — budget is ~1,500 tokens average, well under 3,000 target." Do not spend time optimizing something already under budget. topK=5 is confirmed working.

### Pitfall 5: validate-reference.ts Currently Fails (2/13 checks)
**What goes wrong:** Planning assumes validate-reference.ts is the baseline. It was passing in Phase 9 but now fails due to the expanded corpus introducing new competing sources.
**How to avoid:** Phase 10 must fix validate-reference.ts failures as part of boost tuning. The final validation plan should run validate-reference.ts AFTER tuning and require 13/13 pass as a gate, not just the new golden query validator.

---

## Code Examples

### Current scoreChunk() Implementation
```typescript
// server/rag/index.ts — lines 405-440
function scoreChunk(chunk: Chunk, tokens: string[], sectionNumbers: string[]): number {
  let score = 0;

  for (const token of tokens) {
    let idx = 0;
    while ((idx = chunk.lowerText.indexOf(token, idx)) !== -1) {
      score++;
      idx += token.length;
    }
  }

  const sectionLower = chunk.section.toLowerCase();
  for (const secNum of sectionNumbers) {
    if (sectionLower === secNum.toLowerCase() || sectionLower.startsWith(secNum.toLowerCase() + ' ')) {
      score += 50;
    }
  }

  for (const secNum of sectionNumbers) {
    const secLower = secNum.toLowerCase();
    if (chunk.lowerText.includes(`section ${secLower}`) || chunk.lowerText.includes(`sec. ${secLower}`)) {
      score += 15;
    }
    if (chunk.lowerText.includes(secLower)) {
      score += 10;
    }
  }

  const cfg = sourceConfigMap.get(chunk.source);
  if (cfg?.boost && score > 0) {
    score = Math.ceil(score * cfg.boost);
  }

  return score;
}
```

### Length Normalization Pattern (if needed)
```typescript
// Add after raw score computation, before boost multiplication
// Normalizes by sqrt of text length — reduces advantage of longer/denser chunks
const lengthNorm = Math.sqrt(chunk.text.length);
score = score / lengthNorm * 100; // scale back to comparable magnitude

// Then apply boost as before
```
**When to use:** Only if raising reference boost to 1.5x-1.6x does not fix the CII vs. calendar ranking. The calendar chunk (~1200 chars, max chunk size) vs. CII table section (~800 chars) means calendar gets +22% length advantage in raw token frequency. Length normalization would reduce this advantage.

### Golden Queries JSON Structure (required format)
```json
[
  {
    "id": "IT-01",
    "query": "What are the deductions under section 80C?",
    "expectedDomain": "it-act",
    "expectedSources": ["act-1961", "act-2025", "comparison"],
    "expectedSectionRefs": ["80C"],
    "notes": "Core IT deduction query — primary source should be act-1961 or act-2025"
  },
  {
    "id": "GST-01",
    "query": "What is input tax credit under GST?",
    "expectedDomain": "gst",
    "expectedSources": ["cgst-2017", "igst-2017", "comparison"],
    "expectedSectionRefs": ["16", "17"],
    "notes": "Core GST ITC query — should NOT be dominated by SGST state acts"
  },
  {
    "id": "REF-01",
    "query": "What is the CII for FY 2025-26?",
    "expectedDomain": "reference",
    "expectedSources": ["reference"],
    "expectedSectionRefs": [],
    "expectedValues": ["376"],
    "notes": "Exact lookup query — top reference chunk MUST contain value 376"
  },
  {
    "id": "CROSS-01",
    "query": "Compare GST registration threshold vs income tax registration",
    "expectedDomain": "mixed",
    "expectedSources": ["comparison", "cgst-2017", "act-1961"],
    "notes": "Cross-domain — must include both GST and IT Act sources in top 5"
  }
]
```

### validate-golden.ts Script Pattern (from validate-reference.ts)
```typescript
// server/rag/validate-golden.ts
import { initRAG, retrieveContextWithRefs } from './index.js';
import goldenQueries from '../../server/data/golden-queries.json' assert { type: 'json' };

initRAG();

for (const q of goldenQueries) {
  const result = retrieveContextWithRefs(q.query, 5);
  const sources = result?.references.map(r => r.source) ?? [];

  // Check expected sources appear in top 5
  const hasExpectedSource = q.expectedSources.some(s => sources.includes(s));

  // For reference queries, check expected values
  const hasExpectedValue = !q.expectedValues
    || result?.references.some(r => q.expectedValues.every(v => r.text.includes(v)));

  check(`${q.id}: expected source present`, hasExpectedSource, `sources=${sources.join(',')}`);
  if (q.expectedValues) {
    check(`${q.id}: expected value present`, hasExpectedValue ?? false, `values=${q.expectedValues}`);
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | Status | Impact |
|--------------|------------------|--------|--------|
| 3 hardcoded source buckets | Dynamic bucket per SOURCE_CONFIGS entry | Phase 7 complete | Now enables any N sources — but bucket guarantee with N=23 sources causes slot exhaustion at topK=5 |
| 3 Act sources (1961, 2025, comparison) | 23 registered sources | Phases 7-9 complete | SGST/amendment sources compete for retrieval slots |
| topK=3 | DEFAULT_TOP_K=5 | Phase 7 complete | Token budget well under target (1500 vs 3000) |
| No reference data | 22-chunk Tax Reference Guide | Phase 9 complete | CII/due dates/ITR lookup available but CII ranking regressed with expanded corpus |

---

## Open Questions

1. **Should SGST sources be kept in SOURCE_CONFIGS at all?**
   - What we know: SGST state acts are near-identical to CGST Act; they crowd out CGST/IGST in retrieval; SCOR-02 only requires 6 specific source labels (IT Act 1961, IT Act 2025, Comparison, CGST, IGST, Reference)
   - What's unclear: Whether any user query would specifically need Delhi SGST vs CGST text (state-specific modifications are minor)
   - Recommendation: Disable SGST/amendment/Finance Act sources by setting a `disabled: true` flag or removing them entirely. If keeping them, set boost=0.5x to suppress without removing retrieval path.

2. **Is the bucket guarantee algorithm appropriate for 23 sources?**
   - What we know: With N=23 sources and topK=5, the guarantee pass can assign all 5 slots without reaching the best-scoring chunks
   - What's unclear: Whether the fix should be (a) reduce source count, (b) reduce guarantee slots per source, or (c) add a minimum score threshold for guarantee eligibility
   - Recommendation: Option (a) — reduce source count by disabling secondary sources — is simplest and aligns with the 6-source mental model.

3. **Is boost tuning sufficient for the CII regression, or is length normalization required?**
   - What we know: Calendar section has ~40 "2025" occurrences; CII section has ~25 "cii" occurrences; reference boost is 1.3x
   - What's unclear: The exact raw scores before boost, so we don't know if 1.5x or 1.6x boost would tip the balance
   - Recommendation: Implement probe logging in the validation script to print raw vs. boosted scores for the CII query, then decide based on data.

---

## Validation Architecture

Note: `.planning/config.json` has `workflow.nyquist_validation` not set — only `workflow.research: true`. Nyquist validation is not configured. This section is included as operational guidance for the validation harness design.

### Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Custom validate-*.ts scripts (no Jest/Vitest) |
| Config file | None — scripts import directly from RAG module |
| Quick run command | `npx tsx server/rag/validate-golden.ts` |
| Full suite command | `npx tsx server/rag/validate-reference.ts && npx tsx server/rag/validate-golden.ts` |
| Estimated runtime | ~5 seconds (RAG init + 15 queries) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCOR-01 | DEFAULT_TOP_K=5 set, retrieval returns 5 chunks | unit | Manual inspection of index.ts line 76 | existing code |
| SCOR-02 | Source labels in retrieval output are human-readable (not raw IDs) | integration | `npx tsx server/rag/validate-golden.ts` — check label field per ref | Wave 0 gap |
| SCOR-03 | Dense chunks do not crowd out shorter relevant chunks | integration | `npx tsx server/rag/validate-reference.ts` (CII checks) + golden validate | validate-reference.ts exists; needs fix |
| SCOR-04 | IT Act queries still return IT Act sources after corpus expansion | integration | `npx tsx server/rag/validate-golden.ts` — IT-domain queries check sources | Wave 0 gap |

### Wave 0 Gaps (must be created before implementation)

- [ ] `server/data/golden-queries.json` — 15-query fixture with expected sources/values
- [ ] `server/rag/validate-golden.ts` — validation harness consuming golden-queries.json
- [ ] Fix: `server/rag/validate-reference.ts` — currently 11/13 pass; must reach 13/13

---

## Scoring Tuning Strategy

### Step 1: Diagnose — Print Raw Scores Before Boost

Before tuning any values, add temporary debug logging to `scoreChunk()` for the CII query to confirm the raw score differential:

```typescript
// Temporary: add after raw scoring loop, before boost multiplication
if (process.env.RAG_DEBUG) {
  console.log(`  score=${score} chunk=${chunk.source}:${chunk.section.slice(0,40)}`);
}
```

### Step 2: SGST/Amendment Source Suppression

**Option A (recommended): Add `disabled` flag to SourceConfig**
```typescript
interface SourceConfig {
  // ... existing fields ...
  disabled?: boolean;  // skip loading if true
}
// In initRAG():
for (const cfg of SOURCE_CONFIGS) {
  if (cfg.disabled) { console.log(`[RAG] Skipping disabled source: ${cfg.id}`); continue; }
  // ... existing load logic ...
}
```

**Option B: Remove SGST entries from SOURCE_CONFIGS entirely** — cleaner but harder to re-enable if state-specific queries are needed in future.

Recommended to disable (not remove): sgst-delhi, sgst-haryana, sgst-himachal, sgst-madhya, sgst-punjab, sgst-jk, cgst-amend-2018, cgst-amend-2023, igst-amend-2018, cgst-jk-2017, utgst-amend-2018, fa-2019, fa-2020, fa-2021, fa-2022, fa-2023.

This reduces active sources from 23 to 8 (comparison + 2 IT Acts + CGST + IGST + reference + UTGST + cgst-jk-2017), and active chunks from 9,527 to ~4,374 — much closer to the original 6-source 6,428 chunk count.

### Step 3: Reference Boost Fine-Tuning

After disabling secondary sources, re-run CII query. If still failing:
- Raise reference boost from 1.3x to 1.5x
- If still failing, consider length normalization for reference chunks only, or add a section-header bonus (+20) when the section label exactly matches a query token

### Step 4: Comparison Guide Boost Check

The 1.5x comparison boost was set in Phase 7. With SGST sources disabled, re-verify that:
- GST queries return CGST/IGST chunks (not just comparison) 
- IT Act queries return act-1961/act-2025 chunks (not just comparison)
- Cross-domain queries return both domains

If comparison still dominates all queries, reduce from 1.5x to 1.2x.

---

## Sources

### Primary (HIGH confidence)

- `server/rag/index.ts` — Live code inspection: SOURCE_CONFIGS (23 entries), scoreChunk(), retrieve(), DEFAULT_TOP_K=5, boost application logic
- `server/rag/validate-reference.ts` — Live execution: 11/13 pass, 2 fail on CII chunk identification
- `server/rag/probe-phase10.ts` (executed and deleted) — Live RAG execution output showing actual retrieval results for 7 diagnostic queries

### Secondary (MEDIUM confidence)

- `09-01-SUMMARY.md` — Phase 9 decisions: boost=1.3 added, CII format fix, validate-reference.ts was 13/13 at Phase 9 completion
- `08-02-SUMMARY.md` — Phase 8 decisions: GST queries returning Comparison Guide as top result due to 1.5x boost; scoring review deferred to Phase 10
- `07-02-SUMMARY.md` — Phase 7 decisions: DEFAULT_TOP_K=5, dynamic bucket balancing, SOURCE_CONFIGS-driven architecture

### Tertiary (LOW confidence)

- Token budget estimates: chars/4 approximation for Gemini token counts — accurate within ±20% for English text; not verified against actual Gemini tokenizer

---

## Metadata

**Confidence breakdown:**
- Current state diagnosis: HIGH — from live code and live execution
- Scoring fix approach (disable SGST): HIGH — root cause is clearly the bucket guarantee with 23 sources
- CII fix approach (raise boost): MEDIUM — depends on raw score differential not yet measured precisely
- Length normalization need: LOW — may not be needed once SGST sources are suppressed and source count drops to 8

**Research date:** 2026-04-09
**Valid until:** 2026-04-16 (7 days — code may change during Phase 10 implementation)
