# Phase 6: Iframe Plugin Mode Hardening - Research

**Researched:** 2026-04-04
**Domain:** postMessage security, iframe height synchronization, CSP frame-ancestors, theme sync
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PLUG-01 | Iframe communicates content height to parent via postMessage for seamless embedding | ResizeObserver + postMessage pattern; `document.body` as observation target; typed message envelope |
| PLUG-02 | Iframe validates parent origin against allowlist on all received postMessage events | MDN-verified: always check `event.origin` against hardcoded allowlist; `ai.smartbizin.com` is known parent origin |
| PLUG-03 | Plugin mode hides unnecessary chrome (sidebar, resource links) and adapts layout for constrained widths | Already partially implemented; `isPluginMode` hides Sidebar and tab nav; needs constrained-width CSS audit |
| PLUG-04 | Parent can sync theme (dark/light) to iframe via postMessage | Hook extension: listen for `SET_THEME` message type; call existing `setIsDarkMode` from `useTheme` |
</phase_requirements>

---

## Summary

This phase extends the already-functional `?plugin=true` detection to add four production-grade behaviors: automatic height reporting, secure origin-validated message handling, full chrome suppression, and theme sync. The groundwork is nearly complete — `usePluginMode` exists, the Sidebar and tab navigation are already hidden in plugin mode, and the server already has helmet with CSP. The work is targeted additions, not rewrites.

The most technically demanding requirement is PLUG-01 (height sync). The correct pattern uses `ResizeObserver` on `document.body` inside a `useEffect` in `usePluginMode`, posting height changes to the parent via `window.parent.postMessage`. The parent (Smart Assist at `ai.smartbizin.com`) sets the iframe's `style.height` on receipt. This eliminates the iframe's own scrollbar entirely.

Security (PLUG-02) is non-negotiable: every `window.addEventListener('message', ...)` handler must check `event.origin` against a hardcoded allowlist before processing. The `frame-ancestors` CSP directive in `server/index.ts` must be tightened from the current wildcard `'*'` to `'self' 'https://ai.smartbizin.com'`. These two changes together close the clickjacking and message-spoofing attack surfaces documented in PITFALLS.md.

**Primary recommendation:** Extend `usePluginMode` to own the ResizeObserver, postMessage sender, and message listener in one hook. Keep `useTheme` as the source of truth for dark mode — PLUG-04 calls `useTheme`'s setter, not local state. Tighten `server/index.ts` CSP in the same commit as the postMessage listener to keep the security surface in sync.

---

## Standard Stack

### Core (already installed — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Browser `ResizeObserver` | Web API (no npm) | Detects content height changes in iframe | Native API; no library needed; supported in all modern browsers |
| Browser `window.postMessage` | Web API (no npm) | Cross-origin message passing between iframe and parent | W3C standard; only correct mechanism for cross-origin iframe communication |
| `helmet` | ^8.1.0 (already installed) | Sets `Content-Security-Policy: frame-ancestors` | Already in server/index.ts; just needs value changed from `'*'` to specific origin |
| React `useEffect` | React 19 (already installed) | Lifecycle hook to set up/tear down ResizeObserver and message listener | Standard pattern; no external library |

### No New Dependencies Needed

This phase requires **zero new npm packages**. All required browser APIs (`ResizeObserver`, `window.addEventListener('message', ...)`, `window.parent.postMessage`) are native. The server-side CSP change is a one-line edit to the existing helmet configuration.

**Installation:**
```bash
# No installation required — all capabilities are already present
```

---

## Architecture Patterns

### Recommended File Changes

```
src/
├── hooks/
│   └── usePluginMode.ts      # EXTEND: add ResizeObserver + message listener
│
├── hooks/
│   └── useTheme.ts           # READ: need to expose setIsDarkMode for PLUG-04
│
└── components/layout/
    └── Header.tsx             # VERIFY: plugin mode hides theme toggle text label (keep icon)

server/
└── index.ts                   # EDIT: tighten frameAncestors from '*' to specific origin
```

### Pattern 1: ResizeObserver Height Reporter (PLUG-01)

**What:** Inside `usePluginMode`, when `isPluginMode` is true, attach a `ResizeObserver` to `document.body`. On every resize callback, post the height to the parent window with a typed message envelope and the exact parent origin as `targetOrigin`.

**When to use:** Whenever the app is in plugin mode (`isPluginMode === true`).

**Why `document.body` not `document.documentElement`:** `document.body` matches the layout content; `documentElement` includes the browser chrome margin. For a React SPA with `h-screen` on the root div, both return the same value, but `document.body` is the idiomatic choice.

