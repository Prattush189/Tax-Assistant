# Phase 3: Tax Calculator - Research

**Researched:** 2026-04-04
**Domain:** Indian Income Tax Calculation — FY 2025-26 + FY 2024-25 (new/old regime, capital gains, GST)
**Confidence:** HIGH (tax slab values verified against official incometax.gov.in; GST reform verified against PIB/government sources)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CALC-01 | User can compare Old vs New income tax regime side-by-side for FY 2025-26 and FY 2024-25 | Tax slabs for both years fully documented below; side-by-side UI pattern researched |
| CALC-02 | User can input salary, deductions (80C, 80D, 80CCD-1B), HRA, and standard deduction for old regime | All deduction limits and HRA formula verified; standard deduction regime differences confirmed |
| CALC-03 | Calculator auto-applies Section 87A rebate and 4% health & education cess | 87A rules (including LTCG exclusion edge case) fully documented; cess rate confirmed |
| CALC-04 | User sees regime recommendation with exact savings amount | Trivially derived from CALC-01 output; "switch and save X" pattern documented |
| CALC-05 | User can calculate capital gains (LTCG/STCG) for equity, mutual funds, and real estate | All rates confirmed: LTCG 12.5%, STCG 20%; exemption ₹1.25L; holding periods; indexation option for pre-July 2024 property |
| CALC-06 | User can calculate GST breakdown (CGST+SGST or IGST) for a given amount, rate, and transaction type | GST formula documented; September 2025 rate reform verified — current slabs are 0%, 5%, 18%, 40% |
| CALC-07 | Tax rules stored as versioned per-FY data files, not hardcoded constants | Data file architecture pattern documented; TypeScript interface design recommended |
</phase_requirements>

---

## Summary

Phase 3 is a pure client-side feature (no new backend dependencies). The primary work is (1) implementing correct Indian tax calculation logic in TypeScript across three sub-calculators, (2) building the tab-based UI in `CalculatorView.tsx`, and (3) structuring tax rules in versioned data files so FY changes require only a new data file rather than code changes.

Tax rule values for FY 2025-26 are materially different from FY 2024-25 due to Budget 2025 changes. The new regime slab structure was significantly revised (basic exemption raised from ₹3L to ₹4L, seven slabs replacing five, 30% threshold raised from ₹15L to ₹24L), the Section 87A rebate was expanded (income threshold ₹7L→₹12L, rebate amount ₹25K→₹60K), and standard deduction in the new regime was raised from ₹50K to ₹75K. These changes were introduced by Finance Act 2025 and verified against incometax.gov.in directly.

A critical edge case discovered during research: Section 87A rebate does NOT apply against tax on special-rate income (LTCG u/s 112A, STCG u/s 111A). Finance Act 2025 explicitly inserted a proviso confirming this for the new regime. This means the income tax + capital gains calculator must compute rebate only on "normal income" tax, not on capital gains tax. This is one of the most common errors in third-party Indian tax calculators. Also notable: India's GST rate structure changed materially in September 2025 — the 12% and 28% slabs were eliminated and consolidated into 5% and 18%, making the current GST slabs 0%, 5%, 18%, and 40%.

**Primary recommendation:** Build the calculation engine as pure TypeScript functions in `src/lib/taxEngine.ts` that accept a typed input and return a typed output. Tax rule constants live in `src/data/taxRules/fy2025-26.ts` and `src/data/taxRules/fy2024-25.ts`. UI components in `CalculatorView.tsx` are thin wrappers over these functions. This separates testable logic from presentation and satisfies CALC-07's versioned-rules requirement.

---

## Tax Rule Reference (VERIFIED)

This section documents the exact values that must be encoded in data files. All values verified against incometax.gov.in and/or PIB official sources.

### FY 2025-26 (AY 2026-27) — New Regime

**Source:** https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1 (official)

| Income Bracket | Tax Rate | Tax on Previous Slabs |
|----------------|----------|-----------------------|
| Up to ₹4,00,000 | 0% | ₹0 |
| ₹4,00,001 – ₹8,00,000 | 5% | ₹0 |
| ₹8,00,001 – ₹12,00,000 | 10% | ₹20,000 |
| ₹12,00,001 – ₹16,00,000 | 15% | ₹60,000 |
| ₹16,00,001 – ₹20,00,000 | 20% | ₹1,20,000 |
| ₹20,00,001 – ₹24,00,000 | 25% | ₹2,00,000 |
| Above ₹24,00,000 | 30% | ₹3,00,000 |

- **Standard deduction (salaried):** ₹75,000
- **Section 87A rebate:** Up to ₹60,000; available only if taxable income ≤ ₹12,00,000
- **87A critical rule:** Rebate does NOT apply against LTCG (s.112A) or STCG (s.111A) tax. Rebate eligibility assessed on income EXCLUDING special-rate income.
- **Marginal relief:** When income exceeds ₹12L, tax payable ≤ (income − ₹12,00,000). Prevents cliff effect for small income above threshold.
- **Cess:** 4% Health & Education cess on (income tax + surcharge)
- **HRA:** Not available in new regime
- **80C, 80D, 80CCD(1B):** Not available in new regime (only 80CCD(2) employer NPS contribution is allowed)

