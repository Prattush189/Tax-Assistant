# Tax Assistant

## What This Is

An AI-powered Indian tax assistant that helps users with income tax, GST, deductions, and financial planning queries. Built as a React chat interface powered by Google Gemini, with data visualization for tax comparisons and breakdowns. Designed to run standalone or embed as an iframe plugin in the Smart Assist platform.

## Core Value

Users get accurate, visual, step-by-step answers to Indian tax questions — from simple queries to complex calculations with document analysis.

## Current Milestone: v1.0 — Foundation & Gaps

**Goal:** Transform the prototype into a production-ready, secure, well-architected app with enhanced visualizations, a dedicated tax calculator, and document handling.

**Target features:**
- Express backend with Gemini API proxy (security)
- Full project architecture (components, hooks, services, types)
- Enhanced data visualization (more chart types, interactive dashboard)
- Dedicated tax calculator UI
- Document handling (Form 16, salary slips, general doc Q&A)
- Clean iframe plugin mode for Smart Assist embedding

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from existing codebase. -->

- ✓ Chat interface with Gemini AI for Indian tax queries — v0 (prototype)
- ✓ Dark/light mode with localStorage persistence — v0
- ✓ Basic chart rendering (bar + pie) from AI responses — v0
- ✓ Markdown rendering with GFM tables — v0
- ✓ Responsive layout with mobile sidebar — v0
- ✓ Plugin mode via URL param — v0
- ✓ Quick query shortcuts and resource links — v0

### Active

<!-- Current scope. Building toward these. -->

- [ ] Express backend proxying Gemini API (hide API key)
- [ ] Component-based architecture (split monolithic App.tsx)
- [ ] Enhanced visualization (waterfall, line, stacked charts; interactive dashboard)
- [ ] Dedicated tax calculator UI
- [ ] Document upload and analysis (Form 16, salary slips, general docs)
- [ ] Production-ready iframe plugin mode

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
*Last updated: 2026-04-04 after milestone v1.0 initialization*
