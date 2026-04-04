# Stack Research

**Domain:** React chat app — Express backend proxy, enhanced visualizations, tax calculator UI, PDF document handling, iframe plugin hardening
**Researched:** 2026-04-04
**Confidence:** HIGH (all critical decisions verified against npm registry data and official docs)

---

> This file covers ONLY new additions. The existing stack (React 19, TypeScript, Vite, Tailwind CSS v4, @google/genai, Recharts 3.x, react-markdown, motion, lucide-react, clsx, tailwind-merge) is already installed and validated.

---

## Recommended Stack — New Additions

### Express Backend

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `multer` | `^2.1.1` | Multipart form-data / file upload handling | The standard Express file upload middleware. v2 is the major rewrite with ESM support and active maintenance. Integrates directly with the `express` instance already in the project. |
| `cors` | `^2.8.6` | CORS headers for dev/embed separation | Without this, the Vite dev server (port 3000) cannot call the Express API server (port 3001). Required when frontend and backend run on different ports. |
| `helmet` | `^8.1.0` | HTTP security headers | Sets 13 security response headers in one call (CSP, X-Frame-Options, HSTS, etc.). Critical for the iframe embed context where the parent Smart Assist platform may inspect frame headers. |
| `express-rate-limit` | `^8.3.2` | Per-IP request throttling on API proxy | The Gemini API has per-minute quotas. Without rate limiting, a single malicious user (or a bug in the UI) can exhaust quota. Standard protection for any public-facing AI proxy. |
| `@types/multer` | `^2.1.0` | TypeScript types for multer | multer v2 ships without bundled types; this provides them. Dev dependency only. |
| `@types/cors` | `^2.8.17` | TypeScript types for cors | cors ships without bundled types. Dev dependency only. |

### PDF / Document Parsing

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `pdf-parse` | `^2.4.5` | Extract plain text from uploaded PDFs (Form 16, salary slips) | Returns text per page + metadata in a single async call. No native bindings, no binary dependencies — works as-is on Node.js. For a tax assistant that needs to read salary figures and TDS data from standard government-format PDFs, raw text extraction is sufficient. pdf-parse v2 (last published ~5 months ago) shows more recent maintenance than the stale v1 line. |

