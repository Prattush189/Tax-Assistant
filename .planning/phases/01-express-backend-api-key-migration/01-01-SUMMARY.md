---
phase: 01-express-backend-api-key-migration
plan: 01
subsystem: express-server
tags: [express, security, middleware, helmet, cors, rate-limiting, typescript]
dependency_graph:
  requires: []
  provides: [express-server-foundation, security-middleware-stack, chat-request-validation]
  affects: [plan-02-chat-route, plan-03-upload-route]
tech_stack:
  added: [helmet@8.1.0, cors@2.8.6, express-rate-limit@8.3.2, multer@2.1.1, concurrently@9.2.1]
  patterns: [ESM-imports, Node16-moduleResolution, express-middleware-stack]
key_files:
  created:
    - server/index.ts
    - server/middleware/validation.ts
    - server/tsconfig.json
  modified:
    - package.json
    - package-lock.json
decisions:
  - "Port 4001 chosen to avoid MySQL :3306, common Node defaults :3000/:4000, Nginx :8080 on shared hosting"
  - "server/tsconfig.json uses Node16 moduleResolution to avoid bundler/Node mismatch with root tsconfig"
  - "frameAncestors set to wildcard initially; tightened in Phase 6 once embedding domain confirmed"
  - "CORS allows localhost:3000 and :5173 in dev; ai.smartbizin.com and smartbizin.com in production"
metrics:
  duration: "2 minutes"
  completed_date: "2026-04-04"
  tasks_completed: 2
  files_changed: 5
---

# Phase 1 Plan 1: Express Server Foundation with Security Middleware Summary

**One-liner:** Express server on port 4001 with helmet (CSP + frame-ancestors), CORS, 30req/min rate limiting on /api/*, 1MB body parsing, and validateChatRequest helper.

## What Was Built

A complete Express server foundation in `server/index.ts` that all API routes will mount onto. The security middleware stack (helmet, cors, rate-limit, express.json) is applied in deliberate order: security headers first, CORS before routes so OPTIONS preflight is handled, rate limiting scoped to `/api/*` only, then body parsing. Alongside this, a `validateChatRequest` helper in `server/middleware/validation.ts` enforces message length (4000 chars) and history size (50 messages) constraints for reuse by route handlers.

A separate `server/tsconfig.json` uses `Node16` module resolution to avoid conflicts with the root tsconfig's `bundler` resolution which is required by Vite but incompatible with server-side Node imports.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install dependencies and create server/tsconfig.json | 68a49e4 | package.json, package-lock.json, server/tsconfig.json |
| 2 | Create server/index.ts and server/middleware/validation.ts | abec55f | server/index.ts, server/middleware/validation.ts |

## Verification Results

- All 5 new packages present in node_modules (concurrently, helmet, cors, express-rate-limit, multer)
- `tsx server/index.ts` starts with output: `[API] Server running on :4001 (development)` — no TypeScript errors
- Helmet, CORS, rate-limit, and body-parsing middleware confirmed in server/index.ts
- server/tsconfig.json uses Node16 moduleResolution
- `validateChatRequest` exported from server/middleware/validation.ts

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- server/index.ts: FOUND
- server/middleware/validation.ts: FOUND
- server/tsconfig.json: FOUND
- Commit 68a49e4: FOUND
- Commit abec55f: FOUND
