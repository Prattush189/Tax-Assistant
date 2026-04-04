---
phase: 03-tax-calculator
plan: "02"
subsystem: tax-engines
tags: [tax-calculator, income-tax, capital-gains, gst, pure-functions]
dependency_graph:
  requires: [03-01]
  provides: [calculateIncomeTax, calculateCapitalGains, calculateGST]
  affects: [04-dashboard]
tech_stack:
  added: []
  patterns: [pure-functions, no-side-effects, slab-iteration]
key_files:
  created:
    - src/lib/taxEngine.ts
    - src/lib/capitalGainsEngine.ts
    - src/lib/gstEngine.ts
  modified: []
decisions:
  - "87A rebate applies only in taxEngine.ts against slab tax — capitalGainsEngine.ts intentionally has no rebate logic"
  - "Marginal relief uses excessAboveThreshold approach: effectiveTax = min(slabTax, taxableIncome - threshold)"
  - "HRA exemption base is basic+DA only — not gross salary"
  - "GST engine validates against [0, 0.25, 3, 5, 18, 40] — 12% and 28% eliminated Sep 2025"
  - "Real estate indexation option exposes both branches with recommendedOption field — UI picks lower tax"
  - "Slab labels use 'L' format (₹4.0L) for compact readability in breakdown display"
metrics:
  duration: "~3 minutes"
  completed: "2026-04-04"
  tasks_completed: 2
  files_created: 3
  files_modified: 0
requirements: [CALC-01, CALC-02, CALC-03, CALC-04, CALC-05, CALC-06]
---

# Phase 03 Plan 02: Tax Calculation Engines Summary

Pure TypeScript income-tax (both regimes with marginal relief + HRA), capital-gains (equity/real-estate/other with pre-July-2024 indexation option), and GST (CGST+SGST/IGST, inclusive/exclusive) engines with zero React dependencies.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create src/lib/taxEngine.ts | 1dea82e | src/lib/taxEngine.ts |
| 2 | Create capitalGainsEngine.ts and gstEngine.ts | fce344d | src/lib/capitalGainsEngine.ts, src/lib/gstEngine.ts |

## What Was Built

### src/lib/taxEngine.ts

Four exported functions:

- `computeSlabTax(income, slabs)` — iterates slab table, builds per-slab breakdown with ₹X–₹Y labels
- `calculateHRAExemption(input)` — returns `min(actualHRA, cityPct × basicDA, rent − 10% × basicDA)`, zero when no rent paid; base is basic+DA not gross
- `applyMarginalRelief(slabTax, taxableIncome, rules)` — two branches: (1) at/below threshold → full rebate up to maxRebate; (2) above threshold → marginalRelief = max(0, slabTax − excessAboveThreshold), preventing the ₹12L cliff
- `calculateIncomeTax(input, rules)` — orchestrates all of the above, handles deduction caps for old regime, returns full `IncomeTaxResult` including effective rate

### src/lib/capitalGainsEngine.ts

Single exported function `calculateCapitalGains(input, rules)`:

- Equity LTCG: ₹1.25L exemption applied, 12.5% on remainder
- Equity STCG: 20% flat, no exemption
- Real estate LTCG (post-July-2024): 12.5% without indexation
- Real estate LTCG (pre-July-2024, with indexedCost): exposes `indexationOption` with both branches and `recommendedOption` for lower tax
- Real estate STCG / other STCG: `taxRate: 'slab'`, `taxAmount: null` — caller adds gain to normal income
- 87A rebate intentionally absent — belongs in taxEngine.ts only

### src/lib/gstEngine.ts

Single exported function `calculateGST(input)`:

- Rate validation against `[0, 0.25, 3, 5, 18, 40]` — throws descriptive error for invalid rates (including eliminated 12% and 28%)
- Inclusive mode: `taxableAmount = amount / (1 + rate/100)`, GST extracted from total
- Exclusive mode: `taxableAmount = amount`, GST added on top
- Intra-state: `cgst = sgst = gstAmount / 2`
- Inter-state: `igst = gstAmount`

## Decisions Made

1. **87A rebate isolated to taxEngine.ts** — capitalGainsEngine.ts has zero rebate logic. This is by design: s.111A and s.112A gains cannot benefit from 87A rebate.
2. **Marginal relief formula** — `effectiveTax = min(slabTax, taxableIncome − threshold)` rather than a lookup table, ensures smooth cliff prevention for any income value.
3. **HRA base = basic+DA** — documented explicitly in function comment to prevent future regression where gross salary is used instead.
4. **GST rate list as const array** — `[0, 0.25, 3, 5, 18, 40]` validates against current post-September-2025 structure; any future rate change requires only updating this list.
5. **Real estate indexation exposes both branches** — `indexationOption.recommendedOption` points to whichever yields lower tax; UI can display both for transparency.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

## Self-Check: PASSED

- FOUND: src/lib/taxEngine.ts
- FOUND: src/lib/capitalGainsEngine.ts
- FOUND: src/lib/gstEngine.ts
- FOUND: commit 1dea82e (taxEngine.ts)
- FOUND: commit fce344d (capitalGainsEngine.ts, gstEngine.ts)
- Zero TypeScript errors across full project (npx tsc --noEmit)
