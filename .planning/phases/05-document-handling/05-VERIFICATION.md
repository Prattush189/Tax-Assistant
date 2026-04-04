---
phase: 05-document-handling
verified: 2026-04-04T00:00:00Z
status: human_needed
score: 9/9 automated must-haves verified
human_verification:
  - test: "Upload a Form 16 PDF and inspect the DocumentCard"
    expected: "DocumentCard renders with salary, TDS, and deduction values extracted from the PDF"
    why_human: "Gemini Files API extraction quality and correctness of parsed values cannot be verified without a real API call and a real document"
  - test: "With DocumentCard active, switch to Chat tab and ask: 'What does my uploaded document show?'"
    expected: "AI response references specific values from the uploaded document (not a generic response)"
    why_human: "Document-aware Q&A requires a live Gemini session with a real fileUri; cannot verify by static analysis"
  - test: "Open DevTools Application tab during an active document session"
    expected: "No 'fileUri' key in Local Storage or Session Storage — only React state holds the URI"
    why_human: "localStorage/sessionStorage inspection requires a running browser session; grep confirms the code is correct but runtime behavior must be confirmed"
  - test: "Dismiss DocumentCard (click X), then switch to Chat tab"
    expected: "Green badge in ChatInput is gone; chat sends without fileContext"
    why_human: "React state transition across views requires browser verification"
  - test: "Attempt to upload a .txt file via the upload zone"
    expected: "Inline red error text appears below the upload zone — no toast, no chat bubble"
    why_human: "Server-side MIME rejection and inline error rendering requires visual/browser verification"
---

# Phase 5: Document Handling Verification Report

