# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-08)

**Core value:** Users get accurate, visual, step-by-step answers to Indian tax questions — from simple queries to complex calculations with document analysis.
**Current focus:** Milestone v1.2 — UI Revamp (Premium Fintech Look)

## Current Position

Phase: 11 — Design System & Auth Pages
Plan: Not started
Status: Roadmap created, ready for planning
Last activity: 2026-04-08 — v1.2 roadmap created (phases 11-15)

```
v1.2 Progress: [░░░░░░░░░░░░░░░░░░░░] 0% — Phase 11 not started
Phase 11: [ ] Phase 12: [ ] Phase 13: [ ] Phase 14: [ ] Phase 15: [ ]
```

## Performance Metrics

**Velocity:**
- Total plans completed: 17 (v1.0 all phases)
- Average duration: -
- Total execution time: -

**By Phase (v1.1):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 7. RAG Infrastructure Fixes | TBD | - | - |
| 8. GST Act Data | 2 | 35min | 17.5min |
| 9. Reference Data | TBD | - | - |
| 10. Scoring & Integration Validation | TBD | - | - |

**Recent Trend:**
- Last 5 plans: v1.0 complete
- Trend: Beginning v1.1

*Updated after each plan completion*

**v1.0 Historical (reference):**
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
| Phase 07-rag-infrastructure-fixes P01 | 1 | 2 tasks | 1 files |
| Phase 07-rag-infrastructure-fixes P02 | 4 | 2 tasks | 1 files |
| Phase 09-reference-data P01 | 7 | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

**v1.0 decisions (preserved for reference):**
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

**v1.1 decisions (accumulate here during execution):**
- Roadmap: Phase 7 (infrastructure fixes) must precede all data phases — hardcoded three-bucket retrieval silently blocks any fourth source; schedule regex drops entire schedules as single unchunkable blobs
- Roadmap: CGST and IGST Act bundled in Phase 8 — logically paired, both needed for complete GST query chain
- Roadmap: Reference data (Phase 9) independent of GST data (Phase 8) but both require Phase 7 infrastructure
- Roadmap: Phase 10 is validation-only — no new data added; all regression testing after full corpus is loaded
- Data: BM25 libraries and embedding models explicitly rejected — marginal improvement does not justify 100MB+ dependency at current scale
- Data: Full CGST Rules 2017 deferred to v2 — ITC reversal rules create retrieval noise without dedicated query routing
- Data: HSN/SAC rate schedule deferred — too frequently amended, requires dedicated lookup UI
- Infrastructure: CGST PDF extraction quality is unknown until attempted — section-count validation gate (>150 chunks) is the early-warning check before writing chunker code
- [Phase 07-01]: Chunk.source changed from 3-value union to string — valid values come from SOURCE_CONFIGS.id
- [Phase 07-01]: retrieve() signature simplified to (query, topK) — reads from module-level chunkMap, no external callers
- [Phase 07-01]: comparison.txt boost retained at 1.5x via cfg.boost field in SourceConfig (not hardcoded)
- [Phase 07-01]: DEFAULT_TOP_K = 5 locked; new source registration requires only SOURCE_CONFIGS array entry
- [Phase 07-02]: Section regex applied only to Act body portion (before first SCHEDULE boundary) — eliminates 299 false matches in act-2025.txt schedule area
- [Phase 07-02]: Chapter annotation format: "14 [CHAPTER IV — Computation of Total Income]" — both Roman numeral and title, truncated at 60 chars
- [Phase 07-02]: splitIntoSections() retained as private helper called by splitActBodyWithChapters() — clean refactor, one call site change in buildChunks()
- [Phase 08-01]: CGST/IGST text extracted from official CBIC gazette PDFs via PyMuPDF; gazette artifacts (Hindi text, marginal notes, page headers) cleaned via pattern matching
- [Phase 08-01]: Schedule IV and V added as omission placeholders (Finance Act 2023) to maintain splitter boundary integrity
- [Phase 08-01]: No boost for GST sources — scoring adjustments deferred to Phase 10
- [Phase 08-02]: CGST produces 428 chunks (far exceeding 150 threshold), IGST produces 65 chunks (exceeding 20 threshold)
- [Phase 08-02]: GST queries return Comparison Guide as top result due to 1.5x boost — expected, scoring review is Phase 10 concern (SCOR-03)
- [Phase 09-01]: Reference data boost: 1.3 added to SOURCE_CONFIGS entry -- CII section scored lower than calendar for 'cii' query; boost + 'CII FY XXXX-XX = YYY' row format fixes retrieval; defer fine-tuning to Phase 10 SCOR-02/03
- [Phase 09-01]: reference-data.txt sections use 'CII FY XXXX-XX = YYY' row format -- 25 'cii' token occurrences in CII section ensures accurate retrieval for CII-specific queries via keyword scoring
- [Phase 10-01]: Token budget healthy at baseline: avg=1449 max=1500 tokens vs 3000 target -- length normalization NOT needed; revisit only if scoring changes push avg above 2500
- [Phase 10-01]: SCOR-01 confirmed: topK=5 returns exactly 5 chunks; SCOR-02 confirmed: all refs have human-readable labels at baseline
- [Phase 10-01]: REF-01 CII=376 is primary Plan 02 fix target: reference source returned correctly but CII section with value not making top-5

### Pending Todos

- Phase 10 Plan 01 complete: golden-queries.json + validate-golden.ts baseline established
- REF-01 CII=376 not in top-5: primary fix target for Phase 10 Plan 02 scoring tuning

### Blockers/Concerns

None active for v1.1.

## Session Continuity

Last session: 2026-04-09
Stopped at: Completed 10-01-PLAN.md — golden-queries.json + validate-golden.ts baseline diagnostic done
Resume file: .planning/phases/10-scoring-integration-validation/10-01-SUMMARY.md
