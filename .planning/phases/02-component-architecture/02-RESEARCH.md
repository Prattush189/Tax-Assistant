# Phase 2: Component Architecture - Research

**Researched:** 2026-04-04
**Domain:** React component decomposition, custom hooks, API service layer, tab-based navigation
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ARCH-01 | App.tsx decomposed into feature components (Chat, Calculator, Dashboard, Documents, Layout) | Extraction targets identified from full App.tsx audit; all inline JSX mapped to named component files |
| ARCH-02 | Business logic extracted into custom hooks (useChat, useTheme, usePluginMode) | All state variables and effects in App.tsx inventoried; ownership assigned to each hook |
| ARCH-03 | Single api.ts service module handles all /api/* fetch calls with typed responses | Existing fetch call in App.tsx (handleSend) mapped; chat.ts and upload.ts API contracts documented |
| ARCH-04 | App shell manages tab state (chat / calculator / dashboard) without React Router | Tab switching pattern confirmed; ARCHITECTURE.md explicitly warns against React Router here |
</phase_requirements>

---

## Summary

App.tsx is a 547-line monolith containing: all state (messages, input, loading, sidebar, dark mode, plugin mode), the full `handleSend` async function with SSE stream parsing, `renderContent` with chart/markdown splitting logic, `ChartRenderer` as an inline component, and the entire JSX tree for sidebar, header, chat area, and input. Phase 2 splits this into focused files with no behavior change — this is a pure structural refactor.

The server is already complete from Phase 1. The API contract is well-defined: `POST /api/chat` accepts `{ message: string, history: array }` and streams SSE; `POST /api/upload` accepts `multipart/form-data` with field name `file` and returns `{ success, filename, mimeType, sizeBytes, summary }`. The client's `handleSend` function in App.tsx already calls `/api/chat` correctly — it must move to `useChat.ts` and `api.ts`, not be rewritten.

The project uses React 19, TypeScript 5.8, Tailwind CSS v4, motion/react (Framer Motion), Recharts, Lucide React, clsx + tailwind-merge. No new dependencies are needed for this phase. The `nyquist_validation` config key is absent from `.planning/config.json` (only `workflow.research: true` is present), so the Validation Architecture section is omitted.

**Primary recommendation:** Extract in dependency order — types first, then api.ts, then hooks, then leaf components, then composite components, then App.tsx shell. Never change behavior; change only file boundaries.

---

## Standard Stack

### Core (already installed — no new deps needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | ^19.0.0 | Component model, hooks | Already in project |
| typescript | ~5.8.2 | Type safety across all new files | Already in project |
| tailwind-merge + clsx | ^3.5.0 / ^2.1.1 | Conditional class composition (`cn()`) | Already used in App.tsx |
| motion/react | ^12.23.24 | AnimatePresence, motion.div for message animations | Already used in App.tsx |
| recharts | ^3.8.1 | BarChart, PieChart in ChartRenderer | Already used in App.tsx |
| lucide-react | ^0.546.0 | All icons (Send, Bot, User, etc.) | Already used in App.tsx |
| react-markdown + remark-gfm | ^10.1.0 / ^4.0.1 | Markdown rendering in chat messages | Already used in App.tsx |

### No New Dependencies Required

This phase is structural refactoring only. Every library needed is already installed. Do not add React Router, Zustand, Context API wrappers, or any state management library — the requirements explicitly call for simple tab state via `useState`.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── main.tsx                          # Unchanged
├── index.css                         # Unchanged
├── App.tsx                           # SHRINKS to ~60 lines: tab state + layout shell
│
├── types/
│   └── index.ts                      # Message, ApiChatRequest, ApiChatResponse, UploadResponse
│
├── services/
│   └── api.ts                        # sendChatMessage(), uploadFile() — all fetch calls
│
├── hooks/
│   ├── useChat.ts                    # messages, isLoading, send(), clear(), input state
│   ├── useTheme.ts                   # isDarkMode, toggleTheme, localStorage sync
│   └── usePluginMode.ts              # isPluginMode (URLSearchParams, useMemo)
│
└── components/
    ├── chat/
    │   ├── ChatView.tsx              # Outer chat layout: message list + empty state + input area
    │   ├── MessageList.tsx           # AnimatePresence list of messages + loading indicator
    │   ├── MessageBubble.tsx         # Single message: user or model bubble with renderContent
    │   ├── ChatInput.tsx             # Textarea + send button
    │   └── ChartRenderer.tsx         # Extracted from App.tsx — bar/pie chart from json-chart block
    │
    ├── layout/
    │   ├── Sidebar.tsx               # Fixed sidebar with quick queries + resources + controls
    │   └── Header.tsx                # Top header bar with tab navigation (Phase 2 adds tabs here)
    │
    ├── calculator/
    │   └── CalculatorView.tsx        # Placeholder stub — "Coming soon" (Phase 3 fills this)
    │
    └── dashboard/
        └── DashboardView.tsx         # Placeholder stub — "Coming soon" (Phase 4 fills this)
```

### Pattern 1: Extract Business Logic to Custom Hooks

**What:** Move all `useState`, `useEffect`, and async functions out of App.tsx into purpose-named hooks. Components become pure renderers that call hooks.

**When to use:** Any time a component has state that describes "what the app is doing" rather than "how this component looks."

**The three hooks for this phase:**

```typescript
// src/hooks/useTheme.ts
// Source: App.tsx lines 113-139 (isDarkMode state + useEffect)
import { useState, useEffect } from 'react';

export function useTheme() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' ||
        (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  return { isDarkMode, toggleTheme: () => setIsDarkMode(prev => !prev) };
}
```

```typescript
// src/hooks/usePluginMode.ts
// Source: App.tsx lines 121-127 (isPluginMode useMemo)
import { useMemo } from 'react';

export function usePluginMode() {
  const isPluginMode = useMemo(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('plugin') === 'true';
    }
    return false;
  }, []);

  return { isPluginMode };
}
```

```typescript
// src/hooks/useChat.ts
// Source: App.tsx lines 109-274 (messages, input, isLoading, handleSend, clearChat)
import { useState, useRef, useEffect } from 'react';
import { sendChatMessage } from '../services/api';
import type { Message } from '../types';

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => { /* extracted handleSend logic */ };
  const clearChat = () => { /* extracted clearChat logic */ };

  return { messages, input, setInput, isLoading, messagesEndRef, send, clearChat };
}
```

### Pattern 2: Single API Service Module

**What:** All `fetch('/api/...')` calls live in `src/services/api.ts`. Components and hooks import from this file only — never call `fetch` directly.

**When to use:** There are exactly two API endpoints now: `/api/chat` (SSE stream) and `/api/upload` (multipart). Both must be typed.

**API contracts from the server (verified by reading server/routes/):**

```typescript
// src/services/api.ts