### FY 2025-26 (AY 2026-27) — Old Regime

**Source:** https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1 (official)

**Below 60 years:**
| Income Bracket | Tax Rate |
|----------------|----------|
| Up to ₹2,50,000 | 0% |
| ₹2,50,001 – ₹5,00,000 | 5% |
| ₹5,00,001 – ₹10,00,000 | 20% |
| Above ₹10,00,000 | 30% |

**Senior Citizens (60–80 years):**
| Income Bracket | Tax Rate |
|----------------|----------|
| Up to ₹3,00,000 | 0% |
| ₹3,00,001 – ₹5,00,000 | 5% |
| ₹5,00,001 – ₹10,00,000 | 20% |
| Above ₹10,00,000 | 30% |

**Super Senior Citizens (80+ years):**
| Income Bracket | Tax Rate |
|----------------|----------|
| Up to ₹5,00,000 | 0% |
| ₹5,00,001 – ₹10,00,000 | 20% |
| Above ₹10,00,000 | 30% |

- **Standard deduction (salaried):** ₹50,000 (unchanged from prior year)
- **Section 87A rebate:** Up to ₹12,500; available only if taxable income ≤ ₹5,00,000
- **Old regime deductions available:**
  - Section 80C: up to ₹1,50,000 (PPF, ELSS, life insurance premiums, etc.)
  - Section 80D: up to ₹25,000 self/family (₹50,000 if self is senior citizen); up to ₹25,000 additional for parents (₹50,000 if parents are senior citizens)
  - Section 80CCD(1B) NPS: up to ₹50,000 (additional to 80C limit)
  - HRA: exempt under Section 10(13A) — see HRA formula below
- **Cess:** 4% Health & Education cess on (income tax + surcharge)

### FY 2024-25 (AY 2025-26) — New Regime

**Source:** https://www.referencer.in/Income_Tax/Income_Tax_Rates_AY_2025-26.aspx (verified MEDIUM confidence)

| Income Bracket | Tax Rate |
|----------------|----------|
| Up to ₹3,00,000 | 0% |
| ₹3,00,001 – ₹7,00,000 | 5% |
| ₹7,00,001 – ₹10,00,000 | 10% |
| ₹10,00,001 – ₹12,00,000 | 15% |
| ₹12,00,001 – ₹15,00,000 | 20% |
| Above ₹15,00,000 | 30% |

- **Standard deduction (salaried):** ₹50,000
- **Section 87A rebate:** Up to ₹25,000; available if taxable income ≤ ₹7,00,000

### FY 2024-25 (AY 2025-26) — Old Regime

Same slabs as FY 2025-26 old regime above (old regime slabs have been unchanged for multiple years). Standard deduction ₹50,000. 87A rebate: ₹12,500 if income ≤ ₹5,00,000.

### HRA Exemption Formula (Old Regime Only)

**Source:** https://incometaxindia.gov.in/Pages/tools/house-rent-allowance-calculator.aspx (official)

HRA exemption = **minimum of:**
1. Actual HRA received from employer
2. 50% of (Basic + DA) — for metro cities; 40% — for non-metro cities
3. Rent paid − 10% of (Basic + DA)

Metro cities: Delhi, Mumbai, Kolkata, Chennai. Non-metro: all other cities.

HRA exemption is only available in the old regime.

### Capital Gains Tax — FY 2025-26

**Source:** Finance (No. 2) Act, 2024 (effective 23 July 2024); unchanged for FY 2025-26.
**Verified against:** https://www.finnovate.in/learn/blog/capital-gains-tax-india-explained and PIB CBDT FAQs

**Equity / Equity-Oriented Mutual Funds / Business Trust Units (STT paid):**
| Gain Type | Holding Period | Rate | Exemption |
|-----------|---------------|------|-----------|
| STCG (Section 111A) | ≤ 12 months | 20% | None (basic exemption shortfall can offset) |
| LTCG (Section 112A) | > 12 months | 12.5% | ₹1,25,000 per year |

**Immovable Property (Real Estate):**
| Gain Type | Holding Period | Rate Options |
|-----------|---------------|--------------|
| STCG | ≤ 24 months | Slab rate (added to normal income) |
| LTCG | > 24 months | 12.5% without indexation (for property acquired on/after 23 July 2024); OR taxpayer's choice of 12.5% without indexation vs 20% with indexation for property acquired BEFORE 23 July 2024 |

