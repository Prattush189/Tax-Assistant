---
phase: 06-iframe-plugin-mode-hardening
verified: 2026-04-04T10:00:00Z
status: human_needed
score: 8/9 must-haves verified
re_verification: false
human_verification:
  - test: "Verify height postMessage reaches parent in a real two-frame setup"
    expected: "TAX_ASSISTANT_HEIGHT messages appear in parent window console with increasing height values as content changes; TAX_ASSISTANT_READY fires on mount"
    why_human: "postMessage to window.parent only works cross-frame. Dev-console testing via window.postMessage goes to the same frame. Requires an actual parent page embedding the app in an iframe to confirm the message crosses the frame boundary."
  - test: "Verify theme sync from parent frame (PLUG-04 end-to-end)"
    expected: "Parent sends SET_THEME {dark:true} and the embedded iframe switches to dark mode visually"
    why_human: "Origin validation requires the event.origin to match ALLOWED_ORIGINS. In dev, the origin is localhost which IS in ALLOWED_ORIGINS, but the real integration needs confirmation that the production Smart Assist origin (https://ai.smartbizin.com) triggers the theme change end-to-end."
  - test: "Verify no horizontal overflow at 400px plugin viewport"
    expected: "All three Calculator sub-tabs and Dashboard render without horizontal scrollbar at 400px viewport width"
    why_human: "CSS overflow behavior at exact pixel widths requires browser rendering; cannot be confirmed by code inspection alone."
---

# Phase 6: iframe Plugin Mode Hardening — Verification Report

**Phase Goal:** The app embeds seamlessly in Smart Assist as an iframe with correct height sizing, origin-validated messaging, and theme sync
**Verified:** 2026-04-04T10:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When embedded with ?plugin=true, iframe sends TAX_ASSISTANT_HEIGHT postMessage on every content height change | VERIFIED (code) / ? human | `usePluginMode.ts` L20-28: ResizeObserver on `document.body` posts `{ type: 'TAX_ASSISTANT_HEIGHT', payload: { height } }` to `PARENT_ORIGIN`. Cleanup: `resizeObserver.disconnect()`. Cross-frame delivery requires human test. |
| 2 | TAX_ASSISTANT_READY signal sent on mount before height messages begin | VERIFIED | `usePluginMode.ts` L18: `window.parent.postMessage({ type: 'TAX_ASSISTANT_READY' }, PARENT_ORIGIN)` executes synchronously inside the effect before ResizeObserver observes. |
| 3 | When parent sends SET_THEME {dark: true/false}, iframe switches theme without UI action | VERIFIED (code) / ? human | `usePluginMode.ts` L43-47: handler checks origin then calls `onSetTheme(event.data.dark === true)`. `App.tsx` L22-23 passes `setIsDarkMode` from `useTheme` as the callback. `useTheme.ts` L15-22: `setIsDarkMode` triggers `useEffect` that adds/removes `dark` class on `document.documentElement`. End-to-end cross-frame delivery needs human confirmation. |
| 4 | postMessage events from unrecognized origins are silently discarded | VERIFIED | `usePluginMode.ts` L44: `if (!ALLOWED_ORIGINS.includes(event.origin)) return;` — strict array equality check, no wildcard or substring match. No side effects on discard. |
| 5 | CSP frame-ancestors permits only ai.smartbizin.com in production, localhost variants in dev | VERIFIED | `server/index.ts` L29-31: env-conditional `frameAncestors`: production `["'self'", 'https://ai.smartbizin.com']`, dev `["'self'", 'http://localhost:3000', 'http://localhost:5173']`. No wildcard `'*'` anywhere in frameAncestors. |
| 6 | Plugin mode header shows "Tax Assistant" label and theme toggle; tab nav absent | VERIFIED | `Header.tsx` L47: `isPluginMode ? 'Tax Assistant' : 'Indian Tax Assistant'`. L53-70: tab nav wrapped in `{!isPluginMode && (...)}`. Theme toggle button always rendered (L73-78). |
| 7 | Sidebar hidden in plugin mode | VERIFIED | `App.tsx` L36-43: Sidebar rendered inside `{!isPluginMode && (...)}`. |
| 8 | Calculator tab bar wraps at narrow widths (no horizontal overflow) | VERIFIED (code) | `CalculatorView.tsx` L21: `flex flex-wrap gap-1` on tab bar div — buttons wrap rather than overflow. Visual confirmation needs human test at 400px. |
| 9 | Dashboard summary cards and waterfall chart handle narrow widths | VERIFIED (code) | `TaxSummaryCards.tsx` L35: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` — stacks at narrow widths. `DashboardView.tsx` L36-38: `TaxWaterfallChart` wrapped in `overflow-x-auto`. `CapitalGainsTab.tsx` L233: indexation comparison wrapped in `overflow-x-auto` with `min-w-[280px]`. |

**Score:** 9/9 truths have correct implementation — 3 require human cross-frame or visual confirmation.

---

### Required Artifacts

#### Plan 06-01 Artifacts (PLUG-01, PLUG-02, PLUG-04)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/hooks/useTheme.ts` | Exposes `setIsDarkMode` in return object | VERIFIED | L26-29: returns `{ isDarkMode, setIsDarkMode, toggleTheme }`. `setIsDarkMode` is the raw `useState` setter — stable identity, no wrapping needed. |
| `src/hooks/usePluginMode.ts` | ResizeObserver height reporter, origin-validated message handler, theme sync | VERIFIED | L1: imports `useMemo, useEffect`. L3: accepts `onSetTheme?` param. L20-28: ResizeObserver. L38-55: message listener with `ALLOWED_ORIGINS.includes()` guard. L57: returns `{ isPluginMode }`. |
| `src/App.tsx` | `setIsDarkMode` wired into `usePluginMode(setIsDarkMode)` call | VERIFIED | L22: `const { isDarkMode, toggleTheme, setIsDarkMode } = useTheme()`. L23: `const { isPluginMode } = usePluginMode(setIsDarkMode)`. |
| `server/index.ts` | Env-conditional frame-ancestors; no production wildcard | VERIFIED | L29-31: `process.env.NODE_ENV === 'production' ? ["'self'", 'https://ai.smartbizin.com'] : ["'self'", 'http://localhost:3000', 'http://localhost:5173']`. |