**Phase Goal:** Users can upload Form 16 and other tax documents and ask follow-up questions about their contents in chat
**Verified:** 2026-04-04
**Status:** human_needed — all automated checks pass; 5 items require browser/runtime verification
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can upload a Form 16 PDF and see an extracted summary card showing salary, TDS, and deductions | VERIFIED (automated) / ? human | DocumentsView.tsx calls `uploadFile()`, server returns `extractedData`; DocumentCard renders `grossSalary`, `tdsDeducted`, `deductions80C`, `deductions80D` with INR formatting. Actual extraction quality needs human test. |
| 2 | User can ask follow-up questions in chat and receive document-aware answers | VERIFIED (automated) / ? human | `useChat.send()` passes `{ uri, mimeType }` from `activeDocument` to `sendChatMessage`; server chat route prepends `createPartFromUri` to message parts. Runtime Q&A quality needs human test. |
| 3 | User can upload salary slip or investment proof PDF/image and receive AI analysis | VERIFIED (automated) / ? human | Server `ALLOWED_MIME_TYPES` includes `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `image/heic`; `EXTRACTION_PROMPT` is generic to any tax document type. Real analysis quality needs human test. |
| 4 | Uploaded files processed server-side via Gemini Files API; no file URI persists after session ends | VERIFIED | `new Blob([req.file.buffer])` → `ai.files.upload()` in upload.ts (server-side); `activeDocument` is `useState` only — grep of useChat.ts, api.ts, App.tsx finds zero `localStorage` / `sessionStorage` writes; `clearChat` sets `activeDocument(null)`. |

**Score:** 9/9 automated checks verified; 5 items flagged for human runtime confirmation

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/types/index.ts` | `DocumentSummary`, `DocumentContext`, updated `UploadResponse` | VERIFIED | All three interfaces present; `UploadResponse` has `fileUri: string` and `extractedData: DocumentSummary`; `summary: string` field replaced |
| `server/routes/upload.ts` | Full Gemini Files API pipeline | VERIFIED | 155 lines; contains `new Blob([req.file.buffer])`, `ai.files.upload()`, `createPartFromUri`, `generateContent`, markdown fence stripping, `fileUri` in response |
| `server/routes/chat.ts` | Optional `fileContext` injection | VERIFIED | `createPartFromUri` imported; `fileContext` destructured from `req.body`; `messageParts: Part[]` built and passed to `sendMessageStream`; expired URI detection in catch |
| `src/services/api.ts` | `sendChatMessage` with optional `fileContext` | VERIFIED | 5th param `fileContext?: { uri: string; mimeType: string }` present; forwarded as `fileContext: fileContext ?? null` in fetch body |
| `src/hooks/useChat.ts` | `activeDocument`, `attachDocument`, `detachDocument` | VERIFIED | All three exported; `send()` passes `activeDocument ? { uri: activeDocument.fileUri, mimeType: activeDocument.mimeType } : undefined`; `clearChat` sets `activeDocument(null)` |
| `src/components/documents/DocumentsView.tsx` | Upload zone, drag-and-drop, two-phase UX, inline error | VERIFIED | 157 lines; two-phase states `'uploading'`/`'analyzing'` with 1500ms heuristic; inline error as red `<p>` tag; hidden when `activeDocument` is set |
| `src/components/documents/DocumentCard.tsx` | All `DocumentSummary` fields with Dismiss action | VERIFIED | 75 lines; renders employer, employee, PAN, gross salary, taxable salary, TDS, 80C, 80D; Dismiss `<button>` calls `onDismiss` |
| `src/components/chat/ChatInput.tsx` | Document attached badge | VERIFIED | `activeDocument` prop; green badge renders `{activeDocument.filename} attached — answers will reference this document`; textarea gets `rounded-t-none` when badge shown |
| `src/components/layout/Header.tsx` | Documents tab in navigation | VERIFIED | `tabs` array contains `{ id: 'documents', label: 'Documents' }`; `ActiveView` type includes `'documents'` |
| `src/App.tsx` | `useChat` lifted to App; `DocumentsView` wired; `chatHook` passed to `ChatView` | VERIFIED | Single `const chatHook = useChat()` at App level; `<DocumentsView activeDocument={chatHook.activeDocument} onDocumentAttach={chatHook.attachDocument} onDocumentDetach={chatHook.detachDocument} />`; `<ChatView isPluginMode={isPluginMode} chatHook={chatHook} />` |
| `src/components/chat/ChatView.tsx` | Accepts `chatHook` prop; no internal `useChat()` call | VERIFIED | Interface `ChatViewProps { chatHook: ReturnType<typeof useChat> }`; destructures from `chatHook`; passes `activeDocument` to `ChatInput` |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `server/routes/upload.ts` | Gemini Files API | `new Blob([req.file.buffer])` → `ai.files.upload()` | WIRED | Buffer-to-Blob conversion on line 87; `ai.files.upload({ file: blob, config: { mimeType } })` on line 88 |
| `server/routes/upload.ts` | `res.json` | `fileUri` + `extractedData` in response body | WIRED | `res.status(200).json({ ..., fileUri: uploadedFile.uri, extractedData })` on line 124 |
| `server/routes/chat.ts` | `chat.sendMessageStream` | `messageParts` with optional file part prepended | WIRED | `messageParts: Part[]` built; `createPartFromUri` pushed when `fileContext?.uri && fileContext?.mimeType`; passed as `{ message: messageParts }` |
| `src/hooks/useChat.ts` | `src/services/api.ts sendChatMessage` | `activeDocument && { uri: activeDocument.fileUri, mimeType: activeDocument.mimeType }` | WIRED | Line 56: `activeDocument ? { uri: activeDocument.fileUri, mimeType: activeDocument.mimeType } : undefined` as 5th argument |
| `src/App.tsx` | `DocumentsView` | `onDocumentAttach={chatHook.attachDocument}` | WIRED | Line 60: `onDocumentAttach={chatHook.attachDocument}` confirmed |
| `src/components/documents/DocumentsView.tsx` | `uploadFile` in api.ts | `uploadFile(file)` on form submit / drop | WIRED | `const result = await uploadFile(file)` on line 35; `uploadFile` imported from `../../services/api` |
| `src/components/chat/ChatInput.tsx` | `activeDocument` state | `activeDocument` prop showing badge when non-null | WIRED | Badge rendered in JSX guarded by `{activeDocument && (...)}`; `activeDocument` flows from `chatHook` via `ChatView` → `ChatInput` |

---

## Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DOC-01 | 05-01, 05-04 | User can upload Form 16 PDF and see extracted salary, TDS, and deduction summary | SATISFIED | `EXTRACTION_PROMPT` targets Form 16 fields; `DocumentCard` renders `grossSalary`, `tdsDeducted`, `deductions80C`, `deductions80D` with INR formatting |
| DOC-02 | 05-02, 05-03, 05-04 | User can ask follow-up questions about an uploaded document in chat | SATISFIED | `fileContext` flows from `activeDocument` state through `useChat.send()` → `api.ts` → `/api/chat` → `createPartFromUri` in Gemini message parts |
| DOC-03 | 05-01, 05-04 | User can upload any tax-related document (salary slip, investment proof) for AI analysis | SATISFIED | `ALLOWED_MIME_TYPES` accepts PDF + 4 image formats; `EXTRACTION_PROMPT` is document-type agnostic; DocumentCard renders `documentType` field |
| DOC-04 | 05-01, 05-03 | Uploaded files processed via Gemini Files API server-side; file URIs not persisted beyond session | SATISFIED | multer `memoryStorage` (no disk write); `activeDocument` is `useState` only; zero `localStorage`/`sessionStorage` writes found; `clearChat` resets to null |