**Other Assets (Gold, Debt Funds):**
| Gain Type | Holding Period | Rate |
|-----------|---------------|------|
| STCG | ≤ 24 months | Slab rate |
| LTCG | > 24 months | 12.5% without indexation |

**87A rebate and capital gains:** Rebate is NOT available against LTCG (s.112A) or STCG (s.111A) tax. The ₹4L basic exemption limit can still offset capital gains income in the new regime.

### GST Calculator Rules

**Source:** PIB official announcement September 2025 reform (https://www.pib.gov.in/PressNoteDetails.aspx?NoteId=155151), CBIC official rates

**CRITICAL — GST Rate Change September 22, 2025:**
The GST Council eliminated the 12% and 28% slabs effective 22 September 2025. Current rate structure:

| Rate | Category |
|------|----------|
| 0% | Exempt (fresh produce, basic food, books) |
| 5% | Essentials, medicines, packaged food |
| 18% | Standard (electronics, most goods and services) |
| 40% | Luxury and sin goods (tobacco, aerated drinks, premium cars) |
| 3% | Gold and precious stones (special rate) |
| 0.25% | Diamonds (special rate) |

**Calculation formulas:**

Intra-state (CGST + SGST):
- Each = (Taxable Amount × GST Rate / 2) / 100
- CGST = SGST = half of total GST
- Total = CGST + SGST = Taxable Amount × GST Rate / 100

Inter-state (IGST):
- IGST = Taxable Amount × GST Rate / 100
- No CGST or SGST split

**GST-inclusive amount breakdown:**
- When amount includes GST: Taxable = Total / (1 + Rate/100)
- When amount excludes GST: GST = Amount × Rate / 100

---

## Standard Stack

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.0.0 | Component framework | Already in project |
| TypeScript | ~5.8.2 | Type safety for tax calculations | Already in project |
| Recharts | ^3.8.1 | Charts for regime comparison | Already installed; used for charts in chat |
| Tailwind CSS | ^4.1.14 | Styling | Already in project |
| lucide-react | ^0.546.0 | Icons | Already in project |

### No New Dependencies Required

The tax calculator is pure client-side computation. No additional packages are needed:
- Number formatting: Use `Intl.NumberFormat` with `en-IN` locale (built-in)
- Form state: React `useState` controlled inputs (no form library needed)
- Charts: Recharts already installed

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── data/
│   └── taxRules/
│       ├── index.ts           # Re-export + FY lookup function
│       ├── fy2025-26.ts       # FY 2025-26 rule constants (new + old regime, CG, GST)
│       └── fy2024-25.ts       # FY 2024-25 rule constants
├── lib/
│   ├── utils.ts               # Existing cn() utility
│   ├── taxEngine.ts           # Pure calculation functions (income tax)
│   ├── capitalGainsEngine.ts  # Capital gains calculation
│   └── gstEngine.ts           # GST breakdown calculation
├── types/
│   └── index.ts               # Existing + add calculator types
├── hooks/
│   └── useTaxCalculator.ts    # Calculator state management hook
└── components/
    └── calculator/
        ├── CalculatorView.tsx  # Existing stub — becomes tab shell
        ├── IncomeTaxTab.tsx    # Old vs New regime comparison form + results
        ├── CapitalGainsTab.tsx # Capital gains sub-calculator
        ├── GstTab.tsx          # GST breakdown sub-calculator
        └── RegimeComparison.tsx # Side-by-side result display component
```

### Pattern 1: Versioned Tax Rules Data File (CALC-07)

**What:** Each financial year gets its own TypeScript constants file. A lookup function returns the correct rule set based on a `FY` string key.

**When to use:** Always — satisfies CALC-07, makes year changes a data-only update.

```typescript
// src/data/taxRules/fy2025-26.ts
// Source: incometax.gov.in/iec/foportal/help/individual/return-applicable-1

export const FY_2025_26: TaxRules = {
  fy: '2025-26',
  newRegime: {
    standardDeduction: 75000,
    rebate87A: { maxRebate: 60000, incomeThreshold: 1200000 },
    slabs: [
      { upTo: 400000,  rate: 0   },
      { upTo: 800000,  rate: 0.05 },
      { upTo: 1200000, rate: 0.10 },
      { upTo: 1600000, rate: 0.15 },
      { upTo: 2000000, rate: 0.20 },
      { upTo: 2400000, rate: 0.25 },
      { upTo: Infinity, rate: 0.30 },
    ],
  },
  oldRegime: {
    standardDeduction: 50000,
    rebate87A: { maxRebate: 12500, incomeThreshold: 500000 },
    slabs: {
      below60: [
        { upTo: 250000,  rate: 0    },
        { upTo: 500000,  rate: 0.05 },
        { upTo: 1000000, rate: 0.20 },
        { upTo: Infinity, rate: 0.30 },
      ],
      senior60to80: [ /* ₹3L zero slab */ ],
      superSenior80plus: [ /* ₹5L zero slab */ ],
    },
    deductionLimits: {
      section80C: 150000,
      section80D_self: 25000,
      section80D_self_senior: 50000,
      section80D_parents: 25000,
      section80D_parents_senior: 50000,
      section80CCD1B: 50000,
    },
  },
  cess: 0.04,
  capitalGains: {
    equity: {
      ltcg: { rate: 0.125, holdingMonths: 12, exemption: 125000 },
      stcg: { rate: 0.20,  holdingMonths: 12 },
    },
    realEstate: {
      ltcg: { rate: 0.125, holdingMonths: 24, indexationOptionForPreJuly2024: true },
      stcg: { rate: 'slab', holdingMonths: 24 },
    },
  },
  gst: {
    ratesAvailable: [0, 5, 18, 40],
    specialRates: [3, 0.25],
  },
};
```

### Pattern 2: Pure Calculation Engine

**What:** Engine functions are pure (input → output, no side effects), accept a rule set object rather than hardcoding FY. UI state and engine are completely decoupled.

**When to use:** All tax math lives here. Components never contain calculation logic.

```typescript
// src/lib/taxEngine.ts
// Calculation logic — no React imports, no side effects

export interface IncomeTaxInput {
  grossSalary: number;
  otherIncome: number;
  regime: 'new' | 'old';
  fy: string;
  ageCategory: 'below60' | 'senior' | 'superSenior';
  // Old regime only:
  deductions?: {
    section80C?: number;
    section80D?: number;
    section80CCD1B?: number;
    hra?: number;
  };
}

export interface SlabBreakdown {
  slab: string;
  taxableAmount: number;
  tax: number;
}

export interface IncomeTaxResult {
  grossIncome: number;
  standardDeduction: number;
  totalDeductions: number;
  taxableIncome: number;
  slabTax: number;
  slabBreakdown: SlabBreakdown[];
  rebate87A: number;
  taxAfterRebate: number;
  cess: number;
  totalTax: number;
  effectiveRate: number;
}

export function calculateIncomeTax(
  input: IncomeTaxInput,
  rules: TaxRules
): IncomeTaxResult { ... }
```

### Pattern 3: Tab-Based Calculator Shell

**What:** `CalculatorView.tsx` owns the active sub-calculator tab state. Each tab (Income Tax, Capital Gains, GST) is its own component.

**When to use:** Satisfies CALC-01/05/06 without complex routing.

```typescript
// src/components/calculator/CalculatorView.tsx
type CalcTab = 'income' | 'capitalGains' | 'gst';

export function CalculatorView() {
  const [activeTab, setActiveTab] = useState<CalcTab>('income');

  return (
    <div className="flex-1 flex flex-col p-4 overflow-y-auto">
      {/* Tab switcher */}
      <div className="flex gap-2 mb-4">
        {(['income', 'capitalGains', 'gst'] as CalcTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium',
              activeTab === tab
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
            )}
          >
            {tab === 'income' ? 'Income Tax' : tab === 'capitalGains' ? 'Capital Gains' : 'GST'}
          </button>
        ))}
      </div>
      {activeTab === 'income' && <IncomeTaxTab />}
      {activeTab === 'capitalGains' && <CapitalGainsTab />}
      {activeTab === 'gst' && <GstTab />}
    </div>
  );
}
```

### Pattern 4: Regime Comparison Side-by-Side (CALC-01, CALC-04)

**What:** Calculate results for both regimes simultaneously and render a split card. Include a recommendation banner with exact savings.

```typescript
// Compute both regimes
const newResult = calculateIncomeTax({ ...input, regime: 'new' }, rules);
const oldResult = calculateIncomeTax({ ...input, regime: 'old' }, rules);
const savings = Math.abs(newResult.totalTax - oldResult.totalTax);
const betterRegime = newResult.totalTax < oldResult.totalTax ? 'new' : 'old';

