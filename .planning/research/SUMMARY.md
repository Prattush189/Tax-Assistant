# Project Research Summary

**Project:** Indian Tax Assistant
**Domain:** React SPA + Express backend proxy — AI-powered tax calculator, document handling, interactive visualization, iframe embed
**Researched:** 2026-04-04
**Confidence:** HIGH (stack/architecture/pitfalls verified against official sources; MEDIUM on tax calculation rules and Gemini Files API edge cases)

## Executive Summary

This project extends an existing React 19 + Vite + TypeScript app into a full-featured Indian tax assistant by adding four capabilities: an Express backend proxy (the security prerequisite for everything else), a multi-regime tax calculator, Form 16 / document handling via Gemini's multimodal Files API, and production-grade iframe embedding for the Smart Assist platform. The existing stack (Recharts 3.x, @google/genai, Tailwind CSS v4, motion, react-markdown) already covers all required chart types and AI integration — the additions are strictly additive: `multer`, `cors`, `helmet`, `express-rate-limit`, `pdf-parse`, and `concurrently`. No new frontend libraries are required.

The recommended architecture is a Vite dev-proxy + Express monorepo pattern: two processes in development (Vite on :3000, Express on :4000) sharing a single origin via Vite's `server.proxy`, collapsing into a single Express process in production that serves both the built Vite assets and all `/api/*` routes. The Gemini API key moves server-side as the first act of the Express phase, and the client bundle is verified clean before any feature work begins. Tax calculation logic runs client-side (deterministic math requires no server round-trip); only Gemini calls, file uploads, and document Q&A go through Express.

The three critical risks are: (1) the API key inadvertently surviving the migration to Express — prevent by removing the Vite `define` block before writing any proxy code; (2) postMessage wildcard `targetOrigin` in iframe mode — prevent by specifying the exact Smart Assist domain and validating `event.origin` on every received message; (3) Indian tax slabs hardcoded as constants rather than versioned data files — prevent by building a per-financial-year rules layer before writing any slab calculation. A deduction coverage gap (old regime requires 80C + 80D + HRA + standard deduction at minimum to produce a valid comparison) is the most likely source of a subtle, hard-to-detect bug at launch.

## Key Findings

### Recommended Stack

The existing stack handles all UI and AI needs. The only net-new production dependencies are: `multer` (file uploads), `cors` + `helmet` + `express-rate-limit` (server hardening), `pdf-parse` (text extraction from Form 16 PDFs), and `concurrently` (parallel dev scripts). All required chart types — waterfall, stacked bar, line, composed — are available natively in Recharts 3.8.1 already installed; adding a second chart library would double bundle weight for no gain. Iframe communication uses native `postMessage` (no Penpal needed). The TypeScript server runs via `tsx watch` already present as a dev dependency.

**Core technologies (new additions only):**
- `multer@2.1.1`: multipart file upload middleware for Express — industry standard, memoryStorage keeps PDFs in RAM buffer for direct Gemini Files API upload
- `cors@2.8.6`: CORS headers for dev/embed separation — handles preflight OPTIONS correctly (manual `res.setHeader` does not)
- `helmet@8.1.0`: 13 security response headers in one call including CSP `frame-ancestors` — essential for iframe embed context
- `express-rate-limit@8.3.2`: per-IP throttling on `/api/*` routes — prevents quota exhaustion on Gemini API
- `pdf-parse@2.4.5`: plain text extraction from PDFs — 2M weekly downloads, no native bindings, sufficient for Form 16 text sent to Gemini
- `concurrently@^9.x`: runs Vite + Express together with one `npm run dev` command

**Critical version note:** multer v2 targets Express 4.x; Express 5 support is experimental. The project uses Express 4.21.2 — no concern.

### Expected Features

The most important finding from feature research is the dependency ordering: Express backend must ship before document upload, and the old/new regime calculator must be correct (including rebate 87A and cess) before the dashboard visualization is meaningful. Tax calculations are client-side but must use versioned tax-rules data structures to survive annual Finance Act changes.