**Why `contentRect.height` not `scrollHeight`:** `ResizeObserver` entries provide `contentRect.height` which is the rendered height without scroll — exactly what the parent needs to set iframe height. `scrollHeight` can be larger than the visible content if overflow is hidden.

**Example:**
```typescript
// src/hooks/usePluginMode.ts
// Source: MDN Web Docs (postMessage), Svix blog (ResizeObserver pattern)

const PARENT_ORIGIN = 'https://ai.smartbizin.com';
const ALLOWED_ORIGINS = [PARENT_ORIGIN];

export function usePluginMode(setTheme?: (dark: boolean) => void) {
  const isPluginMode = useMemo<boolean>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('plugin') === 'true';
    }
    return false;
  }, []);

  // PLUG-01: Send height to parent whenever content changes
  useEffect(() => {
    if (!isPluginMode) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = Math.ceil(entry.contentRect.height);
        window.parent.postMessage(
          { type: 'TAX_ASSISTANT_HEIGHT', payload: { height } },
          PARENT_ORIGIN  // never '*' — always exact origin
        );
      }
    });

    resizeObserver.observe(document.body);
    return () => resizeObserver.disconnect();
  }, [isPluginMode]);

  // PLUG-02 + PLUG-04: Receive messages from parent, validate origin first
  useEffect(() => {
    if (!isPluginMode) return;

    const handler = (event: MessageEvent) => {
      // PLUG-02: Origin validation — silently ignore unrecognized origins
      if (!ALLOWED_ORIGINS.includes(event.origin)) return;

      // PLUG-04: Theme sync
      if (event.data?.type === 'SET_THEME' && setTheme) {
        setTheme(event.data.dark === true);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [isPluginMode, setTheme]);

  return { isPluginMode };
}
```

**Call site in App.tsx:**
```typescript
// App.tsx — pass toggleTheme setter to usePluginMode
const { isDarkMode, toggleTheme, setIsDarkMode } = useTheme();
const { isPluginMode } = usePluginMode(setIsDarkMode);
```

### Pattern 2: CSP frame-ancestors Tightening (PLUG-02 server-side)

**What:** Edit `server/index.ts` to replace the wildcard `frameAncestors: ["'self'", '*']` with the specific Smart Assist origin. This prevents clickjacking by any site other than Smart Assist.

**Example:**
```typescript
// server/index.ts — tighten from current wildcard
// Source: helmet docs, MDN frame-ancestors
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        // CHANGED: was ["'self'", '*'] — tightened for PLUG-02
        frameAncestors: ["'self'", 'https://ai.smartbizin.com'],
      },
    },
  })
);
```

### Pattern 3: useTheme Must Expose Setter (PLUG-04)

**What:** `useTheme` currently returns `{ isDarkMode, toggleTheme }`. PLUG-04 requires setting dark mode directly (not toggling), so the hook must also return `setIsDarkMode`. This is a minimal extension to an existing hook.

**Example:**
```typescript
// src/hooks/useTheme.ts — add setIsDarkMode to return value
export function useTheme() {
  const [isDarkMode, setIsDarkMode] = useState(/* existing init logic */);
  const toggleTheme = () => setIsDarkMode(prev => !prev);
  return { isDarkMode, toggleTheme, setIsDarkMode };
}
```

### Pattern 4: Plugin Mode Layout Constraints (PLUG-03)

**What:** The app already hides Sidebar and tab navigation in plugin mode. The remaining work is ensuring the layout works at constrained iframe widths (Smart Assist sidebar context is likely 400–600px wide). Key items to audit:

- `Header`: already shorter (`h-12 px-4`) in plugin mode. The theme toggle and "AY 2025-26 Ready" label remain visible — verify these don't overflow at 400px.
- `ChatView`: likely fine (flex layout adapts). Verify `ChatInput` textarea does not clip at narrow widths.
- `CalculatorView` / `DashboardView`: these may have horizontal overflow on wide tables — add `overflow-x-auto` wrappers in plugin mode if needed.
- The outer `div` in App.tsx gets `rounded-2xl border` in plugin mode — this is cosmetic and correct.

**No structural changes needed** — existing Tailwind responsive classes handle most of this. The audit is a visual verification task.

### Anti-Patterns to Avoid

