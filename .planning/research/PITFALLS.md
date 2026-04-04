# Pitfalls Research

**Domain:** Indian Tax Assistant — Adding Express proxy, PDF parsing, enhanced charts, tax calculator, iframe plugin to existing React app
**Researched:** 2026-04-04
**Confidence:** HIGH (architecture/security pitfalls), MEDIUM (tax calculation rules), HIGH (iframe/postMessage)

---

## Critical Pitfalls

### Pitfall 1: API Key Survives the Migration to Express

**What goes wrong:**
The API key is currently injected into the Vite client bundle via `define`. When adding the Express backend, developers add the proxy routes but forget to remove the Vite `define` block. The key continues to ship in the client bundle alongside the new proxy. Both paths now work — tests pass, but the original vulnerability remains.

**Why it happens:**
The `define` block in `vite.config.ts` is out of sight during server work. Since the client still calls Gemini directly in fallback code paths or tests, CI passes. The key is still visible in `window.__DEFINES__` or the built bundle.

**How to avoid:**
1. Remove `VITE_GEMINI_API_KEY` from `vite.config.ts` `define` block as the **first commit** of the Express phase — before writing any proxy code.
2. If the client still boots, something still has the key. Make the app broken first, then fix it by routing through Express.
3. Run `grep -r "GEMINI_API_KEY" dist/` in CI after every build. Fail the build if found.

**Warning signs:**
- `process.env.GEMINI_API_KEY` or `import.meta.env.VITE_GEMINI_API_KEY` still referenced anywhere in `src/`
- Bundle analyzer shows the key string in client output
- Network tab shows requests going directly to `generativelanguage.googleapis.com` from the browser

**Phase to address:**
Phase: Express Backend Proxy — treat key removal as a prerequisite gate, not an afterthought.

---

### Pitfall 2: CORS Misconfigured to Allow All Origins

**What goes wrong:**
Express is configured with `cors({ origin: '*' })` to stop CORS errors quickly during development. This ships to production. Any website can now proxy requests through your Express server and exhaust your Gemini quota, or exfiltrate uploaded document content.

**Why it happens:**
Wildcard CORS stops the immediate error, developers move on, and the configuration never gets tightened. The risk is invisible until the API quota is drained.

**How to avoid:**
Set explicit origin allowlist from day one:
```javascript
const ALLOWED_ORIGINS = [
  'http://localhost:5173',         // Vite dev
  'https://your-app.domain.com',   // Production
  'https://smart-assist.domain.com' // Smart Assist iframe parent
];
cors({ origin: (origin, cb) => {
  if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
  else cb(new Error('Origin not allowed'));
}})
```

**Warning signs:**
- `Access-Control-Allow-Origin: *` visible in response headers in browser devtools
- `cors()` called without an `origin` option

**Phase to address:**
Phase: Express Backend Proxy — set the allowlist before wiring up Gemini proxy routes.

---

### Pitfall 3: Gemini Streaming Breaks Silently Behind a Reverse Proxy

**What goes wrong:**
The Gemini API supports streaming responses (SSE/chunked transfer). The Express proxy works perfectly locally, but in staging/production behind Nginx or Cloudflare the response is buffered — the entire completion arrives at once after a long pause, or times out for long responses. Users see a frozen spinner for 10–30 seconds.

**Why it happens:**
Nginx buffers proxy responses by default. Cloudflare caches responses. Neither announces this failure loudly — the response eventually arrives, so tests pass but UX is broken. The current prototype is not streaming, so this only emerges after streaming is added.

**How to avoid:**
Set anti-buffering headers explicitly in the Express response before piping the Gemini stream:
```javascript
res.setHeader('X-Accel-Buffering', 'no');     // Nginx
res.setHeader('Cache-Control', 'no-cache, no-transform');
res.setHeader('Content-Type', 'text/event-stream');
res.flushHeaders();
```
Add `proxy_buffering off;` in Nginx config for the Express upstream. Test streaming behavior explicitly in staging, not just localhost.

**Warning signs:**
- Response arrives all at once in production but streams locally
- Very long apparent latency before first token appears
- `Content-Length` header present on streaming response (should be absent)

**Phase to address:**
Phase: Express Backend Proxy — add streaming headers before deploying to any environment with a reverse proxy.

---

### Pitfall 4: postMessage Uses Wildcard Target Origin

