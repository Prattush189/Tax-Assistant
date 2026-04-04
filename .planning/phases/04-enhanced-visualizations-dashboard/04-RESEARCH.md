# Phase 4: Enhanced Visualizations + Dashboard - Research

**Researched:** 2026-04-04
**Domain:** Recharts 3.x chart extensions + React dashboard composition
**Confidence:** HIGH

## Summary

Phase 4 builds on a solid recharts foundation already in the project (v3.8.1 installed) and a largely-complete RegimeComparison component from Phase 3. The primary new work is: (1) a waterfall chart for the income-to-tax flow, (2) additional AI chat chart types (line, stacked bar, composed), and (3) a DashboardView that orchestrates the existing IncomeTaxTab results into visual cards and charts. VIZ-04 (slab-by-slab regime comparison) is already implemented in RegimeComparison.tsx — confirmed by inspecting the slabBreakdown rendering code. Planning must not re-implement it.

The project uses recharts 3.8.1. Version 3.x introduced breaking changes from 2.x: `CategoricalChartState` is gone from event handlers, `activeIndex` prop removed from Bar/Pie/Scatter, Tooltip content type is now `TooltipContentProps` (not `TooltipProps`), and CartesianGrid requires explicit `xAxisId`/`yAxisId` when non-default axes are used. The existing ChartRenderer.tsx uses the older pattern but is compatible since it does not rely on any removed internals. All new chart code must be written for the v3 API.

The most architecturally significant decision is how the Dashboard gets its data. Currently the calculator state (grossSalary, deductions, results) lives entirely inside IncomeTaxTab local state. The Dashboard needs the same `IncomeTaxResult` to drive charts. Options are: (a) lift IncomeTaxTab state to CalculatorView or App level, (b) a React context shared between Calculator and Dashboard, or (c) duplicate inputs on the Dashboard. Option (b) — a `TaxCalculatorContext` — is the right call: it avoids prop-drilling through App.tsx, keeps DashboardView self-contained, and allows IncomeTaxTab to remain unchanged except for sourcing state from context instead of local useState.

**Primary recommendation:** Introduce a `TaxCalculatorContext` that holds the income tax input form state and both regime results. IncomeTaxTab writes to it; DashboardView reads from it. All new charts are new recharts components inside the existing `recharts` 3.8.1 package — no new npm dependencies.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VIZ-01 | User sees waterfall chart showing income → deductions → taxable income → tax flow | Recharts BarChart with stackId + transparent fill pattern; data transforms from IncomeTaxResult fields |
| VIZ-02 | User sees additional chart types (line, stacked bar, composed) in AI chat responses | ChartRenderer.tsx switch-case extension; recharts LineChart, StackedBarChart (Bar with stackId), ComposedChart all available in v3.8.1 |
| VIZ-03 | User can view an interactive tax dashboard summarizing income breakdown, tax liability, deductions, and regime comparison | DashboardView replacement; consumes TaxCalculatorContext for IncomeTaxResult; uses PieChart, BarChart, stat cards |
| VIZ-04 | Regime comparison displayed as rich side-by-side table with slab-by-slab breakdown | ALREADY IMPLEMENTED in RegimeComparison.tsx — full slab breakdown + rebate + cess + winner badge. Planner must NOT re-implement. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | 3.8.1 (already installed) | All chart types: Bar, Line, Pie, Area, ComposedChart | Already in project, v3 API is stable, no new install needed |
| react | 19.0.0 (already installed) | Context API for shared calculator state | Already in project |
| lucide-react | 0.546.0 (already installed) | Icons for dashboard stat cards | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tailwind-merge + clsx | already installed | Conditional class names | All new components |
| React.createContext | built-in | TaxCalculatorContext for sharing calculator state | Dashboard ↔ Calculator data sharing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TaxCalculatorContext | Prop drilling through App.tsx | App.tsx must stay thin (58-line shell per Phase 2 decision); prop drilling violates this |
| TaxCalculatorContext | Zustand/Redux | Overkill — state is local to two sibling views, no persistence needed |
| Recharts waterfall via BarChart | D3 custom | D3 adds 100KB+ and requires SVG manual positioning; recharts stacked bar achieves waterfall in ~40 lines |