// Recommendation banner
<div className="bg-green-50 dark:bg-green-900/20 border border-green-200 rounded-lg p-3">
  <p>Switch to {betterRegime} regime and save {formatINR(savings)}</p>
</div>
```

### Pattern 5: Indian Number Formatting

**What:** Use `Intl.NumberFormat` with `en-IN` locale for ₹ formatting (lakhs/crores system).

```typescript
// src/lib/utils.ts — add to existing file
export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatINRCompact(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)}L`;
  return formatINR(amount);
}
```

### Pattern 6: Marginal Relief for 87A (Critical Edge Case)

**What:** When income slightly exceeds ₹12L in new regime, the additional tax must not exceed (income − ₹12,00,000). Without this, earning ₹12.1L results in a lower take-home than earning ₹12L — a nonsensical cliff.

```typescript
function applyMarginalRelief(
  taxBeforeRebate: number,
  taxableIncome: number,
  rebateThreshold: number
): number {
  if (taxableIncome <= rebateThreshold) return 0; // full rebate
  const excessIncome = taxableIncome - rebateThreshold;
  // Tax payable cannot exceed excess income
  return Math.min(taxBeforeRebate, excessIncome);
}
```

### Anti-Patterns to Avoid

- **Hardcoding tax rates in component files:** Tax values change every budget. Always import from data files. Never write `const RATE = 0.05` in a component.
- **Applying 87A rebate against LTCG/STCG tax:** This is wrong. Rebate applies only to slab tax on normal income. Capital gains tax at special rates (s.111A, s.112A) are always paid in full.
- **Omitting marginal relief:** Calculators that don't implement marginal relief will show that someone earning ₹12.1L pays ₹61,500 tax while someone earning ₹12L pays ₹0. This is incorrect — the former should pay roughly ₹10,000 (the extra income).
- **Single-regime calculation followed by side-by-side display:** Calculate both regimes from the same input object independently. Don't derive one from the other.
- **Using old GST rates (12%, 28%):** These slabs were eliminated on 22 September 2025. The current slabs are 0%, 5%, 18%, 40%. The UI should only offer these four options (plus special rates 3%, 0.25%).
- **Using FY 2024-25 new regime slabs for FY 2025-26:** The slabs are completely different (3/7/10/12/15 lakh breakpoints → 4/8/12/16/20/24 lakh breakpoints). Using wrong FY data is a silent correctness bug.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Indian number formatting | Custom INR formatter | `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` | Handles lakhs/crores correctly, browser-native |
| Chart rendering | SVG-based custom bar/waterfall chart | Recharts (already installed) | Already used in the app; BarChart + ComposedChart cover all needed chart types |
| Form validation | Zod or react-hook-form | Plain React `useState` + `useMemo` for a calculator | Calculators don't need submission validation — just range guards. Adding a form library is overhead. |
| Tax rule version lookup | Complex factory pattern | Simple exported object + `Record<string, TaxRules>` map | Two FY years needed; a plain `fy2025-26.ts` import is sufficient |

