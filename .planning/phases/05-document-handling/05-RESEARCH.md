# Phase 5: Document Handling - Research

**Researched:** 2026-04-04
**Domain:** Gemini Files API, multimodal PDF analysis, document-aware chat, React upload UI
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DOC-01 | User can upload Form 16 PDF and see extracted salary, TDS, and deduction summary | Gemini multimodal PDF analysis + summary card UI in DocumentsView |
| DOC-02 | User can ask follow-up questions about an uploaded document in chat (document-aware Q&A) | File URI injected into chat history via `createPartFromUri`; chat route extended with optional `fileContext` |
| DOC-03 | User can upload any tax-related document (salary slip, investment proof) for AI analysis | Same Files API path as DOC-01; prompt tuned for generic document type |
| DOC-04 | Uploaded files processed via Gemini Files API server-side; file URIs not persisted beyond session | Files API upload in server route; URI held in React state (no localStorage); deleted server-side after session response |
</phase_requirements>

---

## Summary

Phase 5 extends the existing `/api/upload` endpoint (which currently returns a placeholder) to actually process documents through the Gemini Files API. The server-side pipeline is: multer buffer → `ai.files.upload()` with a Blob wrapper → Gemini returns a file URI → server calls `ai.models.generateContent()` with that URI plus a structured extraction prompt → server returns the summary JSON to the client. The file URI is then held in React state (not localStorage) and injected into subsequent `/api/chat` calls so the model can answer follow-up questions referencing the document.