No orphaned requirements — all four DOC IDs declared in plan frontmatter are accounted for, and REQUIREMENTS.md confirms all four map to Phase 5.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/hooks/useChat.ts` | 33 | "placeholder" in comment: `// Add empty model message placeholder to be filled by streamed chunks` | Info | Comment describes legitimate pattern — the empty string message is intentionally filled by SSE chunks. Not a stub. |
| `src/components/chat/ChatInput.tsx` | 32 | `placeholder="Ask about income tax..."` in textarea attribute | Info | HTML `placeholder` attribute — not a code stub. |

No blocker or warning anti-patterns found. Both flagged occurrences are benign (a comment and an HTML attribute).

---

## TypeScript Compile

`npx tsc --noEmit` completed with **zero output** (zero errors). All phase-5 files compile cleanly.

---

## Commit Verification

All 7 commits documented in SUMMARY files confirmed present in git log:

| Commit | Plan | Description |
|--------|------|-------------|
| `aef04d8` | 05-01 Task 1 | Extend types with DocumentSummary, DocumentContext, updated UploadResponse |
| `bc98521` | 05-01 Task 2 | Implement Gemini Files API pipeline in upload route |
| `ac0ad5b` | 05-02 Task 1 | Extend chat route with optional fileContext injection |
| `f86ddb7` | 05-03 Task 1 | Extend sendChatMessage with optional fileContext param |
| `7e09094` | 05-03 Task 2 | Add activeDocument state and attach/detach to useChat |
| `5181468` | 05-04 Task 1 | Create DocumentCard and DocumentsView components |
| `e802b21` | 05-04 Task 2 | Wire Documents tab into App, Header, ChatView, and ChatInput |

---

## Human Verification Required

### 1. Form 16 Upload and Extraction Quality

**Test:** Upload an actual Form 16 PDF (or any salary slip) via the Documents tab
**Expected:** DocumentCard renders with at least `documentType`, a summary sentence, and numeric values for salary/TDS fields where they exist in the document
**Why human:** Gemini extraction quality and JSON parsing correctness require a live API call with a real document; static analysis can only confirm the code path exists

### 2. Document-Aware Chat Q&A

**Test:** With a document attached (DocumentCard visible), switch to Chat tab and ask "What does my uploaded document show?"
**Expected:** AI response references specific values from the document (e.g., mentions the document type, financial year, or a salary figure) — not a generic response
**Why human:** Requires a live Gemini session with a valid fileUri; the code wires it correctly but actual AI behavior needs confirmation

### 3. Session-Only URI (DOC-04 Runtime Check)

**Test:** Open browser DevTools → Application tab → Local Storage and Session Storage during an active document session
**Expected:** No `fileUri` key in any storage; the value exists only in React component state
**Why human:** localStorage inspection requires a running browser; the code has been verified clean (`grep` found zero writes) but runtime confirmation closes the loop on DOC-04

### 4. Dismiss and Badge Reset

**Test:** With DocumentCard active, click the X button to dismiss; switch to Chat tab
**Expected:** Upload zone reappears in Documents tab; green badge is absent in ChatInput
**Why human:** React state transition across two tabs (Documents → Chat) requires browser verification to confirm `detachDocument` clears the badge correctly

### 5. Inline Error Display (Not Toast)

**Test:** Attempt to upload a `.txt` file via the upload zone
**Expected:** Red error text "Invalid file type. Please upload a PDF or image (JPEG, PNG, WebP, HEIC)." appears below the upload zone — no toast notification, no chat bubble
**Why human:** Visual rendering and error routing (inline vs. toast) requires browser verification; the code shows `<p className="text-sm text-red-600...">` but visual confirmation is needed

---

## Summary

Phase 5 automated verification is complete and all checks pass. The end-to-end document handling pipeline is fully wired:

- **Server pipeline (05-01):** Buffer-to-Blob conversion, Gemini Files API upload, structured JSON extraction with markdown fence stripping, `fileUri` + `extractedData` returned to client.
- **Chat route extension (05-02):** `fileContext` injection into current message parts only (not history), expired URI detection with user-friendly error.
- **Client service layer (05-03):** `sendChatMessage` carries `fileContext`; `useChat` holds ephemeral `activeDocument` state with `attachDocument`/`detachDocument`; `clearChat` resets document context.
- **UI layer (05-04):** `DocumentsView` with drag-and-drop and two-phase upload UX; `DocumentCard` rendering all `DocumentSummary` fields; `ChatInput` green badge; `useChat` lifted to `App.tsx` as a single shared instance preventing dual-instance context split.

The only remaining items are 5 runtime/visual behaviors that require a browser session. The structural code is correct and complete.

---

_Verified: 2026-04-04_
_Verifier: Claude (gsd-verifier)_