- **`postMessage(data, '*')` as targetOrigin:** Any malicious page that embeds the app can intercept height messages. Always use `'https://ai.smartbizin.com'` as the exact target origin. Per MDN: "A malicious site can change the location of the window without your knowledge."
- **Processing messages without origin check:** A handler that acts on `event.data` before checking `event.origin` can be exploited by any page to set the iframe's theme or trigger other behaviors.
- **Using `setInterval` for height polling:** The old approach polls every N ms. `ResizeObserver` fires synchronously with content changes — zero delay, zero wasted calls.
- **Checking `event.origin` with `.match()` or includes substring:** Use strict `===` equality or an exact allowlist `Array.includes()`. A substring match (`origin.match('smartbizin.com')`) can be spoofed by `evil-smartbizin.com`.
- **Leaving `frame-ancestors: '*'` in production:** The current server/index.ts has a wildcard with a comment to tighten in Phase 6. This is that phase — tighten it before the plans close.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Iframe height sync | Custom polling loop with `setInterval` | `ResizeObserver` (native Web API) | ResizeObserver fires on every layout change synchronously; polling misses rapid changes and wastes CPU |
| Cross-origin security | Custom message authentication tokens | Strict `event.origin` check + CSP `frame-ancestors` | Origin is set by the browser, cannot be spoofed by page script; tokens add complexity without security benefit for this threat model |
| Theme state management | Duplicate theme state in `usePluginMode` | Pass `setIsDarkMode` from `useTheme` | Single source of truth; avoids state sync bugs between two useState instances |

**Key insight:** All the building blocks (ResizeObserver, postMessage, CSP) are Web Platform standards. Custom implementations introduce complexity and miss edge cases that browsers have already solved.

---

## Common Pitfalls

### Pitfall 1: postMessage Fires Before Parent Is Ready
**What goes wrong:** The iframe loads and immediately fires a height message. The parent's message listener hasn't been set up yet (it fires on `window.load` or similar). The first height message is lost; iframe has wrong height until next content change.
**Why it happens:** ResizeObserver fires on the initial layout, often before the parent finishes mounting its listener.
**How to avoid:** The parent should set the iframe `src` only after its message listener is registered. Alternatively, the iframe can send a `TAX_ASSISTANT_READY` message first and wait for a `PARENT_READY` ack before sending height. For v1, the simpler approach is to fire the initial height message with a 50ms delay after mount, giving the parent time to register. The ResizeObserver will also retrigger on any subsequent content change.
**Warning signs:** Iframe shows scrollbar on first load but not after first chat message.

### Pitfall 2: `frame-ancestors` Change Breaks Standalone Development
**What goes wrong:** After tightening CSP to `https://ai.smartbizin.com` only, the dev server at `http://localhost:3000` can no longer embed the app in an iframe for local testing.
**Why it happens:** `localhost` is not in the allowlist.
**How to avoid:** Use environment-conditional CSP:
```typescript
frameAncestors: process.env.NODE_ENV === 'production'
  ? ["'self'", 'https://ai.smartbizin.com']
  : ["'self'", 'http://localhost:3000', 'http://localhost:5173']
```
**Warning signs:** Iframe test page at localhost shows "Refused to display in a frame" after CSP change.

### Pitfall 3: `document.body` Height Includes Bottom Padding / Margin
**What goes wrong:** The reported height includes CSS padding on `body` or the root `div`. If the Tailwind root has `pb-4`, the iframe is 16px taller than needed, causing a small empty strip at the bottom.
**Why it happens:** `contentRect.height` from ResizeObserver reports the box model height including padding.
**How to avoid:** Use `document.documentElement.scrollHeight` as a cross-check. If both match, the ResizeObserver value is correct. If there's a discrepancy, the element has padding. In this app, the root div uses `h-screen` which fills the viewport — the ResizeObserver target should be the root div, not `document.body`, if the root div is the constraining element.
**Warning signs:** Small gap at bottom of iframe; iframe taller than content.

### Pitfall 4: Theme Sync Creates Feedback Loop
**What goes wrong:** Parent sends `SET_THEME dark=true`. `usePluginMode` calls `setIsDarkMode(true)`. `useTheme` persists to `localStorage`. User loads app standalone next session in dark mode unexpectedly. Worse: if the app also sends a theme-changed message back to the parent, a message loop can form.
**Why it happens:** The theme setter and persistence are in `useTheme` which doesn't know whether the call came from user action or postMessage.
**How to avoid:** The iframe should NOT send theme-change messages back to the parent. PLUG-04 is one-directional: parent → iframe only. Document this contract clearly. The `localStorage` persistence in standalone mode is acceptable behavior.
**Warning signs:** Theme toggles rapidly, or browser console shows repeated `message` events.