import type { Message } from '../types';

// POST /api/chat
// Body: { message: string, history: { role: string, parts: { text: string }[] }[] }
// Response: SSE stream — each event is "data: {text: string}\n\n" or "data: [DONE]\n\n"
//           Error event: "data: {error: true, message: string}\n\n"
export async function sendChatMessage(
  message: string,
  history: Message[],
  onChunk: (text: string) => void,
  onError: (msg: string) => void
): Promise<void> {
  const conversationHistory = history.map(m => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history: conversationHistory }),
  });

  if (!response.ok || !response.body) {
    // Non-streaming error (rate limit 429, etc.)
    try {
      const errData = await response.json();
      onError(errData.error ?? 'An error occurred. Please try again.');
    } catch {
      onError('An error occurred. Please try again.');
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;

      try {
        const parsed = JSON.parse(payload);
        if (parsed.error) { onError(parsed.message ?? 'Connection error.'); return; }
        if (parsed.text) onChunk(parsed.text);
      } catch { /* malformed chunk — skip */ }
    }
  }
}

// POST /api/upload
// Body: FormData with field "file"
// Response: { success: boolean, filename: string, mimeType: string, sizeBytes: number, summary: string }
// Error: { error: string }
export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/upload', { method: 'POST', body: formData });
  const data = await response.json();

  if (!response.ok) throw new Error(data.error ?? 'Upload failed.');
  return data as UploadResponse;
}
```

### Pattern 3: Tab State in App Shell (No React Router)

**What:** App.tsx holds a single `activeView` state. It renders the correct view component. No URL changes, no browser history entries, no back button behavior change.

**When to use:** Specifically required by ARCH-04. ARCHITECTURE.md section "Anti-Pattern 4" explicitly documents why React Router is wrong here (breaks iframe/plugin mode back button, requires parent-frame URL sync).

```typescript
// src/App.tsx (after refactor — target ~60 lines)
import { useState } from 'react';
import { useTheme } from './hooks/useTheme';
import { usePluginMode } from './hooks/usePluginMode';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ChatView } from './components/chat/ChatView';
import { CalculatorView } from './components/calculator/CalculatorView';
import { DashboardView } from './components/dashboard/DashboardView';
import { cn } from './lib/utils'; // or keep cn() inline