**Installation:** No new packages required. All capabilities are within the existing recharts 3.8.1 install.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── contexts/
│   └── TaxCalculatorContext.tsx   # New: shared income tax state + results
├── components/
│   ├── calculator/
│   │   ├── IncomeTaxTab.tsx        # Modified: reads/writes TaxCalculatorContext
│   │   ├── RegimeComparison.tsx    # Unchanged (VIZ-04 already done)
│   │   └── ...other tabs unchanged
│   ├── dashboard/
│   │   ├── DashboardView.tsx       # Replaced: full implementation
│   │   ├── TaxWaterfallChart.tsx   # New: VIZ-01 waterfall
│   │   └── TaxSummaryCards.tsx     # New: stat cards for VIZ-03
│   └── chat/
│       └── ChartRenderer.tsx       # Modified: add line/stacked-bar/composed cases
```

### Pattern 1: TaxCalculatorContext

**What:** React context that holds IncomeTaxTab form state (grossSalary, deductions, hra, fy, ageCategory) and the computed `{ oldResult, newResult }`. IncomeTaxTab calls `useTaxCalculator()` to read/write; DashboardView calls `useTaxCalculator()` to read results.

**When to use:** When two sibling views in the same App shell need to share state without routing or prop-drilling through the parent.

**Example:**
```typescript
// src/contexts/TaxCalculatorContext.tsx
import { createContext, useContext, useState, useMemo } from 'react';
import { calculateIncomeTax } from '../lib/taxEngine';
import { getTaxRules } from '../data/taxRules';
import type { IncomeTaxResult } from '../lib/taxEngine';
import type { AgeCategory } from '../types';

interface TaxCalculatorState {
  fy: '2025-26' | '2024-25';
  grossSalary: string;
  otherIncome: string;
  ageCategory: AgeCategory;
  // ... deductions, hra fields
  oldResult: IncomeTaxResult;
  newResult: IncomeTaxResult;
  // setters
  setFy: (fy: '2025-26' | '2024-25') => void;
  setGrossSalary: (v: string) => void;
  // ...
}

const TaxCalculatorContext = createContext<TaxCalculatorState | null>(null);

export function TaxCalculatorProvider({ children }: { children: React.ReactNode }) {
  const [fy, setFy] = useState<'2025-26' | '2024-25'>('2025-26');
  const [grossSalary, setGrossSalary] = useState('');
  // ... other state

  const { oldResult, newResult } = useMemo(() => {
    // Same useMemo logic currently in IncomeTaxTab
    const rules = getTaxRules(fy);
    // ...
    return { oldResult, newResult };
  }, [fy, grossSalary, /* ... */]);

  return (
    <TaxCalculatorContext.Provider value={{ fy, grossSalary, oldResult, newResult, setFy, setGrossSalary }}>
      {children}
    </TaxCalculatorContext.Provider>
  );
}

export function useTaxCalculator() {
  const ctx = useContext(TaxCalculatorContext);
  if (!ctx) throw new Error('useTaxCalculator must be inside TaxCalculatorProvider');
  return ctx;
}
```

### Pattern 2: Waterfall Chart via Stacked BarChart

**What:** Recharts has no native waterfall chart. The standard workaround uses a BarChart with two Bar components sharing `stackId="a"`: one with `fill="transparent"` (invisible spacer) and one with the actual color. Each bar's spacer height = running total before that item.

**When to use:** Any waterfall/bridge chart in recharts — income flow, budget variance, etc.

**Example:**
```typescript
// src/components/dashboard/TaxWaterfallChart.tsx
// Source: recharts official stacked bar pattern + waterfall adaptation
// https://medium.com/2359media/tutorial-how-to-create-a-waterfall-chart-in-recharts-15a0e980d4b

interface WaterfallEntry {
  name: string;
  spacer: number;   // transparent offset — cumulative running total before this bar
  value: number;    // visible bar height (positive = income, negative = deduction)
  fill: string;     // color: green=income, red=deduction/tax, orange=total
}

function buildWaterfallData(result: IncomeTaxResult): WaterfallEntry[] {
  // VIZ-01: income → deductions → taxable income → tax
  return [
    { name: 'Gross Income', spacer: 0, value: result.grossIncome, fill: '#10b981' },
    { name: 'Deductions',   spacer: result.grossIncome - result.totalDeductions, value: result.totalDeductions, fill: '#f43f5e' },
    { name: 'Taxable Income', spacer: 0, value: result.taxableIncome, fill: '#6366f1' },
    { name: 'Tax Payable',  spacer: result.taxableIncome - result.totalTax, value: result.totalTax, fill: '#f97316' },
  ];
}

