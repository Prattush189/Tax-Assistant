# Tax Assistant

## What This Is

An AI-powered Indian tax assistant that helps users with income tax, GST, deductions, and financial planning queries. Built as a React chat interface powered by Google Gemini, with data visualization for tax comparisons and breakdowns. Designed to run standalone or embed as an iframe plugin in the Smart Assist platform.

## Core Value

Users get accurate, visual, step-by-step answers to Indian tax questions — from simple queries to complex calculations with document analysis.

## Current Milestone: v1.2 — UI Revamp (Premium Fintech Look)

**Goal:** Transform the entire UI from prototype-quality to premium fintech-grade — new color palette, polished layouts, Framer Motion animations, and a professional login experience. Inspired by banking/fintech apps (Zerodha, Groww, Cred).

**Target features:**
- New color palette (user to select during implementation — options: refined gold, blue/indigo, or green)
- Login/Signup pages with Framer Motion entrance animations and premium design
- Sidebar redesign — better nav, typography, spacing
- Chat page polish — message bubbles, input area, empty state, thinking indicator
- Calculator, Dashboard, Notices, Plan pages — consistent premium styling
- Dark mode refinement — proper contrast ratios, premium feel
- Typography and spacing overhaul across all components
- Micro-interactions and transitions via Framer Motion

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
*Last updated: 2026-04-08 after milestone v1.2 initialization*