> **Why not unpdf?** unpdf (~200K weekly downloads vs pdf-parse's ~2M) is designed for edge/serverless runtimes and bundles a full pdfjs distribution (~4MB). This project runs a standard Node.js Express server, so the added bundle weight and younger ecosystem are not worthwhile. Use unpdf if the backend ever moves to Cloudflare Workers or similar edge runtimes.
>
> **Why not pdfjs-dist directly?** pdfjs-dist provides pixel-accurate character positioning (x/y coordinates), which is valuable for form field extraction but adds significant complexity. Form 16 and salary slips are text-dense PDFs where sequential text extraction (what pdf-parse gives) is sufficient for Gemini to interpret. If structured field parsing becomes necessary later, migrate to pdfjs-dist at that point.

### Visualizations (Recharts Extensions)

No new chart library is needed. Recharts 3.8.1 (already installed) covers all required chart types natively:

| Feature | Recharts API | Notes |
|---------|-------------|-------|
| Waterfall chart | `BarChart` + range values `[low, high]` + custom `shape` prop | Official Recharts example at recharts.github.io/en-US/examples/Waterfall uses this pattern. No additional library. |
| Stacked bar chart | `BarChart` with `stackId` on each `Bar` | Supported in v3. Example: recharts.github.io/en-US/examples/StackedBarChart |
| Line chart | `LineChart` or `ComposedChart` | Already available in Recharts. |
| Multi-series composed | `ComposedChart` mixing `Bar`, `Line`, `Area` | Single component handles all combinations. |
| Interactive tooltips | `Tooltip` with `cursor` prop + `Brush` for zoom | Built-in. `Brush` component enables range zoom/pan. |
| Interactive dashboard | `ResponsiveContainer` wrapping charts | Already in Recharts — makes charts reactive to container size changes. |

### Iframe Plugin Hardening

No library is needed. postMessage is a browser-native API. The implementation is a typed wrapper:

| Pattern | Implementation | Why |
|---------|---------------|-----|
| postMessage to parent | `window.parent.postMessage(payload, allowedOrigin)` | Native. Do NOT use `*` as target origin — always pass the specific Smart Assist origin. |
| Receive messages from parent | `window.addEventListener('message', handler)` + origin validation | Native. Validate `event.origin` against an allowlist on every received message. |
| TypeScript message types | Discriminated union type for all message shapes | Catches mismatches at compile time. No library needed. |

> **Why not Penpal?** Penpal is a well-maintained promise-based postMessage wrapper, but it adds a dependency for a use case that is only two event listeners and one `postMessage` call. The native API is sufficient and keeps the plugin bundle small — important because this code ships inside the embed script.

### Development Tooling

| Tool | Purpose | Notes |
|------|---------|-------|
| `tsx` | Run the Express server in TypeScript without compilation | Already a dev dependency (`^4.21.0`). Use `tsx server/index.ts` for the backend dev script. No additional tool needed. |
| `concurrently` | Run Vite frontend + Express backend in parallel with one `npm run dev` | Without this, developers need two terminals. Add to devDependencies. |

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `concurrently` | `^9.x` | Parallel process runner for dev | Runs `vite --port 3000` and `tsx server/index.ts --port 3001` together. Standard solution in Vite + Express monorepo setups. |

---

## Installation

```bash
# Backend middleware (production dependencies)
npm install multer cors helmet express-rate-limit

# PDF parsing (production dependency — runs on server only)
npm install pdf-parse

# Parallel dev runner
npm install concurrently

# TypeScript types (dev only)
npm install -D @types/multer @types/cors @types/concurrently
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `pdf-parse` | `unpdf` | When deploying backend to edge/serverless (Cloudflare Workers, Vercel Edge). unpdf is designed for those runtimes. Not needed here. |
| `pdf-parse` | `pdfjs-dist` (direct) | When you need character-level position data for structured form field extraction. Overkill for raw text sent to Gemini. |
| `cors` middleware | Manual `res.setHeader` | Only acceptable if CORS needs are trivially simple (one origin, no preflight). cors middleware handles preflight OPTIONS requests correctly — manual headers frequently miss this. |
| `helmet` defaults | Custom CSP only | If the Smart Assist parent explicitly sets conflicting frame-ancestor policies, you may need to tune helmet's CSP and X-Frame-Options. Start with defaults, adjust per embed requirements. |
| `concurrently` | `npm-run-all` | Either works. concurrently is more widely maintained in 2025 and provides cleaner output coloring per process. |
| Recharts built-in charts | `victory`, `nivo`, `visx` | Only if Recharts cannot satisfy a specific chart type. All required chart types (waterfall, stacked, line, composed) exist in Recharts 3.x. Adding a second chart library doubles bundle weight and creates inconsistent styling. |
| Native postMessage | `penpal` | If the communication protocol becomes complex (bidirectional RPC, multiple methods, timeout handling). For this project's needs (theme sync, query injection, resize), native postMessage is sufficient. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `body-parser` (standalone package) | Redundant since Express 4.16.0. `express.json()` and `express.urlencoded()` are built-in and identical in functionality. Installing body-parser adds a duplicate dependency. | `express.json()` and `express.urlencoded({ extended: true })` — both built into Express 4.x |
| `formidable` | Older multipart parsing library. Multer is the Express-native solution with better stream handling and active maintenance. | `multer` |
| `pdfjs-dist` in browser bundle | pdfjs-dist is a 3MB+ library. Loading it on the client side for "display parsed content" adds massive bundle weight. PDF parsing belongs on the Express server. | Parse on server with `pdf-parse`, send extracted text to client |
| `react-pdf` | A React wrapper around pdfjs-dist for rendering PDFs visually in the browser. This project does not display PDFs — it reads them, sends content to Gemini, and shows AI responses. | Server-side `pdf-parse` + client file upload via `<input type="file">` |
| A second chart library (nivo, victory, visx) | All required chart types exist in Recharts 3.x. Two chart libraries = doubled bundle, visual inconsistency, two sets of docs to maintain. | Recharts `ComposedChart`, `BarChart` with range values |
| `socket.io` or `ws` | WebSockets are not needed. Gemini responses stream via the existing SDK fetch mechanism. The Express backend is a stateless proxy. | Standard Express request/response |

---

## Stack Patterns by Variant

**For the Express API proxy route (Gemini calls):**
- Use `express.json()` for request body parsing
- Use `helmet()` before all routes
- Use `cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') })` to scope to known domains
- Use `express-rate-limit` as middleware on `/api/*` routes, not globally (static file serving should not be rate-limited)

**For file upload routes (document handling):**
- Use `multer({ storage: multer.memoryStorage() })` — store files in memory buffer, not disk, then pass the buffer directly to `pdf-parse` and to Gemini Files API
- Set `limits: { fileSize: 10 * 1024 * 1024 }` (10MB) to prevent oversized PDFs
- Use `fileFilter` to accept only `application/pdf` and `image/*` MIME types

**For Gemini document analysis (multimodal):**
- Use `ai.files.upload()` from `@google/genai` with the PDF buffer — the SDK handles the Files API upload
- Inline small images (<20MB total request) as base64 using `createPartFromBase64`
- Use `ai.files.upload()` for PDFs and larger files (avoids inline base64 bloat)

**For the iframe plugin mode:**
- Read `?mode=plugin` from `URLSearchParams` in React on mount
- In plugin mode: suppress the sidebar, override body background to `transparent`, inject minimal CSS resets
- Send `{ type: 'TAX_ASSISTANT_READY', version: '1.0' }` via postMessage on mount so the parent knows the iframe loaded
- Validate `event.origin` against a hardcoded allowlist (not env var — the client bundle is public) before acting on incoming messages

**For development (Vite + Express together):**
- Configure `vite.config.ts` `server.proxy` to forward `/api/*` to `http://localhost:3001` — eliminates CORS during development
- In production, the Express server serves the built Vite assets from `dist/` and also handles `/api/*` — single process, single port, no CORS needed

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `multer@2.1.1` | `express@4.x` | multer v2 targets Express 4. Express 5 support is experimental in multer v2 as of early 2026. Since the project uses express@4.21.2, this is not a concern. |
| `pdf-parse@2.4.5` | `node@18+` | Requires ESM-compatible Node.js. The `"type": "module"` in package.json means the server must use `import` syntax — pdf-parse v2 is fully ESM. |
| `cors@2.8.6` | `express@4.x` | Compatible. cors has no peer dep constraints on Express version. |
| `helmet@8.1.0` | `express@4.x` | Compatible. Helmet 8.x targets Express 4 and 5. |
| `express-rate-limit@8.3.2` | `express@4.x` | Compatible. Uses Express middleware signature. |
| `recharts@3.8.1` | `react@19` | Confirmed compatible. recharts 3.x rewrote state management to be React 18/19 compatible. Minor react-is warning may appear in console (cosmetic only). |

---

## Sources

- [multer on npm](https://www.npmjs.com/package/multer) — version 2.1.1 confirmed, March 2026 activity
- [expressjs/multer GitHub](https://github.com/expressjs/multer) — middleware reference
- [cors on npm](https://www.npmjs.com/package/cors) — version 2.8.6 confirmed
- [helmet on npm / helmetjs.github.io](https://helmetjs.github.io/) — version 8.1.0 confirmed
- [express-rate-limit on npm](https://www.npmjs.com/package/express-rate-limit) — version 8.3.2 confirmed (published 4 days before research date)
- [pdf-parse on npm](https://www.npmjs.com/package/pdf-parse) — version 2.4.5, last published ~5 months ago
- [unpdf vs pdf-parse vs pdfjs-dist comparison (PkgPulse, 2026)](https://www.pkgpulse.com/blog/unpdf-vs-pdf-parse-vs-pdfjs-dist-pdf-parsing-extraction-nodejs-2026) — MEDIUM confidence (third-party blog, aligns with other sources)
- [7 PDF Parsing Libraries for Node.js (Strapi, 2025)](https://strapi.io/blog/7-best-javascript-pdf-parsing-libraries-nodejs-2025) — MEDIUM confidence
- [Recharts Waterfall example](https://recharts.github.io/en-US/examples/Waterfall/) — HIGH confidence (official docs)
- [Recharts StackedBarChart example](https://recharts.github.io/en-US/examples/StackedBarChart/) — HIGH confidence (official docs)
- [Recharts React 19 compatibility issue #4558](https://github.com/recharts/recharts/issues/4558) — HIGH confidence (official GitHub)
- [Gemini File API — official docs](https://ai.google.dev/gemini-api/docs/files) — HIGH confidence
- [Gemini file input methods](https://ai.google.dev/gemini-api/docs/file-input-methods) — HIGH confidence
- [@types/multer on npm](https://www.npmjs.com/package/@types/multer) — version 2.1.0 confirmed
- [Strongly-typed iframe messaging pattern](https://www.nickwhite.cc/blog/strongly-typed-iframe-messaging/) — MEDIUM confidence
- [Vite proxy configuration guide](https://vite.dev/guide/backend-integration) — HIGH confidence (official Vite docs)
- [Express built-in body parsing (express.json)](https://expressjs.com/en/resources/middleware/body-parser.html) — HIGH confidence (official Express docs)

---
*Stack research for: Tax Assistant v1.0 — new feature additions*
*Researched: 2026-04-04*
