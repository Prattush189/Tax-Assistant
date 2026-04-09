# Roadmap: Tax Assistant

## Milestones

- ✅ **v1.0 MVP** — Phases 1-6 (shipped 2026-04-06)
- 🚧 **v1.1 RAG Data Completeness & Quality** — Phases 7-10 (in progress)
- 🔮 **v1.2 UI Revamp (Premium Fintech Look)** — Phases 11-15 (planned)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-6) — SHIPPED 2026-04-06</summary>

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Express Backend + API Key Migration** - Secure the Gemini API key server-side and establish the Express proxy foundation (completed 2026-04-04)
- [x] **Phase 2: Component Architecture** - Decompose the 495-line App.tsx monolith into maintainable feature components and hooks (completed 2026-04-04)
- [x] **Phase 3: Tax Calculator** - Build client-side old/new regime comparison, capital gains, and GST calculators with versioned tax rules (completed 2026-04-04)
- [x] **Phase 4: Enhanced Visualizations + Dashboard** - Add waterfall, line, and stacked charts; build interactive tax dashboard over calculator output (completed 2026-04-04)
- [x] **Phase 5: Document Handling** - Form 16 PDF upload, extracted summary, and document-aware chat Q&A via Gemini Files API (completed 2026-04-04)
- [x] **Phase 6: Iframe Plugin Mode Hardening** - Production-ready postMessage infrastructure, origin validation, height resize, and theme sync (completed 2026-04-06)

