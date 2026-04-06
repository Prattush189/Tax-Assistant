# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-04)

**Core value:** Users get accurate, visual, step-by-step answers to Indian tax questions — from simple queries to complex calculations with document analysis.
**Current focus:** Phase 6 complete — all PLUG requirements delivered

## Current Position

Phase: 6 of 6 (iFrame Plugin Mode Hardening)
Plan: 2 of 2 in current phase (06-02 complete — ALL PLANS DONE)
Status: Phase 6 complete — PLUG-01 through PLUG-04 all implemented and hardened
Last activity: 2026-04-04 — Plan 06-02 complete: responsive 400px fixes (overflow-x-auto, grid-cols-1 sm:grid-cols-2); Phase 6 and full project roadmap done

Progress: [███████████████] 100% (all 6 phases complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01-express-backend-api-key-migration P03 | 2 | 2 tasks | 4 files |
| Phase 02-component-architecture P02 | 8 | 2 tasks | 3 files |
| Phase 03-tax-calculator P01 | 2 | 2 tasks | 5 files |
| Phase 04-enhanced-visualizations-dashboard P01 | 3 | 2 tasks | 3 files |
| Phase 04-enhanced-visualizations-dashboard P03 | 1 | 2 tasks | 3 files |
| Phase 05-document-handling P01 | 15 | 2 tasks | 2 files |
| Phase 05-document-handling P02 | 2 | 1 tasks | 1 files |
| Phase 05-document-handling P03 | 8 | 2 tasks | 2 files |
| Phase 06-iframe-plugin-mode-hardening P01 | 2 | 2 tasks | 4 files |
| Phase 06-iframe-plugin-mode-hardening P02 | 8 | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: Express backend before any feature work — API key must leave client bundle first
- Roadmap: Architecture refactor (Phase 2) before new features — prevents monolith from becoming unmanageable
- Roadmap: Tax calculator (Phase 3) is client-side only — no new backend dependencies needed
- Roadmap: Dashboard (Phase 4) builds on stable calculator output — charts with real data only
- 01-01: Port 4001 chosen to avoid common port conflicts on shared hosting (MySQL :3306, dev :3000/:4000, Nginx :8080)
- 01-01: server/tsconfig.json uses Node16 moduleResolution; root tsconfig preserved for Vite (bundler resolution)
- 01-01: CSP frameAncestors wildcard initially; tighten to specific embedding domain in Phase 6
- [Phase 01-03]: multer memoryStorage chosen so Phase 5 can forward buffer directly to Gemini Files API without disk temp files
- [Phase 01-03]: vite.config.ts converted to plain object after removing define block - loadEnv no longer needed since no client env vars remain
- [Phase 01-03]: concurrently --kill-others-on-fail used so dev environment fails fast if either Vite or Express crashes
- [Phase 01-04]: ecosystem.config.cjs uses .cjs extension because PM2 uses CommonJS require() even in ESM projects
- [Phase 01-04]: GEMINI_API_KEY excluded from ecosystem.config.cjs — must be in server .env only
- [Phase 01-04]: Apache ProxyPass scoped to /api/* only; static files served via DocumentRoot dist/
- [Phase 02-01]: api.ts uses callbacks (onChunk/onError) rather than React state — service layer stays framework-agnostic
- [Phase 02-01]: SSE buffer accumulation (decoder stream:true + lines.pop()) copied verbatim from App.tsx — must not be simplified
- [Phase 02-01]: HistoryItem conversion placed in api.ts — server API contract knowledge belongs in service layer
- [Phase 02-02]: clearChat excludes window.confirm — confirmation is UI concern, hook simply resets state
- [Phase 02-02]: chatContainerRef excluded from useChat — dead code in App.tsx (assigned but never read)
- [Phase 02-03]: ChatView owns useChat() call internally — chat state does not flow through props from App.tsx, keeping concerns separated
- [Phase 02-03]: renderContent kept as unexported local function in MessageBubble — implementation detail, not a public API
- [Phase 02-03]: Quick query buttons in empty state call setInput only (no immediate send) — matches App.tsx chat area behavior
- [Phase 02-03]: COLORS constant kept local to ChartRenderer — chart-specific palette does not belong in shared module
- [Phase 02-04]: quickQueries defined as local constant in Sidebar — not a prop (matches App.tsx pattern, sidebar owns its own quick query list)
- [Phase 02-04]: Tab navigation placed in Header with border-b-2 active styling; hidden in plugin mode to keep plugin embed clean
- [Phase 02-04]: App.tsx reduced to 58-line thin shell — only useTheme/usePluginMode hooks, activeView/isSidebarOpen state, layout composition
- [Phase 03-01]: FY data files are plain TypeScript constants type-checked by TaxRules interface — zero runtime parsing
- [Phase 03-01]: Infinity sentinel in Slab.upTo — uniform engine loop, no special-case for top slab
- [Phase 03-01]: getTaxRules() throws on unknown FY — hard error prevents silent miscalculation
- [Phase 03-02]: 87A rebate isolated to taxEngine.ts — capitalGainsEngine.ts has zero rebate logic (s.111A/s.112A gains cannot benefit from 87A)
- [Phase 03-02]: Marginal relief = max(0, slabTax - excessAboveThreshold) — smooth cliff prevention for any income value
- [Phase 03-02]: HRA base = basic+DA not gross salary — documented in function comment to prevent regression
- [Phase 03-02]: GST validates against [0, 0.25, 3, 5, 18, 40] — 12% and 28% eliminated Sep 2025
- [Phase 03-02]: Real estate indexation exposes both branches with recommendedOption for lower tax
- [Phase 03-03]: IncomeTaxTab calls calculateIncomeTax twice in one useMemo — old and new regime always computed together
- [Phase 03-03]: RegimeComparison is a pure display component receiving oldResult/newResult props — zero calculation logic
- [Phase 03-03]: GstTab renders only [0, 5, 18, 40] standard + [3, 0.25] special rate buttons — no 12% or 28% UI options
- [Phase 03-03]: CapitalGainsTab passes indexedCost || purchasePrice to engine — safe fallback when indexation checkbox checked but field empty
- [Phase 04-01]: TaxCalculatorProvider wraps <main> not just CalculatorView — ensures DashboardView can call useTaxCalculator() without throwing
- [Phase 04-01]: setDeductions/setHra typed as React.Dispatch<SetStateAction<T>> so functional updater pattern in IncomeTaxTab works unchanged
- [Phase 04-02]: renderChart() switch replaces ternary in ChartRenderer — open to new chart types with a new case, no restructuring needed
- [Phase 04-02]: line type defaults to ['value'] key if chartData.lines absent — consistent with bar chart's hardcoded 'value'
- [Phase 04-02]: composed uses i+3 color offset for line series — avoids color collision with bar series in same chart
- [Phase 04-03]: Waterfall uses stacked BarChart with transparent spacer bar and Cell-per-entry fill — verified pattern from RESEARCH.md
- [Phase 04-03]: DashboardView is purely derived from context reads (no new state/useEffect) — all tax data flows from TaxCalculatorContext
- [Phase 04-03]: RegimeComparison reused in DashboardView for VIZ-04 slab-by-slab table — no duplicate implementation
- [Phase 05-01]: Buffer-to-Blob wrapping: ai.files.upload() accepts Blob not raw Buffer — new Blob([req.file.buffer]) is mandatory
- [Phase 05-01]: fileUri NOT deleted after summary: DOC-02 follow-up chat requires the URI; React state is the session boundary per DOC-04
- [Phase 05-01]: Markdown fence stripping added before JSON.parse on Gemini extraction responses to prevent silent parse failures
- [Phase 05-02]: Use SDK Part type for messageParts array — avoids type incompatibility with FileData.fileUri being optional in @google/genai SDK types
- [Phase 05-02]: File part injected only into current message parts, not into chat history — prevents sending same PDF reference N times per multi-turn conversation
- [Phase 05-03]: activeDocument stored in React useState only — never written to localStorage or sessionStorage (DOC-04 requirement enforced)
- [Phase 05-03]: fileContext param shape is { uri: string; mimeType: string } rather than DocumentContext — keeps service layer framework-agnostic per Phase 02-01 pattern
- [Phase 05-04]: useChat lifted to App.tsx as single chatHook instance — ChatView receives it as prop to prevent dual-instance document context split where DocumentsView attach wouldn't flow to ChatView send
- [Phase 05-04]: ChatView accepts chatHook: ReturnType<typeof useChat> prop — type-safe approach without prop drilling individual values
- [Phase 05-04]: ChatInput textarea gets rounded-t-none when activeDocument badge shown — badge and textarea join visually as single connected element
- [Phase 06-01]: usePluginMode accepts onSetTheme? callback rather than importing useTheme internally — avoids dual theme state and keeps hook composable
- [Phase 06-01]: TAX_ASSISTANT_READY sent before ResizeObserver fires — parent can register listener before height messages begin
- [Phase 06-01]: postMessage targetOrigin is always PARENT_ORIGIN constant, never '*' — prevents any page from intercepting height messages
- [Phase 06-01]: frameAncestors env-conditional: production locks to ai.smartbizin.com; dev allows localhost:3000 and localhost:5173
- [Phase 06-02]: overflow-x-auto applied globally (not isPluginMode conditional) — responsive behavior benefits all users
- [Phase 06-02]: TaxSummaryCards grid-cols-2 changed to grid-cols-1 sm:grid-cols-2 so cards stack at 400px rather than squeeze

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 3: FY 2025-26 tax slab values and 87A rebate threshold RESOLVED — verified and coded in 03-01 (Finance Act 2025 confirmed)
- Phase 5: Gemini Files API behavior for password-protected Form 16 PDFs (TRACES format) is LOW confidence — test before planning tasks
- Phase 6: Smart Assist postMessage contract (origin domain, event types, data shapes) not yet confirmed with Smart Assist team — gate Phase 6 planning on this input

## Session Continuity

Last session: 2026-04-04
Stopped at: Completed 06-02-PLAN.md — responsive 400px layout fixes for plugin iframe mode; Phase 6 and full roadmap complete
Resume file: None — all plans complete
