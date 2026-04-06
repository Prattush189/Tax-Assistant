# Requirements: Tax Assistant

**Defined:** 2026-04-04
**Core Value:** Users get accurate, visual, step-by-step answers to Indian tax questions — from simple queries to complex calculations with document analysis.

## v1 Requirements

Requirements for milestone v1.0. Each maps to roadmap phases.

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

- [x] **VIZ-01**: User sees waterfall chart showing income → deductions → taxable income → tax flow
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
- [ ] **PLUG-03**: Plugin mode hides unnecessary chrome (sidebar, resource links) and adapts layout for constrained widths
- [x] **PLUG-04**: Parent can sync theme (dark/light) to iframe via postMessage

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

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
| User accounts / authentication | Stateless v1; no persistent storage needed |
| Multi-language support | English only for v1 |
| Mobile native app | Web responsive is sufficient |
| Live stock price integration | Requires paid NSE/BSE API subscription |
| Batch document processing | Gemini context limits; queue management complexity |
| AI prescriptive tax advice as certainty | Hallucination risk in financial context; advisory only with CA disclaimer |

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
| PLUG-03 | Phase 6 | Pending |
| PLUG-04 | Phase 6 | Complete |

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-04*
*Last updated: 2026-04-04 after initial definition*