// In JSX:
<BarChart data={buildWaterfallData(result)}>
  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
  <XAxis dataKey="name" fontSize={12} />
  <YAxis tickFormatter={(v) => `₹${(v/100000).toFixed(1)}L`} fontSize={11} />
  <Tooltip formatter={(v: number) => formatINR(v)} />
  <Bar dataKey="spacer" stackId="a" fill="transparent" />
  <Bar dataKey="value"  stackId="a" radius={[4, 4, 0, 0]}>
    {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
  </Bar>
</BarChart>
```

**Critical note on recharts 3.x:** `Cell` is still the correct way to apply per-bar fill colors inside a `Bar`. The `fill` prop on `Cell` is unchanged in v3.

### Pattern 3: ChartRenderer Extension (VIZ-02)

**What:** Extend the `type` switch in ChartRenderer.tsx to handle `line`, `stacked-bar`, and `composed` chart types sent by the AI in `json-chart` blocks.

**When to use:** When the AI model needs to render richer time-series or comparison charts inline in chat.

**Example:**
```typescript
// Additions to ChartRenderer.tsx switch-case

// type === 'line'
<LineChart data={data}>
  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
  <XAxis dataKey="name" fontSize={12} stroke="#94a3b8" />
  <YAxis fontSize={12} stroke="#94a3b8" />
  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }} />
  <Legend />
  {(chartData.lines || ['value']).map((key: string, i: number) => (
    <Line key={key} type="monotone" dataKey={key} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
  ))}
</LineChart>

// type === 'stacked-bar'  — data objects have multiple value keys
<BarChart data={data}>
  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
  <XAxis dataKey="name" fontSize={12} stroke="#94a3b8" />
  <YAxis fontSize={12} stroke="#94a3b8" />
  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }} />
  <Legend />
  {(chartData.keys || ['value']).map((key: string, i: number) => (
    <Bar key={key} dataKey={key} stackId="a" fill={COLORS[i % COLORS.length]} />
  ))}
</BarChart>

// type === 'composed'  — AI can mix bar + line
<ComposedChart data={data}>
  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
  <XAxis dataKey="name" fontSize={12} stroke="#94a3b8" />
  <YAxis fontSize={12} stroke="#94a3b8" />
  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }} />
  <Legend />
  {(chartData.bars || []).map((key: string, i: number) => (
    <Bar key={key} dataKey={key} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
  ))}
  {(chartData.lines || []).map((key: string, i: number) => (
    <Line key={key} type="monotone" dataKey={key} stroke={COLORS[(i + 3) % COLORS.length]} strokeWidth={2} dot={false} />
  ))}
</ComposedChart>
```

**JSON shape the AI must emit for new chart types:**
```json
{
  "type": "line",
  "title": "Effective Tax Rate by Income",
  "data": [{"name": "5L", "rate": 0}, {"name": "10L", "rate": 8.5}],
  "lines": ["rate"]
}

{
  "type": "stacked-bar",
  "title": "Deductions Breakdown",
  "data": [{"name": "80C", "used": 150000, "remaining": 0}],
  "keys": ["used", "remaining"]
}