The frontend work has three parts: (1) a `DocumentsView` tab component (currently a stub from Phase 2's architecture) that contains the drag-and-drop upload zone and renders the extracted summary card, (2) extending `useChat` to hold an optional `activeDocument` context and pass it through to `sendChatMessage`, and (3) extending the server's `/api/chat` route to accept an optional `fileContext: { uri, mimeType }` in the request body and prepend a file part to the first turn of the chat when present.

A critical technical constraint: `@google/genai` v1.x `ai.files.upload()` accepts a file path string or a Blob object — NOT a raw Node.js Buffer. Since multer memoryStorage gives us a Buffer, we must wrap it: `new Blob([req.file.buffer], { type: req.file.mimetype })`. Node.js 18+ supports the global `Blob` constructor, so no shim is needed. This is the single most important implementation detail to get right.

**Primary recommendation:** Use Gemini Files API for all document uploads (not inline base64), wrap multer Buffer in Blob before upload, hold the returned URI in React state only, inject via `createPartFromUri` in chat messages. Do NOT install pdf-parse — Gemini's native multimodal PDF understanding is sufficient and avoids an extra dependency.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@google/genai` | `1.48.0` (already installed) | `ai.files.upload()` + `ai.models.generateContent()` with file URI | Already the project's AI SDK; Files API is a first-class feature of this package |
| `multer` | `^2.1.1` (already installed) | Accept multipart file upload; provide `req.file.buffer` | Already wired in Phase 1 upload route |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` | (already installed) | Upload icon, file icon, X-remove icon for document UI | Already the project's icon library |
| `motion` (motion/react) | (already installed) | Animate upload progress, summary card appearance | Already used in ChatView for message animations |

### Not Needed

| Considered | Decision | Reason |
|------------|----------|--------|
| `pdf-parse` | DO NOT install | Phase 1 STACK.md recommended it; but Gemini's native multimodal PDF understanding renders text extraction redundant. Adding pdf-parse creates a two-step pipeline (extract text → send text) that loses image content from PDFs and adds a dependency for no gain. |
| `react-dropzone` | DO NOT install | A plain `<input type="file" accept=".pdf,image/*">` with CSS drag event handlers is 20 lines and has no accessibility gap for this use case. react-dropzone is warranted for complex multi-file drop zones — overkill here. |

**Installation:** No new packages needed. Everything required is already installed.

---

## Architecture Patterns

### Recommended Project Structure Changes

```
server/routes/
├── upload.ts        # EXTEND: add Gemini Files API upload + summary generation
├── chat.ts          # EXTEND: accept optional fileContext in request body

src/
├── components/
│   ├── documents/
│   │   ├── DocumentsView.tsx    # NEW: upload zone + document summary card
│   │   └── DocumentCard.tsx     # NEW: displays extracted summary (salary, TDS, deductions)
│   └── chat/
│       └── ChatInput.tsx        # EXTEND: show "document attached" badge when activeDocument set
├── hooks/
│   └── useChat.ts               # EXTEND: add activeDocument state + clearDocument
├── services/
│   └── api.ts                   # EXTEND: uploadFile returns fileUri; sendChatMessage accepts optional fileContext
├── types/
│   └── index.ts                 # EXTEND: UploadResponse gets fileUri + extractedData fields; add DocumentContext type
```

### Pattern 1: Buffer → Blob → Files API Upload

**What:** Convert multer's `req.file.buffer` (Node.js Buffer) to a Blob, then pass to `ai.files.upload()`.
**When to use:** Every server-side document upload handler.
**Why critical:** `ai.files.upload()` accepts string path or Blob — NOT Buffer. Passing a raw Buffer will either throw or produce silent corruption.

```typescript
// Source: googleapis/js-genai docs + Node.js 18+ Blob global
async function uploadToGemini(buffer: Buffer, mimeType: string) {
  const blob = new Blob([buffer], { type: mimeType });
  const uploadedFile = await ai.files.upload({
    file: blob,
    config: { mimeType },
  });
  return uploadedFile; // { uri, name, mimeType, ... }
}
```

### Pattern 2: Generate Summary from Uploaded File

**What:** After Files API upload, call `generateContent` with the file URI and a structured extraction prompt.
**When to use:** After every successful `ai.files.upload()` call.

```typescript
// Source: https://ai.google.dev/gemini-api/docs/document-processing
import { createPartFromUri } from '@google/genai';

async function extractDocumentSummary(fileUri: string, mimeType: string) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [
      {
        role: 'user',
        parts: [
          createPartFromUri(fileUri, mimeType),
          {
            text: `You are analyzing an Indian tax document. Extract the following fields if present:
- Document type (Form 16, salary slip, investment proof, other)
- Employer name
- Employee name / PAN
- Financial year
- Gross salary
- Standard deduction applied
- Net taxable salary
- TDS deducted (total)
- Section 80C investments
- Section 80D premium
- Any other deductions mentioned

Respond ONLY with a JSON object. Use null for missing fields. Format:
{
  "documentType": "...",
  "financialYear": "...",
  "employerName": "...",
  "employeeName": "...",
  "pan": "...",
  "grossSalary": number | null,
  "standardDeduction": number | null,
  "taxableSalary": number | null,
  "tdsDeducted": number | null,
  "deductions80C": number | null,
  "deductions80D": number | null,
  "otherDeductions": number | null,
  "summary": "One sentence describing what this document shows"
}`,
          },
        ],
      },
    ],
  });
  return JSON.parse(response.text ?? '{}');
}
```

### Pattern 3: Document-Aware Chat via fileContext

**What:** Client passes `fileContext: { uri, mimeType }` alongside the message. Server prepends file part to the first user message in the chat.
**When to use:** When `activeDocument` is set in useChat state.

```typescript
// server/routes/chat.ts — extended section
// Source: https://ai.google.dev/gemini-api/docs/file-input-methods
import { createPartFromUri } from '@google/genai';

// In the route handler:
const { message, history = [], fileContext } = req.body;

const messageParts: Part[] = [];
if (fileContext?.uri && fileContext?.mimeType) {
  messageParts.push(createPartFromUri(fileContext.uri, fileContext.mimeType));
}
messageParts.push({ text: message });

const stream = await chat.sendMessageStream({ message: messageParts });
```

### Pattern 4: Client-Side Document State (ephemeral)

**What:** `useChat` holds `activeDocument` in React state. Never persisted to localStorage or sessionStorage.
**When to use:** After a successful upload; cleared when user dismisses the document or starts a new chat.

```typescript
// src/hooks/useChat.ts extension
interface ActiveDocument {
  filename: string;
  mimeType: string;
  fileUri: string;          // Gemini Files API URI (e.g. "files/abc123")
  extractedData: DocumentSummary;
}