**What goes wrong:**
The iframe communicates with the Smart Assist parent using `window.parent.postMessage(data, '*')`. Any malicious page that embeds the tax assistant can receive those messages. If the messages include user document data, tax calculation results, or session tokens, those are exfiltrated.

**Why it happens:**
`'*'` is the obvious way to make postMessage "just work" without knowing the parent URL at development time. It ships because there is no visible error and tests pass.

**How to avoid:**
1. Require the parent origin to be passed as a URL param or postMessage handshake before sending any data back.
2. Always specify target origin explicitly: `window.parent.postMessage(data, 'https://smart-assist.domain.com')`.
3. On the listener side, validate `event.origin` against a hardcoded allowlist before processing any message.
```javascript
window.addEventListener('message', (event) => {
  if (!ALLOWED_ORIGINS.includes(event.origin)) return;
  // process event.data
});
```

**Warning signs:**
- Any `postMessage` call with `'*'` as second argument
- Message listeners that don't check `event.origin`
- No `frame-ancestors` CSP directive in Express response headers

**Phase to address:**
Phase: Iframe Plugin Mode — treat origin validation as a non-negotiable requirement before any data passes through postMessage.

---

### Pitfall 5: CSP frame-ancestors Not Set, Enabling Clickjacking

**What goes wrong:**
Without `Content-Security-Policy: frame-ancestors 'self' https://smart-assist.domain.com`, any website can embed the tax assistant in a hidden iframe, overlay UI elements over it, and use clickjacking to trick users into submitting documents to attacker-controlled forms.

**Why it happens:**
CSP headers require server-side configuration. The React app cannot set its own CSP without a server. Since the current app has no Express server, no CSP exists. Adding Express is the first opportunity to set it — but developers focus on the proxy functionality rather than response headers.

**How to avoid:**
Add a CSP middleware to Express as part of the initial server setup (use `helmet` package):
```javascript
app.use(helmet.contentSecurityPolicy({
  directives: {
    frameAncestors: ["'self'", 'https://smart-assist.domain.com']
  }
}));
```

**Warning signs:**
- No `Content-Security-Policy` header in Express responses
- `X-Frame-Options` header absent (legacy fallback)
- App loads in any random iframe without restriction

**Phase to address:**
Phase: Express Backend Proxy (initial server setup) — helmet should be one of the first three middlewares added.

---

### Pitfall 6: Monolithic App.tsx State Split Causes Prop Drilling or Context Hell

**What goes wrong:**
When splitting `App.tsx` (~495 lines) into components, state that was co-located gets hoisted up to a common ancestor or thrown into multiple Context providers. Either you get 8+ props passed through three levels of components (prop drilling), or you create 4 separate Context providers that nest inside each other. When a new component is added it either doesn't have access to the state it needs, or any state change re-renders the entire tree.

**Why it happens:**
The split is done naively by copy-pasting sections of the monolith into new files. The state that was conveniently in one closure now needs to be shared explicitly, and the path of least resistance is hoisting everything.

**How to avoid:**
1. Before splitting, identify state ownership: UI state (sidebar open/closed) stays local; chat state (messages, loading) lives in one central store or context; theme stays in its own context.
2. Use one of: React Context + useReducer for the chat domain, or a lightweight store (Zustand) if complexity grows.
3. Split in order: extract leaf components (pure render) first, then hooks (data-fetching logic), then container components. Never split a parent before its children.

**Warning signs:**
- A component receives props it doesn't use — only passes them down
- More than 3 props with identical names at different component levels
- Context provider wrapping more than it needs to

**Phase to address:**
Phase: Architecture Refactoring — establish state ownership map before writing any new component file.

---

### Pitfall 7: PDF Upload Accepts All File Types and Has No Size Guard

**What goes wrong:**
A user (or attacker) uploads a 200 MB zip file renamed to `.pdf`, or a JavaScript file, crashing the Node process with an out-of-memory error or executing arbitrary content through naive text extraction. Multer without limits will happily buffer whatever it receives into memory.

**Why it happens:**
`multer({ storage: memoryStorage() })` with no `limits` option is the default example in every tutorial. File type validation is an afterthought.

**How to avoid:**
```javascript
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    cb(null, allowed.includes(file.mimetype));
  }
});
```
Also validate the file's magic bytes server-side (first 4 bytes of Buffer), not just the mimetype header which the client can spoof.

