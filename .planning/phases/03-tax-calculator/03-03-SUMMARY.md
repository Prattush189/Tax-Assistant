---
phase: 03-tax-calculator
plan: 03
subsystem: ui
tags: [react, typescript, tailwindcss, tax-calculator]

# Dependency graph
requires:
  - phase: 03-02
    provides: calculateIncomeTax, calculateCapitalGains, calculateGST engine functions
  - phase: 03-01
    provides: getTaxRules, TaxRules types, formatINR utility
provides:
  - CalculatorView tab shell with Income Tax / Capital Gains / GST sub-tabs
  - IncomeTaxTab with FY selector, age category, deductions/HRA expandable sections, useMemo calculation
  - RegimeComparison side-by-side old/new regime cards with slab breakdown and recommendation banner
  - CapitalGainsTab with asset type selector, indexation comparison for pre-July-2024 real estate, 87A note
  - GstTab with current GST rate buttons (no 12%/28%), CGST+SGST/IGST breakdown, September 2025 disclaimer
affects: [04-dashboard, 06-smart-assist]

# Tech tracking
tech-stack:
  added: []
  patterns: [thin UI components calling engine functions via useMemo, expandable form sections with toggle state, side-by-side result cards with recommendation banners]

key-files:
  created:
    - src/components/calculator/IncomeTaxTab.tsx
    - src/components/calculator/RegimeComparison.tsx
    - src/components/calculator/CapitalGainsTab.tsx
    - src/components/calculator/GstTab.tsx
  modified:
    - src/components/calculator/CalculatorView.tsx

key-decisions:
  - "IncomeTaxTab calls calculateIncomeTax twice (old + new regime) in a single useMemo — keeps comparison always in sync with no extra state"
  - "RegimeComparison receives oldResult and newResult as props — pure display component with no calculation logic"
  - "CapitalGainsTab passes indexedCost || purchasePrice to engine — avoids null/undefined when indexation checkbox checked but field left empty"
  - "GstTab renders only [0, 5, 18, 40] as standard buttons and [3, 0.25] as special buttons — no 12% or 28% options anywhere in UI"

patterns-established:
  - "Engine-first UI: all calculation logic lives in engine functions; components call via useMemo on state changes"
  - "Expandable sections: toggle state controls visibility, border + bg pattern reused across income deductions and HRA sections"
  - "Recommendation banner pattern: green bg-green-50 border-green-200 with savings amount, neutral fallback for zero savings"

requirements-completed: [CALC-01, CALC-02, CALC-03, CALC-04, CALC-05, CALC-06]

# Metrics
duration: 4min
completed: 2026-04-04
---

# Phase 03 Plan 03: Calculator UI Components Summary

**Five thin React components (CalculatorView, IncomeTaxTab, RegimeComparison, CapitalGainsTab, GstTab) connecting the Plan 02 engine functions to a usable tax calculator UI with side-by-side regime comparison, indexation options, and GST breakdown**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-04T10:43:33Z
- **Completed:** 2026-04-04T10:47:31Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- CalculatorView tab shell replaces placeholder stub with three sub-tabs (Income Tax / Capital Gains / GST) using border-b-2 active styling consistent with Header.tsx
- IncomeTaxTab calls calculateIncomeTax for both old and new regimes in one useMemo, with expandable sections for deductions and HRA; RegimeComparison shows side-by-side cards with slab breakdown, rebate/marginal relief line items, cess, effective rate, and green savings banner
- CapitalGainsTab handles equity LTCG exemption, real estate indexation comparison (pre-July-2024), and slab-rate STCG cases; GstTab shows only current GST slabs with CGST+SGST or IGST split and September 2025 reform note

## Task Commits

1. **Task 1: Build CalculatorView.tsx tab shell, IncomeTaxTab.tsx, and RegimeComparison.tsx** - `8cf42eb` (feat)
2. **Task 2: Build CapitalGainsTab.tsx and GstTab.tsx** - `04e25bd` (feat)

## Files Created/Modified

- `src/components/calculator/CalculatorView.tsx` - Replaced placeholder with three-tab shell; owns activeTab state only
- `src/components/calculator/IncomeTaxTab.tsx` - Income form with FY/age selectors, expandable deductions/HRA, useMemo dual-regime calculation
- `src/components/calculator/RegimeComparison.tsx` - Side-by-side old/new regime cards with recommendation banner and winning card ring highlight
- `src/components/calculator/CapitalGainsTab.tsx` - Capital gains form with asset type buttons, indexation comparison cards, 87A note
- `src/components/calculator/GstTab.tsx` - GST form with current-rate-only buttons, inclusive/exclusive toggle, CGST+SGST/IGST breakdown

## Decisions Made

- IncomeTaxTab calls calculateIncomeTax twice in one useMemo rather than storing two separate results — keeps old and new always computed together with a single dependency array
- CapitalGainsTab passes `indexedCost || purchasePrice` to engine so the indexation path is never called with undefined when checkbox is checked but field is empty
- GstTab renders standard rates [0, 5, 18, 40] and special rates [3, 0.25] as button groups — no radio inputs for rate since buttons give clearer visual affordance for a small fixed set

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. All calculator components are client-side only.

## Next Phase Readiness

- All five calculator component files exist and TypeScript compiles with zero errors
- Calculator UI is fully wired to engine functions from Plans 01 and 02
- Phase 4 (Dashboard) can consume calculator output — charts with real data from IncomeTaxResult and CapitalGainsResult
- Phase 3 still has Plans 04 and 05 remaining (per ROADMAP)

## Self-Check: PASSED

All 5 created/modified files exist on disk. Both task commits (8cf42eb, 04e25bd) confirmed in git log.

---
*Phase: 03-tax-calculator*
*Completed: 2026-04-04*