const [activeDocument, setActiveDocument] = useState<ActiveDocument | null>(null);

const attachDocument = (doc: ActiveDocument) => setActiveDocument(doc);
const detachDocument = () => setActiveDocument(null);
```

### Pattern 5: Upload Progress UX

**What:** Two distinct loading states — "uploading" (multer + Files API) and "analyzing" (generateContent).
**When to use:** For the DocumentsView upload zone.

```typescript
type UploadPhase = 'idle' | 'uploading' | 'analyzing' | 'done' | 'error';
```

Show "Uploading document..." during fetch, then "Analyzing with AI..." after the file is received but while the summary is being generated. This prevents users from thinking the upload failed during the slower analysis step.

### Anti-Patterns to Avoid

- **Storing fileUri in localStorage:** The file expires after 48 hours. A stale URI causes Gemini to return a 404 on the next session. Keep it in React state only.
- **Using inline base64 for PDFs:** Base64 inflates payload by ~33%. For a 5MB Form 16, that's 6.6MB in the request body. The Files API upload route exists precisely to avoid this.
- **Running pdf-parse before Gemini:** Double-processing the file. Gemini reads the PDF natively — extracted text loses image data, tables, and Form 16's certificate number layout. Let Gemini process the original binary.
- **Re-uploading on every follow-up message:** Upload once, hold URI in state, reference it in subsequent chat messages. Re-uploading on every message wastes Files API quota and adds ~2s latency per message.
- **Trusting mimeType from client:** Always use `req.file.mimetype` from multer (server-side) in the Files API upload call, not a user-supplied value. Multer's MIME detection is based on the actual content headers in the multipart stream.
- **Not deleting the file after session ends:** The Files API has a 48h automatic expiry, so deletion is not strictly required for DOC-04 compliance. However, calling `ai.files.delete({ name: file.name })` after generating the summary (server-side) ensures the file is removed immediately. This is a DOC-04 requirement: "file URIs not persisted beyond session" — the safest interpretation is to delete on the server immediately, keep only the URI in client state, and let the client state expire with the browser tab.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multimodal PDF text extraction | pdf-parse + custom text parser | Gemini `ai.files.upload()` + `generateContent()` | Gemini handles scanned PDFs (image-based), tables, and form layouts that pdf-parse cannot; form16 from TRACES often has non-extractable text layers |
| File upload progress tracking | XMLHttpRequest with onprogress | Standard `fetch` + two-phase UX state (uploading / analyzing) | PDF uploads are fast (<1s for 5MB on typical connection); granular byte progress is not worth the complexity |
| Drag-and-drop library | react-dropzone | Native HTML drag events + `<input type="file">` | 20 lines of CSS + 10 lines of JS; no library needed for single-file drop zone |
| Document type detection | Magic bytes parser + MIME heuristics | Multer fileFilter (already in upload.ts) + Gemini's response `documentType` field | Already validated server-side; Gemini identifies the document type in the extraction response |

**Key insight:** Gemini is a multimodal PDF reader — treat it as the parsing engine, not a downstream consumer of pre-extracted text.

---

## Common Pitfalls

### Pitfall 1: Buffer Passed Directly to ai.files.upload()

**What goes wrong:** `ai.files.upload({ file: req.file.buffer })` — the SDK does not accept a raw Node.js Buffer. It either throws a type error or silently uploads a corrupted file, and the subsequent `generateContent()` call returns garbled text or an empty response.

**Why it happens:** The multer docs show `req.file.buffer` prominently; developers assume the Gemini SDK accepts it.

**How to avoid:** Always wrap: `new Blob([req.file.buffer], { type: req.file.mimetype })`.

**Warning signs:** Gemini returns "I cannot read this document" or the file metadata shows 0 bytes.

### Pitfall 2: 48-Hour URI Used After Expiry

**What goes wrong:** User uploads Form 16, gets a summary, returns the next day, asks a follow-up. The URI is in React state (if the component hasn't unmounted) or, worse, in localStorage. Gemini returns HTTP 404; the app crashes with an unhandled error.

**How to avoid:** Never persist URI to localStorage or sessionStorage. Treat it as session-only. In the chat route, wrap the `createPartFromUri` call in try/catch and return a specific error: `"The uploaded document has expired. Please upload it again."` — not a generic 500.

**Warning signs:** Gemini error response body contains "File not found" or status 404.

### Pitfall 3: Chat Route Sends File Part on Every Message in History

**What goes wrong:** The client sends `fileContext` with every message, but also sends the full chat history. The server re-attaches the file part to every message in the history. The model receives the same PDF reference 6 times in one request, wasting tokens and potentially hitting context limits.

**How to avoid:** Inject the file part only into the CURRENT user message (the new `messageParts`), not into the chat history reconstruction. The model retains document context through the conversation history's text references.

### Pitfall 4: extractedData JSON Parse Fails Silently

**What goes wrong:** Gemini's extraction prompt asks for JSON, but the model occasionally wraps it in a markdown code block (` ```json ... ``` `). `JSON.parse(response.text)` throws. The app shows a blank summary card or crashes.

**How to avoid:** Strip markdown code fences before parsing:
```typescript
const raw = response.text?.replace(/^```json\n?/m, '').replace(/\n?```$/m, '').trim() ?? '{}';
const data = JSON.parse(raw);
```
Also wrap in try/catch with a fallback to `{ summary: "Could not parse document summary." }`.

### Pitfall 5: DocumentsView Not Connected to Chat Tab

**What goes wrong:** User uploads Form 16 in Documents tab, gets summary. Switches to Chat tab and asks "What is my TDS?". But the chat doesn't know about the uploaded document because the state lives in DocumentsView and useChat is unaware.

**How to avoid:** The `activeDocument` state (fileUri + extractedData) must be lifted or shared. Since ChatView already calls `useChat()` internally (Phase 2 decision), extend `useChat` to export `attachDocument` / `detachDocument` and have DocumentsView call `attachDocument` via a prop or a shared store. The simplest approach: pass an `onDocumentAttach` callback from App.tsx down to DocumentsView, and pass `activeDocument` as a prop to ChatView which passes it to `useChat`.

**Warning signs:** Chat responses don't reference document content; no visual indicator in chat that a document is active.

### Pitfall 6: Upload Error Not Shown Inline

**What goes wrong:** Per the existing upload.ts error handler pattern, upload errors should show "inline below the upload area, not as chat messages" (comment in upload.ts from Phase 1 CONTEXT.md). If the DocumentsView just calls `uploadFile()` from api.ts without catching the thrown Error, the error propagates unhandled or goes to a generic boundary.

**How to avoid:** In DocumentsView, wrap the upload call in try/catch:
```typescript
try {
  const result = await uploadFile(file);
  setUploadPhase('done');
  setDocumentData(result.extractedData);
} catch (err) {
  setUploadPhase('error');
  setErrorMessage(err instanceof Error ? err.message : 'Upload failed.');
}
```
Render the error message as red text below the upload zone, not as a toast or chat bubble.

---

## Code Examples

### Complete Upload Route Extension

```typescript
// server/routes/upload.ts — Phase 5 implementation
// Source: https://ai.google.dev/gemini-api/docs/document-processing + googleapis/js-genai

