# Phase 9: Reference Data - Research

**Researched:** 2026-04-09
**Domain:** RAG data authoring — structured lookup files consumed by the existing comparison splitter
**Confidence:** HIGH

## Summary

Phase 9 adds exactly one new file (`reference-data.txt`) to `server/data/` and one new entry to `SOURCE_CONFIGS` in `server/rag/index.ts`. No new splitter code is needed for the data file itself — the existing `splitComparisonSections` function (which splits on `======` delimiters) handles the format. However, the `buildChunks` switch in `index.ts` currently throws for `splitter: 'reference'` (line 314: "Splitter 'reference' is not implemented yet"), so a one-line case must be added that routes `'reference'` to `splitComparisonSections`.

The heavy lifting of this phase is content accuracy. The CII table (25 rows), advance tax due dates, GST return due dates, TDS return due dates, ITR form selection matrix (7 forms, all assessee types), and regime-sensitive notes must be exact and complete. The primary quality gate is: "What is the CII for FY 2025-26?" → exactly 376 (CBDT Notification No. 70/2025, dated 01-07-2025).

**Primary recommendation:** Author `reference-data.txt` with `======`-delimited sections matching the comparison.txt pattern, add the `'reference'` splitter case in `buildChunks`, register one SOURCE_CONFIGS entry with `id: 'reference'`, and verify CII/ITR/due-date retrieval with representative test queries before marking complete.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**CII Table Scope**
- Full range: FY 2001-02 (base year, index=100) through FY 2025-26 (index=376)
- FY 2026-27 omitted until officially notified by CBDT — no estimates
- Include brief context: base year explanation, indexation formula (indexed cost = cost x CII of sale year / CII of purchase year), when indexation applies
- Include note about Budget 2024 change: indexation for property is now optional (old regime with indexation vs new 12.5% flat rate) to prevent user confusion on recent property sales

**Due Dates Coverage**
- Cover all three categories: Income Tax, GST returns, and corporate compliance deadlines
- Organize both ways: by category (grouped by type) AND chronological (month-by-month calendar)
- Include both generic recurring rules AND current Tax Year 2025-26 specific dates
- Note the AY (Assessment Year) to Tax Year transition in Indian income tax law
- Show statutory dates only — extensions/changes are out of scope (admin UI management is a deferred idea)

**ITR Form Matrix**
- Cover all assessee types: individuals, HUFs, firms, LLPs, companies, trusts, AOPs
- Include both old and new tax regime form eligibility rules
- Include specific income thresholds that trigger form changes (e.g., ITR-1 if total income <= 50L, only salary/one house property/other sources, no LTCG, agriculture income <= 5000)
- Cover both current Tax Year 2025-26 and previous AY 2025-26 (for late/belated filers)

**Data Format & Splitter**
- All three datasets in one file (reference-data.txt) with ====== section delimiters
- Use existing 'comparison' splitter — no new splitter code needed
- One SOURCE_CONFIGS entry with splitter='comparison'

