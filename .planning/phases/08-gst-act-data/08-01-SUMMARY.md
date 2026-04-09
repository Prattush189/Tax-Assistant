---
phase: 08-gst-act-data
plan: 01
subsystem: data
tags: [rag, gst, cgst, igst, pdf-extraction, text-processing]

requires:
  - phase: 07-rag-infrastructure-fixes
    provides: "Chapter/schedule-aware Act splitter and dynamic SOURCE_CONFIGS registry"
provides:
  - "CGST Act 2017 full text data file (server/data/cgst-act.txt) with 21 chapters, 174+ sections, 5 schedules"
  - "IGST Act 2017 full text data file (server/data/igst-act.txt) with 9 chapters, 25 sections"
  - "Two new SOURCE_CONFIGS entries (cgst-2017, igst-2017) with splitter='act'"
affects: [08-02, 09-reference-data, 10-scoring-integration-validation]

tech-stack:
  added: []
  patterns: ["PDF extraction via PyMuPDF -> text cleaning -> structured format matching existing Act files"]

key-files:
  created:
    - "server/data/cgst-act.txt"
    - "server/data/igst-act.txt"
  modified:
    - "server/rag/index.ts"

key-decisions:
  - "CGST and IGST Act text extracted from official CBIC gazette PDFs using PyMuPDF, then cleaned to remove Hindi text, gazette headers/footers, and marginal notes"
  - "Schedule IV and V added as placeholders noting omission by Finance Act 2023 to prevent splitter boundary gaps"
  - "No boost value for either GST source — scoring adjustments deferred to Phase 10"
  - "Base Act text (2017 gazette) used as primary source — amendments from 2018/2023/Finance Acts available but consolidated text would require manual section-by-section merging"

patterns-established:
  - "PDF-to-RAG pipeline: extract with PyMuPDF, clean gazette artifacts, validate section/chapter/schedule counts, register in SOURCE_CONFIGS"

requirements-completed: [GST-01, GST-02, GST-03]

duration: 25min
completed: 2026-04-09
---

# Phase 08 Plan 01: CGST & IGST Act Data Files + Source Registration

**CGST Act 2017 (191 section matches, 21 chapters, 5 schedules) and IGST Act 2017 (25 sections, 9 chapters) extracted from official gazette PDFs and registered as RAG sources**

## Performance

- **Duration:** 25 min
- **Tasks:** 2
- **Files created:** 2 (cgst-act.txt, igst-act.txt)
- **Files modified:** 1 (server/rag/index.ts)

## Accomplishments
- Extracted CGST Act 2017 from 103-page official gazette PDF into clean structured text (347K chars)
- Extracted IGST Act 2017 from 17-page official gazette PDF into clean structured text
- Both files follow the same Chapter/Section/Schedule format as act-2025.txt and act-1961.txt
- Registered both as RAG sources in SOURCE_CONFIGS with splitter='act' — zero code changes needed beyond array entries
- All format validation gates passed: CGST ≥150 sections (191), 21 chapters, 5 schedules; IGST ≥20 sections (25), ≥4 chapters (9)

## Files Created/Modified
- `server/data/cgst-act.txt` — Full text of Central GST Act 2017 (21 chapters, 174 sections + schedule content)
- `server/data/igst-act.txt` — Full text of Integrated GST Act 2017 (9 chapters, 25 sections)
- `server/rag/index.ts` — Added 2 SOURCE_CONFIGS entries (cgst-2017, igst-2017), total now 5

## Decisions Made
- Gazette PDF cleanup required removing Hindi gazette metadata, page headers/footers ("THE GAZETTE OF INDIA EXTRAORDINARY"), marginal notes (section descriptions printed in gazette margin), and digital signatures
- CHAPTER X and XII had double-spaced roman numerals ("CHAPTER  X") in the PDF — normalized to single space to match splitter regex
- SCHEDULE I and III had extra spacing ("SCHEDULE   I") — normalized similarly
- Schedule IV and V placeholders added with "[Omitted by the Finance Act, 2023]" to maintain schedule boundary integrity

## Deviations from Plan

None — plan executed as written. Source PDFs were user-provided official gazette documents rather than web-scraped, which improved text quality.

## Issues Encountered
- PDF extraction included Hindi gazette text (Devanagari script) mixed with English — filtered by non-ASCII character ratio threshold
- Marginal notes (gazette margin annotations like "Definitions.", "Levy and collection.") appeared as separate lines in extracted text — required a known-pattern matching approach to identify and remove

## Next Phase Readiness
- Both data files ready for chunk loading validation (Plan 02)
- SOURCE_CONFIGS registration complete — RAG system will automatically load and chunk both files on next server startup

---
*Phase: 08-gst-act-data*
*Completed: 2026-04-09*
