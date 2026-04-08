# Requirements: Tax Assistant

**Defined:** 2026-04-04
**Core Value:** Users get accurate, visual, step-by-step answers to Indian tax questions — from simple queries to complex calculations with document analysis.

## v1.0 Requirements (Complete)

All v1.0 requirements shipped in phases 1-6.

### Backend & Security

- [x] **BACK-01**: Express server proxies all Gemini API calls — API key never reaches client bundle
- [x] **BACK-02**: Server applies CORS, Helmet (CSP + frame-ancestors), and rate limiting on all /api/* routes
- [x] **BACK-03**: Server accepts PDF/image file uploads via multer with 10MB size limit and MIME type validation
- [x] **BACK-04**: Vite dev server proxies /api/* requests to Express; production Express serves built Vite assets

### Architecture

- [x] **ARCH-01**: App.tsx decomposed into feature components (Chat, Calculator, Dashboard, Documents, Layout)
- [x] **ARCH-02**: Business logic extracted into custom hooks (useChat, useTheme, usePluginMode)
- [x] **ARCH-03**: Single api.ts service module handles all /api/* fetch calls with typed responses
- [x] **ARCH-04**: App shell manages tab state (chat / calculator / dashboard) without React Router

### Tax Calculator

- [x] **CALC-01**: User can compare Old vs New income tax regime side-by-side for FY 2025-26 and FY 2024-25
- [x] **CALC-02**: User can input salary, deductions (80C, 80D, 80CCD-1B), HRA, and standard deduction for old regime
- [x] **CALC-03**: Calculator auto-applies Section 87A rebate and 4% health & education cess
- [x] **CALC-04**: User sees regime recommendation with exact savings amount ("Switch to new regime, save X")
- [x] **CALC-05**: User can calculate capital gains (LTCG/STCG) for equity, mutual funds, and real estate with current rates
- [x] **CALC-06**: User can calculate GST breakdown (CGST+SGST or IGST) for a given amount, rate, and transaction type
- [x] **CALC-07**: Tax rules stored as versioned per-FY data files, not hardcoded constants

### Visualization & Dashboard

- [x] **VIZ-01**: User sees waterfall chart showing income -> deductions -> taxable income -> tax flow
- [x] **VIZ-02**: User sees additional chart types (line, stacked bar, composed) in AI chat responses
- [x] **VIZ-03**: User can view an interactive tax dashboard summarizing income breakdown, tax liability, deductions, and regime comparison
- [x] **VIZ-04**: Regime comparison displayed as rich side-by-side table with slab-by-slab breakdown

### Document Handling

- [x] **DOC-01**: User can upload Form 16 PDF and see extracted salary, TDS, and deduction summary
- [x] **DOC-02**: User can ask follow-up questions about an uploaded document in chat (document-aware Q&A)
- [x] **DOC-03**: User can upload any tax-related document (salary slip, investment proof) for AI analysis
- [x] **DOC-04**: Uploaded files processed via Gemini Files API server-side; file URIs not persisted beyond session

### Plugin & Embed

- [x] **PLUG-01**: Iframe communicates content height to parent via postMessage for seamless embedding
- [x] **PLUG-02**: Iframe validates parent origin against allowlist on all received postMessage events
- [x] **PLUG-03**: Plugin mode hides unnecessary chrome (sidebar, resource links) and adapts layout for constrained widths
- [x] **PLUG-04**: Parent can sync theme (dark/light) to iframe via postMessage

## v1.1 Requirements

Requirements for RAG Data Completeness & Quality milestone. Each maps to roadmap phases.

### RAG Infrastructure

- [ ] **RAGI-01**: Retrieval function supports any number of data sources without hardcoded bucket limits
- [ ] **RAGI-02**: Chunker detects CHAPTER headers and creates chapter-level chunks with proper labels
- [ ] **RAGI-03**: Chunker detects SCHEDULE / PART boundaries and creates schedule-aware chunks separate from Act section numbering
- [ ] **RAGI-04**: Chunk source type is extensible (TypeScript union accepts new source types without code duplication)
- [ ] **RAGI-05**: Existing act-1961.txt, act-2025.txt, comparison.txt data files preserved unchanged as fallback

### GST Data

- [ ] **GST-01**: CGST Act 2017 full text (174+ sections, 5 schedules) loaded as RAG data source
- [ ] **GST-02**: IGST Act 2017 full text (~25 sections including place-of-supply rules) loaded as RAG data source
- [ ] **GST-03**: GST source chunks have proper section labels distinguishable from IT Act section numbers
- [ ] **GST-04**: User can ask GST-specific questions and receive RAG-augmented answers with CGST/IGST references

### Reference Data

- [ ] **REF-01**: CII table (FY 2001-02 to 2025-26, base year 2001-02) available as structured data for exact lookup
- [ ] **REF-02**: Due dates calendar (advance tax, TDS, ITR, GST returns) available as structured data
- [ ] **REF-03**: ITR form selection matrix (which form for which assessee type/income) available as structured data
- [ ] **REF-04**: Reference data queries return exact answers (not keyword-matched Act text about the same year/date)

### Scoring & Retrieval Quality

- [ ] **SCOR-01**: Retrieval uses configurable topK (increased from 3 to 5) for richer context
- [ ] **SCOR-02**: Source-type labels in retrieval output distinguish IT Act 1961, IT Act 2025, Comparison, CGST, IGST, and Reference sources
- [ ] **SCOR-03**: Length normalization prevents dense GST/legal text from crowding out relevant IT Act chunks
- [ ] **SCOR-04**: Adding new data sources does not regress retrieval quality for existing IT Act queries

## v1.2 Requirements

Requirements for UI Revamp milestone. Premium fintech-grade redesign across all pages.

### Auth & Onboarding

- [ ] **AUTH-UI-01**: Login page fully redesigned with premium fintech aesthetic, animated gradient background, and floating card
- [ ] **AUTH-UI-02**: Signup page matches login design with consistent styling
- [ ] **AUTH-UI-03**: Framer Motion entrance animations on auth pages (fade-in, slide-up for form elements)
- [ ] **AUTH-UI-04**: Animated logo and brand element on auth pages

### Color Palette & Theme

- [ ] **THEME-01**: New color palette with 2-3 options presented for user selection (refined gold, blue/indigo, green)
- [ ] **THEME-02**: Dark mode uses proper contrast ratios and premium fintech-grade color pairings
- [ ] **THEME-03**: Consistent color tokens applied across all components (no ad-hoc hex values)

### Sidebar & Navigation

- [ ] **NAV-01**: Sidebar redesigned with better typography, spacing, and visual hierarchy
- [ ] **NAV-02**: Active tab has premium indicator (not just background color change)
- [ ] **NAV-03**: Chat history items have better cards with hover states
- [ ] **NAV-04**: User profile section in footer polished with cleaner layout

### Chat Page

- [ ] **CHAT-UI-01**: Message bubbles redesigned — better shapes, spacing, avatar indicators
- [ ] **CHAT-UI-02**: Input area refined — cleaner button placement, attachment indicator, polished borders
- [ ] **CHAT-UI-03**: Empty state redesigned with premium landing (feature highlights, cleaner quick queries)
- [ ] **CHAT-UI-04**: Thinking indicator refined for premium feel

### Calculator & Dashboard

- [ ] **CALC-UI-01**: Calculator tabs and input forms redesigned with fintech-grade styling
- [ ] **CALC-UI-02**: Dashboard cards, stat widgets, and chart containers have premium styling
- [ ] **CALC-UI-03**: Result displays use polished typography and number formatting

### Notice Drafter & Plan Pages

- [ ] **PAGE-UI-01**: Notice Drafter page form and preview styled consistently with new theme
- [ ] **PAGE-UI-02**: Plan page cards redesigned with premium layout

### Micro-Interactions

- [ ] **ANIM-01**: Subtle page transitions when switching views (fade, no flashy slides)
- [ ] **ANIM-02**: Button hover/press effects (subtle scale or glow)
- [ ] **ANIM-03**: Smooth loading states (skeleton loaders or gentle fade-ins for data)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Retrieval

- **ADV-01**: Embedding-based semantic search for conceptual queries
- **ADV-02**: Hybrid keyword + embedding retrieval with re-ranking
- **ADV-03**: Query classification to route IT vs GST vs reference queries to specialized retrievers

### Additional Data Sources

- **DATA-01**: CGST Rules 2017 (ITC rules, e-invoicing, valuation)
- **DATA-02**: Income Tax Rules 2026 (form instructions, depreciation tables)
- **DATA-03**: CBDT Circulars and Notifications
- **DATA-04**: DTAA treaty text for major countries

### Enhanced Calculator

- **CALC-08**: Surcharge calculation for income above 50L/1Cr/2Cr with marginal relief
- **CALC-09**: Deduction gap analysis showing unused 80C/80D/NPS capacity with tax saving equivalent
- **CALC-10**: Capital gains holding-period optimizer hint ("Hold 3 more months for LTCG rate")

### Chat Integration

- **CHAT-01**: Chat-to-calculator pre-fill — user mentions income in chat, calculator auto-opens with value
- **CHAT-02**: Chat history persistence across sessions

### Document Enhancements

- **DOC-05**: Salary slip parsing with component-level breakdown
- **DOC-06**: Multi-year document comparison ("Did my effective tax rate improve?")
- **DOC-07**: GST HSN code lookup via AI from plain English product description

## Out of Scope

| Feature | Reason |
|---------|--------|
| ITR e-filing / form submission | Legal liability, requires TRACES API access and digital signatures |
| Real-time AIS/26AS data fetch | Requires taxpayer credentials — security and legal risk |
| Multi-language support | English only for v1 |
| Mobile native app | Web responsive is sufficient |
| Live stock price integration | Requires paid NSE/BSE API subscription |
| Batch document processing | Gemini context limits; queue management complexity |
| AI prescriptive tax advice as certainty | Hallucination risk in financial context; advisory only with CA disclaimer |
| Full CGST Rules 2017 | Creates retrieval noise; curated summaries in comparison.txt suffice for v1.1 |
| HSN/SAC rate schedule | Frequently amended, too granular; comparison.txt covers rate structure |
| Finance Act amendment text | Raw amendment text is confusing; Acts already incorporate amendments |
| Vector database (Pinecone, Chroma) | Disproportionate complexity for current scale; keyword RAG sufficient |
| BM25 / tf-idf libraries | Marginal improvement over optimized keyword scoring; adds dependencies |
| Case law database | High complexity, licensing issues; defer to v2+ |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BACK-01 | Phase 1 | Complete |
| BACK-02 | Phase 1 | Complete |
| BACK-03 | Phase 1 | Complete |
| BACK-04 | Phase 1 | Complete |
| ARCH-01 | Phase 2 | Complete |
| ARCH-02 | Phase 2 | Complete |
| ARCH-03 | Phase 2 | Complete |
| ARCH-04 | Phase 2 | Complete |
| CALC-01 | Phase 3 | Complete |
| CALC-02 | Phase 3 | Complete |
| CALC-03 | Phase 3 | Complete |
| CALC-04 | Phase 3 | Complete |
| CALC-05 | Phase 3 | Complete |
| CALC-06 | Phase 3 | Complete |
| CALC-07 | Phase 3 | Complete |
| VIZ-01 | Phase 4 | Complete |
| VIZ-02 | Phase 4 | Complete |
| VIZ-03 | Phase 4 | Complete |
| VIZ-04 | Phase 4 | Complete |
| DOC-01 | Phase 5 | Complete |
| DOC-02 | Phase 5 | Complete |
| DOC-03 | Phase 5 | Complete |
| DOC-04 | Phase 5 | Complete |
| PLUG-01 | Phase 6 | Complete |
| PLUG-02 | Phase 6 | Complete |
| PLUG-03 | Phase 6 | Complete |
| PLUG-04 | Phase 6 | Complete |
| RAGI-01 | Phase 7 | Pending |
| RAGI-02 | Phase 7 | Pending |
| RAGI-03 | Phase 7 | Pending |
| RAGI-04 | Phase 7 | Pending |
| RAGI-05 | Phase 7 | Pending |
| GST-01 | Phase 8 | Pending |
| GST-02 | Phase 8 | Pending |
| GST-03 | Phase 8 | Pending |
| GST-04 | Phase 8 | Pending |
| REF-01 | Phase 9 | Pending |
| REF-02 | Phase 9 | Pending |
| REF-03 | Phase 9 | Pending |
| REF-04 | Phase 9 | Pending |
| SCOR-01 | Phase 10 | Pending |
| SCOR-02 | Phase 10 | Pending |
| SCOR-03 | Phase 10 | Pending |
| SCOR-04 | Phase 10 | Pending |

| AUTH-UI-01 | Phase 11 | Pending |
| AUTH-UI-02 | Phase 11 | Pending |
| AUTH-UI-03 | Phase 11 | Pending |
| AUTH-UI-04 | Phase 11 | Pending |
| THEME-01 | Phase 11 | Pending |
| THEME-02 | Phase 11 | Pending |
| THEME-03 | Phase 11 | Pending |
| NAV-01 | Phase 12 | Pending |
| NAV-02 | Phase 12 | Pending |
| NAV-03 | Phase 12 | Pending |
| NAV-04 | Phase 12 | Pending |
| CHAT-UI-01 | Phase 13 | Pending |
| CHAT-UI-02 | Phase 13 | Pending |
| CHAT-UI-03 | Phase 13 | Pending |
| CHAT-UI-04 | Phase 13 | Pending |
| CALC-UI-01 | Phase 14 | Pending |
| CALC-UI-02 | Phase 14 | Pending |
| CALC-UI-03 | Phase 14 | Pending |
| PAGE-UI-01 | Phase 14 | Pending |
| PAGE-UI-02 | Phase 14 | Pending |
| ANIM-01 | Phase 15 | Pending |
| ANIM-02 | Phase 15 | Pending |
| ANIM-03 | Phase 15 | Pending |

**Coverage:**
- v1.0 requirements: 27 total (all complete)
- v1.1 requirements: 17 total (pending)
- v1.2 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0

---
*Requirements defined: 2026-04-04*
*Last updated: 2026-04-08 after v1.2 requirements defined*
