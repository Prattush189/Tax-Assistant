---
phase: 03-tax-calculator
plan: 01
subsystem: calculator
tags: [typescript, tax, indian-tax, slab, capital-gains, gst, intl-number-format]

# Dependency graph
requires:
  - phase: 02-component-architecture
    provides: CalculatorView stub component that will consume these types

provides:
  - TaxRules TypeScript interface hierarchy (Slab, Rebate87A, DeductionLimits, OldRegimeSlabs, NewRegimeConfig, OldRegimeConfig, CapitalGainsRules, GstRules, TaxRules)
  - FY_2025_26 constant — Finance Act 2025 new regime 7-slab structure, old regime 3 age tiers
  - FY_2024_25 constant — Finance Act 2024 new regime 5-slab structure
  - getTaxRules(fy) lookup function with error boundary for unsupported FYs
  - TAX_RULES_BY_FY map and SUPPORTED_FY tuple
  - formatINR and formatINRCompact INR currency formatting utilities

affects:
  - 03-02 (income tax engine)
  - 03-03 (capital gains engine)
  - 03-04 (GST calculator)
  - 03-05 (calculator UI)
  - 04-dashboard

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Versioned per-FY data files — one file per fiscal year, never mutated
    - Infinity as top-slab sentinel in Slab.upTo
    - getTaxRules() throws on unknown FY — fail-fast, no silent fallback
    - formatINRCompact uses lakhs/crores thresholds for compact Indian number display

key-files:
  created:
    - src/data/taxRules/fy2025-26.ts
    - src/data/taxRules/fy2024-25.ts
    - src/data/taxRules/index.ts
  modified:
    - src/types/index.ts
    - src/lib/utils.ts

key-decisions:
  - "FY data files are plain TypeScript constants (not JSON) — type-checked by TaxRules interface at compile time, zero runtime parsing"
  - "Infinity used as top-slab sentinel in Slab.upTo — avoids special-casing last slab in engine loops"
  - "getTaxRules() throws on unknown FY — engines get a hard error rather than a silent undefined, preventing miscalculation"
  - "formatINRCompact thresholds: >=1Cr uses Cr suffix, >=1L uses L suffix — matches Indian financial convention"

patterns-established:
  - "Versioned FY files: new fiscal year = new file, never mutate existing data files"
  - "All tax values imported from src/data/taxRules — no hardcoded tax constants in engine or UI"
  - "TaxRules interface is the contract: every FY file must satisfy it at compile time"

requirements-completed: [CALC-07]

# Metrics
duration: 2min
completed: 2026-04-04
---

# Phase 3 Plan 01: Tax Type Definitions and FY Data Files Summary

**Versioned TypeScript tax constants for FY 2025-26 (7-slab Finance Act 2025) and FY 2024-25 (5-slab) with full TaxRules interface hierarchy and INR formatting utilities**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-04T10:33:47Z
- **Completed:** 2026-04-04T10:35:30Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Defined TaxRules TypeScript interface hierarchy covering new regime, old regime (3 age tiers), capital gains (equity/real estate/other), and GST — single source of truth for all tax constants
- Created FY 2025-26 data file with Finance Act 2025 7-slab new regime structure (4/8/12/16/20/24L breakpoints, 87A rebate up to 60,000 at 12L threshold)
- Created FY 2024-25 data file with 5-slab new regime structure (3/7/10/12/15L breakpoints)
- Created getTaxRules() lookup with error boundary and TAX_RULES_BY_FY map
- Added formatINR and formatINRCompact to utils.ts for consistent INR display across calculator UI

## Task Commits

Each task was committed atomically:

1. **Task 1: Add calculator types to src/types/index.ts** - `da08356` (feat)
2. **Task 2: Create tax rule data files and INR formatting utilities** - `5a510f8` (feat)

## Files Created/Modified

- `src/types/index.ts` - Appended 10 interfaces + 4 type aliases for tax calculator domain
- `src/data/taxRules/fy2025-26.ts` - FY 2025-26 TaxRules constant (Finance Act 2025)
- `src/data/taxRules/fy2024-25.ts` - FY 2024-25 TaxRules constant (Finance Act 2024)
- `src/data/taxRules/index.ts` - TAX_RULES_BY_FY map, SUPPORTED_FY tuple, getTaxRules() function
- `src/lib/utils.ts` - Added formatINR and formatINRCompact

## Decisions Made

- FY data files use plain TypeScript constants (not JSON) so the TaxRules interface type-checks them at compile time with zero runtime parsing overhead
- `Infinity` used as the top-slab sentinel in `Slab.upTo` — engine loop can use a uniform `income <= slab.upTo` test with no special-case for the final slab
- `getTaxRules()` throws on unknown FY rather than returning undefined — calculation engines get a hard error immediately, preventing silent miscalculation with stale/wrong data

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All interfaces and FY data constants are in place; 03-02 (income tax engine), 03-03 (capital gains), and 03-04 (GST) can import from these files immediately
- No blockers — TypeScript compiles clean with zero errors

---
*Phase: 03-tax-calculator*
*Completed: 2026-04-04*

## Self-Check: PASSED

All 5 source files confirmed present. Both task commits (da08356, 5a510f8) confirmed in git log.
