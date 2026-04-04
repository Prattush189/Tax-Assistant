---
phase: 03-tax-calculator
verified: 2026-04-04T12:00:00Z
status: human_needed
score: 5/5 must-haves verified
re_verification: false
human_verification:
  - test: "Enter ₹15L gross salary, FY 2025-26, below60, new regime. Expected total tax = ₹97,500 (taxableIncome ₹14.25L, slabTax ₹93,750, cess ₹3,750). Confirm displayed value matches."
    expected: "Total Tax shows ₹97,500 and New Regime recommendation banner appears."
    why_human: "Cannot run a browser; numerical output of useMemo → DOM rendering cannot be verified statically."
  - test: "Enter ₹13L gross salary, FY 2025-26, below60. Expected marginal relief case: totalTax = ₹26,000 (slabTax ₹63,750 − marginalRelief ₹38,750 = ₹25,000 + cess ₹1,000). Confirm marginal relief line item is visible."
    expected: "Marginal relief row shows ₹38,750 in green; Total Tax shows ₹26,000."
    why_human: "Marginal relief rendering requires live DOM inspection."
  - test: "Navigate to Capital Gains tab. Enter equity sale ₹10L, purchase ₹5L, holding 18 months (FY 2025-26). Expected: LTCG, exemption ₹1.25L, taxable gain ₹3.75L, tax ₹46,875."
    expected: "LTCG badge shown in green; Annual exemption row shows ₹1,25,000; Estimated tax shows ₹46,875."
    why_human: "Engine output → card rendering must be visually confirmed."
  - test: "In Capital Gains tab, switch to Real Estate, check 'Acquired before 23 July 2024', enter purchase ₹20L, sale ₹50L, indexed cost ₹30L, holding 36 months. Expect both indexation cards with 'Lower Tax' badge on the cheaper option."
    expected: "With Indexation: taxableGain ₹20L, tax ₹4L (20%). Without Indexation: taxableGain ₹30L, tax ₹3.75L (12.5%). 'Lower Tax' badge on Without Indexation card."
    why_human: "Both-branch rendering and recommendedOption badge need visual confirmation."
  - test: "Navigate to GST tab. Enter ₹10,000, 18%, intra-state, amount excludes GST. Expected: CGST ₹900, SGST ₹900, Total ₹11,800."
    expected: "CGST and SGST rows each show ₹900; Total amount shows ₹11,800."
    why_human: "CGST/SGST split rendering and totals must be confirmed visually."
  - test: "In GST tab, confirm that 12% and 28% rate buttons are absent from the UI."
    expected: "Only buttons for 0%, 5%, 18%, 40% (standard) and 3%, 0.25% (special) are visible."
    why_human: "UI absence cannot be fully confirmed by static code alone; requires browser render."
---

# Phase 3: Tax Calculator Verification Report

**Phase Goal:** Users can calculate and compare their tax liability across regimes, capital gains scenarios, and GST transactions
**Verified:** 2026-04-04
**Status:** human_needed (all automated checks PASSED — 6 items require browser confirmation)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can enter income and deductions and see old vs new regime tax side-by-side for FY 2025-26 and FY 2024-25 | VERIFIED | `IncomeTaxTab.tsx` calls `calculateIncomeTax` twice in `useMemo` (old + new), passes both results to `RegimeComparison`; FY selector present; `getTaxRules(fy)` fetches correct versioned data |
| 2 | Section 87A rebate and 4% cess are automatically applied; result matches hand-calculation for known test case | VERIFIED | `taxEngine.ts` implements `applyMarginalRelief` (new regime) and simple rebate (old regime); cess = `taxAfterRebate × rules.cess`; reference test cases embedded in file confirm ₹13L case yields totalTax ₹26,000 |
| 3 | User sees a clear recommendation showing exactly how much they save by choosing the better regime | VERIFIED | `RegimeComparison.tsx` computes `savings = Math.abs(newResult.totalTax - oldResult.totalTax)`, renders green banner "{betterRegime} Regime saves you {formatINR(savings)}" with neutral fallback for zero savings |
| 4 | User can calculate LTCG and STCG for equity, mutual funds, and real estate using current FY rates | VERIFIED | `capitalGainsEngine.ts` handles equity (LTCG 12.5% + ₹1.25L exemption, STCG 20%), real estate (LTCG with pre-July-2024 indexation option, STCG at slab), other assets; `CapitalGainsTab.tsx` wires engine via `useMemo` |
| 5 | User can enter amount, GST rate, transaction type and see CGST+SGST or IGST split | VERIFIED | `gstEngine.ts` handles intra/inter-state, inclusive/exclusive; `GstTab.tsx` calls `calculateGST` in `useMemo`; only current rates [0, 5, 18, 40] + [3, 0.25] offered — 12% and 28% absent |