{
  "type": "composed",
  "title": "Income vs Tax",
  "data": [{"name": "FY24", "income": 1200000, "tax": 97500}],
  "bars": ["income"],
  "lines": ["tax"]
}
```

### Pattern 4: Dashboard Layout (VIZ-03)

**What:** DashboardView renders stat cards at the top, then a waterfall chart, then a donut breakdown of income components, reusing RegimeComparison for the slab table (VIZ-04).

**When to use:** When the user has entered data in the calculator tab — dashboard shows an empty state prompt if grossSalary is 0.

**Rough structure:**
```typescript
export function DashboardView() {
  const { oldResult, newResult, grossSalary } = useTaxCalculator();

  if (!Number(grossSalary)) {
    return <EmptyState message="Enter your income in the Calculator tab to see your dashboard." />;
  }

  const betterResult = newResult.totalTax <= oldResult.totalTax ? newResult : oldResult;

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <TaxSummaryCards result={betterResult} />
      <TaxWaterfallChart result={betterResult} className="mt-6" />
      <IncomeBreakdownPie result={betterResult} className="mt-6" />
      {/* VIZ-04 already done — reuse existing component */}
      <RegimeComparison oldResult={oldResult} newResult={newResult} fy={fy} />
    </div>
  );
}
```

### Anti-Patterns to Avoid

- **Duplicating IncomeTaxTab state in DashboardView:** Leads to drift — user changes calculator, dashboard shows stale data. Use context instead.
- **Re-implementing RegimeComparison for dashboard:** It already shows slab-by-slab with winner badge. Reuse it — mounting it in DashboardView is the only task needed for VIZ-04.
- **Using recharts 2.x API patterns:** The project has v3.8.1. Do not use `CategoricalChartState`, `activeIndex` prop on Bar, or `TooltipProps` (use `TooltipContentProps`).
- **Multiple YAxis without explicit yAxisId on CartesianGrid:** In v3, CartesianGrid will fail to render grid lines unless `yAxisId` matches the axis ID.
- **Adding new npm packages for charts:** recharts 3.8.1 already provides all required chart types (Line, Bar, Pie, ComposedChart, Area, Cell).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Waterfall chart floating bars | Custom SVG positioning | recharts BarChart + `stackId` + transparent `fill` on spacer Bar | SVG math for floating bars is error-prone; recharts handles layout automatically |
| INR currency formatting | New formatter function | Existing `formatINR` from `src/lib/utils` | Already exists, already tested against Indian formatting |
| Responsive chart container | Custom resize observer | recharts `ResponsiveContainer` | Already used in ChartRenderer.tsx; handles window resize, no extra code |
| Regime slab table | New table component | Existing `RegimeComparison` component | Already complete, already handles all display edge cases |
| Dark mode chart colors | CSS variables or theme detection | Hardcoded hex values matching existing COLORS constant | ChartRenderer already has the working dark-mode tooltip style; copy the pattern |

**Key insight:** The chart rendering infrastructure is already built. Phase 4 extends it, not replaces it.

## Common Pitfalls

### Pitfall 1: Recharts 3.x Breaking Changes Applied Incorrectly
**What goes wrong:** Copying recharts 2.x code examples from the web (pre-2024) — most tutorials still show 2.x patterns.
**Why it happens:** Recharts 3.0 was released in 2024; most SEO-ranking tutorials predate it.
**How to avoid:** Check the project's recharts version (`"recharts": "^3.8.1"` in package.json) and write for v3. Key differences: no `CategoricalChartState`, no `activeIndex` prop on Bar, Tooltip type is `TooltipContentProps`.
**Warning signs:** TypeScript errors about missing props, `activeIndex` type errors, Tooltip custom content type mismatch.

### Pitfall 2: Waterfall Spacer Calculation Off-By-One
**What goes wrong:** The transparent spacer bar makes the visible bar float at the wrong height.
**Why it happens:** The spacer for each segment must equal the cumulative running total *before* that segment, not the total *including* it.
**How to avoid:** Use the pattern: `spacer[i] = sum of all previous visible values (accounting for sign)`. Test with known values from taxEngine test cases (e.g., ₹15L → grossIncome=15L, deductions=75K, taxable=14.25L, tax=97.5K).
**Warning signs:** Bars float above where they should, or visible bar extends below zero.

### Pitfall 3: Dashboard Empty State Not Handled
**What goes wrong:** DashboardView renders with default zero-value IncomeTaxResult, showing charts full of zeros.
**Why it happens:** TaxCalculatorContext initializes with empty strings for salary fields; results default to zeros.
**How to avoid:** Check `grossSalary === ''` or `Number(grossSalary) === 0` and render an empty state prompt directing user to the Calculator tab.
**Warning signs:** Dashboard shows "₹0" everywhere with no prompt to enter data.

### Pitfall 4: TaxCalculatorProvider Placement
**What goes wrong:** Provider wraps only CalculatorView, so DashboardView cannot access context.
**Why it happens:** Instinct to co-locate provider with its primary consumer.
**How to avoid:** Mount `TaxCalculatorProvider` in App.tsx wrapping both `CalculatorView` and `DashboardView`, or wrap the entire `<main>` element.
**Warning signs:** `useTaxCalculator()` throws "must be inside TaxCalculatorProvider" at runtime.

### Pitfall 5: ChartRenderer json-chart Schema Not Updated in System Prompt
**What goes wrong:** New chart types (line, stacked-bar, composed) render nothing because the AI sends old `type: "bar"` or `type: "pie"` for all charts.
**Why it happens:** The server-side system prompt still only mentions `bar` and `pie` as valid chart types.
**How to avoid:** Update the Gemini system prompt in `server/index.ts` to document `line`, `stacked-bar`, and `composed` types including their extra fields (`lines`, `keys`, `bars`).
**Warning signs:** AI chat never produces line or composed charts despite having the renderer.

## Code Examples

Verified patterns from official recharts and project sources:

### Waterfall Data Transform from IncomeTaxResult
```typescript
// Source: recharts stacked bar pattern verified against
// https://recharts.github.io/en-US/api/Bar (stackId prop)
// + waterfall adaptation from https://medium.com/2359media/tutorial-how-to-create-a-waterfall-chart-in-recharts-15a0e980d4b