type ActiveView = 'chat' | 'calculator' | 'dashboard';

export default function App() {
  const { isDarkMode, toggleTheme } = useTheme();
  const { isPluginMode } = usePluginMode();
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className={cn(
      "flex h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 overflow-hidden transition-colors duration-300",
      isPluginMode && "rounded-2xl border border-slate-200 dark:border-slate-800"
    )}>
      {!isPluginMode && (
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          isDarkMode={isDarkMode}
          onToggleTheme={toggleTheme}
        />
      )}
      <main className="flex-1 flex flex-col relative min-w-0">
        <Header
          isPluginMode={isPluginMode}
          isDarkMode={isDarkMode}
          onToggleTheme={toggleTheme}
          activeView={activeView}
          onViewChange={setActiveView}
          onOpenSidebar={() => setIsSidebarOpen(true)}
        />
        {activeView === 'chat' && <ChatView />}
        {activeView === 'calculator' && <CalculatorView />}
        {activeView === 'dashboard' && <DashboardView />}
      </main>
      {isSidebarOpen && !isPluginMode && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
}
```

### Pattern 4: Typed Shared Types Module

**What:** `src/types/index.ts` defines interfaces shared across hooks, components, and api.ts. This prevents import cycles.

```typescript
// src/types/index.ts

export interface Message {
  role: 'user' | 'model';
  content: string;
  timestamp: Date;
}

export interface UploadResponse {
  success: boolean;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  summary: string;
}

// History item shape expected by /api/chat server route
export interface HistoryItem {
  role: string;
  parts: Array<{ text: string }>;
}
```

### Anti-Patterns to Avoid

- **Rewriting handleSend logic:** The SSE stream parsing in App.tsx (lines 205-257) is working and handles all edge cases (rate limit 429, malformed JSON chunks, network errors). Move it into `api.ts`/`useChat.ts` unchanged. Do not simplify it.
- **Adding React Router:** ARCH-04 and ARCHITECTURE.md both prohibit this. Tab switching is `useState<'chat' | 'calculator' | 'dashboard'>`.
- **Prop drilling the `cn()` utility:** The `cn()` function (clsx + tailwind-merge) is used in every component. Define it once in `src/lib/utils.ts` and import it, rather than re-defining inline in each file.
- **Moving `ChartRenderer` out of the chat feature folder:** ChartRenderer is only used by `renderContent` in the chat message bubble. It belongs in `src/components/chat/ChartRenderer.tsx`, not a top-level `components/charts/` folder (that folder is for Phase 4 dashboard charts).
- **Extracting `quickQueries` as a prop:** The quick queries array is UI content for the sidebar and the chat empty state. Keep it as a local constant in each component (or in a `constants.ts` file) — do not thread it as a prop from App.tsx.
- **Changing the `motion/react` import:** The existing import is `from 'motion/react'` (not `framer-motion`). Keep this exactly as-is across all extracted components.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Conditional Tailwind classes | Custom classname string concatenation | `cn()` (clsx + tailwind-merge) | Already used throughout App.tsx; tailwind-merge handles conflicting classes |
| Markdown rendering | Custom markdown parser | `react-markdown` + `remark-gfm` | Already handles GFM tables, code blocks, bold, lists — all used by the AI responses |
| Message animations | CSS transitions or keyframes | `motion/react` AnimatePresence | Already handles mount/unmount animations correctly with `initial/animate` |
| Icon components | SVG literals in JSX | `lucide-react` | All icons already imported; consistent sizing via className props |
| Chart rendering | Raw SVG | `recharts` | ResponsiveContainer, BarChart, PieChart already configured and working |
| View switching routing | react-router-dom | `useState<ActiveView>` | Plugin/iframe mode requires no URL changes; single component tree |

**Key insight:** This phase creates zero new capabilities — it reorganizes existing working code into maintainable file structure. Every library question is already answered by what's in App.tsx.

---

## Inventory: What Leaves App.tsx

This inventory is the authoritative source for the planner. Every item listed below must be accounted for in the final task plan.

### State Variables → useChat.ts
- `messages` (useState)
- `input` (useState)
- `isLoading` (useState)
- `messagesEndRef` (useRef)
- `chatContainerRef` (useRef — only used for ref assignment, can be dropped or kept)
- `scrollToBottom` (useEffect wrapping messagesEndRef.current?.scrollIntoView)

### State Variables → useTheme.ts
- `isDarkMode` (useState with localStorage init)
- `useEffect` that syncs to `document.documentElement.classList` and `localStorage`

### State Variables → usePluginMode.ts
- `isPluginMode` (useMemo from URLSearchParams)

### State Variables → App.tsx (stay in shell)
- `isSidebarOpen` (useState) — controls mobile sidebar overlay; tightly coupled to App layout
- `activeView` (NEW useState) — tab routing

### Functions → api.ts
- The entire `fetch('/api/chat', ...)` call with SSE stream reading (lines 176-257 of App.tsx)

### Functions → useChat.ts
- `handleSend` (orchestrates state changes, calls api.ts)
- `clearChat`

### Functions → MessageBubble.tsx (or ChatView.tsx)
- `renderContent` (splits content on json-chart blocks, renders ChartRenderer or Markdown)

### Constants → local or constants.ts
- `quickQueries` array
- `COLORS` array (used only in ChartRenderer)

### Components → src/components/chat/ChartRenderer.tsx
- `ChartRenderer` function component (lines 56-106)

### JSX Sections → components
| Section in App.tsx | Target Component | Target File |
|-------------------|-----------------|-------------|
| `<aside>` sidebar (lines 313-378) | Sidebar | `src/components/layout/Sidebar.tsx` |
| `<header>` (lines 382-419) | Header | `src/components/layout/Header.tsx` |
| Chat area + empty state (lines 422-500) | ChatView | `src/components/chat/ChatView.tsx` |
| Individual message bubble (lines 453-476) | MessageBubble | `src/components/chat/MessageBubble.tsx` |
| Loading indicator (lines 479-496) | part of MessageList or ChatView | inline or extracted |
| `<textarea>` + send button (lines 503-534) | ChatInput | `src/components/chat/ChatInput.tsx` |
| Mobile overlay (lines 538-543) | stays in App.tsx | inline |

---

## Common Pitfalls

### Pitfall 1: Breaking the SSE Stream Parser During Extraction

**What goes wrong:** The SSE stream parsing logic in `handleSend` (lines 205-257) uses a `buffer` variable to handle chunks that split across `reader.read()` calls. If this logic is simplified or restructured during extraction, partial SSE frames will be dropped and streaming will appear broken.

**Why it happens:** The pattern `buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() ?? '';` is subtle. The `stream: true` in `TextDecoder.decode` and the `buffer` accumulator are both required. Removing either causes dropped text.

**How to avoid:** Copy the entire while loop from App.tsx into `api.ts:sendChatMessage` verbatim. Refactor the callback shape (onChunk, onError) but do not change the parsing logic.

**Warning signs:** Model messages appear with missing words or stop mid-sentence.

### Pitfall 2: Hook Return Shape Mismatch with Components

**What goes wrong:** A hook returns `{ isDarkMode, setIsDarkMode }` but the component expects `{ isDarkMode, toggleTheme }`. Or `useChat` returns `send` but `ChatInput` calls it as `onSend(input)`.

**Why it happens:** When extracting simultaneously, the hook API and the component props are defined in separate tasks without a shared contract.

**How to avoid:** Define hook return types in `src/types/index.ts` (or as exported types from each hook file) before writing components. Components accept typed props that match the hook return shape.

**Warning signs:** TypeScript errors on prop destructuring; `undefined is not a function` at runtime.

### Pitfall 3: Stale Closure on `messages` in `useChat.ts`

**What goes wrong:** The `send` function captures `messages` at the time it was created. Concurrent `setMessages` calls within the same async function accumulate incorrectly.

**Why it happens:** The existing App.tsx code (lines 241-249) correctly uses the functional updater form: `setMessages(prev => { const updated = [...prev]; ... return updated; })`. If this is changed to `setMessages([...messages, newMsg])` during extraction, it will produce stale state bugs under fast streaming.

**How to avoid:** Preserve all `setMessages(prev => ...)` functional updater forms from App.tsx exactly. Do not simplify to direct array assignment.

**Warning signs:** Chat messages appear out of order or duplicate during fast AI responses.

### Pitfall 4: `cn()` Utility Duplication

**What goes wrong:** Each extracted component file re-declares `function cn(...inputs) { return twMerge(clsx(inputs)); }` at the top.

**Why it happens:** App.tsx has this inline. Developers copy-paste it into each new file.

**How to avoid:** Create `src/lib/utils.ts` in the first task. Export `cn` from there. All component files import from `'../lib/utils'` (or `'../../lib/utils'` for nested components).

**Warning signs:** Multiple `cn` declarations in the codebase; `grep -r "function cn" src/` returns more than one result.

### Pitfall 5: ChatView Needs Both useChat Return Values AND Forwarded Props

**What goes wrong:** ChatView accepts `isPluginMode` and `isDarkMode` as props (from App.tsx), but also calls `useChat()` internally. If the hook is called in App.tsx and values are passed as props, AND ChatView also calls the hook, two independent state instances are created.

**Why it happens:** Unclear hook ownership during the split.

**How to avoid:** `useChat` is called ONCE, in ChatView (or in App.tsx and passed down). Decide ownership before writing any component. Recommendation: call `useChat` inside ChatView — it owns message state. App.tsx only manages tab state and layout concerns. Theme and plugin mode are passed via props from App.tsx (which calls `useTheme` and `usePluginMode`).

**Warning signs:** Two independent message lists; clear chat in one place doesn't affect the other.

---

## Code Examples

### ChartRenderer (extracted verbatim from App.tsx)

```typescript
// src/components/chat/ChartRenderer.tsx
// Source: App.tsx lines 56-106
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const COLORS = ['#f97316', '#6366f1', '#10b981', '#f43f5e', '#8b5cf6', '#eab308'];

export function ChartRenderer({ jsonString }: { jsonString: string }) {
  try {
    const chartData = JSON.parse(jsonString);
    const { type, data, title } = chartData;

    return (
      <div className="my-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
        {title && <h4 className="text-sm font-semibold mb-4 text-slate-700 dark:text-slate-300">{title}</h4>}
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {type === 'bar' ? (
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
                <XAxis dataKey="name" fontSize={12} stroke="#94a3b8" />
                <YAxis fontSize={12} stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Bar dataKey="value" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            ) : (
              <PieChart>
                <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {data.map((_: unknown, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Legend />
              </PieChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    );
  } catch {
    return null;
  }
}
```

### renderContent (stays as function, used in MessageBubble)

```typescript
// src/components/chat/MessageBubble.tsx
// Source: App.tsx lines 289-304
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChartRenderer } from './ChartRenderer';
import { cn } from '../../lib/utils';

function renderContent(content: string, role: 'user' | 'model') {
  const parts = content.split(/```json-chart([\s\S]*?)```/);
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      return <ChartRenderer key={index} jsonString={part.trim()} />;
    }
    return (
      <div key={index} className={cn(
        "markdown-body prose max-w-none prose-sm sm:prose-base overflow-x-auto",
        role === 'user' ? 'prose-invert' : 'prose-slate dark:prose-invert'
      )}>
        <Markdown remarkPlugins={[remarkGfm]}>{part}</Markdown>
      </div>
    );
  });
}
```

### CalculatorView and DashboardView stubs (Phase 3 / Phase 4 fill these)

```typescript
// src/components/calculator/CalculatorView.tsx
export function CalculatorView() {
  return (
    <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-slate-400">
      <p>Tax Calculator — coming in Phase 3</p>
    </div>
  );
}

// src/components/dashboard/DashboardView.tsx
export function DashboardView() {
  return (
    <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-slate-400">
      <p>Dashboard — coming in Phase 4</p>
    </div>
  );
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `framer-motion` package | `motion/react` (same library, new package name) | Framer Motion v11+ | Import must be `from 'motion/react'` — App.tsx already uses this correctly |
| Tailwind CSS v3 `@apply` + `tailwind.config.js` | Tailwind CSS v4 `@import "tailwindcss"` + `@theme {}` in CSS | v4 release (2024) | `index.css` already uses v4 syntax; no `tailwind.config.js` exists in project |
| `react-router-dom` for multi-view SPAs | Tab state with `useState` for simple view switching | N/A — depends on requirements | ARCH-04 explicitly requires no router; tabs are the correct v1 approach |
| Default export components | Named export components | Community convention shift | Use named exports for all new components (e.g., `export function ChatView()`) — only `App.tsx` keeps default export for Vite entry compatibility |

---

## Open Questions

1. **Should `useChat` live in ChatView or be called from App.tsx and passed down?**
   - What we know: Chat state (messages, isLoading) is only consumed by ChatView and its children. There is no cross-feature state sharing needed in Phase 2.
   - Recommendation: Call `useChat()` inside `ChatView.tsx`. This makes ChatView self-contained. App.tsx does not need to know about chat internals. If Phase 6 (plugin mode) needs to observe chat state, it can be lifted then.

2. **Does the `chatContainerRef` from App.tsx need to be preserved?**
   - What we know: `chatContainerRef` is assigned to the chat area `<div>` in App.tsx (line 423) but is never actually read — only `messagesEndRef` is used for scrolling.
   - Recommendation: Drop `chatContainerRef` entirely. It's dead code in the current implementation.

3. **Where does the mobile sidebar overlay div live after extraction?**
   - What we know: The overlay (lines 538-543 of App.tsx) depends on `isSidebarOpen` state which stays in App.tsx.
   - Recommendation: Keep the overlay inline in App.tsx — it's 5 lines and tightly coupled to the layout shell state. Do not extract it.

---

## Extraction Order (Dependency Graph)

The planner MUST implement tasks in this order to avoid forward references:

```
Wave 1 (no deps):
  Task 1: src/types/index.ts        — Message, UploadResponse, HistoryItem
  Task 2: src/lib/utils.ts          — cn() utility

Wave 2 (depends on types):
  Task 3: src/services/api.ts       — sendChatMessage(), uploadFile()
  Task 4: src/hooks/useTheme.ts     — extracted from App.tsx
  Task 5: src/hooks/usePluginMode.ts — extracted from App.tsx

Wave 3 (depends on types + api.ts + hooks):
  Task 6: src/hooks/useChat.ts      — depends on api.ts + Message type

Wave 4 (depends on types + utils):
  Task 7: src/components/chat/ChartRenderer.tsx    — no deps on hooks
  Task 8: src/components/chat/ChatInput.tsx        — no deps on hooks
  Task 9: src/components/chat/MessageBubble.tsx    — depends on ChartRenderer + utils
  Task 10: src/components/chat/ChatView.tsx        — depends on useChat + MessageBubble + ChatInput

Wave 5 (depends on useTheme, usePluginMode):
  Task 11: src/components/layout/Sidebar.tsx       — depends on utils
  Task 12: src/components/layout/Header.tsx        — depends on utils (adds tab nav)

Wave 6 (depends on nothing yet — stubs):
  Task 13: src/components/calculator/CalculatorView.tsx  — stub
  Task 14: src/components/dashboard/DashboardView.tsx    — stub

Wave 7 (final — replaces the monolith):
  Task 15: src/App.tsx refactor     — imports all the above, becomes ~60-line shell
```

---

## Sources

### Primary (HIGH confidence)
- Direct read of `D:/tax-assistant/src/App.tsx` — full monolith inventory, all state/logic/JSX identified
- Direct read of `D:/tax-assistant/server/routes/chat.ts` — verified API contract: `POST /api/chat`, SSE format
- Direct read of `D:/tax-assistant/server/routes/upload.ts` — verified API contract: `POST /api/upload`, field name `file`, response shape
- Direct read of `D:/tax-assistant/package.json` — confirmed all needed libraries already installed
- Direct read of `D:/tax-assistant/.planning/research/ARCHITECTURE.md` — verified component structure, hook names, anti-patterns

### Secondary (MEDIUM confidence)
- React 19 docs pattern for custom hooks and component extraction — well-established stable patterns
- React official docs: hooks rules (call at top level, same order each render) — verified

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — read package.json directly; confirmed all deps present
- Architecture: HIGH — read App.tsx fully; every extract target identified by line number
- API contracts: HIGH — read both server route files directly
- Pitfalls: HIGH — derived from direct code analysis; not speculative

**Research date:** 2026-04-04
**Valid until:** 2026-05-04 (stable React patterns; no external API dependencies for this phase)