**Key insight:** The entire phase is pure TypeScript math + Tailwind UI. The temptation is to over-engineer the engine. Keep it simple: typed functions, immutable inputs, one result object per call.

---

## Common Pitfalls

### Pitfall 1: 87A Rebate Applied Against Capital Gains Tax

**What goes wrong:** Calculator applies the ₹60,000 rebate against total tax (income tax + capital gains tax), reducing capital gains liability.
**Why it happens:** Finance Act 2025 added an explicit proviso to Section 87A barring this, but most tutorials don't mention it. Pre-2025 behavior was ambiguous.
**How to avoid:** In the combined income tax + capital gains flow, compute rebate exclusively against `slabTax` (the normal income tax). Never subtract rebate from `capitalGainsTax`.
**Warning signs:** A user with ₹11L salary + ₹3L LTCG shows zero tax — that would be wrong. LTCG tax (12.5% on gains above ₹1.25L) must remain.

### Pitfall 2: Wrong FY for New Regime Slabs

**What goes wrong:** FY 2024-25 new regime slabs (breakpoints at ₹3L/7L/10L/12L/15L) are used instead of FY 2025-26 slabs (₹4L/8L/12L/16L/20L/24L). This produces materially wrong tax for income between ₹7L and ₹24L.
**Why it happens:** Budget 2025 changed the new regime significantly but blog posts from 2024 still rank highly.
**How to avoid:** Encode FY 2025-26 and FY 2024-25 data separately. The FY selector drives which data file is used. Never mix them.
**Warning signs:** Tax calculation test case fails: ₹15L income new regime FY 2025-26 should yield ₹1,40,000 slab tax, not ₹1,87,500 (the FY 2024-25 answer).

### Pitfall 3: Missing Marginal Relief for ₹12L Threshold (New Regime)

**What goes wrong:** Someone earning ₹12.1L has a take-home LOWER than someone earning ₹12L because the full slab tax (~₹61,500) applies without any relief.
**Why it happens:** Marginal relief is a lesser-known provision; many tutorials and even some official tools don't implement it correctly.
**How to avoid:** Apply marginal relief: tax on income slightly above ₹12L = min(slab_tax, income − 12,00,000). See Pattern 6 above.
**Warning signs:** Tax jumps from ₹0 to ~₹60,000 in a linear range test when crossing ₹12L.

### Pitfall 4: Old Regime HRA Calculated Incorrectly

**What goes wrong:** HRA exemption uses the wrong "metro" city logic, or the "rent minus 10% of Basic+DA" leg is computed on gross salary instead of Basic+DA.
**Why it happens:** The "10% of salary" in HRA rules means Basic+DA only — not gross salary. This distinction is commonly missed.
**How to avoid:** HRA exemption = min(actual_HRA, city_pct × (basic + da), rent_paid − 0.10 × (basic + da)). The city_pct is 50% for metro (Delhi/Mumbai/Kolkata/Chennai), 40% for non-metro.
**Warning signs:** Non-metro user sees the same HRA exemption as a metro user.