**Warning signs:**
- Multer configured without `limits.fileSize`
- `fileFilter` absent or always calling `cb(null, true)`
- File type check based only on `originalname` extension

**Phase to address:**
Phase: Document Handling — implement limits and validation before the upload endpoint is accessible from the UI.

---

### Pitfall 8: Gemini Files API Uploads Are Temporary — 48-Hour Expiry Not Handled

**What goes wrong:**
A user uploads Form 16 via the Files API. The file URI is stored (even just in React state for a session). After 48 hours — or if the user returns to a persisted session — the URI is referenced but Gemini returns a 404. The app crashes with an unhandled error, or silently sends invalid requests.

**Why it happens:**
The 48-hour expiry is documented but easy to overlook when building the happy path. The file URI looks stable (it has a UUID), so developers assume it persists.

**How to avoid:**
1. Treat file URIs as ephemeral session data — never persist them to localStorage or any storage.
2. Always handle 404/file-not-found errors from Gemini with a specific user message: "Your uploaded document has expired. Please upload it again."
3. If session persistence is needed later, re-upload on session restore rather than storing URIs.

**Warning signs:**
- File URI stored in `localStorage`
- No error handling for `404` on Gemini file references
- User can reference "previously uploaded document" across browser sessions

**Phase to address:**
Phase: Document Handling — add expiry error handling before the feature ships.

---

### Pitfall 9: Indian Tax Slabs Hardcoded — Break Every Budget Cycle

**What goes wrong:**
Tax slabs, exemption limits, Section 87A rebate thresholds, surcharge brackets, and standard deduction amounts are hardcoded as constants in the tax calculator. The Finance Act changes these annually (sometimes mid-year). FY 2025-26 has different new regime slabs than FY 2024-25 (₹12L rebate limit, new slab breakpoints). Hardcoded values make the calculator wrong for every financial year except the one it was built for, with no obvious warning to the user.

**Why it happens:**
Tax values feel like constants — they don't change at runtime. The natural implementation is `const TAX_SLABS = [...]`. Annual budget changes are an operational concern, not a code concern, so developers don't architect for changeability.

**How to avoid:**
1. Define all tax parameters in a single, versioned data file per financial year: `src/data/tax-rules/FY2025-26.ts`, `FY2024-25.ts`.
2. The calculator function takes `taxRules: TaxRules` as a parameter — never references year-specific constants directly.
3. Always display the financial year prominently: "Calculated for FY 2025-26 (AY 2026-27)."
4. Provide a FY selector — even if only two years are supported, the architecture must support adding new years without touching calculator logic.

**Critical FY 2025-26 values that differ from prior year:**
- New regime rebate: ₹60,000 (was ₹25,000) — zero tax up to ₹12L effective income
- New regime standard deduction: ₹75,000 (was ₹50,000)
- New regime slabs: 0%, 5% (4-8L), 10% (8-12L), 15% (12-16L), 20% (16-20L), 25% (20-24L), 30% (>24L)
- Surcharge cap: 25% under new regime (vs 37% under old for >5Cr)
- Health & Education Cess: 4% (unchanged, applied after surcharge)

**Warning signs:**
- `const STANDARD_DEDUCTION = 75000` anywhere in code not tied to a FY year object
- No financial year selector in the calculator UI
- Calculator doesn't show which year it is calculating for

**Phase to address:**
Phase: Tax Calculator — architect the data layer with financial year versioning from the first commit.

---

### Pitfall 10: Old Regime Deductions Are Incomplete — Calculator Gives Wrong Comparison

**What goes wrong:**
The old vs new regime comparison is the core value of the tax calculator. Under the old regime, dozens of deductions apply: 80C (up to ₹1.5L), 80D (health insurance), 80E (education loan interest), HRA exemption, LTA, NPS 80CCD(1B), home loan interest 24(b), professional tax, etc. If only 80C is implemented, the old regime always appears worse than it actually is, giving users incorrect advice to switch to the new regime when they should stay on the old one.

**Why it happens:**
80C is the most prominent deduction, so it gets implemented first. The complexity of the full deduction set (20+ sections) is underestimated, and "we'll add more later" becomes "never."