import type { IncomeTaxResult } from '../../lib/taxEngine';

interface WaterfallEntry {
  name: string;
  spacer: number;
  value: number;
  fill: string;
}

export function buildWaterfallData(result: IncomeTaxResult): WaterfallEntry[] {
  return [
    {
      name: 'Gross Income',
      spacer: 0,
      value: result.grossIncome,
      fill: '#10b981', // green
    },
    {
      name: 'Deductions',
      // spacer: starts where deductions begin (at taxable income level from top, reading left-to-right)
      // For waterfall: spacer = position where the bar's bottom sits
      // Deductions bar shows the reduction, so spacer = taxableIncome (the bottom of the deduction band)
      spacer: result.taxableIncome,
      value: result.totalDeductions,
      fill: '#f43f5e', // red
    },
    {
      name: 'Taxable Income',
      spacer: 0,
      value: result.taxableIncome,
      fill: '#6366f1', // indigo
    },
    {
      name: 'Tax + Cess',
      spacer: result.taxableIncome - result.totalTax,
      value: result.totalTax,
      fill: '#f97316', // orange
    },
  ];
}
```

### LineChart (new chart type for ChartRenderer)
```typescript
// Source: recharts official docs https://recharts.github.io/en-US/api/LineChart/
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Inside ChartRenderer switch, type === 'line':
<LineChart data={data}>
  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
  <XAxis dataKey="name" fontSize={12} stroke="#94a3b8" />
  <YAxis fontSize={12} stroke="#94a3b8" />
  <Tooltip
    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
    itemStyle={{ color: '#fff' }}
  />
  <Legend />
  {(chartData.lines ?? ['value']).map((key: string, i: number) => (
    <Line key={key} type="monotone" dataKey={key} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
  ))}
</LineChart>
```

### ComposedChart (new chart type for ChartRenderer)
```typescript
// Source: recharts official docs https://recharts.github.io/en-US/api/ComposedChart/
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Inside ChartRenderer switch, type === 'composed':
<ComposedChart data={data}>
  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
  <XAxis dataKey="name" fontSize={12} stroke="#94a3b8" />
  <YAxis fontSize={12} stroke="#94a3b8" />
  <Tooltip
    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
    itemStyle={{ color: '#fff' }}
  />
  <Legend />
  {(chartData.bars ?? []).map((key: string, i: number) => (
    <Bar key={key} dataKey={key} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
  ))}
  {(chartData.lines ?? []).map((key: string, i: number) => (
    <Line key={key} type="monotone" dataKey={key} stroke={COLORS[(i + 3) % COLORS.length]} strokeWidth={2} dot={false} />
  ))}
</ComposedChart>
```

### Stacked Bar (new chart type for ChartRenderer)
```typescript
// Inside ChartRenderer switch, type === 'stacked-bar':
<BarChart data={data}>
  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
  <XAxis dataKey="name" fontSize={12} stroke="#94a3b8" />
  <YAxis fontSize={12} stroke="#94a3b8" />
  <Tooltip
    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
    itemStyle={{ color: '#fff' }}
  />
  <Legend />
  {(chartData.keys ?? ['value']).map((key: string, i: number) => (
    <Bar key={key} dataKey={key} stackId="a" fill={COLORS[i % COLORS.length]} />
  ))}