### Phase 1: Express Backend + API Key Migration
**Goal**: The Gemini API key is removed from the client bundle and all AI calls route through a secure Express proxy
**Depends on**: Nothing (first phase)
**Requirements**: BACK-01, BACK-02, BACK-03, BACK-04
**Success Criteria** (what must be TRUE):
  1. The built client bundle contains no Gemini API key string (verified by grep on dist/)
  2. Chat responses work end-to-end with the API key only in server environment variables
  3. File uploads up to 10MB are accepted by the server with MIME type validation
  4. A single `npm run dev` starts both Vite and Express; /api/* requests reach the Express server
  5. Production build serves both the React app and /api/* routes from a single Express process
**Plans**: 4 plans

Plans:
- [x] 01-01-PLAN.md — Express server scaffold with helmet, CORS, rate-limit middleware stack
- [x] 01-02-PLAN.md — /api/chat SSE streaming endpoint and App.tsx client migration
- [x] 01-03-PLAN.md — /api/upload multer endpoint, Vite proxy, npm dev script, bundle security check
- [x] 01-04-PLAN.md — PM2 ecosystem config, .env.example, Apache VirtualHost, human verification

### Phase 2: Component Architecture
**Goal**: App.tsx is a thin shell; all business logic lives in hooks and all UI lives in feature components
**Depends on**: Phase 1
**Requirements**: ARCH-01, ARCH-02, ARCH-03, ARCH-04
**Success Criteria** (what must be TRUE):
  1. App.tsx is reduced to tab/view state management with no inline business logic
  2. Chat, calculator, and dashboard views are reachable via tab navigation without React Router
  3. All /api/* fetch calls originate from a single api.ts service module
  4. useChat, useTheme, and usePluginMode hooks encapsulate their respective state; no duplication in components
**Plans**: 4 plans

Plans:
- [x] 02-01-PLAN.md — Foundation modules: shared types, cn() utility, api.ts service layer
- [x] 02-02-PLAN.md — Custom hooks: useTheme, usePluginMode, useChat
- [x] 02-03-PLAN.md — Chat components: ChartRenderer, ChatInput, MessageBubble, ChatView
- [x] 02-04-PLAN.md — Layout components, placeholder stubs, and App.tsx thin shell refactor

### Phase 3: Tax Calculator
**Goal**: Users can calculate and compare their tax liability across regimes, capital gains scenarios, and GST transactions
**Depends on**: Phase 2
**Requirements**: CALC-01, CALC-02, CALC-03, CALC-04, CALC-05, CALC-06, CALC-07
**Success Criteria** (what must be TRUE):
  1. User can enter income and deductions and see old vs new regime tax side-by-side for FY 2025-26 and FY 2024-25
  2. Section 87A rebate and 4% cess are automatically applied; the result matches hand-calculation for a known test case
  3. User sees a clear recommendation showing exactly how much they save by choosing the better regime
  4. User can calculate LTCG and STCG for equity, mutual funds, and real estate using current FY rates
  5. User can enter an amount, GST rate, and transaction type (intra/inter-state) and see the CGST+SGST or IGST split
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md — Calculator types, versioned tax rule data files (FY 2025-26 + FY 2024-25), and INR formatting utilities
- [x] 03-02-PLAN.md — Pure calculation engines: taxEngine.ts, capitalGainsEngine.ts, gstEngine.ts
- [x] 03-03-PLAN.md — UI components: CalculatorView tab shell, IncomeTaxTab, RegimeComparison, CapitalGainsTab, GstTab

### Phase 4: Enhanced Visualizations + Dashboard
**Goal**: Tax data is presented through rich interactive charts; the calculator output drives a visual tax breakdown dashboard
**Depends on**: Phase 3
**Requirements**: VIZ-01, VIZ-02, VIZ-03, VIZ-04
**Success Criteria** (what must be TRUE):
  1. User sees a waterfall chart tracing income through deductions to taxable income to final tax
  2. AI chat responses can render line charts, stacked bar charts, and composed charts in addition to the existing bar and pie charts
  3. User can open a dashboard view showing income breakdown, tax liability, deductions used, and regime comparison in one screen
  4. Regime comparison displays a slab-by-slab side-by-side table showing tax at each bracket
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md — TaxCalculatorContext: shared income tax state + migrate IncomeTaxTab + wrap App.tsx
- [x] 04-02-PLAN.md — ChartRenderer extension (line, stacked-bar, composed) + AI system prompt update
- [x] 04-03-PLAN.md — TaxWaterfallChart, TaxSummaryCards, DashboardView full build

### Phase 5: Document Handling
**Goal**: Users can upload Form 16 and other tax documents and ask follow-up questions about their contents in chat
**Depends on**: Phase 1, Phase 2
**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04
**Success Criteria** (what must be TRUE):
  1. User can upload a Form 16 PDF and see an extracted summary card showing salary, TDS, and deductions
  2. User can ask follow-up questions about an uploaded document in the chat interface and receive document-aware answers
  3. User can upload a salary slip or investment proof PDF or image and receive AI analysis of its contents
  4. Uploaded files are processed server-side via Gemini Files API; no file URI persists after the browser session ends
**Plans**: 4 plans

Plans:
- [x] 05-01-PLAN.md — Types extension + Gemini Files API upload pipeline in upload.ts
- [x] 05-02-PLAN.md — Server chat route extension with optional fileContext injection
- [x] 05-03-PLAN.md — Client service layer and useChat extension for document context
- [x] 05-04-PLAN.md — DocumentsView, DocumentCard UI components + App.tsx/Header/ChatInput wiring

### Phase 6: Iframe Plugin Mode Hardening
**Goal**: The app embeds seamlessly in Smart Assist as an iframe with correct height sizing, origin-validated messaging, and theme sync
**Depends on**: Phase 2
**Requirements**: PLUG-01, PLUG-02, PLUG-03, PLUG-04
**Success Criteria** (what must be TRUE):
  1. The iframe resizes to match its content height automatically; the Smart Assist page shows no iframe scroll bar
  2. All postMessage events from the parent are validated against an origin allowlist; unrecognized origins are silently ignored
  3. Plugin mode hides the sidebar and resource links and adapts the layout to constrained widths
  4. When the Smart Assist parent sends a theme-change message, the iframe switches between dark and light mode
**Plans**: 2 plans

Plans:
- [x] 06-01-PLAN.md — useTheme setter exposure + usePluginMode ResizeObserver/origin-validator/theme-sync + server CSP tightening
- [x] 06-02-PLAN.md — Plugin mode layout audit at 400px + end-to-end human verification checkpoint

</details>

---

### 🚧 v1.1 RAG Data Completeness & Quality (In Progress)

**Milestone Goal:** Ensure the RAG system has comprehensive, well-structured data covering both Income Tax Acts, GST legislation, and supplementary reference data — with improved chunking and retrieval quality that does not regress existing IT Act query performance.

- [x] **Phase 7: RAG Infrastructure Fixes** - Fix schedule-aware chunking and hardcoded retrieval bucket limits that silently break all new data sources (completed 2026-04-08)
- [ ] **Phase 8: GST Act Data** - Add CGST Act 2017 and IGST Act 2017 full text as indexed RAG sources for deep GST query support
- [ ] **Phase 9: Reference Data** - Add CII table, due dates calendar, and ITR form selection matrix as structured lookup data sources
- [ ] **Phase 10: Scoring & Integration Validation** - Tune retrieval scoring, validate 15-query golden set, confirm no regression against existing IT Act queries

## Phase Details

### Phase 7: RAG Infrastructure Fixes
**Goal**: The RAG chunker and retrieval function correctly handle any number of source types, including non-section-numbered content, so new data files are actually retrievable
**Depends on**: Phase 6
**Requirements**: RAGI-01, RAGI-02, RAGI-03, RAGI-04, RAGI-05
**Success Criteria** (what must be TRUE):
  1. Adding a new data source file does not require modifying a hardcoded bucket list; retrieval surfaces results from all registered sources
  2. CHAPTER headers in Act files produce named chapter-level chunks visible in retrieval output
  3. SCHEDULE and PART sections produce separate chunks with labels that do not inherit Act section numbers
  4. TypeScript union type for chunk source accepts new values without duplicating retrieval logic
  5. Existing act-1961.txt, act-2025.txt, and comparison.txt files load and produce the same or more chunks than before the fix (no data loss)
**Plans**: 2 plans

Plans:
- [ ] 07-01-PLAN.md — SourceConfig registry, source-agnostic retrieval, stable chunk IDs, topK=5
- [ ] 07-02-PLAN.md — Chapter header detection and schedule-aware chunking

### Phase 8: GST Act Data
**Goal**: Users can ask GST-specific questions and receive answers grounded in actual CGST Act and IGST Act text with proper section references
**Depends on**: Phase 7
**Requirements**: GST-01, GST-02, GST-03, GST-04
**Success Criteria** (what must be TRUE):
  1. Asking "What is input tax credit under GST?" returns a response citing CGST Act section numbers (e.g., Section 16 or Section 17)
  2. Asking about interstate supply or place of supply returns a response citing IGST Act sections (e.g., Section 10-13)
  3. GST Act chunks appear in retrieval output labeled distinctly from IT Act 1961 and IT Act 2025 chunks
  4. CGST Act loads with more than 150 section-matched chunks (extraction quality gate passes)
**Plans**: 2 plans

Plans:
- [ ] 08-01-PLAN.md — CGST Act + IGST Act text files and SOURCE_CONFIGS registration
- [ ] 08-02-PLAN.md — Startup chunk count validation and end-to-end GST query testing

### Phase 9: Reference Data
**Goal**: Queries about CII values, tax due dates, and ITR form selection return exact structured answers rather than approximate keyword matches from Act text
**Depends on**: Phase 7
**Requirements**: REF-01, REF-02, REF-03, REF-04
**Success Criteria** (what must be TRUE):
  1. Asking "What is the CII for FY 2025-26?" returns exactly 376 (the CBDT-notified value), not a general statement about indexation
  2. Asking "When is the advance tax due date for Q3?" returns the specific calendar date, not a general description of advance tax rules
  3. Asking "Which ITR form should a salaried person with LTCG up to 1.25L use?" returns ITR-1 for AY 2026-27 with the correct eligibility reason
  4. Reference data answers are distinguishable in source labels from IT Act and GST Act answers
**Plans**: 1 plan

Plans:
- [ ] 09-01-PLAN.md — Reference data file (CII, due dates, ITR matrix) + SOURCE_CONFIGS wiring + retrieval validation

### Phase 10: Scoring & Integration Validation
**Goal**: All six source types compete fairly in retrieval, existing IT Act query quality is unchanged, and the full data corpus fits within acceptable token budget at topK=5
**Depends on**: Phase 8, Phase 9
**Requirements**: SCOR-01, SCOR-02, SCOR-03, SCOR-04
**Success Criteria** (what must be TRUE):
  1. Running 15 golden queries covering IT Act, GST, and reference topics shows no regression in IT Act answer quality compared to the pre-v1.1 baseline
  2. Retrieval output for any query includes source-type labels that correctly identify IT Act 1961, IT Act 2025, Comparison, CGST, IGST, or Reference as the chunk origin
  3. A mixed-domain query (e.g., "What is taxable supply under GST vs taxable income under IT Act?") returns chunks from both domains without one crowding out the other
  4. topK=5 retrieval produces responses within an acceptable input token budget (confirmed against usageRepo averages)
**Plans**: TBD

---

### 🔮 v1.2 UI Revamp — Premium Fintech Look

**Milestone Goal:** Transform the entire UI from prototype-quality to premium fintech-grade — new color palette, polished layouts, Framer Motion animations, and a professional login experience.

- [ ] **Phase 11: Design System & Auth Pages** - Establish color palette, CSS tokens, and redesign login/signup with Framer Motion animations
- [ ] **Phase 12: Sidebar & Navigation** - Redesign sidebar layout, nav tabs, chat history, and user profile section
- [ ] **Phase 13: Chat Page Overhaul** - Redesign message bubbles, input area, empty state, and thinking indicator
- [ ] **Phase 14: Calculator, Dashboard & Secondary Pages** - Premium styling for calculator, dashboard, notice drafter, and plan pages
- [ ] **Phase 15: Micro-Interactions & Polish** - Page transitions, button effects, loading states, final consistency pass

## Phase Details (v1.2)

### Phase 11: Design System & Auth Pages
**Goal**: A unified color palette is established and login/signup pages showcase the premium fintech aesthetic with smooth animations
**Depends on**: Phase 10 (or can run independently of v1.1)
**Requirements**: AUTH-UI-01, AUTH-UI-02, AUTH-UI-03, AUTH-UI-04, THEME-01, THEME-02, THEME-03
**Success Criteria** (what must be TRUE):
  1. User presented with 2-3 color palette options and selects one before any UI work begins
  2. CSS custom properties (tokens) for primary, secondary, accent, surface, and text colors exist in a single source file
  3. Login page has animated gradient background, floating card with entrance animation, and smooth field focus transitions
  4. Signup page matches login design with consistent styling and animations
  5. Dark mode on auth pages uses proper contrast ratios (WCAG AA minimum)
**Plans**: TBD

### Phase 12: Sidebar & Navigation
**Goal**: The sidebar and navigation feel like a premium fintech app with clear visual hierarchy and polished interactions
**Depends on**: Phase 11
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04
**Success Criteria** (what must be TRUE):
  1. Sidebar has improved typography (font sizes, weights, spacing) with clear visual hierarchy between sections
  2. Active nav tab has a premium indicator distinct from inactive tabs (not just background color)
  3. Chat history items are styled as polished cards with smooth hover transitions
  4. User profile section in sidebar footer has cleaner layout with proper alignment
**Plans**: TBD

### Phase 13: Chat Page Overhaul
**Goal**: The chat experience matches premium AI products — clean message bubbles, polished input area, and engaging empty state
**Depends on**: Phase 11
**Requirements**: CHAT-UI-01, CHAT-UI-02, CHAT-UI-03, CHAT-UI-04
**Success Criteria** (what must be TRUE):
  1. Message bubbles have refined styling with proper spacing, avatar indicators, and visual distinction between user/AI
  2. Input area has cleaner button placement, visible attachment indicator, and polished border treatment
  3. Empty state shows premium landing with feature highlights and refined quick query cards
  4. Thinking indicator has a refined animation that feels premium
**Plans**: TBD

### Phase 14: Calculator, Dashboard & Secondary Pages
**Goal**: All secondary pages (calculator, dashboard, notice drafter, plan) match the premium standard set in phases 11-13
**Depends on**: Phase 11
**Requirements**: CALC-UI-01, CALC-UI-02, CALC-UI-03, PAGE-UI-01, PAGE-UI-02
**Success Criteria** (what must be TRUE):
  1. Calculator tabs, input forms, and result displays use the new design tokens consistently
  2. Dashboard stat cards, chart containers, and comparison widgets have premium styling
  3. Notice drafter form and preview panel styled with new theme
  4. Plan page tier cards redesigned with premium layout
**Plans**: TBD

### Phase 15: Micro-Interactions & Polish
**Goal**: Subtle animations and transitions give the app a polished, cohesive feel throughout
**Depends on**: Phase 12, Phase 13, Phase 14
**Requirements**: ANIM-01, ANIM-02, ANIM-03
**Success Criteria** (what must be TRUE):
  1. Switching between views (Chat, Calc, Dashboard, etc.) has a subtle fade transition
  2. Buttons have consistent hover/press feedback (subtle scale or glow)
  3. Data-loading states use skeleton loaders or smooth fade-ins instead of jarring content pops
  4. No animation is distracting or flashy — all feel natural and understated
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 7 → 8 → 9 → 10

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Express Backend + API Key Migration | v1.0 | 4/4 | Complete | 2026-04-04 |
| 2. Component Architecture | v1.0 | 4/4 | Complete | 2026-04-04 |
| 3. Tax Calculator | v1.0 | 3/3 | Complete | 2026-04-04 |
| 4. Enhanced Visualizations + Dashboard | v1.0 | 3/3 | Complete | 2026-04-04 |
| 5. Document Handling | v1.0 | 4/4 | Complete | 2026-04-04 |
| 6. Iframe Plugin Mode Hardening | v1.0 | 2/2 | Complete | 2026-04-06 |
| 7. RAG Infrastructure Fixes | 2/2 | Complete    | 2026-04-08 | - |
| 8. GST Act Data | v1.1 | 0/TBD | Not started | - |
| 9. Reference Data | v1.1 | 0/1 | Not started | - |
| 10. Scoring & Integration Validation | v1.1 | 0/TBD | Not started | - |
| 11. Design System & Auth Pages | v1.2 | 0/TBD | Not started | - |
| 12. Sidebar & Navigation | v1.2 | 0/TBD | Not started | - |
| 13. Chat Page Overhaul | v1.2 | 0/TBD | Not started | - |
| 14. Calc, Dashboard & Secondary | v1.2 | 0/TBD | Not started | - |
| 15. Micro-Interactions & Polish | v1.2 | 0/TBD | Not started | - |