**How to avoid:**
1. Build deductions as a pluggable data structure from day one: `{ section: '80C', limit: 150000, label: 'Investments (80C)', applicableRegimes: ['old'] }`.
2. MVP must include at minimum: 80C, 80D, HRA, standard deduction, Section 87A rebate for both regimes, professional tax.
3. Show a disclaimer: "Calculation includes the deductions you've entered. Other deductions may reduce your old regime liability further."
4. Never present the comparison as definitive — always recommend consulting a CA for final decisions.

**Warning signs:**
- Old regime tax always higher than new regime in tests regardless of deduction inputs
- Calculator has only one "investments" input field
- No HRA or home loan interest input

**Phase to address:**
Phase: Tax Calculator — deduction coverage must be reviewed before the compare feature ships to users.

---

### Pitfall 11: Existing JSON-Chart Flow Breaks After Recharts Refactor

**What goes wrong:**
The existing app parses AI responses for embedded JSON chart specs and renders bar/pie charts. When adding waterfall, line, and stacked chart types, the JSON schema is extended. Old messages in the chat (or cached responses) that use the old schema now fail to render or render incorrectly. A type field mismatch causes a blank chart or a React error that crashes the entire message list.

**Why it happens:**
The chart rendering code is changed to support new types but backward compatibility with existing chart JSON shapes is not tested. AI responses are non-deterministic — the model may produce the old format even after the system prompt is updated.

**How to avoid:**
1. Treat chart JSON parsing as defensive: always validate schema before rendering; fall back to a raw JSON code block if schema is invalid.
2. Add a `version` field to chart specs in the AI system prompt and handle both `v1` and `v2` schemas.
3. Write unit tests for the chart parser covering: all current types, unknown type, missing required field, empty data array.
4. Use a discriminated union type: `type ChartSpec = BarChart | PieChart | WaterfallChart | LineChart` so TypeScript forces handling of each.

**Warning signs:**
- Chart renderer throws unhandled errors rather than falling back gracefully
- No tests for the JSON parsing path
- System prompt updated without updating parser to handle both old and new formats