#### Plan 06-02 Artifacts (PLUG-03)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/calculator/CalculatorView.tsx` | `flex-wrap` on tab bar | VERIFIED | L21: `flex flex-wrap gap-1` on the tab container div. |
| `src/components/calculator/CapitalGainsTab.tsx` | `overflow-x-auto` on wide containers | VERIFIED | L233: `overflow-x-auto` wraps the indexation comparison `grid-cols-2` with `min-w-[280px]`. |
| `src/components/dashboard/DashboardView.tsx` | `overflow-x-auto` on chart | VERIFIED | L36-38: `TaxWaterfallChart` wrapped in `<div className="overflow-x-auto">`. |
| `src/components/dashboard/TaxSummaryCards.tsx` | Responsive grid (not bare `grid-cols-2`) | VERIFIED | L35: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/App.tsx` | `src/hooks/usePluginMode.ts` | `usePluginMode(setIsDarkMode)` call | VERIFIED | `App.tsx` L23: exact pattern `usePluginMode(setIsDarkMode)` present. |
| `src/hooks/usePluginMode.ts` | `src/hooks/useTheme.ts` | `onSetTheme` callback calling `setIsDarkMode` | VERIFIED | `usePluginMode.ts` L45-47: `onSetTheme(event.data.dark === true)` — the callback IS `setIsDarkMode` as wired by App.tsx. `useTheme.ts` L4: `setIsDarkMode` is the useState setter that drives the theme effect. |
| `src/hooks/usePluginMode.ts` | `window.parent` | `postMessage TAX_ASSISTANT_HEIGHT` | VERIFIED (code) | L23-25: `window.parent.postMessage({ type: 'TAX_ASSISTANT_HEIGHT', payload: { height } }, PARENT_ORIGIN)`. Never uses `'*'` as targetOrigin. |
| `src/App.tsx` | `src/hooks/usePluginMode.ts` | `isPluginMode` flag controls layout branches | VERIFIED | `App.tsx` L34, L36, L66: `isPluginMode` gates sidebar render, border style, and overlay. `Header.tsx` L33, L36, L47, L53: `isPluginMode` gates compact height, menu button, label, and tab nav. |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PLUG-01 | 06-01-PLAN.md | Iframe communicates content height to parent via postMessage for seamless embedding | SATISFIED | `usePluginMode.ts`: ResizeObserver on `document.body` sends `TAX_ASSISTANT_HEIGHT` with `Math.ceil(entry.contentRect.height)` to `PARENT_ORIGIN`. Cleanup on unmount. |
| PLUG-02 | 06-01-PLAN.md | Iframe validates parent origin against allowlist on all received postMessage events | SATISFIED | Client: `ALLOWED_ORIGINS.includes(event.origin)` guard in message handler (`usePluginMode.ts` L44). Server: CSP `frameAncestors` is env-conditional with no production wildcard (`server/index.ts` L29-31). |
| PLUG-03 | 06-02-PLAN.md | Plugin mode hides unnecessary chrome (sidebar, resource links) and adapts layout for constrained widths | SATISFIED (code) | Sidebar hidden (`App.tsx` L36). Tab nav hidden (`Header.tsx` L53). `flex-wrap` on Calculator tabs. `overflow-x-auto` on wide containers. Responsive grid in TaxSummaryCards. Visual 400px check needs human. |
| PLUG-04 | 06-01-PLAN.md | Parent can sync theme (dark/light) to iframe via postMessage | SATISFIED (code) | Full chain: `SET_THEME` event → origin check → `onSetTheme(dark)` → `setIsDarkMode` setter → `useEffect` applies/removes `dark` class on `document.documentElement`. End-to-end cross-frame delivery needs human. |

**Orphaned requirements check:** REQUIREMENTS.md maps PLUG-01 through PLUG-04 to Phase 6 only. All four are claimed by plans 06-01 and 06-02. No orphaned requirements.

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None | — | — | — |

No TODO/FIXME/HACK comments, no placeholder returns, no `postMessage(data, '*')` wildcard, no stub implementations found in any phase 6 modified file.

---

### TypeScript Compilation

`npx tsc --noEmit` exits with zero errors. All hook signatures, callback types, and JSX are type-safe.

---

### Commit Verification

All commits documented in SUMMARYs exist in git log:

| Commit | Task | Status |
|--------|------|--------|
| `5bc4192` | feat(06-01): implement postMessage height reporter, origin validator, and theme sync | VERIFIED |
| `d7d528a` | fix(06-01): tighten CSP frame-ancestors from wildcard to exact origin allowlist | VERIFIED |
| `7680709` | feat(06-02): add overflow-x-auto and responsive grid classes for 400px plugin mode | VERIFIED |

---

### Human Verification Required

The following items have correct code implementations but require a real browser or cross-frame setup to confirm end-to-end delivery.

#### 1. Height postMessage crosses the frame boundary (PLUG-01)

**Test:** Create a minimal HTML page that embeds `http://localhost:5173?plugin=true` in an `<iframe>`. Add `window.addEventListener('message', e => console.log(JSON.stringify(e.data)))` to the parent page. Load the parent page and interact with the embedded app.