**Must have (table stakes):**
- Old vs new regime income tax comparison side-by-side with 87A rebate auto-applied — every major Indian tax tool does this; regime choice is critical for FY 2025-26 (₹12L zero-tax threshold is new this year)
- Section 80C / 80D / HRA deduction inputs for old regime — without these the old regime always appears worse than it is, giving incorrect switch advice
- Capital gains calculator (equity LTCG/STCG with FY 2024-25 rate changes: LTCG 12.5%, STCG 20%) — rates changed in Budget 2024-25; users are actively recalculating
- Form 16 PDF upload + parsed summary display — highest perceived value; most salaried users have Form 16 from employer
- Document-aware chat Q&A (file URI passed to Gemini with each message) — the AI differentiator over plain calculators
- Tax breakdown visualization tied to calculator output (waterfall or stacked bar)
- GST calculator (amount + rate + intra/inter-state type) — 30-minute implementation, table stakes for business users
- postMessage height resize + production iframe cleanup — without these Smart Assist embedding has broken scrolling

**Should have (competitive differentiators):**
- Regime recommendation callout with exact savings figure ("Switch to new regime, save ₹X") — trivial computation once base calculator works
- Deduction gap analysis (unused 80C/80D/NPS capacity with tax saving equivalent)
- postMessage theme sync from parent — prevents visual mismatch when Smart Assist uses dark mode
- Capital gains holding-period optimizer hint

**Defer to v2+:**
- Chat-to-calculator pre-fill bridge (requires internal routing state architecture)
- Multi-year document comparison (requires multi-file Gemini context management)
- User accounts + tax history persistence (requires auth system)
- ITR form submission / e-filing integration (legal liability, TRACES API access)
- Real-time AIS/26AS data fetch (requires user credentials — security and legal liability)

### Architecture Approach

The architecture is a feature-folder React SPA over a stateless Express proxy. The key structural decision is that `App.tsx` (currently ~495 lines monolith) is refactored into a thin shell managing only tab state and plugin mode, with business logic extracted into hooks (`useChat`, `useTheme`, `usePluginMode`) and feature components into `src/components/{chat,calculator,documents,charts,layout}/`. The server (`server/`) has three routes and one service singleton; the Gemini SDK instance is created once and shared across routes. Tax calculation runs entirely client-side — the `/api/calculate` endpoint is reserved for future complex edge cases. The client has a single `src/services/api.ts` that handles all `/api/*` fetch calls, making future changes (auth headers, base URL) a one-file edit.

**Major components:**
1. `server/index.ts` + `server/routes/{chat,upload,calculate}.ts` — Express proxy; API key lives here only; multer + Gemini Files API for document handling
2. `server/services/gemini.ts` — GoogleGenAI SDK singleton; reconstructs stateless chat sessions per request from client-sent history
3. `src/services/api.ts` — typed fetch wrapper; single point for all `/api/*` calls including SSE stream reading
4. `src/hooks/useChat.ts` — owns message array, loading state, attachedDocument; replaces the state currently in App.tsx
5. `src/components/calculator/` — TaxCalculator, IncomeInputForm, RegimeComparison; fully client-side deterministic math
6. `src/components/documents/` — DocumentUpload, UploadProgress, DocQAView; depends on Express upload route
7. `src/components/charts/` — WaterfallChart, LineChart, ChartDashboard (new); extends existing ChartRenderer
8. `src/hooks/usePluginMode.ts` + `PluginWrapper.tsx` — postMessage listener with origin allowlist, height-resize publisher

### Critical Pitfalls

1. **API key survives Express migration** — Remove the Vite `define` block for `GEMINI_API_KEY` as the first commit of the Express phase, before writing any proxy code. Verify with `grep -r "AIza" dist/` in CI after every build. If the client still boots after removal, something still holds the key.

2. **postMessage wildcard target origin** — Never use `window.parent.postMessage(data, '*')`. Always specify the Smart Assist domain explicitly. Validate `event.origin` against a hardcoded allowlist on every received message. Tax calculation results and uploaded document content must not be receivable by arbitrary parent pages.

3. **Indian tax slabs hardcoded** — All tax parameters (slabs, standard deduction, 87A rebate threshold, surcharge brackets) must live in versioned data files (`src/data/tax-rules/FY2025-26.ts`) from the first calculator commit. The calculator function must accept `taxRules` as a parameter, never reference year-specific constants directly. FY 2025-26 has materially different values from FY 2024-25 (rebate ₹60K vs ₹25K; standard deduction ₹75K vs ₹50K).

4. **Old regime deductions incomplete** — Old regime must include at minimum 80C, 80D, HRA, and standard deduction before the comparison feature ships. Missing deductions cause the old regime to appear systematically worse, giving users incorrect switch advice. Build deductions as a pluggable data structure (array of `{ section, limit, label, applicableRegimes }`) from the start.

