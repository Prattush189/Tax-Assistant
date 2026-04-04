# Roadmap: Tax Assistant

## Overview

v1.0 transforms a single-file React prototype with an exposed API key into a production-ready Indian tax assistant. The journey starts by moving the Gemini API key server-side (Phase 1), then refactoring the monolith into a maintainable component architecture (Phase 2), then building the tax calculator (Phase 3) and visualization dashboard (Phase 4) on top of that stable foundation, then adding document handling via the Gemini Files API (Phase 5), and finally hardening the iframe plugin mode for Smart Assist embedding (Phase 6).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Express Backend + API Key Migration** - Secure the Gemini API key server-side and establish the Express proxy foundation (completed 2026-04-04)
- [ ] **Phase 2: Component Architecture** - Decompose the 495-line App.tsx monolith into maintainable feature components and hooks
- [ ] **Phase 3: Tax Calculator** - Build client-side old/new regime comparison, capital gains, and GST calculators with versioned tax rules
- [ ] **Phase 4: Enhanced Visualizations + Dashboard** - Add waterfall, line, and stacked charts; build interactive tax dashboard over calculator output
- [ ] **Phase 5: Document Handling** - Form 16 PDF upload, extracted summary, and document-aware chat Q&A via Gemini Files API
- [ ] **Phase 6: Iframe Plugin Mode Hardening** - Production-ready postMessage infrastructure, origin validation, height resize, and theme sync

## Phase Details

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
- [ ] 01-02-PLAN.md — /api/chat SSE streaming endpoint and App.tsx client migration
- [ ] 01-03-PLAN.md — /api/upload multer endpoint, Vite proxy, npm dev script, bundle security check
- [ ] 01-04-PLAN.md — PM2 ecosystem config, .env.example, Apache VirtualHost, human verification

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
- [ ] 02-01-PLAN.md — Foundation modules: shared types, cn() utility, api.ts service layer
- [ ] 02-02-PLAN.md — Custom hooks: useTheme, usePluginMode, useChat
- [ ] 02-03-PLAN.md — Chat components: ChartRenderer, ChatInput, MessageBubble, ChatView
- [ ] 02-04-PLAN.md — Layout components, placeholder stubs, and App.tsx thin shell refactor

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
**Plans**: TBD

### Phase 4: Enhanced Visualizations + Dashboard
**Goal**: Tax data is presented through rich interactive charts; the calculator output drives a visual tax breakdown dashboard
**Depends on**: Phase 3
**Requirements**: VIZ-01, VIZ-02, VIZ-03, VIZ-04
**Success Criteria** (what must be TRUE):
  1. User sees a waterfall chart tracing income through deductions to taxable income to final tax
  2. AI chat responses can render line charts, stacked bar charts, and composed charts in addition to the existing bar and pie charts
  3. User can open a dashboard view showing income breakdown, tax liability, deductions used, and regime comparison in one screen
  4. Regime comparison displays a slab-by-slab side-by-side table showing tax at each bracket
**Plans**: TBD

### Phase 5: Document Handling
**Goal**: Users can upload Form 16 and other tax documents and ask follow-up questions about their contents in chat
**Depends on**: Phase 1, Phase 2
**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04
**Success Criteria** (what must be TRUE):
  1. User can upload a Form 16 PDF and see an extracted summary card showing salary, TDS, and deductions
  2. User can ask follow-up questions about an uploaded document in the chat interface and receive document-aware answers
  3. User can upload a salary slip or investment proof PDF or image and receive AI analysis of its contents
  4. Uploaded files are processed server-side via Gemini Files API; no file URI persists after the browser session ends
**Plans**: TBD

### Phase 6: Iframe Plugin Mode Hardening
**Goal**: The app embeds seamlessly in Smart Assist as an iframe with correct height sizing, origin-validated messaging, and theme sync
**Depends on**: Phase 2
**Requirements**: PLUG-01, PLUG-02, PLUG-03, PLUG-04
**Success Criteria** (what must be TRUE):
  1. The iframe resizes to match its content height automatically; the Smart Assist page shows no iframe scroll bar
  2. All postMessage events from the parent are validated against an origin allowlist; unrecognized origins are silently ignored
  3. Plugin mode hides the sidebar and resource links and adapts the layout to constrained widths
  4. When the Smart Assist parent sends a theme-change message, the iframe switches between dark and light mode
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Express Backend + API Key Migration | 4/4 | Complete    | 2026-04-04 |
| 2. Component Architecture | 3/4 | In Progress|  |
| 3. Tax Calculator | 0/? | Not started | - |
| 4. Enhanced Visualizations + Dashboard | 0/? | Not started | - |
| 5. Document Handling | 0/? | Not started | - |
| 6. Iframe Plugin Mode Hardening | 0/? | Not started | - |