**Score:** 5/5 truths verified

---

### Required Artifacts

#### Plan 03-01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/types/index.ts` | TaxRules interface hierarchy | VERIFIED | Contains Slab, Rebate87A, DeductionLimits, OldRegimeSlabs, NewRegimeConfig, OldRegimeConfig, CapitalGainsAssetRules, CapitalGainsRules, GstRules, TaxRules plus 4 type aliases (AgeCategory, TaxRegime, CapitalGainsAssetType, GstTransactionType) |
| `src/data/taxRules/fy2025-26.ts` | FY 2025-26 TaxRules constant, 7-slab new regime | VERIFIED | Exports `FY_2025_26`; new regime has 7 slabs (4/8/12/16/20/24L breakpoints + Infinity); old regime has 3 age categories; capital gains and GST fields present |
| `src/data/taxRules/fy2024-25.ts` | FY 2024-25 TaxRules constant, 5 taxed bands | VERIFIED | Exports `FY_2024_25`; new regime has 6 slabs (0% at 3L + 5 taxed bands at 7/10/12/15L + Infinity) matching plan's "5-slab (3/7/10/12/15L breakpoints)" description |
| `src/data/taxRules/index.ts` | TAX_RULES_BY_FY map and getTaxRules() | VERIFIED | Exports `TAX_RULES_BY_FY`, `SUPPORTED_FY`, `SupportedFY`, `getTaxRules`; function throws on unknown FY |
| `src/lib/utils.ts` | formatINR, formatINRCompact | VERIFIED | Both exported; formatINRCompact uses ≥1Cr/≥1L thresholds for Indian compact notation |

#### Plan 03-02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/taxEngine.ts` | calculateIncomeTax, computeSlabTax, applyMarginalRelief, calculateHRAExemption | VERIFIED | All 4 functions present and exported; HRA base is basic+DA (not gross salary); marginalRelief = max(0, slabTax − excessAboveThreshold); 87A rebate not applied to capital gains |
| `src/lib/capitalGainsEngine.ts` | calculateCapitalGains with indexation option | VERIFIED | Handles all 3 asset types; pre-July-2024 real estate exposes `indexationOption` with `recommendedOption`; no 87A rebate logic present |
| `src/lib/gstEngine.ts` | calculateGST with rate validation | VERIFIED | Validates against `[0, 0.25, 3, 5, 18, 40]`; throws descriptive error for invalid rates (explicitly tests 12% and 28% in reference comments); CGST/SGST and IGST splits correct |

