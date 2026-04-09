---
phase: 09-reference-data
verified: 2026-04-09T00:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
gaps: []
human_verification: []
---

# Phase 9: Reference Data Verification Report

**Phase Goal:** Queries about CII values, tax due dates, and ITR form selection return exact structured answers rather than approximate keyword matches from Act text
**Verified:** 2026-04-09
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Asking "What is the CII for FY 2025-26?" returns exactly 376 | VERIFIED | validate-reference.ts PASS — reference chunk contains "CII FY 2025-26 = 376"; label "Tax Reference Guide" confirmed |
| 2 | Asking "When is the advance tax due date for Q3?" returns 15 December 2025 | VERIFIED | validate-reference.ts PASS — reference chunk (source: 'reference') contains "15 December 2025" |
| 3 | Asking "Which ITR form for salaried with LTCG up to 1.25L?" returns ITR-1 for AY 2026-27 | VERIFIED | validate-reference.ts PASS — reference chunk contains "ITR-1", "112A", and "1.25" |
| 4 | Reference data chunks labeled "Tax Reference Guide" distinct from IT Act / GST Act labels | VERIFIED | SOURCE_CONFIGS: `label: 'Tax Reference Guide'`; validate-reference.ts check 5 and 13 both PASS |
| 5 | Server starts without errors after adding reference-data.txt | VERIFIED | validate-reference.ts startup output: 6 sources loaded, 6428 total chunks, 0 warnings |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Exists | Level 2: Substantive | Level 3: Wired | Status |
|----------|----------|--------|----------------------|----------------|--------|
| `server/data/reference-data.txt` | CII table (25 rows), due dates, ITR form matrix | Yes | 385 lines, 7 sections (22 chunks): CII table with "CII FY 2025-26 = 376", advance tax Q3 "15 December 2025", ITR-1 LTCG 1.25L rule, corporate ITR-6 dates, AY 2025-26 belated filer rules | Read by `buildChunks()` via SOURCE_CONFIGS filePath | VERIFIED |
| `server/rag/index.ts` | SOURCE_CONFIGS 'reference' entry | Yes | Entry present at line 42: `{ id: 'reference', filePath: 'reference-data.txt', label: 'Tax Reference Guide', splitter: 'reference', boost: 1.3 }` | Iterated in `initRAG()` loop; 'reference' case in `buildChunks()` routes to `splitComparisonSections()` | VERIFIED |
| `server/rag/validate-reference.ts` | Validation script with 13 checks | Yes | 186 lines; 13 named checks across CII, Q3 due date, ITR form, and source label queries; exits 0 on all-pass | Run independently; calls `initRAG()` + `retrieveContextWithRefs()` | VERIFIED |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `server/rag/index.ts` SOURCE_CONFIGS | `server/data/reference-data.txt` | `filePath: 'reference-data.txt'` in entry at line 42 | WIRED | `buildChunks(join(dataDir, cfg.filePath), cfg)` resolves to data dir at runtime |
| `buildChunks()` 'reference' case | `splitComparisonSections()` | `config.splitter === 'reference'` branch (lines 322-325) | WIRED | Reference case explicitly added; routes to same `======`-delimiter splitter as comparison |
| `scoreChunk()` | boost from reference source | `sourceConfigMap.get(chunk.source)` → `cfg.boost` (lines 409-413) | WIRED | boost: 1.3 applied when chunk.source === 'reference' and score > 0 |
| `retrieveContextWithRefs()` | caller context | Exported function; called by `validate-reference.ts` and production chat route | WIRED | Used in validation script; production wiring unchanged from prior phases |