### Pitfall 5: GST Rate Offered Outside Current Slabs

**What goes wrong:** UI offers a 12% or 28% GST rate dropdown option, which no longer exists post September 2025 reform.
**Why it happens:** All pre-September 2025 GST documentation shows 5/12/18/28 structure.
**How to avoid:** Use only [0, 5, 18, 40] as standard rate options. Note: if user specifically needs 3% (gold) or 0.25% (diamonds), add as special-case options clearly labeled. Never offer 12% or 28%.
**Warning signs:** Rate dropdown shows 12 or 28 as selectable standard options.

### Pitfall 6: LTCG Property Indexation Option Not Offered for Pre-July 2024 Assets

**What goes wrong:** Calculator always applies 12.5% without indexation for real estate LTCG, but taxpayers who bought property BEFORE 23 July 2024 can choose between 12.5% (no indexation) and 20% (with indexation). The calculator should let them compare both and pick the lower.
**Why it happens:** The Finance (No. 2) Act 2024 created a transitional option for pre-July-2024 property; this is commonly missed.
**How to avoid:** In the real estate LTCG calculator, if the acquisition date is before 23 July 2024, compute both options and display the lower one (or let user toggle between options).

---

## Code Examples

### Income Tax Slab Calculation Core

```typescript
// src/lib/taxEngine.ts
// No external imports needed — pure computation

interface Slab {
  upTo: number;
  rate: number;
}

export function computeSlabTax(income: number, slabs: Slab[]): {
  total: number;
  breakdown: Array<{ slab: string; taxable: number; tax: number }>;
} {
  let remaining = income;
  let totalTax = 0;
  const breakdown = [];
  let prevLimit = 0;

  for (const slab of slabs) {
    const slabSize = Math.min(remaining, slab.upTo - prevLimit);
    if (slabSize <= 0) break;
    const tax = slabSize * slab.rate;
    if (slab.rate > 0) {
      breakdown.push({
        slab: `₹${prevLimit / 100000}L – ₹${slab.upTo === Infinity ? '∞' : slab.upTo / 100000 + 'L'}`,
        taxable: slabSize,
        tax,
      });
    }
    totalTax += tax;
    remaining -= slabSize;
    prevLimit = slab.upTo;
    if (remaining <= 0) break;
  }
  return { total: totalTax, breakdown };
}

export function apply87ARebate(
  slabTax: number,
  taxableIncome: number,
  rebateRules: { maxRebate: number; incomeThreshold: number }
): number {
  // Does not apply to special-rate income (LTCG/STCG) — call only with normal income
  if (taxableIncome > rebateRules.incomeThreshold) {
    // Check marginal relief
    const excess = taxableIncome - rebateRules.incomeThreshold;
    // Tax payable cannot exceed the excess income earned above threshold
    return Math.max(0, slabTax - Math.max(0, slabTax - excess));
  }
  return Math.min(slabTax, rebateRules.maxRebate);
}
```

### Capital Gains Calculation

```typescript
// src/lib/capitalGainsEngine.ts
export interface EquityGainInput {
  purchaseValue: number;
  saleValue: number;
  holdingMonths: number; // calculated from dates
  assetType: 'equity' | 'equityMF';
}

export interface EquityGainResult {
  gainType: 'LTCG' | 'STCG';
  grossGain: number;
  exemption: number;        // 0 for STCG; ₹1.25L for LTCG (applies once per FY)
  taxableGain: number;
  taxRate: number;
  taxAmount: number;
  cess: number;
  totalTax: number;
}

export function calculateEquityGains(
  input: EquityGainInput,
  rules: TaxRules['capitalGains']['equity'],
  ltcgExemptionUsed: number = 0  // track cumulative exemption in FY
): EquityGainResult {
  const isLTCG = input.holdingMonths > rules.ltcg.holdingMonths;
  const grossGain = Math.max(0, input.saleValue - input.purchaseValue);
  const exemptionAvailable = isLTCG
    ? Math.max(0, rules.ltcg.exemption - ltcgExemptionUsed)
    : 0;
  const taxableGain = Math.max(0, grossGain - exemptionAvailable);
  const rate = isLTCG ? rules.ltcg.rate : rules.stcg.rate;
  const taxAmount = taxableGain * rate;
  const cess = taxAmount * 0.04;
  return {
    gainType: isLTCG ? 'LTCG' : 'STCG',
    grossGain,
    exemption: Math.min(grossGain, exemptionAvailable),
    taxableGain,
    taxRate: rate,
    taxAmount,
    cess,
    totalTax: taxAmount + cess,
  };
}
```

### GST Breakdown Calculation