### Pitfall 5: `isPluginMode` is `useMemo` Not State — Hook Call Order
**What goes wrong:** `usePluginMode` is called in App.tsx. If `setIsDarkMode` is passed as a prop to the hook, and the theme setter changes reference on re-render, the `useEffect` for the message listener re-registers on every render.
**Why it happens:** Function references from `useState` setters are stable in React, but if `setIsDarkMode` is wrapped in a callback elsewhere, it may not be stable.
**How to avoid:** Pass the raw `setIsDarkMode` setter from `useState` directly — React guarantees setter identity is stable. Do not wrap it in `useCallback` before passing (that would create a new reference on each render).

---

## Code Examples

Verified patterns from official sources:

### PLUG-01: ResizeObserver Height Reporter

```typescript
// src/hooks/usePluginMode.ts — complete updated hook
// Source: MDN Web Docs postMessage, Svix blog ResizeObserver pattern

import { useMemo, useEffect } from 'react';

const PARENT_ORIGIN = 'https://ai.smartbizin.com';
const ALLOWED_ORIGINS = [PARENT_ORIGIN];

export function usePluginMode(onSetTheme?: (dark: boolean) => void) {
  const isPluginMode = useMemo<boolean>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('plugin') === 'true';
    }
    return false;
  }, []);

  // PLUG-01: Height reporter
  useEffect(() => {
    if (!isPluginMode) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = Math.ceil(entry.contentRect.height);
        window.parent.postMessage(
          { type: 'TAX_ASSISTANT_HEIGHT', payload: { height } },
          PARENT_ORIGIN
        );
      }
    });

    resizeObserver.observe(document.body);
    return () => resizeObserver.disconnect();
  }, [isPluginMode]);

  // PLUG-02 + PLUG-04: Inbound message handler with origin validation
  useEffect(() => {
    if (!isPluginMode) return;

    const handler = (event: MessageEvent) => {
      if (!ALLOWED_ORIGINS.includes(event.origin)) return; // PLUG-02: silently ignore
      if (event.data?.type === 'SET_THEME' && onSetTheme) {
        onSetTheme(event.data.dark === true);             // PLUG-04: theme sync
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [isPluginMode, onSetTheme]);

  return { isPluginMode };
}
```

### PLUG-02: Server CSP Tightening

```typescript
// server/index.ts — replace frameAncestors wildcard
// Source: helmet GitHub README

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: process.env.NODE_ENV === 'production'
          ? ["'self'", 'https://ai.smartbizin.com']
          : ["'self'", 'http://localhost:3000', 'http://localhost:5173'],
      },
    },
  })
);
```

### PLUG-04: useTheme Setter Exposure

```typescript
// src/hooks/useTheme.ts — expose setIsDarkMode
// Existing return: { isDarkMode, toggleTheme }
// Updated return: { isDarkMode, toggleTheme, setIsDarkMode }
export function useTheme() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(
    () => localStorage.getItem('theme') === 'dark'  // preserve existing init
  );
  const toggleTheme = () => setIsDarkMode(prev => !prev);
  return { isDarkMode, setIsDarkMode, toggleTheme };
}
```

### App.tsx Hook Wiring (integration point)