import { GoogleGenAI, createPartFromUri } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

router.post(
  '/upload',
  multerMiddleware,
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided.' });
      return;
    }

    let uploadedFile;
    try {
      // Step 1: Wrap Buffer in Blob (CRITICAL — SDK does not accept raw Buffer)
      const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
      uploadedFile = await ai.files.upload({
        file: blob,
        config: { mimeType: req.file.mimetype },
      });
    } catch (err) {
      console.error('[upload] Files API error:', err);
      res.status(500).json({ error: 'Failed to process document. Please try again.' });
      return;
    }

    let extractedData;
    try {
      // Step 2: Extract structured data from document
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [{
          role: 'user',
          parts: [
            createPartFromUri(uploadedFile.uri!, uploadedFile.mimeType!),
            { text: EXTRACTION_PROMPT },
          ],
        }],
      });
      const raw = response.text
        ?.replace(/^```json\n?/m, '').replace(/\n?```$/m, '').trim() ?? '{}';
      extractedData = JSON.parse(raw);
    } catch (err) {
      console.error('[upload] Extraction error:', err);
      extractedData = { summary: 'Document uploaded but summary could not be generated.' };
    }

    // Step 3: Delete from Files API immediately (DOC-04 — no server-side persistence)
    // Client will hold URI in session state only
    try {
      if (uploadedFile.name) {
        await ai.files.delete({ name: uploadedFile.name });
      }
    } catch {
      // Non-fatal — file will auto-expire in 48h anyway
    }

    // NOTE: If DOC-02 (follow-up chat) is needed, DO NOT delete here.
    // Delete only after user ends session or navigates away.
    // See Open Questions below for the design decision.

    res.status(200).json({
      success: true,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      fileUri: uploadedFile.uri,       // Used by client for follow-up chat (DOC-02)
      extractedData,
    });
  }
);
```

### Extended UploadResponse Type

```typescript
// src/types/index.ts additions
export interface DocumentSummary {
  documentType: string | null;
  financialYear: string | null;
  employerName: string | null;
  employeeName: string | null;
  pan: string | null;
  grossSalary: number | null;
  standardDeduction: number | null;
  taxableSalary: number | null;
  tdsDeducted: number | null;
  deductions80C: number | null;
  deductions80D: number | null;
  otherDeductions: number | null;
  summary: string;
}