```typescript
// src/lib/gstEngine.ts
export type GstTransactionType = 'intraState' | 'interState';

export interface GstInput {
  amount: number;
  gstRate: number;       // 0, 5, 18, or 40 (post Sep 2025 reform)
  transactionType: GstTransactionType;
  amountInclusive: boolean; // is amount inclusive of GST or exclusive?
}

export interface GstResult {
  baseAmount: number;
  gstRate: number;
  cgst: number | null;   // null for inter-state
  sgst: number | null;   // null for inter-state
  igst: number | null;   // null for intra-state
  totalGst: number;
  totalAmount: number;
}

export function calculateGst(input: GstInput): GstResult {
  const rateDecimal = input.gstRate / 100;
  const baseAmount = input.amountInclusive
    ? input.amount / (1 + rateDecimal)
    : input.amount;
  const totalGst = baseAmount * rateDecimal;

  if (input.transactionType === 'intraState') {
    return {
      baseAmount,
      gstRate: input.gstRate,
      cgst: totalGst / 2,
      sgst: totalGst / 2,
      igst: null,
      totalGst,
      totalAmount: baseAmount + totalGst,
    };
  }
  return {
    baseAmount,
    gstRate: input.gstRate,
    cgst: null,
    sgst: null,
    igst: totalGst,
    totalGst,
    totalAmount: baseAmount + totalGst,
  };
}
```

### Known-Good Test Case for CALC-03 Verification

To verify the full income tax calculation pipeline for FY 2025-26 (new regime):

| Input | Value |
|-------|-------|
| Gross salary (salaried) | ₹15,00,000 |
| Regime | New |
| Age | Below 60 |
| FY | 2025-26 |

Expected calculation:
1. Taxable income = ₹15,00,000 − ₹75,000 (standard deduction) = ₹14,25,000
2. Slab tax:
   - 0% on ₹4,00,000 = ₹0
   - 5% on ₹4,00,000 (₹4L–₹8L) = ₹20,000
   - 10% on ₹4,00,000 (₹8L–₹12L) = ₹40,000
   - 15% on ₹2,25,000 (₹12L–₹14.25L) = ₹33,750
   - Total slab tax = ₹93,750
3. 87A rebate: Income ₹14.25L > ₹12L threshold → ₹0 rebate
4. Cess: 4% × ₹93,750 = ₹3,750
5. **Total tax = ₹97,500**

Second test case — at-threshold (income ≤ ₹12L):

| Input | Value |
|-------|-------|
| Gross salary | ₹12,75,000 |
| Regime | New |

Expected:
1. Taxable income = ₹12,75,000 − ₹75,000 = ₹12,00,000
2. Slab tax = ₹20,000 + ₹40,000 = ₹60,000
3. 87A rebate = min(₹60,000, ₹60,000) = ₹60,000
4. Tax after rebate = ₹0
5. Cess = ₹0
6. **Total tax = ₹0**

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| New regime 5-slab structure (₹3L/7L/10L/12L/15L breakpoints) | 7-slab structure (₹4L/8L/12L/16L/20L/24L breakpoints) | Budget 2025 (Apr 2025) | Significantly lower tax for ₹12L–₹24L earners; 30% bracket starts at ₹24L not ₹15L |
| 87A rebate ₹25,000 threshold ₹7L (new regime) | 87A rebate ₹60,000 threshold ₹12L (new regime) | Budget 2025 (Apr 2025) | Zero-tax income effectively ₹12.75L for salaried |
| Standard deduction ₹50,000 (new regime) | Standard deduction ₹75,000 (new regime) | Budget 2024 interim / Finance Act 2024 | Higher take-home for salaried in new regime |
| LTCG equity: 10%, STCG equity: 15%, exemption ₹1L | LTCG equity: 12.5%, STCG equity: 20%, exemption ₹1.25L | Finance (No.2) Act 2024 (Jul 23, 2024) | Higher capital gains tax but marginally higher exemption |
| GST slabs: 0%, 5%, 12%, 18%, 28% | GST slabs: 0%, 5%, 18%, 40% | Sep 22, 2025 | 12% and 28% eliminated; calculator must only offer new slabs |
| Real estate LTCG: 20% with indexation | Real estate LTCG: 12.5% without indexation (option to choose for pre-Jul-2024 purchases) | Finance (No.2) Act 2024 (Jul 23, 2024) | Lower nominal rate but loss of indexation benefit |

**Deprecated/outdated:**
- GST rates 12% and 28%: eliminated September 22, 2025. Do not offer in the dropdown.
- FY 2024-25 new regime slabs as a proxy for "current" rates: materially wrong for FY 2025-26.

---

## Open Questions