**Expected:** `{ "type": "TAX_ASSISTANT_READY" }` appears in the parent console on iframe load, followed by `{ "type": "TAX_ASSISTANT_HEIGHT", "payload": { "height": <number> } }` messages as content changes.

**Why human:** `window.parent.postMessage` only delivers to a real parent frame. Dev-console testing via `window.postMessage` goes to the same frame (not the parent), so automated grep cannot verify cross-frame delivery.

#### 2. Theme sync from parent (PLUG-04 end-to-end)

**Test:** From the parent test page above, run `document.querySelector('iframe').contentWindow` — or better, send a message from the parent frame:
```js
document.querySelector('iframe').contentWindow.postMessage(
  { type: 'SET_THEME', dark: true },
  'http://localhost:5173'
);
```

**Expected:** The iframe visually switches to dark mode. Light-mode toggle reverses it.

**Why human:** Origin validation ensures the message is accepted only when `event.origin` matches `ALLOWED_ORIGINS`. This can only be truly verified cross-frame, where the origin is set by the browser.

#### 3. No horizontal overflow at 400px (PLUG-03)

**Test:** Open `http://localhost:5173?plugin=true` in Chrome. Open DevTools, set viewport to 400px. Navigate through Chat, Calculator (Income Tax, Capital Gains, GST sub-tabs), and Dashboard.

**Expected:** No horizontal scrollbar on the page. All content either wraps, stacks, or scrolls within its own `overflow-x-auto` container — not the viewport.

**Why human:** CSS overflow at exact pixel thresholds requires browser layout rendering.

---

### Summary

Phase 6 implementation is complete and correct at the code level. All four PLUG requirements have substantive, non-stub implementations:

- **PLUG-01 (height reporting):** ResizeObserver fires on every `document.body` size change and posts `TAX_ASSISTANT_HEIGHT` with exact origin targeting — never a wildcard.
- **PLUG-02 (origin validation + CSP):** Client enforces `ALLOWED_ORIGINS.includes(event.origin)` before any handler action. Server CSP `frameAncestors` is env-conditional with no production wildcard.
- **PLUG-03 (layout hardening):** Sidebar and tab nav hidden via `isPluginMode` guards. Tab bar uses `flex-wrap`. Wide containers use `overflow-x-auto`. Summary cards use responsive `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`.
- **PLUG-04 (theme sync):** Full chain implemented — `SET_THEME` message → origin guard → `onSetTheme` callback → `setIsDarkMode` → DOM class toggle.

Three human tests remain to confirm cross-frame message delivery and visual overflow behavior. These cannot be automated by grep. All other automated checks pass.

---

_Verified: 2026-04-04T10:00:00Z_
_Verifier: Claude (gsd-verifier)_