**Note on PLAN deviation:** The PLAN specified `splitter: 'comparison'` but implementation uses `splitter: 'reference'`. A dedicated `'reference'` case was added to `buildChunks()` (lines 322-325) that calls the same `splitComparisonSections()` function. The behavior is identical; the SUMMARY documents this as a deliberate semantic improvement. The deviation does not affect correctness — all 13 validation checks pass.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| REF-01 | 09-01-PLAN.md | CII table (FY 2001-02 to 2025-26, base year 2001-02) available as structured data for exact lookup | SATISFIED | reference-data.txt Section 1: 25 CII rows in "CII FY XXXX-XX = YYY" format; FY 2025-26 = 376 confirmed |
| REF-02 | 09-01-PLAN.md | Due dates calendar (advance tax, TDS, ITR, GST returns) available as structured data | SATISFIED | Sections 2-5: advance tax Q1-Q4, TDS return dates, ITR filing deadlines, GSTR-1/3B/9 dates, corporate ITR-6, chronological calendar April 2025 to March 2027 |
| REF-03 | 09-01-PLAN.md | ITR form selection matrix (which form for which assessee type/income) available as structured data | SATISFIED | Section 6: All 7 forms (ITR-1 through ITR-7), AY 2026-27 rules including ITR-1 LTCG 1.25L change and ITR-4 2-house-property change, AY 2025-26 belated filer rules |
| REF-04 | 09-01-PLAN.md | Reference data queries return exact answers (not keyword-matched Act text about the same year/date) | SATISFIED | All 3 success-criteria queries return chunks from source 'reference' (labeled "Tax Reference Guide"), not from IT Act 1961 / IT Act 2025 / CGST Act 2017 chunks |

All 4 requirements satisfied. No orphaned requirements detected — REQUIREMENTS.md traceability table maps REF-01 through REF-04 exclusively to Phase 9, and all 4 appear in the 09-01-PLAN.md `requirements` field.

---

### Anti-Patterns Found

| File | Pattern | Severity | Assessment |
|------|---------|----------|------------|
| None | — | — | No TODO/FIXME/placeholder comments, no empty implementations, no stub handlers found in any phase 9 file |

---

### Human Verification Required

None. All success criteria are programmatically verifiable via `validate-reference.ts`, which passed all 13 checks with exits code 0. No UI behavior, real-time data, or external service dependencies involved.

---

### Validation Script Execution (Live Run)

```
[RAG] Loaded comparison: 98 chunks
[RAG] Loaded act-2025: 2179 chunks
[RAG] Loaded act-1961: 3636 chunks
[RAG] Loaded cgst-2017: 428 chunks
[RAG] Loaded igst-2017: 65 chunks
[RAG] Loaded reference: 22 chunks
[RAG] Total chunks: 6428, index keys: 27916

[PASS] CII query returns result
[PASS] CII query returns reference source chunk
[PASS] CII reference chunk contains value 376
[PASS] CII chunk section label contains CII or COST INFLATION INDEX
[PASS] CII chunk label is "Tax Reference Guide"
[PASS] Q3 advance tax query returns a result with "15 December"
[PASS] Q3 advance tax answer comes from reference source
[PASS] ITR form query returns reference source chunk
[PASS] ITR form chunk mentions ITR-1
[PASS] ITR form chunk mentions Section 112A
[PASS] ITR form chunk mentions 1.25 lakh threshold
[PASS] Source label "Tax Reference Guide" appears in retrieval output
[PASS] Reference chunks display label "Tax Reference Guide" (not raw id)

Total: 13 | Passed: 13 | Failed: 0
All checks PASSED.
```

---

### Additional Verification Checks (Beyond Must-Haves)

These items were specified in the PLAN's `<verification>` block and `<success_criteria>`:

| Check | Result |
|-------|--------|
| FY 2026-27 CII value absent (only "NOT YET NOTIFIED" note) | CONFIRMED — line 66 has note text only, no numeric value |
| Budget 2024 indexation optionality note present | CONFIRMED — lines 31-35 cover both 20%+indexation and 12.5% flat options |
| Corporate compliance section with ITR-6 and tax audit report deadlines | CONFIRMED — Section 4 covers ITR-6 (Oct/Nov 2026), advance tax schedule, Form 3CA/3CB+3CD by 30 Sep 2026 |
| ITR form matrix covers both AY 2026-27 and AY 2025-26 (belated filers) | CONFIRMED — Section 6 has explicit AY 2025-26 block noting ITR-1 did not allow LTCG, ITR-4 limited to 1 house property |
| 6+ sources loaded at startup | CONFIRMED — 6 sources: comparison (98), act-2025 (2179), act-1961 (3636), cgst-2017 (428), igst-2017 (65), reference (22) = 6428 total |
| No regression on existing sources | CONFIRMED — all 5 prior sources load at prior chunk counts |

---

### Gaps Summary

No gaps. The phase goal is fully achieved: all three reference data domains (CII lookup, due dates, ITR form selection) are indexed as a dedicated RAG source, and retrieval queries return exact structured answers from the "Tax Reference Guide" source rather than approximate keyword matches from Act text.

---

_Verified: 2026-04-09_
_Verifier: Claude (gsd-verifier)_
