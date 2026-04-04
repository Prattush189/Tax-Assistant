# Phase 1: Express Backend + API Key Migration - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Move all Gemini API calls from client-side to an Express backend proxy. Remove the API key from the Vite client bundle. Set up the dev environment (Vite proxy + Express via concurrently) and production deploy configuration (aaPanel + Apache + PM2). Establish file upload endpoint with multer. Apply security middleware (CORS, Helmet, rate limiting).

</domain>

<decisions>
## Implementation Decisions

### API Route Design
- `/api/chat` streams responses via Server-Sent Events (SSE) — words appear as Gemini generates them
- Client sends full conversation history with each request — server stays stateless, no session storage
- `/api/upload` accepts file and immediately processes through Gemini Files API — returns file URI + initial analysis summary in one response
- Basic request validation: max message length (~4000 chars), max history (~50 messages), file size limit (10MB), MIME type validation (PDF + image)

### Dev Environment
- Single `npm run dev` command starts both Vite (:3000) and Express (:4000) via concurrently
- Single `.env` file at project root — loaded by both Vite (non-secret vars) and Express (API key)
- Server code in TypeScript using `tsx watch` (already a dev dependency) — consistent with frontend
- Server code lives in `server/` at project root — clear separation from `src/` (frontend)
- Vite proxies `/api/*` to Express `:4000` in dev mode

### Production Deploy
- Deploy target: aaPanel with Apache on shared hosting at `ai.smartbizin.com`
- Push to GitHub: `https://github.com/Prattush189/Tax-Assistant.git`
- Express runs as PM2 process (auto-restart, log management)
- Apache serves static files (dist/) directly and reverse-proxies only `/api/*` to Express — avoids impacting other sites on the same server
- Express port: Claude's discretion (pick a safe port unlikely to conflict with common services on shared hosting)

### Error Handling
- Gemini API errors → friendly chat message: "I'm having trouble connecting. Please try again in a moment." — no technical details exposed
- Rate limit hit → friendly message: "You're sending messages too fast. Please wait a moment." — with retry hint
- File upload errors (wrong type, too large, corrupted) → inline error text below the upload area, not a chat message
- Server logging: console.error for failures — PM2 captures to log files automatically. No structured logging library needed at this scale.

### Claude's Discretion
- Express production port number (something safe for shared hosting)
- Apache ProxyPass configuration details
- Exact rate limit thresholds (requests per minute)
- SSE event format and reconnection strategy
- CORS allowed origins list structure

</decisions>

<specifics>
## Specific Ideas

- Must not affect other websites on the same shared hosting server — isolation is important
- The existing `?plugin=true` URL param for iframe mode should continue working through this migration
- The current chat UX (typing animation, message bubbles) should feel faster with streaming, not slower

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-express-backend-api-key-migration*
*Context gathered: 2026-04-04*