**Phase to address:**
Phase: Enhanced Visualization — add schema validation and fallback before adding new chart types.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `cors({ origin: '*' })` | Stops CORS errors immediately | Any site can proxy through your server; quota exhaustion | Never in production |
| `multer()` without `limits` | Simplest setup | OOM crash on large uploads | Never |
| Hardcoded tax slabs | No data layer needed | Calculator wrong after every Finance Act | Never |
| `postMessage(data, '*')` | Works immediately | Document data exfiltration | Never with sensitive data |
| Gemini API called directly from client during "testing" | Faster iteration | Key re-exposed, CORS headers needed again | Dev-only, env-gated |
| Single monolithic Context for all app state | Simple access anywhere | Re-renders entire tree on any state change | Prototype/early MVP only |
| `pdf-parse` only (no Gemini Files API) | Simple text extraction | Fails on image-based PDFs, scanned Form 16s | Only for guaranteed digital PDFs |
| Financial year hardcoded to current year | Simpler UI | Silent wrong calculations for prior year questions | Never once calculator ships |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Gemini API via Express proxy | Forwarding all headers including `Authorization` from client | Strip all client headers; add API key only on server side |
| Gemini Files API | Using inline base64 for PDFs > 20MB | Use Files API upload then reference URI; 20MB is the inline limit |
| Gemini Files API | Assuming file URI persists across sessions | File expires after 48h; treat URI as ephemeral session data only |
| Gemini streaming | Piping raw Gemini stream to client without setting `Content-Type: text/event-stream` | Set SSE headers before piping; some clients interpret non-SSE chunked responses inconsistently |
| Multer + Express | Adding multer as global middleware | Apply only to specific upload routes — global multer creates unintended upload endpoints |
| Smart Assist iframe parent | Sending postMessage before parent is ready | Send a `ready` message and wait for parent's `ack` before sending data |
| Recharts + React 19 | React 19 compatibility — Recharts 2.x has known issues | Check Recharts issue #4558; as of 2025 Recharts 2.x works with React 19 but with some deprecation warnings; pin version |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Recharts re-renders on every chat message | Charts flash/re-render even when data hasn't changed | Memoize chart data with `useMemo`; memoize components with `React.memo`; stabilize `dataKey` with `useCallback` | With 5+ charts visible simultaneously |
| PDF parsed on every render | Each state update triggers full PDF re-parse | Parse once on upload, store extracted text in component state; never in render path | Immediately — even single document |
| New Context provider per feature (chart ctx, calculator ctx, theme ctx, chat ctx) | Any state update causes cascading re-renders across unrelated components | Split contexts by change frequency: theme (rarely), chat messages (often), UI state (frequent) | When Context tree has 4+ providers |
| Express storing uploaded PDFs in `/tmp` without cleanup | Disk fills up over time | Delete files immediately after processing; or use `memoryStorage` and never write to disk | At moderate request volume |
| Gemini Files API used for every request including text | Unnecessary latency; 48h expiry management overhead | Only use Files API for actual document uploads; text/prompt requests go directly without file upload | Every request |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| API key in Vite `define` after Express migration | Key visible in client bundle; Gemini quota stolen | Remove from `define` before proxy routes are written; grep bundle in CI |
| `frame-ancestors` not set | Clickjacking; tax assistant embedded in attacker-controlled page | Add `helmet` with `frameAncestors` on Express startup |
| No origin validation on `message` event listener | Attacker page sends arbitrary commands to iframe; data exfiltration | Always check `event.origin` against allowlist before processing |
| Wildcard `targetOrigin` in `postMessage` | Tax calculation results and document content sent to any embedding page | Always specify exact parent domain as `targetOrigin` |
| PDF file type validated by extension only | Attacker uploads malicious file as `.pdf` | Validate MIME type AND check first 4 bytes (magic bytes: `%PDF` = `25 50 44 46`) |
| Tax advice without disclaimer | Legal liability; users may rely on incorrect calculations | Always show "for informational purposes only, consult a CA" on calculator output |
| Gemini response content injected directly into DOM | XSS via maliciously crafted AI response | Always render AI content through sanitized markdown renderer, never `dangerouslySetInnerHTML` with raw AI text |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Calculator doesn't show which FY it is calculating for | User assumes current year; gets wrong result for prior year query | Always show "FY 2025-26 (AY 2026-27)" prominently; add year selector |
| Document upload has no progress indicator | User thinks upload failed for large PDFs; uploads multiple times | Show upload progress, then "Analyzing document..." state separately |
| Old/new regime comparison shows only total tax | User cannot understand why one is better | Show line-by-line breakdown: gross income, deductions applied, taxable income, tax before cess, cess, net tax |
| Chart appears inside long AI response with no scroll anchor | User misses chart embedded mid-conversation | Scroll to chart after render; or surface charts in a separate panel |
| PDF parse failure shows generic error | User doesn't know if their PDF is scanned/image-based | Detect image-only PDFs early and show: "This appears to be a scanned document. For best results, use a digital Form 16 downloaded from TRACES." |
| Iframe plugin mode loads standalone theme (full dark UI) | Clashes visually with Smart Assist parent app styling | Expose a `theme` postMessage API so parent can set light/dark; default to `auto` (prefers-color-scheme) |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Express proxy:** Backend routes work locally — verify Gemini API key is **not** present in the Vite-built client bundle (`grep -r "AIza" dist/`)
- [ ] **CORS:** Stops 403 errors — verify `Access-Control-Allow-Origin` is **not** `*` in production response headers
- [ ] **PDF upload:** File uploads successfully — verify size limit rejects files >10MB and non-PDF files are rejected with clear error
- [ ] **Gemini Files API:** PDF analysis works — verify error handling for expired file URI returns user-friendly message, not stack trace
- [ ] **Tax calculator:** Returns a number — verify FY year is displayed, old regime uses at least 80C+80D+HRA+standard deduction, and a disclaimer is shown
- [ ] **Old vs new regime:** Comparison renders — verify old regime is not systematically higher due to missing deductions
- [ ] **Iframe mode:** Renders in iframe — verify `frame-ancestors` CSP header restricts embedding to Smart Assist origin only
- [ ] **postMessage:** Data passes between parent and iframe — verify every `postMessage` specifies exact target origin, never `'*'`
- [ ] **Chart rendering:** New chart types display — verify old-format chart JSON still renders (backward compatibility test)
- [ ] **Recharts + React 19:** Charts render — verify no console errors from React 19 compatibility issues; check Recharts version

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| API key found in production bundle | HIGH | Rotate key immediately in Google AI Studio; redeploy with key removed from client; audit git history for key commits and invalidate if present |
| Tax slab hardcoded wrong (post-budget) | MEDIUM | Add versioned tax rules file; update constants; add "last updated" display to calculator; communicate correction to users |
| postMessage wildcard shipped to production | HIGH | Emergency deploy with fixed origin validation; review server logs for unexpected iframe embeds; notify Smart Assist team |
| Monolith split causes state regression (features stop working) | MEDIUM | Revert component split to last working state; map all state dependencies before re-attempting split; split one component at a time with tests |
| PDF parsing OOM crash in production | MEDIUM | Add `limits.fileSize` to multer immediately; restart Express process; monitor Node memory usage going forward |
| Recharts breaking change causes blank charts | LOW | Pin to last working Recharts version; write regression test; upgrade in isolation |
| Gemini Files API 48h expiry causes silent failures | LOW | Add try/catch with re-upload prompt; no data loss since document is on user's device |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| API key survives migration to Express | Express Backend Proxy | `grep -r "AIza\|GEMINI_API_KEY" dist/` returns empty after build |
| CORS wildcard in production | Express Backend Proxy | Response headers show specific origin, not `*` |
| Streaming breaks behind proxy | Express Backend Proxy | Test streaming with Nginx in staging before feature ship |
| postMessage wildcard target origin | Iframe Plugin Mode | Code review: no `postMessage(data, '*')` anywhere in codebase |
| CSP frame-ancestors missing | Express Backend Proxy (server setup) | `curl -I` shows `Content-Security-Policy: frame-ancestors` header |
| Monolith split causes prop drilling | Architecture Refactoring | No component receives props it doesn't use directly |
| Multer without size/type limits | Document Handling | Upload test: 20MB file rejected; `.js` file rejected |
| Gemini Files API expiry unhandled | Document Handling | Test: expired URI returns user-friendly message |
| Tax slabs hardcoded | Tax Calculator | No numeric tax constants outside versioned data files |
| Old regime deductions incomplete | Tax Calculator | Test: user with 80C+80D+HRA inputs gets lower old regime tax than new |
| JSON chart schema backward incompatibility | Enhanced Visualization | All existing chart JSON fixtures still render after schema extension |
| Recharts re-render performance | Enhanced Visualization | React DevTools profiler: chart components do not re-render on unrelated state changes |

