# Tax Assistant

## What This Is

An AI-powered Indian tax assistant that helps users with income tax, GST, deductions, and financial planning queries. Built as a React chat interface powered by Google Gemini, with data visualization for tax comparisons and breakdowns. Designed to run standalone or embed as an iframe plugin in the Smart Assist platform.

## Core Value

Users get accurate, visual, step-by-step answers to Indian tax questions — from simple queries to complex calculations with document analysis.

## Current Milestone: v1.1 — RAG Data Completeness & Quality

**Goal:** Ensure the RAG system has comprehensive, well-structured data covering both Income Tax Acts, GST, supplementary reference data, and improved chunking/retrieval quality — while preserving existing data files as fallback.

**Target features:**
- Add CGST/IGST Act full text for deep GST query support
- Add supplementary reference data (CII table, due dates calendar, ITR form matrix)
- Fix RAG chunker to properly handle schedules, chapters, and non-section-numbered content
- Improve retrieval quality and scoring for common query patterns
- Keep existing act-1961.txt, act-2025.txt, comparison.txt as stable fallback

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Chat interface with Gemini AI for Indian tax queries — v0
- ✓ Dark/light mode with localStorage persistence — v0
- ✓ Basic chart rendering (bar + pie) from AI responses — v0
- ✓ Markdown rendering with GFM tables — v0
- ✓ Responsive layout with mobile sidebar — v0
- ✓ Plugin mode via URL param — v0
- ✓ Quick query shortcuts and resource links — v0
- ✓ Express backend proxying Gemini API (hide API key) — v1.0
- ✓ Component-based architecture — v1.0
- ✓ Enhanced visualization (waterfall, line, stacked charts; interactive dashboard) — v1.0
- ✓ Dedicated tax calculator UI — v1.0
- ✓ Document upload and analysis (Form 16, salary slips, general docs) — v1.0
- ✓ Production-ready iframe plugin mode — v1.0
- ✓ Complete IT Act 1961 + IT Act 2025 text data (full extraction from PDFs) — v1.0
- ✓ Comprehensive old-to-new Act comparison document (40 sections) — v1.0
- ✓ Keyword-based RAG with inverted index and section scoring — v1.0

### Active

<!-- Current scope. Building toward these. -->

- [ ] CGST/IGST Act full text for deep GST query support
- [ ] Supplementary reference data (CII table, due dates, ITR form matrix)
- [ ] Schedule-aware RAG chunking (handle non-section-numbered content)
- [ ] Improved retrieval quality and scoring for common queries
- [ ] Existing data files preserved as stable fallback

### Out of Scope

- Mobile native app — web-first, mobile responsive is sufficient
- User authentication / accounts — not needed for v1, tax queries are stateless
- Chat history persistence — deferred, no backend storage yet
- Multi-language support — English only for v1
- Real-time tax filing / ITR submission — advisory only, no filing

## Context

- Originally built via Google AI Studio as a prototype
- Single-file React app (~495 lines in App.tsx)
- Uses `gemini-3.1-pro-preview` model
- API key currently exposed in client bundle via Vite `define`
- Express is already a dependency but unused
- Will be embedded as iframe in a separate "Smart Assist" project
- Tailwind CSS v4 with `@tailwindcss/vite` plugin

## Constraints

- **Tech stack**: React 19 + TypeScript + Vite + Tailwind CSS v4 (keep existing stack)
- **AI provider**: Google Gemini API (no switching)
- **Hosting**: Must work as standalone + iframe embed
- **Security**: API key must not be exposed to client

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Express backend over serverless | Express already a dependency, simpler for document uploads | — Pending |
| Full architecture over routing | Pages not needed yet — calculator and dashboard can be tabs/views | — Pending |
| Keep Gemini model | Existing system prompt tuned for Indian tax domain | ✓ Good |

---
*Last updated: 2026-04-08 after milestone v1.1 initialization*