#### Plan 03-03 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/calculator/CalculatorView.tsx` | Tab shell with 3 sub-tabs | VERIFIED | Replaced placeholder; owns only `activeTab` state; renders IncomeTaxTab/CapitalGainsTab/GstTab conditionally; tab bar uses border-b-2 active styling |
| `src/components/calculator/IncomeTaxTab.tsx` | Income form + useMemo dual-regime calculation | VERIFIED | FY + age selectors; expandable deductions and HRA sections; `useMemo` calls `calculateIncomeTax` twice; passes both results to RegimeComparison |
| `src/components/calculator/RegimeComparison.tsx` | Side-by-side cards + recommendation banner | VERIFIED | Old/new regime cards; slab breakdown table; 87A rebate + marginal relief as conditional green line items; cess shown; Total Tax bolded; recommendation banner with `formatINR(savings)` |
| `src/components/calculator/CapitalGainsTab.tsx` | Capital gains form + result display | VERIFIED | Asset type buttons; pre-July-2024 real estate checkbox; indexation comparison cards with "Lower Tax" badge; 87A note displayed in amber banner |
| `src/components/calculator/GstTab.tsx` | GST form + CGST/SGST/IGST breakdown | VERIFIED | Standard rates [0,5,18,40] + special rates [3, 0.25] as button groups; 12% and 28% absent; CGST+SGST or IGST conditionally rendered; September 2025 reform disclaimer present |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/data/taxRules/fy2025-26.ts` | `src/types/index.ts` | `import type { TaxRules }` | WIRED | Line 3: `import type { TaxRules } from '../../types'`; constant typed as `TaxRules` |
| `src/data/taxRules/index.ts` | `src/data/taxRules/fy2025-26.ts` | re-export and map entry | WIRED | Both `export { FY_2025_26 }` and `'2025-26': FY_2025_26` in TAX_RULES_BY_FY present |
| `src/lib/taxEngine.ts` | `src/data/taxRules/index.ts` | TaxRules parameter | WIRED | `calculateIncomeTax(input: IncomeTaxInput, rules: TaxRules)` — rules passed as parameter; imports `TaxRules` type from types |
| `src/lib/capitalGainsEngine.ts` | `src/types/index.ts` | CapitalGainsAssetType import | WIRED | Line 1: `import type { TaxRules, CapitalGainsAssetType } from '../types'` |
| `src/lib/gstEngine.ts` | `src/types/index.ts` | GstTransactionType import | WIRED | Line 1: `import type { GstTransactionType } from '../types'` |
| `src/components/calculator/IncomeTaxTab.tsx` | `src/lib/taxEngine.ts` | calculateIncomeTax in useMemo | WIRED | Lines 95, 108: two `calculateIncomeTax(...)` calls inside `useMemo`; result stored and consumed |
| `src/components/calculator/CapitalGainsTab.tsx` | `src/lib/capitalGainsEngine.ts` | calculateCapitalGains in useMemo | WIRED | Line 66: `calculateCapitalGains(...)` call inside `useMemo`; result drives result card render |
| `src/components/calculator/GstTab.tsx` | `src/lib/gstEngine.ts` | calculateGST in useMemo | WIRED | Line 21: `calculateGST(...)` call inside `useMemo`; result drives GST breakdown card |
| `src/components/calculator/CalculatorView.tsx` | `src/components/calculator/IncomeTaxTab.tsx` | conditional render by activeTab | WIRED | Line 39: `{activeTab === 'income' && <IncomeTaxTab />}` |
| `src/App.tsx` | `src/components/calculator/CalculatorView.tsx` | app-level tab routing | WIRED | `activeView === 'calculator' && <CalculatorView />` — calculator accessible from main app shell |

---

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| CALC-01 | 03-02, 03-03 | Old vs New income tax regime side-by-side for FY 2025-26 and FY 2024-25 | SATISFIED | `IncomeTaxTab` computes both regimes in `useMemo`; FY selector present; `RegimeComparison` renders side-by-side cards |
| CALC-02 | 03-02, 03-03 | Input salary, deductions (80C, 80D, 80CCD-1B), HRA, standard deduction | SATISFIED | `IncomeTaxTab` has expandable deductions section (80C, 80D self/parents, 80CCD-1B) and expandable HRA section; `taxEngine.ts` caps each deduction at limits from `rules.oldRegime.deductionLimits` |
| CALC-03 | 03-02, 03-03 | Auto-applies Section 87A rebate and 4% cess | SATISFIED | `applyMarginalRelief` for new regime, simple rebate for old regime; cess = `taxAfterRebate × rules.cess`; both displayed as line items in `RegimeComparison` |
| CALC-04 | 03-02, 03-03 | Regime recommendation with exact savings amount | SATISFIED | `RegimeComparison` green banner: "{betterRegime} Regime saves you {formatINR(savings)} for FY {fy}" |
| CALC-05 | 03-02, 03-03 | Capital gains (LTCG/STCG) for equity, mutual funds, real estate | SATISFIED | `capitalGainsEngine.ts` handles all 3 asset types with correct rates; `CapitalGainsTab.tsx` provides full UI with pre-July-2024 indexation option |
| CALC-06 | 03-02, 03-03 | GST breakdown (CGST+SGST or IGST) for amount, rate, transaction type | SATISFIED | `gstEngine.ts` handles both transaction types, inclusive/exclusive; `GstTab.tsx` renders CGST/SGST/IGST split with correct conditional logic |
| CALC-07 | 03-01 | Tax rules stored as versioned per-FY data files | SATISFIED | `src/data/taxRules/fy2025-26.ts` and `fy2024-25.ts` are separate versioned files; `getTaxRules()` lookup with hard throw for unknown FY; no hardcoded tax values in engines or UI |

**Orphaned requirements check:** REQUIREMENTS.md Traceability table maps exactly CALC-01 through CALC-07 to Phase 3. All 7 IDs claimed in plans. No orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/calculator/CapitalGainsTab.tsx` | 62 | `return null` | INFO | Legitimate guard: returns null only when sale/purchase/months are zero/empty; result card conditional renders correctly on non-null result — not a stub |

No TODO, FIXME, placeholder, or stub anti-patterns found in any phase 3 file. No React imports in engine files (`taxEngine.ts`, `capitalGainsEngine.ts`, `gstEngine.ts`). TypeScript compiler exits with zero errors.