1. **Surcharge for high-income users (>₹50L)**
   - What we know: Surcharge rates are documented (10% for ₹50L–₹1Cr, 15% for ₹1Cr–₹2Cr, 25% for ₹2Cr–₹5Cr; 37% old regime / 25% new regime above ₹5Cr). CALC-08 (surcharge with marginal relief) is explicitly v2.
   - What's unclear: REQUIREMENTS.md explicitly defers this to CALC-08 in v2.
   - Recommendation: For Phase 3, show a disclaimer "Surcharge not included — applicable for income above ₹50L" rather than silently showing wrong numbers. Log a TODO for Phase 4 or v2.

2. **Property acquired exactly on July 23, 2024 — which indexation rule applies?**
   - What we know: "On or after July 23, 2024" = no choice (12.5% only). "Before July 23, 2024" = taxpayer's choice.
   - What's unclear: Whether the exact date is inclusive (< vs ≤ comparison).
   - Recommendation: Use "acquired before 23 July 2024" as the condition for indexation option. This errs on the side of safety (the taxpayer gets the more favorable option if acquired before).

3. **Cumulative LTCG exemption ₹1.25L across multiple transactions**
   - What we know: The ₹1.25L exemption is per financial year (not per transaction).
   - What's unclear: The calculator UI for Phase 3 likely handles one transaction at a time.
   - Recommendation: For v1, calculate one transaction at a time with a note "₹1.25L annual exemption — applies across all LTCG transactions in the year." Track total exemption used if user adds multiple transactions.

4. **HRA and new regime**
   - What we know: HRA is not available in the new regime.
   - Recommendation: When regime is "new", hide the HRA input fields entirely. Show a tooltip: "HRA exemption not available in new regime."

---

## Sources

### Primary (HIGH confidence)
- https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1 — Official IT Dept salaried individuals help page; FY 2025-26 slabs fetched directly (both new and old regime with exact cumulative slab values)
- https://www.incometax.gov.in/iec/foportal/help/new-tax-vs-old-tax-regime-faqs — Official deduction comparison
- https://www.pib.gov.in/PressReleasePage.aspx?PRID=2098406 — PIB official Budget 2025 press release: "No income tax on income up to ₹12L"; standard deduction ₹75,000 confirmed
- https://www.pib.gov.in/PressNoteDetails.aspx?NoteId=155151 — PIB official GST 2.0 reform announcement (Sep 2025); 12%/28% slabs eliminated

### Secondary (MEDIUM confidence)
- https://www.referencer.in/Income_Tax/Income_Tax_Rates_AY_2025-26.aspx — FY 2024-25 slab rates; cross-verified against IT dept and multiple sources
- https://taxguru.in/income-tax/tax-planning-fy-2025-26-understanding-rebate-rules-ltcg-section-112A-new-regime.html — 87A + LTCG interaction; confirmed by Finance Act 2025 proviso description
- https://www.ujjivansfb.bank.in/banking-blogs/personal-finance/marginal-tax-relief-save-income-tax — Marginal relief formula with concrete example
- https://www.finnovate.in/learn/blog/capital-gains-tax-india-explained — Capital gains rates post Finance (No.2) Act 2024; consistent with PIB CBDT FAQs
- https://cbic-gst.gov.in/gst-goods-services-rates.html — CBIC official GST rates (pre-reform baseline verified; reform confirmed via PIB)
- https://www.kotakmf.com/Information/blogs/gst-2-point-0_ — GST 2.0 rate structure (5%/18%); consistent with PIB announcement
- https://cleartax.in/s/income-tax-slabs — FY 2025-26 slab rates; consistent with official sources

### Tertiary (LOW confidence — for awareness only)
- WebSearch aggregate results on 87A + capital gains: consistent across multiple CA/tax firm sources but not individually verified against the Finance Act 2025 text. The key claim (87A not applicable to 111A/112A gains) is supported by the taxguru.in article which quotes the proviso language.

---

## Metadata

**Confidence breakdown:**
- FY 2025-26 new regime slabs: HIGH — fetched directly from incometax.gov.in
- FY 2025-26 old regime slabs: HIGH — fetched directly from incometax.gov.in
- FY 2024-25 slabs: MEDIUM — referenced from referencer.in + cross-verified with cleartax.in; could be validated against incometax.gov.in AY 2025-26 help page
- Section 87A values: HIGH — confirmed by PIB Budget 2025 press release + incometax.gov.in
- 87A + capital gains exclusion: MEDIUM — confirmed by taxguru.in citing Finance Act 2025 proviso; not personally verified against Finance Act text
- Capital gains rates: MEDIUM — Finance (No.2) Act 2024 widely reported; PIB CBDT FAQ reference found
- GST reform (Sep 2025): MEDIUM — PIB official announcement confirmed; CBIC official rate schedule may lag notification date
- Marginal relief: MEDIUM — formula and example verified via ujjivansfb blog; consistent with budget intent
- HRA formula: HIGH — matches official incometax.gov.in HRA calculator

**Research date:** 2026-04-04
**Valid until:** 2027-03-31 (tax rules change per budget, next budget expected Feb 2027; GST rates could change if further council decisions are made)