export interface UploadResponse {
  success: boolean;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  fileUri: string;             // Gemini Files API URI — session only
  extractedData: DocumentSummary;
}

export interface DocumentContext {
  filename: string;
  mimeType: string;
  fileUri: string;
  extractedData: DocumentSummary;
}
```

### Extended sendChatMessage with fileContext

```typescript
// src/services/api.ts extension
export async function sendChatMessage(
  message: string,
  history: Message[],
  onChunk: (text: string) => void,
  onError: (msg: string) => void,
  fileContext?: { uri: string; mimeType: string }   // NEW optional param
): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      history: conversationHistory,
      fileContext: fileContext ?? null,              // NEW
    }),
  });
  // ... rest unchanged
}
```

---

## DOC-04 Design Decision: When to Delete the File URI

This is the most important architectural decision in Phase 5 and is flagged as an open question with a clear recommendation.

**DOC-04 says:** "Uploaded files processed via Gemini Files API server-side; file URIs not persisted beyond session."

**The tension:** DOC-02 requires follow-up questions about the document. If the server deletes the file immediately after generating the summary, the client still has the URI, but the file is gone — follow-up chat will fail with 404.

**Recommended approach:**
- Do NOT delete the file immediately after summary generation.
- Return the `fileUri` to the client.
- Client holds it in React state (not localStorage).
- Client passes `fileContext` with every chat message while document is active.
- Server detects expired URI (Gemini 404) and returns a user-friendly "Document expired, please re-upload" error.
- DOC-04's "not persisted beyond session" means: React state only, no localStorage, no server DB. This is satisfied.

This interpretation is the correct one. The alternative (immediate server-side deletion after summary) would break DOC-02 entirely.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| pdf-parse text extraction → send text to Gemini | Gemini Files API → send PDF binary → Gemini reads natively | Works on scanned/image-based PDFs; Gemini understands tables and certificate layouts |
| `@google/generative-ai` (deprecated) SDK | `@google/genai` 1.x SDK | New SDK is already installed; `ai.files.upload()` is the supported method |
| Inline base64 for PDFs | Files API upload then URI reference | Avoids 33% payload inflation; files reusable across messages in session |

**Deprecated/outdated:**
- `@google/generative-ai` (old package): replaced by `@google/genai`. Already migrated in Phase 1.
- `GoogleGenerativeAI.getGenerativeModel()` pattern: replaced by `ai.models.generateContent()` in new SDK.

---

## Open Questions

1. **Form 16 from TRACES — password-protected PDFs**
   - What we know: TRACES-issued Form 16s are often password-protected (PAN-based password). pdf-parse fails on these entirely. Gemini's behavior on password-protected PDFs is undocumented.
   - What's unclear: Will Gemini return an error or a partial result for a password-protected PDF?
   - Recommendation: Handle with a specific user message: "Your Form 16 appears to be password-protected. Please remove the password before uploading (or use the Form 16 Part B which is typically not protected)." The upload route should detect the Gemini error response and return this specific message.

2. **Chat route fileContext injection — history reconstruction**
   - What we know: The current `chat.ts` builds `history` from the request body and creates a new `ai.chats.create()` instance per request. The file URI should be injected only into the current message's parts, not the history.
   - What's unclear: How Gemini handles multi-turn conversation where a file part appears only in message 1 but later messages refer to its content — does the model maintain context?
   - Recommendation: Based on standard LLM multi-turn behavior and Google's own long-context docs, the model does maintain document context through conversation history as long as the history text references are present. Inject file part only in message 1 (first user message that references the document), or on every new user message if the client passes `fileContext` on each request. The latter (every message) is safer for context persistence.

3. **DocumentsView placement — separate tab vs embedded in Chat**
   - What we know: Phase 2 established a `documents` stub component; App.tsx has a tab navigation system with `activeView` state.
   - What's unclear: Whether Documents should be a separate tab (requiring user to switch) or an upload area inside the Chat tab (lower friction).
   - Recommendation: Implement as the existing `documents` tab (matching Phase 2's established architecture). Add a visual indicator in the Chat tab when a document is active (badge on the input or a dismissable banner above the chat input).

---

## Sources

### Primary (HIGH confidence)
- `https://ai.google.dev/gemini-api/docs/document-processing` — PDF processing, inline vs Files API, base64 approach
- `https://ai.google.dev/gemini-api/docs/file-input-methods` — size limits, when to use each method, `createPartFromUri` usage
- `https://ai.google.dev/gemini-api/docs/files` — Files API upload, 48h expiry, `ai.files.delete()`
- `https://googleapis.github.io/js-genai/release_docs/classes/files.Files.html` — `upload()` method signature, accepts string or Blob (NOT Buffer)
- `D:/tax-assistant/server/routes/upload.ts` — existing upload route (multer config, error handling, placeholder)
- `D:/tax-assistant/server/routes/chat.ts` — existing chat route (SSE, history format, system instruction)
- `D:/tax-assistant/src/types/index.ts` — existing UploadResponse type (needs extension)
- `D:/tax-assistant/src/hooks/useChat.ts` — hook structure (needs activeDocument state added)

### Secondary (MEDIUM confidence)
- `https://medium.com/google-cloud/a-versatile-approach-to-uploading-files-with-node-js-fd4a85c44d8e` — Node.js buffer → Blob upload pattern verified against SDK docs
- npm: `@google/genai` v1.48.0 confirmed as installed and actively maintained (published April 2026)

### Tertiary (LOW confidence)
- General Gemini multi-turn file context behavior (no explicit doc found; inferred from long-context and file-input-methods docs)
- TRACES Form 16 password protection behavior with Gemini API (no official documentation found; flagged as open question)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages needed; @google/genai 1.48.0 already installed; Files API documented
- Architecture: HIGH — extends existing patterns (upload.ts, chat.ts, useChat) with minimal surface area changes
- Pitfalls: HIGH — Buffer-vs-Blob issue is verified from SDK docs; 48h expiry and JSON parse issues are documented API behaviors

**Research date:** 2026-04-04
**Valid until:** 2026-05-04 (Gemini SDK updates frequently; re-verify `ai.files.upload()` Blob support if SDK version changes)