### Claude's Discretion
- Boost factor for reference data (whether to add a boost like comparison's 1.5x, or defer to Phase 10)
- Source label text (e.g., "Reference Guide" vs "Tax Reference Data")
- Exact formatting of tables and matrices within the text file
- How to handle corporate compliance dates that vary by company type

### Deferred Ideas (OUT OF SCOPE)
- Admin UI for managing extended/changed deadlines — new capability, own phase
- PDF page rendering with highlighted sections in SectionModal (instead of raw text) — significant frontend feature, requires PDF.js + chunk-to-page mapping
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REF-01 | CII table (FY 2001-02 to 2025-26, base year 2001-02) available as structured data for exact lookup | Full 25-row table verified from CBDT Notification No. 70/2025; all values confirmed |
| REF-02 | Due dates calendar (advance tax, TDS, ITR, GST returns) available as structured data | Advance tax Q1-Q4 dates, TDS 24Q/26Q quarterly deadlines, GSTR-1/3B monthly/quarterly patterns, ITR non-audit/audit/TP deadlines all confirmed |
| REF-03 | ITR form selection matrix (which form for which assessee type/income) available as structured data | All 7 forms (ITR-1 through ITR-7) with eligibility rules for AY 2026-27 confirmed from official IT dept page and cleartax |
| REF-04 | Reference data queries return exact answers (not keyword-matched Act text about the same year/date) | Achieved by registering reference-data.txt with its own SOURCE_CONFIGS id; keyword scoring on structured text will prefer exact matches over Act prose |
</phase_requirements>

---

## Standard Stack

### Core
| Component | Detail | Purpose | Why Standard |
|-----------|--------|---------|--------------|
| `server/data/reference-data.txt` | New plain-text file | Structured lookup data for CII, due dates, ITR forms | Matches existing data file convention; no binary dependencies |
| `splitComparisonSections()` | Existing function in `server/rag/index.ts` | Splits on `^={3,}$` line boundaries | Already used by comparison.txt; zero new code for splitting |
| `SOURCE_CONFIGS` entry | `{ id: 'reference', filePath: 'reference-data.txt', label: '...', splitter: 'comparison' }` | Registers file with RAG system | One-line addition; follows Phase 7 extensibility pattern |

### What Must Change in index.ts

The `SourceConfig` interface already declares `splitter: 'act' | 'comparison' | 'reference'` (line 15). The `buildChunks` function at line 309-315 throws for `'reference'`. A single case must be added:

```typescript
// In buildChunks(), add before the else clause:
} else if (config.splitter === 'reference') {
  rawSections = splitComparisonSections(text);
}
```

This is the only code change to `index.ts`. Everything else (inverted index, scoring, retrieval, boost field) works automatically for the new source.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single reference-data.txt | Three separate files (cii.txt, duedates.txt, itr.txt) | Multiple files need multiple SOURCE_CONFIGS entries; single file is simpler and the planner confirmed one entry |
| comparison splitter reuse | New 'reference' splitter function | No benefit to new function — ====== delimiters are identical in behavior |
| No boost | Boost ~1.2–1.3x | Helps reference chunks surface above Act prose for lookup queries; defer to Phase 10 per user constraint |

**Installation:** No new npm packages required.

---

## Architecture Patterns

### File Location
```
server/
└── data/
    ├── act-1961.txt          # existing
    ├── act-2025.txt          # existing
    ├── comparison.txt        # existing
    ├── cgst-act.txt          # Phase 8
    ├── igst-act.txt          # Phase 8
    └── reference-data.txt    # NEW — Phase 9
```

### reference-data.txt Structure Pattern

The file must use the exact same delimiter format as comparison.txt — a line of 3+ `=` characters alone on a line:

```
TAX REFERENCE GUIDE — INDIA FY 2025-26
=======================================
[preamble or intro text]

======================================================================
1. COST INFLATION INDEX (CII) TABLE
======================================================================
[CII table content]

======================================================================
2. DUE DATES — INCOME TAX
======================================================================
[IT due dates]

======================================================================
3. DUE DATES — GST RETURNS
======================================================================
[GST due dates]

======================================================================
4. DUE DATES — TDS RETURNS
======================================================================
[TDS due dates]

======================================================================
5. DUE DATES — CHRONOLOGICAL CALENDAR (FY 2025-26)
======================================================================
[Month-by-month calendar]

======================================================================
6. ITR FORM SELECTION MATRIX
======================================================================
[ITR form eligibility table]
```

Each `======` block becomes one chunk. Section title is extracted from the first line after the delimiter (regex: `/^\d+\.\s*(.+)/` — same as comparison splitter).

### How splitComparisonSections Works (verified from source)

```typescript
// From server/rag/index.ts line 279-296
function splitComparisonSections(text: string): { section: string; text: string }[] {
  const parts = text.split(/^={3,}$/gm);
  // Each part: trim, skip if < 50 chars
  // First line of part matched against /^\d+\.\s*(.+)/ for section label
  // If no match: first 60 chars of first line become label
}
```

Implications for content authoring:
- Each section's first line after the `======` delimiter MUST follow the pattern `N. SECTION TITLE` (number dot space title) for the section label to appear correctly in retrieval output
- Content before the first `======` delimiter is treated as a standalone chunk (the intro/preamble)
- Sections shorter than 50 characters are silently skipped — all substantive sections will far exceed this

### SOURCE_CONFIGS Registration Pattern

```typescript
// Existing entries show the pattern (from index.ts lines 28-34):
const SOURCE_CONFIGS: SourceConfig[] = [
  { id: 'comparison', filePath: 'comparison.txt', label: 'Comparison Guide', splitter: 'comparison', boost: 1.5 },
  { id: 'act-2025',   filePath: 'act-2025.txt',   label: 'IT Act 2025',      splitter: 'act' },
  { id: 'act-1961',   filePath: 'act-1961.txt',   label: 'IT Act 1961',      splitter: 'act' },
  { id: 'cgst-2017',  filePath: 'cgst-act.txt',   label: 'CGST Act 2017',    splitter: 'act' },
  { id: 'igst-2017',  filePath: 'igst-act.txt',   label: 'IGST Act 2017',    splitter: 'act' },
  // ADD:
  { id: 'reference',  filePath: 'reference-data.txt', label: 'Tax Reference Guide', splitter: 'reference' },
];
```

The `label` field is what appears in chat as the source chip (e.g., "[Tax Reference Guide — CII TABLE]"). The CONTEXT.md notes this matters for chip display — choose a label that reads naturally as a chip label and distinguishes from IT Act/GST Act chips.

### Anti-Patterns to Avoid
- **Using `splitter: 'comparison'` directly instead of `splitter: 'reference'`:** The interface already declares the `'reference'` union member. Using `'comparison'` for the new entry would work at runtime but is semantically wrong and confuses future readers.
- **Including FY 2026-27 CII:** Not yet notified — locked out of scope per user decision.
- **Putting extension deadlines in the file:** Statutory dates only; extensions change frequently and are deferred to admin UI.
- **Making section titles that don't start with `N. `:** The splitter's label extraction regex requires the `N. TITLE` pattern — sections labeled differently will fall back to first-60-chars label.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Splitting reference-data.txt into chunks | Custom reference splitter function | `splitComparisonSections()` (already exists) | Identical delimiter pattern; adding a new function creates dead code |
| Registering the new source | Modifying retrieve() or buildIndex() | Add one SOURCE_CONFIGS entry | Phase 7 made retrieval source-agnostic; it already reads from SOURCE_CONFIGS dynamically |
| Source label display | Custom chip rendering | Existing `cfg.label` field in SourceConfig | SectionModal and source chips already use `cfg.label` via `retrieveContextWithRefs` |

**Key insight:** Phase 7 was specifically built to make Phase 9 a data-only task. The only code change needed is the single `'reference'` case in `buildChunks`.

---

## Common Pitfalls

### Pitfall 1: CII Value for FY 2025-26
**What goes wrong:** Using 363 (the FY 2024-25 value) or an unnotified estimate for FY 2026-27
**Why it happens:** Confusing consecutive FY values; CII for 2026-27 has not been notified as of April 2026
**How to avoid:** Use exactly 376 for FY 2025-26 (CBDT Notification No. 70/2025, dated 01-07-2025). State clearly that FY 2026-27 is "not yet notified."
**Warning signs:** If a test query "CII for FY 2024-25" returns 376, the table is off by one year

### Pitfall 2: AY vs Tax Year Terminology Confusion
**What goes wrong:** Mixing "AY 2026-27" and "Tax Year 2025-26" inconsistently
**Why it happens:** IT Act 2025 eliminates the AY concept (only "Tax Year" used), but the 1961 Act still uses AY; ITR forms for FY 2025-26 are filed under AY 2026-27
**How to avoid:** In reference-data.txt, use both terms with explicit mapping: "FY 2025-26 = Tax Year 2025-26 = AY 2026-27 (last AY used under 1961 Act)" — this is already stated in comparison.txt and should be echoed
**Warning signs:** The ITR due date section says "AY 2025-26" instead of "AY 2026-27" for FY 2025-26 returns

### Pitfall 3: ITR-1 LTCG Eligibility Change (AY 2026-27)
**What goes wrong:** Stating that any LTCG disqualifies ITR-1 filing
**Why it happens:** This was true before AY 2026-27; the rule changed for AY 2026-27
**How to avoid:** For AY 2026-27 specifically, ITR-1 can be used when LTCG under Section 112A is up to ₹1.25 lakh AND there are no carried-forward losses. State both conditions explicitly.
**Warning signs:** Success criterion 3 fails — the query about salaried + LTCG ≤ 1.25L returns "use ITR-2" instead of "use ITR-1"

### Pitfall 4: Budget 2024 Indexation Change Omission
**What goes wrong:** CII section says indexation applies to all LTCG on immovable property without noting the optional flat rate
**Why it happens:** The Budget 2024 change (effective 23-07-2024) made indexation optional for property acquired before 23-07-2024 — recent change, easy to miss
**How to avoid:** Add explicit note in the CII section: "For immovable property acquired before 23 July 2024 and sold after that date: taxpayer may choose either (a) 20% LTCG with indexation or (b) 12.5% LTCG without indexation — whichever results in lower tax."
**Warning signs:** Users asking about property sold in FY 2025-26 get only the indexed-cost answer

### Pitfall 5: Splitter Routing Not Wired
**What goes wrong:** Server throws at startup: "Splitter 'reference' is not implemented yet"
**Why it happens:** `buildChunks()` has `throw new Error(...)` in the else branch; the `'reference'` union member exists in the type but no case handles it
**How to avoid:** Add the `else if (config.splitter === 'reference')` case before the final `else` in `buildChunks()` — this is a prerequisite for the file to load at all
**Warning signs:** `[RAG] reference-data.txt not found, skipping` or server crash at startup

### Pitfall 6: GST Return Due Dates — Monthly vs Quarterly Distinction
**What goes wrong:** Stating a single GSTR-3B due date without distinguishing monthly vs QRMP filers
**Why it happens:** Due dates differ: monthly filers (turnover > ₹5 Cr) → 20th of following month; QRMP filers (≤ ₹5 Cr) → 22nd/24th of month following quarter (state-dependent)
**How to avoid:** Note both categories explicitly in the GST section; state that the 22nd/24th split is state-dependent and give both dates

---

## Code Examples

### Adding the 'reference' Case in buildChunks

```typescript
// server/rag/index.ts — buildChunks() function, around line 309
function buildChunks(filePath: string, config: SourceConfig): Chunk[] {
  const text = readFileSync(filePath, 'utf-8');

  let rawSections: { section: string; text: string }[];
  if (config.splitter === 'comparison') {
    rawSections = splitComparisonSections(text);
  } else if (config.splitter === 'act') {
    rawSections = splitActWithChaptersAndSchedules(text);
  } else if (config.splitter === 'reference') {
    // Reference data uses same ====== delimiter format as comparison
    rawSections = splitComparisonSections(text);
  } else {
    throw new Error(`Splitter '${config.splitter}' is not implemented yet`);
  }
  // ... rest unchanged
}
```

### SOURCE_CONFIGS Addition

```typescript
// server/rag/index.ts — SOURCE_CONFIGS array, after igst-2017 entry
{ id: 'reference', filePath: 'reference-data.txt', label: 'Tax Reference Guide', splitter: 'reference' },
```

### reference-data.txt Section Format (verified pattern from comparison.txt)

```
======================================================================
1. COST INFLATION INDEX (CII) TABLE
======================================================================
Base Year: FY 2001-02 = 100
CBDT Notification No. 70/2025 dated 01 July 2025

Formula: Indexed Cost = Original Cost × (CII of Sale Year / CII of Purchase Year)
Applies to: Long-term capital assets held > 24 months (36 months for immovable property)

BUDGET 2024 NOTE (Effective 23 July 2024):
For immovable property acquired BEFORE 23 July 2024 and sold AFTER that date:
- Option A: Pay 20% LTCG tax WITH indexation benefit
- Option B: Pay 12.5% LTCG tax WITHOUT indexation benefit
Choose whichever option gives lower tax. Both are valid.

CII Table (FY 2001-02 to FY 2025-26):
FY 2001-02 | 100    FY 2002-03 | 105    FY 2003-04 | 109
FY 2004-05 | 113    FY 2005-06 | 117    FY 2006-07 | 122
FY 2007-08 | 129    FY 2008-09 | 137    FY 2009-10 | 148
FY 2010-11 | 167    FY 2011-12 | 184    FY 2012-13 | 200
FY 2013-14 | 220    FY 2014-15 | 240    FY 2015-16 | 254
FY 2016-17 | 264    FY 2017-18 | 272    FY 2018-19 | 280
FY 2019-20 | 289    FY 2020-21 | 301    FY 2021-22 | 317
FY 2022-23 | 331    FY 2023-24 | 348    FY 2024-25 | 363
FY 2025-26 | 376

FY 2026-27: NOT YET NOTIFIED by CBDT (as of April 2026)
```

### Verifying Chunk Count at Startup

```
[RAG] Loaded reference: N chunks
```

With ~6 sections (CII, IT due dates, GST due dates, TDS due dates, calendar, ITR matrix), expect 6–12 chunks depending on subchunking. Each section will likely fit within MAX_CHUNK_SIZE=1200 chars, so no subchunking expected.

---

## Verified Reference Data

### Complete CII Table (CBDT Notification No. 70/2025, 01-07-2025)
Source: CBDT official; confirmed by RSM India, TaxGuru, ClearTax, taxadda.com

| FY | CII | FY | CII | FY | CII |
|----|-----|----|-----|----|-----|
| 2001-02 | 100 | 2009-10 | 148 | 2017-18 | 272 |
| 2002-03 | 105 | 2010-11 | 167 | 2018-19 | 280 |
| 2003-04 | 109 | 2011-12 | 184 | 2019-20 | 289 |
| 2004-05 | 113 | 2012-13 | 200 | 2020-21 | 301 |
| 2005-06 | 117 | 2013-14 | 220 | 2021-22 | 317 |
| 2006-07 | 122 | 2014-15 | 240 | 2022-23 | 331 |
| 2007-08 | 129 | 2015-16 | 254 | 2023-24 | 348 |
| 2008-09 | 137 | 2016-17 | 264 | 2024-25 | 363 |
| | | | | 2025-26 | 376 |

### ITR Form Matrix (AY 2026-27, FY 2025-26)
Source: Income Tax Department official page + ClearTax (verified)

| Form | Who Files | Key Eligibility Conditions |
|------|-----------|---------------------------|
| ITR-1 (Sahaj) | Resident individual | Total income ≤ ₹50L; salary/pension + max 1 house property + other sources; LTCG u/s 112A ≤ ₹1.25L (NEW for AY 2026-27) with no c/f losses; agriculture income ≤ ₹5,000 |
| ITR-2 | Individual/HUF | Capital gains (LTCG > ₹1.25L or STCG), >1 house property, income > ₹50L, NRI, foreign assets; no business/professional income |
| ITR-3 | Individual/HUF | Business or professional income (proprietor, partner receiving salary/interest from firm) |
| ITR-4 (Sugam) | Individual/HUF/Firm (not LLP) | Presumptive income u/s 44AD/44ADA/44AE; total income ≤ ₹50L; up to 2 house properties (NEW for AY 2026-27) |
| ITR-5 | Partnership firm, LLP, AOP, BOI | Non-individual, non-company, non-trust entities |
| ITR-6 | Companies | Companies other than those claiming exemption u/s 11 (charitable trust) |
| ITR-7 | Charitable/religious trusts, political parties, research institutions, universities, hospitals | Filing u/s 139(4A)/(4B)/(4C)/(4D) |

### Due Dates (FY 2025-26 / AY 2026-27)
Sources: ClearTax, Income Tax Department, verified across multiple

**Advance Tax (Section 207-211):**
| Quarter | Period | Cumulative % | Due Date |
|---------|--------|--------------|----------|
| Q1 | Apr–Jun 2025 | 15% | 15 June 2025 |
| Q2 | Jul–Sep 2025 | 45% | 15 September 2025 |
| Q3 | Oct–Dec 2025 | 75% | 15 December 2025 |
| Q4 | Jan–Mar 2026 | 100% | 15 March 2026 |
Note: Senior citizens (60+) with no business income are exempt from advance tax.

**ITR Filing Deadlines:**
| Category | Due Date |
|----------|----------|
| Non-audit individuals/HUF (ITR-1, ITR-2) | 31 July 2026 |
| Non-audit business (ITR-3, ITR-4) | 31 August 2026 |
| Audit cases | 31 October 2026 |
| Transfer pricing cases | 30 November 2026 |
| Belated return | 31 December 2026 (with late fee up to ₹5,000) |
| Revised return | 31 March 2027 |

**TDS Returns (Forms 24Q/26Q):**
| Quarter | Period | Due Date |
|---------|--------|----------|
| Q1 | Apr–Jun 2025 | 31 July 2025 |
| Q2 | Jul–Sep 2025 | 31 October 2025 |
| Q3 | Oct–Dec 2025 | 31 January 2026 |
| Q4 | Jan–Mar 2026 | 31 May 2026 |

**GST Returns:**
| Form | Frequency | Monthly Filers (>₹5 Cr turnover) | Quarterly/QRMP Filers (≤₹5 Cr) |
|------|-----------|----------------------------------|----------------------------------|
| GSTR-1 | Monthly/Quarterly | 11th of following month | 13th of month after quarter |
| GSTR-3B | Monthly/Quarterly | 20th of following month | 22nd/24th of month after quarter (state-dependent) |
| GSTR-9 (Annual) | Annual | 31 December 2026 | 31 December 2026 |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ITR-1 requires zero LTCG | ITR-1 allows LTCG u/s 112A ≤ ₹1.25L | AY 2026-27 | Large group of salaried+equity investors now use ITR-1 instead of ITR-2 |
| LTCG on property: 20% with indexation (mandatory) | Choice: 20% with indexation OR 12.5% without | Effective 23-07-2024 (Budget 2024) | CII section must explain both options to prevent wrong advice |
| Assessment Year (AY) as primary filing reference | Tax Year (FY) is the primary term under IT Act 2025 | IT Act 2025 effective 01-04-2026 | Reference data must map both: "FY 2025-26 = Tax Year 2025-26 = AY 2026-27" |
| ITR-4: max 1 house property | ITR-4: up to 2 house properties | AY 2026-27 | Eligibility matrix must reflect new threshold |

**Deprecated/outdated:**
- AY (Assessment Year) as a standalone concept: IT Act 2025 removes it; use "Tax Year 2025-26" with AY mapping note for backward compatibility

---

## Open Questions

1. **Boost factor for 'reference' SOURCE_CONFIGS entry**
   - What we know: comparison.txt uses `boost: 1.5`; reference data has distinct vocabulary (exact numbers like "376", "15 June") that keyword scoring should match directly without boosting
   - What's unclear: Whether exact-number matches in reference chunks score high enough vs. Act prose on the same query
   - Recommendation: Ship with no boost initially; test with the success-criteria queries; if "CII 2025-26" still surfaces an Act chunk above the reference chunk, add `boost: 1.2`; defer final tuning to Phase 10 (SCOR-02/SCOR-03)

2. **GST QRMP due date state variation (22nd vs 24th)**
   - What we know: QRMP filers' GSTR-3B due date is 22nd for some states, 24th for others
   - What's unclear: Whether the reference data should list both or just say "22nd-24th (state-dependent)"
   - Recommendation: State "22nd or 24th depending on state" — exact state-by-state breakdown would bloat the chunk without clear retrieval benefit

3. **Corporate compliance dates**
   - What we know: CONTEXT.md says cover corporate compliance; varies by company type
   - What's unclear: How detailed to go (ROC filings, AGM deadlines, director KYC)
   - Recommendation: Keep corporate section to income tax and GST compliance only (ITR-6 due dates, advance tax); ROC/MCA filing deadlines are out of the tax assistant's primary scope

---

## Sources

### Primary (HIGH confidence)
- CBDT Notification No. 70/2025 (01-07-2025) — CII value 376 for FY 2025-26; confirmed by RSM India, TaxGuru, ClearTax, A2Z Taxcorp
- `server/rag/index.ts` (read directly) — splitter behavior, SOURCE_CONFIGS pattern, buildChunks switch, existing 'reference' union type
- `server/data/comparison.txt` (read directly) — exact ====== delimiter format, section title pattern
- Income Tax Department official (incometax.gov.in) — ITR form eligibility for AY 2026-27

### Secondary (MEDIUM confidence)
- ClearTax (cleartax.in/s/which-itr-to-file) — ITR-1 through ITR-7 eligibility summary, ITR due dates
- ClearTax (cleartax.in/s/changes-in-new-itr-forms) — ITR-1 LTCG ≤ ₹1.25L change for AY 2026-27
- ClearTax (cleartax.in/s/gst-calendar) — GSTR-1/3B monthly and quarterly due dates
- TaxAdda (taxadda.com/cost-inflation-index-cii) — complete CII table all 25 years (cross-verified with CBDT notification)
- PIB Press Release (pib.gov.in) — CBDT FAQs on Budget 2024 capital gains tax regime (indexation optional for property)

### Tertiary (LOW confidence)
- None — all key facts verified against primary or secondary sources

---

## Metadata

**Confidence breakdown:**
- CII table values: HIGH — verified against CBDT notification via multiple tax portals
- ITR form eligibility: HIGH — cross-verified Income Tax Department page + ClearTax
- Due dates: HIGH — cross-verified ClearTax + BankBazaar + TaxGuru for advance tax and ITR dates
- GST due dates: MEDIUM — QRMP state variation acknowledged; general pattern confirmed
- Code pattern (splitter routing): HIGH — read directly from source file

**Research date:** 2026-04-09
**Valid until:** 2026-07-01 (FY 2026-27 CII may be notified around June 2026, which would require adding one row; ITR form changes for AY 2027-28 would require a matrix update)