5. **Multer without size/type limits** — Configure multer with `limits: { fileSize: 10 * 1024 * 1024 }` and a `fileFilter` allowing only `application/pdf` and `image/*`. Validate magic bytes server-side (first 4 bytes of Buffer: `%PDF` = `25 50 44 46`). Without these, a 200MB file crashes the Node process with OOM.

## Implications for Roadmap

Based on research, the dependency chain is unambiguous: the Express backend is a prerequisite for document handling, which is a prerequisite for document Q&A. The tax calculator is independent of Express but must precede the dashboard. Plugin mode hardening can be last because basic `?plugin=true` behavior already exists.

### Phase 1: Express Backend Proxy + API Key Migration
**Rationale:** Security prerequisite for all subsequent phases. The API key cannot remain in the Vite client bundle once Express exists. This is the smallest possible change that establishes the server skeleton and verifies the dev setup before feature work begins.
**Delivers:** Express server with helmet/cors/rate-limit, Vite proxy config, chat route migrated from client to server, API key removed from bundle, `src/services/api.ts`, `src/hooks/useChat.ts`
**Addresses features from FEATURES.md:** Express backend proxy (P1 prerequisite)
**Avoids pitfalls:** API key in client bundle (Pitfall 1), CORS wildcard (Pitfall 2), CSP frame-ancestors missing (Pitfall 5), streaming breaks behind proxy (Pitfall 3)
**Research flag:** Standard pattern — Vite + Express monorepo is well-documented; no additional research needed

### Phase 2: App.tsx Refactoring + Component Architecture
**Rationale:** The monolith split must happen before new features are added. Adding a calculator and document upload to a 495-line App.tsx would make it unmanageable. Extract in dependency order: leaf components first, then hooks, then containers.
**Delivers:** ChatView, MessageBubble, ChatInput, Sidebar, Header components extracted; useChat, useTheme hooks; App.tsx reduced to shell; tab state for Calculator/Chat/Dashboard views
**Addresses features from FEATURES.md:** Foundation for all subsequent features
**Avoids pitfalls:** Prop drilling / Context hell (Pitfall 6) — establish state ownership map before splitting; existing JSON-chart flow preserved (Pitfall 11)
**Research flag:** Standard React refactoring — no research needed; follow ARCHITECTURE.md build order exactly

### Phase 3: Tax Calculator (Old/New Regime + Capital Gains + GST)
**Rationale:** Client-side only, no new backend dependencies, highest user value after the backend is secured. Build with versioned tax-rules data structure from the first commit.
**Delivers:** TaxCalculator, IncomeInputForm, RegimeComparison components; FY2025-26 tax rules data file; old/new regime comparison with 87A rebate + cess; capital gains LTCG/STCG calculator; GST calculator
**Addresses features from FEATURES.md:** All P1 calculator features (old/new regime, 80C/80D/HRA, 87A rebate, cess, capital gains, GST)
**Avoids pitfalls:** Tax slabs hardcoded (Pitfall 9), old regime deductions incomplete (Pitfall 10)
**Research flag:** Tax rules need validation — confirm FY 2025-26 slab values, 87A rebate threshold, and capital gains rates against official Finance Act 2025 before coding constants

### Phase 4: Enhanced Visualizations + Tax Dashboard
**Rationale:** Dashboard is a view layer over calculator outputs. Build after calculator is stable so chart data is realistic and testable.
**Delivers:** WaterfallChart (income → deductions → taxable → tax flow), LineChart, ChartDashboard combining views; backward-compatible extension of existing ChartRenderer JSON schema
**Addresses features from FEATURES.md:** Tax breakdown chart tied to calculator output (P1); interactive dashboard (foundation for P2 deduction gap analysis)
**Avoids pitfalls:** JSON chart schema backward incompatibility (Pitfall 11), Recharts re-render performance (performance traps section)
**Research flag:** Standard Recharts patterns — no research needed; existing Recharts 3.8.1 covers all required chart types per STACK.md

### Phase 5: Document Handling (Form 16 Upload + Document Q&A)
**Rationale:** Requires Express (Phase 1) and the document-aware chat pattern builds on the chat refactor (Phase 2). The Gemini Files API integration is the highest complexity item and should be isolated in its own phase.
**Delivers:** `server/routes/upload.ts` with multer + Gemini Files API; DocumentUpload component with progress state; DocQAView; extracted summary card displaying salary/TDS/deductions from parsed Form 16
**Addresses features from FEATURES.md:** Form 16 PDF upload + parsed summary (P1), document-aware chat Q&A (P1)
**Avoids pitfalls:** Multer without limits (Pitfall 7), Gemini Files API 48h expiry unhandled (Pitfall 8), PDF file type validated by extension only (security section)
**Research flag:** Gemini Files API integration has LOW-confidence edge cases — test password-protected Form 16 PDFs (TRACES format uses PAN+DOB password), image-based vs digital PDFs, and 48h expiry error handling before considering this phase complete