</BarChart>
```

### Existing Pattern to Preserve (ChartRenderer tooltip style)
```typescript
// Source: src/components/chat/ChartRenderer.tsx (project codebase)
// All new chart types MUST reuse this exact tooltip style for visual consistency:
contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
itemStyle={{ color: '#fff' }}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| recharts `CategoricalChartState` in event handlers | Hooks (`useActiveTooltipLabel` etc.) | recharts 3.0 (2024) | Cannot pass internal state via Customized component |
| `TooltipProps` for custom tooltip typing | `TooltipContentProps` | recharts 3.0 (2024) | Type import must change if building custom tooltips |
| `activeIndex` prop on Bar/Pie | Cell-level `isActive` prop from callback | recharts 3.0 (2024) | Pie active sectors work differently |
| `react-smooth` dependency (recharts animation) | Built-in animation, no external dep | recharts 3.0 (2024) | Fewer transitive deps; no action needed |
| CartesianGrid renders on default axis only | Must specify `xAxisId`/`yAxisId` when non-default | recharts 3.0 (2024) | Multi-axis charts need explicit IDs |
| ResponsiveContainer wrapper required | `responsive` prop available as alternative | recharts 3.x | ResponsiveContainer still works; no change needed |

**Deprecated/outdated:**
- `<Customized />` component for accessing internal state: removed in v3 — use hooks instead.
- `recharts-scale` and `react-smooth` as separate imports: removed; now internal to recharts.

## VIZ-04 Completeness Assessment

**CONFIRMED COMPLETE in Phase 3.** Inspecting `RegimeComparison.tsx`:

- Line 68-79: Renders `result.slabBreakdown` — every slab row with label and tax amount
- Line 83-108: Renders rebate87A, marginalRelief, cess, totalTax, effectiveRate
- Line 119-148: Side-by-side card layout with winner badge and savings banner
- Line 47-64: Income breakdown (gross, standard deduction, HRA, other deductions, taxable income)

VIZ-04 requirement "regime comparison displayed as rich side-by-side table with slab-by-slab breakdown" is fully satisfied. The only task needed is mounting this existing component inside DashboardView.

## Open Questions

1. **Should Dashboard show the better regime's waterfall or both regimes side by side?**
   - What we know: IncomeTaxResult has all fields needed for either approach; RegimeComparison already shows both side by side
   - What's unclear: User has not specified — "you decide" was stated
   - Recommendation: Show the better regime waterfall (reduces visual complexity) + the existing RegimeComparison below it for slab detail. This uses both charts purposefully.

2. **Should IncomeTaxTab inputs be duplicated in DashboardView or shared via context?**
   - What we know: Context is the correct architectural choice (see above)
   - What's unclear: Whether moving IncomeTaxTab state to context risks any Phase 3 regressions
   - Recommendation: The context provider wraps the existing components; IncomeTaxTab behaviour is identical from user perspective. Migration is mechanical: replace `const [grossSalary, setGrossSalary] = useState('')` with context reads. No regression risk.

3. **System prompt update scope for VIZ-02**
   - What we know: New chart types in ChartRenderer need corresponding AI instructions
   - What's unclear: Exact location of system prompt in server/index.ts was not read
   - Recommendation: Read server/index.ts in the planning task that covers VIZ-02 to find the system prompt location and add the new chart type documentation.

## Sources

### Primary (HIGH confidence)
- recharts official API — https://recharts.github.io/en-US/api/ComposedChart/ — ComposedChart props, compatible chart types
- recharts official API — https://recharts.github.io/en-US/api/LineChart/ — LineChart API
- recharts 3.0 migration guide — https://github.com/recharts/recharts/wiki/3.0-migration-guide — breaking changes
- Project codebase (read directly) — ChartRenderer.tsx, RegimeComparison.tsx, taxEngine.ts, package.json, all types

### Secondary (MEDIUM confidence)
- Waterfall pattern — https://medium.com/2359media/tutorial-how-to-create-a-waterfall-chart-in-recharts-15a0e980d4b — stackId + transparent fill technique (verified against recharts BarChart API)
- recharts 3.x release notes — https://github.com/recharts/recharts/releases/tag/v3.0.0 — version and feature list

### Tertiary (LOW confidence)
- None flagged.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — recharts 3.8.1 confirmed in package.json; all required chart types verified in official API docs
- Architecture: HIGH — TaxCalculatorContext pattern is standard React; RegimeComparison completeness verified by direct code inspection
- Pitfalls: HIGH (recharts breaking changes) / MEDIUM (waterfall data math) — v3 migration guide is official; waterfall math verified against the established pattern
- VIZ-04 status: HIGH — code inspected directly, slab breakdown confirmed present

**Research date:** 2026-04-04
**Valid until:** 2026-05-04 (recharts 3.x is stable; 30-day window reasonable)