---

### Human Verification Required

All 6 items below require running `npm run dev` and navigating to the Calculator tab in a browser.

#### 1. Income Tax — ₹15L New Regime (Baseline Calculation)

**Test:** Enter ₹15,00,000 gross salary, FY 2025-26, Below 60, no deductions, no HRA
**Expected:** New Regime Total Tax = ₹97,500 (slabTax ₹93,750 + cess ₹3,750); recommendation banner favors New Regime
**Why human:** useMemo output → DOM rendering cannot be verified without a running browser

#### 2. Income Tax — ₹13L Marginal Relief (Cliff Prevention)

**Test:** Enter ₹13,00,000 gross salary, FY 2025-26, Below 60, new regime
**Expected:** Marginal relief row shows ₹38,750 in green text; Total Tax = ₹26,000
**Why human:** Marginal relief is a conditional rendered row — requires DOM inspection to confirm it appears with the correct value

#### 3. Capital Gains — Equity LTCG with ₹1.25L Exemption

**Test:** Capital Gains tab → Equity, sale ₹10L, purchase ₹5L, holding 18 months, FY 2025-26
**Expected:** LTCG badge; Annual exemption ₹1,25,000; Taxable gain ₹3,75,000; Estimated tax ₹46,875
**Why human:** Engine output → card render must be visually confirmed

#### 4. Capital Gains — Real Estate Pre-July-2024 Indexation Comparison

**Test:** Real Estate, sale ₹50L, purchase ₹20L, indexed cost ₹30L, holding 36 months, check "Acquired before 23 July 2024"
**Expected:** With Indexation card: taxableGain ₹20L, tax ₹4L (20%). Without Indexation card: taxableGain ₹30L, tax ₹3.75L (12.5%). "Lower Tax" badge on Without Indexation
**Why human:** Both indexation branches and recommendedOption badge require visual confirmation

#### 5. GST — Intra-State CGST/SGST Split

**Test:** GST tab → ₹10,000, 18%, Intra-state, amount excludes GST
**Expected:** CGST ₹900, SGST ₹900, Total GST ₹1,800, Total amount ₹11,800
**Why human:** CGST/SGST conditional rendering and total arithmetic must be visually confirmed

#### 6. GST — Confirm 12% and 28% Absent from UI

**Test:** Inspect all visible rate buttons in GST tab
**Expected:** Only buttons: 0%, 5%, 18%, 40% (standard) and 3%, 0.25% (special); no 12% or 28% button exists
**Why human:** UI completeness (absence of elements) requires browser render; static code confirms `STANDARD_RATES = [0, 5, 18, 40]` and `SPECIAL_RATES = [3, 0.25]` but not that no other rate-rendering code path exists

---

## Additional Findings

### Architectural Integrity

The engines-first architecture is correctly implemented across all three plans:
- Engine files (`taxEngine.ts`, `capitalGainsEngine.ts`, `gstEngine.ts`) contain zero React imports and zero side effects
- UI components call engines exclusively via `useMemo` — no calculation logic in components
- `RegimeComparison.tsx` is a pure display component receiving pre-computed results as props
- 87A rebate is correctly isolated to `taxEngine.ts` and explicitly absent from `capitalGainsEngine.ts` (with a JSDoc comment explaining the constraint)

### Tax Law Accuracy

The following critical tax rules are correctly implemented:
- FY 2025-26 new regime 87A threshold: ₹12L (`incomeThreshold: 1200000`), maxRebate ₹60,000 — matches Finance Act 2025
- FY 2024-25 new regime 87A threshold: ₹7L (`incomeThreshold: 700000`), maxRebate ₹25,000 — matches Finance Act 2024
- Equity STCG rate: 20% (post-July 2024 Budget change) — correctly implemented
- GST rates reflect September 2025 reform: 12% and 28% slabs absent from both engine validation array and UI button list

### Git Commit Verification

All 6 task commits documented in SUMMARYs confirmed in git log:
- `da08356` — feat(03-01): add calculator types
- `5a510f8` — feat(03-01): tax rule data files and INR utilities
- `1dea82e` — feat(03-02): income tax engine
- `fce344d` — feat(03-02): capital gains and GST engines
- `8cf42eb` — feat(03-03): CalculatorView, IncomeTaxTab, RegimeComparison
- `04e25bd` — feat(03-03): CapitalGainsTab and GstTab

---

_Verified: 2026-04-04_
_Verifier: Claude (gsd-verifier)_