### Phase 6: Iframe Plugin Mode Hardening
**Rationale:** Basic plugin mode already works. Production hardening (postMessage infrastructure, origin validation, height resize, theme sync) can be last since it does not block other features and Smart Assist integration testing is a dependency.
**Delivers:** usePluginMode hook with origin allowlist, PluginWrapper component, postMessage height-resize, theme sync from parent, `frame-ancestors` CSP verified
**Addresses features from FEATURES.md:** postMessage height resize (P1), production iframe cleanup (P1); postMessage theme sync (P2 — add if Smart Assist confirms need)
**Avoids pitfalls:** postMessage wildcard target origin (Pitfall 4), CSP frame-ancestors missing (Pitfall 5)
**Research flag:** Smart Assist integration requirements need confirmation — the exact origin domain, which postMessage events the parent expects, and whether theme sync is required must be validated against actual Smart Assist team before finalizing the API

### Phase Ordering Rationale

- **Security first:** Phase 1 (Express) removes the API key from the client bundle before any feature is built on top of it. Every subsequent phase ships with the secure foundation already in place.
- **Architecture before features:** Phase 2 (refactor) prevents the monolith from becoming unmanageable. Adding a calculator tab to a 495-line App.tsx is feasible; adding a calculator, document upload, and dashboard simultaneously is not.
- **Client-side before server-side features:** Phase 3 (calculator) requires no backend changes and delivers the highest user value, allowing early validation of the domain logic while the more complex Gemini Files API work (Phase 5) is isolated.
- **Visualizations after data:** Phase 4 (dashboard) builds on stable calculator output. Charts with real data are testable; charts against mock data mask rendering bugs.
- **Document handling isolated:** Phase 5 contains the most complex integration (multer + Gemini Files API + pdf-parse + 48h expiry handling). Isolating it prevents its complexity from contaminating other phases.
- **Plugin last:** Phase 6 depends on Smart Assist team coordination for origin configuration. It cannot be fully completed without external input, so it goes last where schedule uncertainty causes the least disruption.

### Research Flags

Phases needing `/gsd:research-phase` during planning:
- **Phase 3 (Tax Calculator):** Tax rule values (slabs, rebate thresholds, surcharge brackets) must be verified against official Finance Act 2025 source before coding. The FY 2025-26 new regime slabs and 87A rebate limit (₹12L) differ materially from FY 2024-25. MEDIUM confidence in FEATURES.md tax values.
- **Phase 5 (Document Handling):** Gemini Files API behavior for password-protected PDFs (TRACES Form 16 format), image-only PDFs, and 48h expiry error responses is flagged LOW confidence in FEATURES.md. Test the end-to-end upload → analysis → follow-up Q&A flow with real Form 16 samples before planning detailed tasks.
- **Phase 6 (Iframe Plugin Mode):** Smart Assist postMessage API contract (event types, expected responses, origin domain) is not documented in research. Needs direct coordination with Smart Assist team before tasks can be specified.

Phases with well-documented standard patterns (skip research):
- **Phase 1 (Express Backend):** Vite + Express proxy monorepo is extensively documented in official Vite docs. Stack and patterns are HIGH confidence.
- **Phase 2 (Refactoring):** Standard React component extraction. No external dependencies or new integrations.
- **Phase 4 (Visualizations):** Recharts 3.x waterfall and stacked bar patterns are documented in official Recharts examples. HIGH confidence.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All new dependencies verified against npm registry and official docs; version compatibility confirmed against existing Express 4.21.2 and React 19 |
| Features | MEDIUM-HIGH | Table stakes features verified against live competitor products (ClearTax, Groww, IT portal); Gemini Files API document handling capabilities flagged LOW confidence pending real-world testing |
| Architecture | HIGH | Vite proxy + Express monorepo pattern verified against official Vite docs; @google/genai SDK patterns verified against official release docs |
| Pitfalls | HIGH (architecture/security), MEDIUM (tax rules) | Security/iframe pitfalls verified against multiple authoritative sources including Microsoft MSRC; Indian tax domain values need annual verification against Finance Act |

**Overall confidence:** HIGH for technical implementation; MEDIUM for tax domain correctness (by design — tax rules change annually)