---

## Sources

- [React security in 2025: protect your UI and API without complexity](https://www.etixio.com/en/blog/security-react-2025/)
- [PostMessage Vulnerabilities: When Cross-Window Communication Goes Wrong](https://medium.com/@instatunnel/postmessage-vulnerabilities-when-cross-window-communication-goes-wrong-4c82a5e8da63)
- [postMessaged and Compromised — Microsoft MSRC Blog](https://msrc.microsoft.com/blog/2025/08/postmessaged-and-compromised/)
- [CSP: frame-ancestors — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)
- [Gemini Files API documentation](https://ai.google.dev/gemini-api/docs/files)
- [Recharts Performance Guide](https://recharts.github.io/en-US/guide/performance/)
- [Best React chart libraries 2025 — LogRocket](https://blog.logrocket.com/best-react-chart-libraries-2025/)
- [Income Tax Slabs FY 2025-26 — ClearTax](https://cleartax.in/s/income-tax-slabs)
- [Tax Rates: Surcharge & Cess AY 2025-26 and 2026-27 — Taxmann](https://www.taxmann.com/post/blog/tax-rates-surcharge-cess)
- [Finance Act 2025 Tax Rates — Income Tax India (official)](https://incometaxindia.gov.in/Tutorials/2%20Tax%20Rates.pdf)
- [Multer: Node.js middleware for multipart/form-data](https://github.com/expressjs/multer)
- [Streaming LLM responses — SSE to real-time UI](https://dev.to/hobbada/the-complete-guide-to-streaming-llm-responses-in-web-applications-from-sse-to-real-time-ui-3534)
- [Server-Sent Events not production ready — DEV Community](https://dev.to/miketalbot/server-sent-events-are-still-not-production-ready-after-a-decade-a-lesson-for-me-a-warning-for-you-2gie)
- [React state management 2025 — developerway](https://www.developerway.com/posts/react-state-management-2025)
- [Recharts React 19 compatibility — GitHub issue #4558](https://github.com/recharts/recharts/issues/4558)

---
*Pitfalls research for: Indian Tax Assistant v1.0 — Feature Addition to Existing React App*
*Researched: 2026-04-04*