```typescript
// src/App.tsx — updated hook call
const { isDarkMode, toggleTheme, setIsDarkMode } = useTheme();
const { isPluginMode } = usePluginMode(setIsDarkMode);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `setInterval` height polling | `ResizeObserver` | ~2018 (browsers) | Fires synchronously on layout change; no wasted poll cycles |
| `X-Frame-Options: SAMEORIGIN` | `CSP: frame-ancestors` | Modern browsers (2020+) | More granular — allows specific origins, not just same-origin; X-Frame-Options deprecated in favor of CSP |
| `postMessage(data, '*')` | `postMessage(data, exactOrigin)` | Security best practice since postMessage introduction | Prevents data exfiltration to malicious embedding sites |
| Manual `window.innerHeight` reads | `ResizeObserver contentRect.height` | ~2018 | Accurate for element height vs viewport height; correct for SPA content that changes without viewport resize |

**Deprecated/outdated:**
- `X-Frame-Options: SAMEORIGIN`: Still valid as fallback but superseded by CSP `frame-ancestors`. Helmet sets both by default — leave that behavior in place.
- `document.body.scrollHeight`: Works but gives max-content height, not rendered height. `contentRect.height` from ResizeObserver is more precise for reporting visible content height.

---

## What Already Exists (Do Not Rebuild)

| Already Done | Location | Phase 6 Action |
|--------------|----------|----------------|
| `isPluginMode` detection via `?plugin=true` | `src/hooks/usePluginMode.ts` | Extend, don't replace |
| Sidebar hidden in plugin mode | `src/App.tsx` line 37 | No change needed |
| Tab navigation hidden in plugin mode | `src/components/layout/Header.tsx` line 53 | No change needed |
| Header shrinks to `h-12` in plugin mode | `src/components/layout/Header.tsx` line 33 | No change needed |
| Root div gets `rounded-2xl border` in plugin mode | `src/App.tsx` line 35 | No change needed |
| `helmet` installed with CSP in `server/index.ts` | `server/index.ts` | Change `frameAncestors` value only |
| CORS allowlist already has `ai.smartbizin.com` in production | `server/index.ts` lines 39-41 | No change needed |
| `useTheme` manages dark mode state | `src/hooks/useTheme.ts` | Add `setIsDarkMode` to return |

---

## Open Questions

1. **Smart Assist postMessage contract — exact message shape from parent**
   - What we know: STATE.md notes "Smart Assist postMessage contract not yet confirmed with Smart Assist team"
   - What's unclear: Does Smart Assist use `{ type: 'SET_THEME', dark: true }` or a different shape? Does it expect `TAX_ASSISTANT_HEIGHT` or a different type name?
   - Recommendation: Implement with the shapes defined in this research (`SET_THEME`, `TAX_ASSISTANT_HEIGHT`). Document them in comments as the proposed contract. If Smart Assist uses different shapes, it is a one-line change in the handler. The security validation (`event.origin` check) works regardless of message shape.

2. **Does Smart Assist need a `READY` handshake before height messages?**
   - What we know: Some iframe hosts require the iframe to send a `READY` message and wait for `ACK` before beginning height reporting, to avoid lost messages if the parent listener is slower to initialize.
   - What's unclear: Unknown without Smart Assist team input.
   - Recommendation: Send `TAX_ASSISTANT_READY` message on mount (before starting ResizeObserver), then start ResizeObserver unconditionally. If Smart Assist needs the handshake, it can use the ready signal; if not, the height messages work regardless.

3. **What minimum iframe width does Smart Assist set?**
   - What we know: Plugin mode already responds to narrow widths due to Tailwind responsive classes. The `CalculatorView` and `DashboardView` have data tables that may have min-width requirements.
   - What's unclear: Whether Smart Assist sets a fixed width (e.g., 400px) or responsive width.
   - Recommendation: Audit `CalculatorView` and `DashboardView` at 400px, 500px, and 600px in browser devtools. Add `overflow-x-auto` to table containers if content clips.

---

## Sources

### Primary (HIGH confidence)
- [MDN Web Docs — Window.postMessage()](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage) — targetOrigin semantics, origin validation requirements, security warnings
- [helmet GitHub README — CSP directives](https://github.com/helmetjs/helmet/blob/main/middlewares/content-security-policy/README.md) — frameAncestors array syntax
- Codebase reading — `server/index.ts`, `src/hooks/usePluginMode.ts`, `src/App.tsx`, `src/components/layout/Header.tsx`, `src/components/layout/Sidebar.tsx` — exact current state

### Secondary (MEDIUM confidence)
- [Svix Blog — You Don't Need an Iframe Resizing Library](https://www.svix.com/blog/you-dont-need-iframe-resizer/) — ResizeObserver + postMessage production pattern, verified against Web API spec
- [This Dot Labs — Using Message Events to Resize an IFrame](https://www.thisdot.co/blog/using-message-events-to-resize-an-iframe) — clientHeight + postMessage pattern

### Tertiary (LOW confidence)
- [Microsoft MSRC — postmessaged-and-compromised (2025)](https://www.microsoft.com/en-us/msrc/blog/2025/08/postmessaged-and-compromised) — origin validation attack patterns; single source but corroborates MDN guidance

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tooling already installed; no new dependencies; patterns verified against MDN and helmet docs
- Architecture: HIGH — existing hook structure is exactly the right extension point; code examples are directly adapted from production patterns
- Pitfalls: HIGH — security pitfalls verified against MDN (origin check), PITFALLS.md (wildcard postMessage), and helmet docs (frame-ancestors)

**Research date:** 2026-04-04
**Valid until:** 2026-07-04 (90 days — postMessage and ResizeObserver APIs are stable; CSP frame-ancestors is well-established)