### Gaps to Address

- **Form 16 password protection:** TRACES-format Form 16 PDFs use PAN+DOB as password. Neither `pdf-parse` nor Gemini Files API has documented behavior for encrypted PDFs. Determine whether to: (a) require digital unencrypted download, (b) prompt user for password client-side and pass to pdf-parse, or (c) rely entirely on Gemini's multimodal PDF handling without text pre-extraction. Validate during Phase 5 planning.
- **Smart Assist postMessage contract:** The exact domain, event type names, and data shapes expected by Smart Assist are unspecified in research. This gap cannot be resolved without coordination with the Smart Assist team. Gate Phase 6 planning on this input.
- **FY selector UX:** Research identifies financial year versioning as critical but does not specify whether to default to the current FY, show a selector, or infer from uploaded Form 16. Decide before Phase 3 tasks are written.
- **Surcharge calculation scope:** Surcharge for income above ₹50L/₹1Cr/₹2Cr is deferred to v2 in the MVP definition, but PITFALLS.md notes it as important for credibility with high-income users. Clarify target audience income range to decide whether to include in Phase 3 MVP.

## Sources

### Primary (HIGH confidence)
- [Vite Server Options — official proxy docs](https://vite.dev/config/server-options) — dev proxy configuration
- [Vite Backend Integration guide](https://vite.dev/guide/backend-integration) — Express integration pattern
- [Gemini Files API — @google/genai release docs](https://googleapis.github.io/js-genai/release_docs/classes/files.Files.html) — upload, URI, 48h expiry
- [Google AI Files API reference](https://ai.google.dev/api/files) — file handling patterns
- [Recharts Waterfall example](https://recharts.github.io/en-US/examples/Waterfall/) — chart type confirmation
- [Recharts StackedBarChart example](https://recharts.github.io/en-US/examples/StackedBarChart/) — chart type confirmation
- [Recharts React 19 compatibility issue #4558](https://github.com/recharts/recharts/issues/4558) — version compatibility
- [Finance Act 2025 Tax Rates — Income Tax India (official)](https://incometaxindia.gov.in/Tutorials/2%20Tax%20Rates.pdf) — FY 2025-26 slab values
- [CSP: frame-ancestors — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors) — iframe security
- [postMessaged and Compromised — Microsoft MSRC Blog](https://msrc.microsoft.com/blog/2025/08/postmessaged-and-compromised/) — postMessage security
- [multer on npm](https://www.npmjs.com/package/multer) / [expressjs/multer GitHub](https://github.com/expressjs/multer) — v2.1.1 confirmed
- [helmet on npm / helmetjs.github.io](https://helmetjs.github.io/) — v8.1.0 confirmed
- [express-rate-limit on npm](https://www.npmjs.com/package/express-rate-limit) — v8.3.2 confirmed

### Secondary (MEDIUM confidence)
- [ClearTax Income Tax Calculator](https://cleartax.in/paytax/taxcalculator) — feature set and competitor baseline
- [Groww Income Tax Calculator](https://groww.in/calculators/income-tax-calculator) — old/new regime UI pattern
- [ClearTax Income Tax Slabs FY 2025-26](https://cleartax.in/s/income-tax-slabs) — slab value cross-reference
- [Gemini PDF Limits — DataStudios](https://www.datastudios.org/post/google-gemini-pdf-reading-file-size-limits-parsing-features-cloud-uploads-and-automation-workflo) — 50MB limit, base64 inflation
- [unpdf vs pdf-parse vs pdfjs-dist comparison (PkgPulse, 2026)](https://www.pkgpulse.com/blog/unpdf-vs-pdf-parse-vs-pdfjs-dist-pdf-parsing-extraction-nodejs-2026) — library selection rationale
- [React iframes Best Practices — LogRocket](https://blog.logrocket.com/best-practices-react-iframes/) — postMessage patterns
- [AI Tax Chatbot Pitfalls — CNBC](https://www.cnbc.com/2026/03/31/ai-tax-help-pitfalls.html) — anti-features and accuracy risks

### Tertiary (LOW confidence)
- [Strongly-typed iframe messaging pattern](https://www.nickwhite.cc/blog/strongly-typed-iframe-messaging/) — TypeScript discriminated union for postMessage types
- [Google Gemini PDF Analysis — Firebase](https://firebase.google.com/docs/vertex-ai/analyze-documents) — document handling capabilities (Firebase-specific, may differ from direct API)

---
*Research completed: 2026-04-04*
*Ready for roadmap: yes*
