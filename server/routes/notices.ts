import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { pickChatProvider } from '../lib/chatProvider.js';
import { SseWriter } from '../lib/sseStream.js';

import { noticeRepo } from '../db/repositories/noticeRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { styleProfileRepo } from '../db/repositories/styleProfileRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { getBillingUser } from '../lib/billing.js';
import { extractWithRetry } from '../lib/documentExtract.js';
import { GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST } from '../lib/gemini.js';
import { AuthRequest } from '../types.js';

// ── Notice attachment uploader (mirrors bank-statements pattern) ──
// We accept the file in-route instead of routing through /api/upload so the
// extraction does NOT consume the user's chat-attachment monthly quota.
// Only the per-notice `notice` counter is bumped (after a successful draft).
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_MIME_TYPE'));
    }
  },
});

const NOTICE_EXTRACTION_PROMPT = `You are extracting the textual content of an Indian tax notice (Income Tax / GST / TDS) so a downstream model can draft a reply.

Return ONLY a JSON object with this shape:
{
  "summary": "Plain-text transcription of the notice body — every sentence, every figure, every section/sub-section reference, every demand amount. Preserve the department's exact wording for any phrase you would put inside quote-marks. 4000 chars max.",
  "noticeNumber": "string or null",
  "noticeDate": "string or null (DD/MM/YYYY if available)",
  "section": "string or null",
  "assessmentYear": "string or null",
  "din": "string or null"
}

STRICT RULES:
- Output MUST be valid JSON, no markdown fences, no commentary.
- Escape quotes in string values with backslash. No literal newlines inside strings — use \\n.
- Never invent values; use null when a field is genuinely absent from the document.`;

const router = Router();

const MAX_TOKENS = 8192;

// ── Plan-based notice limits (per month) ──
const NOTICE_LIMITS: Record<string, number> = {
  free: 3,
  pro: 30,
  enterprise: 100,
};

function istDateString(): string {
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
}

// ── System prompt ────────────────────────────────────────────────────────────
// Claude Haiku 4.5 produces the full reply as structured GitHub-Flavoured
// Markdown. The client renders this via react-markdown in the preview pane
// and via a markdown-aware jsPDF renderer for download. The structure mirrors
// how a practising senior advocate actually files a reply / rectification.
const NOTICE_SYSTEM_PROMPT = `You are a senior Indian tax litigation advocate with 20+ years of experience drafting replies to Income Tax, GST, TDS, and other regulatory notices at the quality expected for representation before ITAT, High Courts, and first-appellate authorities. You have deep knowledge of the Income Tax Act, 1961 (and the parallel Income Tax Act, 2025 recodification), the CGST / IGST Acts, 2017, and all associated rules and procedural law.

YOUR TASK
Draft a complete, ready-to-file reply letter in GitHub-Flavoured Markdown. The output must be structured, precisely formatted, and contain NO placeholder brackets in the final letter. You will be given: sender details, recipient details, notice details, the key points to address, and (optionally) the raw text of the notice. Use the exact values supplied — do not invent facts, amounts, or citations.

DOCUMENT STRUCTURE (produce every section that applies, in this order)

(0) Summary header — a 2-column GFM table (no heading above it) with rows for: PAN, Assessment Year, DIN / Ref. No., Ack. No., Demand Ref. No., Demand Amount. Omit rows where no value is available.

(1) Subject line — one line: \`**Subject:** Reply / Rectification Request u/s <section> of the <Act> against Notice / Intimation No. <num> dated <date> — Assessment Year <AY>\`.

(2) Salutation and opening — \`Respected Sir / Madam,\` followed by a short paragraph referencing the notice, the demand (if any), and what is being requested (reply, rectification u/s 154, DRC-03 response, etc.).

(3) \`## 1. FACTS OF THE CASE\` — state the facts. Where a financial snapshot helps (return figures, tax computation, etc.), render it as a GFM table with two columns: "Particulars" and "As per Return Filed" (or similar).

(4) \`## 2. GRIEVANCE AGAINST THE INTIMATION\` — identify the specific action being challenged. Where the department's wording matters, quote it verbatim using a blockquote: \`> "exact quoted text"\`. Follow with a one-sentence statement that the conclusion is factually incorrect and legally untenable.

(5) \`## 3. LEGAL SUBMISSIONS\` — the heart of the reply. Break into lettered sub-parts \`### A. <heading>\`, \`### B. <heading>\`, etc. Each sub-part states one discrete legal point with the exact section cited and sub-section where applicable. Quote statutory text inside \`> "..."\` blockquotes so it stands out.

(6) \`## 4. SUPPORTING CASE LAWS / LEGAL PRECEDENTS\` — a numbered list using \`**(i)** <heading>:\`, \`**(ii)** <heading>:\` etc. Under each, a short paragraph stating the principle and the citation in this exact form: \`[Assessee] v. [Department], (Year) Volume ITR/GSTL Page (Court abbreviation)\`. Cite 2–4 precedents. Only use real judgments — never fabricate a citation; if unsure, state the principle as a "well-settled rule" without a fake citation. Verify each cited section number, sub-section text, and case-law reference against the web search results before relying on it.

(7) \`## 5. RELIEF SOUGHT\` — a numbered list \`(1) (2) (3) ...\` of the exact prayers. Include precise rupee amounts wherever the notice has quantified figures (e.g. refund, interest withdrawal, demand rectification).

(8) \`## 6. DOCUMENTS ENCLOSED\` — a numbered list of 4–6 realistic enclosures appropriate to the notice type (copy of intimation, copy of ITR, Form 10-ID / Form 3CEB / Form 3CB-3CD, TDS/TCS certificates, bank proofs, etc.).

(9) Closing block — output each item on its own line using GFM hard line breaks (two trailing spaces before the newline). The exact order is:
\`Thanking you,  \`
\`For <Sender Name>  \`
\`Authorised Signatory  \`
\`Name: <value>  \`
\`Designation: <inferred — Director / Managing Director for companies, Proprietor for sole-prop, Partner for firms>  \`
\`Place: <sender city / address>  \`
\`Date: <today's IST date>  \`
Use the values from the provided sender details; do NOT output bracketed placeholders. Do NOT add any section after the closing block.

FORMATTING RULES (strict)
- Output GitHub-Flavoured Markdown only — no HTML, no front-matter, no fenced code blocks except when quoting machine output.
- Use \`**...**\` for labels and emphasis on key phrases (\`**PAN**\`, \`**Subject:**\`, \`**Section 115JB(5A)**\`, \`**Rs. 55,380/-**\`). DO NOT bold whole paragraphs.
- Rupee amounts: always in plain ASCII — \`Rs. 55,380/-\` or \`Rs. 3,52,881\`. NEVER use the Unicode \`Rs.\` character (U+20B9). The PDF renderer cannot display it.
- Section numbers: always cite precisely, with sub-section where applicable: "Section 115JB(5A)", "Section 143(1)(a)", "Rule 8D(2)(iii)".
- Statutory quotations: use \`> "..."\` blockquotes so they render as call-out boxes.
- Never leave square-bracket placeholders ([NAME], [DATE], [TBD]) in the final letter. If a value is genuinely missing, write a sensible plain-language fallback ("the Assessing Officer", "the undersigned").
- Numbered section headings \`## 1. ...\` through \`## 6. ...\` must appear in that exact sequence; skip a section only if truly not applicable.

QUALITY BAR
- Be precise about section numbers and sub-sections — a wrong citation sinks the reply.
- Only cite judgments you are confident exist with the citation you provide. A plain principle is better than a fabricated citation.
- Write in the voice of a practising senior advocate: precise, assertive, respectful. No marketing language, no emojis, no hedging about being AI-generated.
- Complete every sentence — never truncate mid-argument.

WEB-SEARCH-GROUNDED CITATIONS (mandatory)
You have live Google Search grounding. Use it to verify every section number, sub-section quotation, rule citation, and case-law reference before including it in the letter. When a fact is ambiguous or recent (post-2023 amendment, FA 2025/2026 change, fresh notification), search first.

ONLY treat the following as authoritative sources — prefer these in your search results and cite them inline in section 5 (Legal Submissions) and section 6 (Case Laws / Precedents) where appropriate:
- incometax.gov.in, incometaxindia.gov.in, eportal.incometax.gov.in (CBDT, Income Tax Department)
- gst.gov.in, cbic.gov.in, cbic-gst.gov.in (CBIC, GST Council)
- mca.gov.in (MCA), sebi.gov.in (SEBI), rbi.org.in (RBI) — for cross-statute references
- indiankanoon.org, itat.gov.in, sci.gov.in, livelaw.in (judgments — court / official reporters)
- taxmann.com, taxsutra.com, cleartax.in/lawnetwork (commentary cross-checks only — never as the primary citation when an official source exists)
- Official press releases / circulars / notifications (PIB, CBDT/CBIC notification PDFs)

DO NOT cite blog posts, YouTube, Quora, generic Q&A sites, or unofficial summaries. If web search returns only such sources for a point, drop the citation and fall back to "well-settled rule" language.

Inline citation form: when the supporting authority is an official notification, circular, or judgment URL surfaced by the search, append a short bracketed reference at the end of the relevant sentence — e.g. \`(see CBDT Circular No. 12/2024 dated 15.05.2024)\` or \`(see ITAT Mumbai, ITA No. 1234/2023 dated 02.02.2024)\`. Keep the URL out of the letter body — the bracketed reference plus precise document number is enough for the recipient to locate it.`;

// ── Generate notice draft (streaming) ──
// Accepts EITHER:
//   - JSON body { noticeType, ..., extractedText? }
//   - multipart/form-data with `payload` (JSON string of the same fields) plus
//     an optional `file` (PDF/image of the notice). When a file is present,
//     this route extracts it server-side via Gemini vision and merges the
//     extracted text into the prompt. The vision extraction cost is logged to
//     usageRepo under feature='notice' and does NOT touch the chat-attachment
//     monthly quota.
router.post(
  '/generate',
  (req: Request, res: Response, next: NextFunction) => {
    const ct = req.headers['content-type'] ?? '';
    if (typeof ct === 'string' && ct.startsWith('multipart/form-data')) {
      upload.single('file')(req, res, (err) => {
        if (err) {
          if (err instanceof Error && err.message === 'INVALID_MIME_TYPE') {
            res.status(400).json({ error: 'Invalid file type. Please upload a PDF or image (JPEG, PNG, WebP).' });
            return;
          }
          if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
            res.status(400).json({ error: 'File exceeds the 10 MB size limit.' });
            return;
          }
          return next(err);
        }
        next();
      });
    } else {
      next();
    }
  },
  async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Multipart: form fields arrive as `payload` (stringified JSON) so we can
  // ship the file alongside structured data without needing a separate route.
  let parsedBody: Record<string, unknown> = req.body;
  if (req.file && typeof req.body?.payload === 'string') {
    try {
      parsedBody = JSON.parse(req.body.payload);
    } catch {
      res.status(400).json({ error: 'Invalid `payload` JSON in multipart body.' });
      return;
    }
  }

  const { noticeType, subType, senderDetails, recipientDetails, noticeDetails, keyPoints } = parsedBody as {
    noticeType?: string;
    subType?: string;
    senderDetails?: Record<string, string>;
    recipientDetails?: Record<string, string>;
    noticeDetails?: Record<string, string>;
    keyPoints?: string;
    extractedText?: string;
  };
  let extractedText = (parsedBody as { extractedText?: string }).extractedText;

  if (!noticeType || !keyPoints) {
    res.status(400).json({ error: 'Notice type and key points are required' });
    return;
  }

  // Check plan limit against the BILLING (pool) user.
  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : undefined;
  const billingUserId = billingUser?.id ?? req.user.id;
  const plan = billingUser?.plan ?? actor?.plan ?? 'free';
  const limit = NOTICE_LIMITS[plan] ?? NOTICE_LIMITS.free;
  const used = featureUsageRepo.countThisMonthByBillingUser(billingUserId, 'notice');

  if (used >= limit) {
    res.status(429).json({
      error: `You've reached your monthly notice draft limit (${limit}). Upgrade your plan for more.`,
      upgrade: true,
    });
    return;
  }

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';

  // ── Server-side notice extraction (when a file was uploaded) ──
  // Cost is logged to usageRepo under feature='notice' so it appears alongside
  // the draft cost in the admin dashboard, but the chat attachment_upload
  // counter is intentionally NOT incremented here.
  let extractionMeta: { mergedNoticeNumber?: string; mergedNoticeDate?: string; mergedSection?: string; mergedAssessmentYear?: string; mergedDin?: string } = {};
  if (req.file) {
    try {
      const base64Data = req.file.buffer.toString('base64');
      const dataUrl = `data:${req.file.mimetype};base64,${base64Data}`;
      const extraction = await extractWithRetry<{
        summary: string;
        noticeNumber: string | null;
        noticeDate: string | null;
        section: string | null;
        assessmentYear: string | null;
        din: string | null;
      }>(dataUrl, NOTICE_EXTRACTION_PROMPT);

      const data = extraction.data ?? {};
      extractedText = (extractedText ?? '') + (data.summary ?? '');
      extractionMeta = {
        mergedNoticeNumber: data.noticeNumber ?? undefined,
        mergedNoticeDate: data.noticeDate ?? undefined,
        mergedSection: data.section ?? undefined,
        mergedAssessmentYear: data.assessmentYear ?? undefined,
        mergedDin: data.din ?? undefined,
      };

      // Log vision cost to api_usage with feature='notice'. We use the same
      // T2 (gemini-2.5-flash-lite) cost basis since extractWithRetry's primary
      // model is GEMINI_MODEL = 'gemini-2.5-flash-lite'.
      try {
        const cost = extraction.inputTokens * GEMINI_T2_INPUT_COST + extraction.outputTokens * GEMINI_T2_OUTPUT_COST;
        usageRepo.logWithBilling(clientIp, req.user.id, billingUserId, extraction.inputTokens, extraction.outputTokens, cost, false, extraction.modelUsed, false, 'notice');
      } catch (logErr) {
        console.error('[notices] Failed to log extraction cost:', logErr);
      }
    } catch (extractErr) {
      console.error('[notices] Notice file extraction failed:', extractErr);
      res.status(502).json({ error: 'Could not read the uploaded notice. Try again, or paste the key points manually.' });
      return;
    }
  }

  // Fill any missing structured fields from extraction so the prompt below
  // doesn't fall back to the "[extract from notice text below]" placeholder
  // when the model already returned the value during extraction.
  const mergedNoticeDetails: Record<string, string | undefined> = {
    noticeNumber: noticeDetails?.noticeNumber || extractionMeta.mergedNoticeNumber,
    noticeDate: noticeDetails?.noticeDate || extractionMeta.mergedNoticeDate,
    section: noticeDetails?.section || extractionMeta.mergedSection,
    assessmentYear: noticeDetails?.assessmentYear || extractionMeta.mergedAssessmentYear,
    din: noticeDetails?.din || extractionMeta.mergedDin,
  };

  // ── Build the user prompt ────────────────────────────────────────────────
  // NOTE: The notice record is intentionally created AFTER successful generation
  // (see below) so that failed attempts never count against the usage limit or
  // appear in the saved drafts list.
  const actName = noticeType.toLowerCase().includes('gst')
    ? 'the CGST Act, 2017'
    : 'the Income Tax Act, 1961';

  let userPrompt = '';

  userPrompt += `=== LETTER DATA (use these values exactly; do not invent or modify them) ===\n`;
  userPrompt += `Today's Date (IST): ${istDateString()}\n`;
  userPrompt += `Notice Type: ${noticeType}\n`;
  if (subType) userPrompt += `Sub-type: ${subType}\n`;
  userPrompt += `Governing Statute: ${actName}\n`;

  userPrompt += `\nSender / Assessee:\n`;
  userPrompt += `  Name: ${senderDetails?.name || '[extract from notice text below]'}\n`;
  userPrompt += `  Address: ${senderDetails?.address || '[extract from notice text below]'}\n`;
  userPrompt += `  PAN: ${senderDetails?.pan || '[extract from notice text below]'}\n`;
  if (senderDetails?.gstin || noticeType.toLowerCase().includes('gst')) {
    userPrompt += `  GSTIN: ${senderDetails?.gstin || '[extract from notice text below]'}\n`;
  }

  userPrompt += `\nRecipient (Officer / Authority):\n`;
  userPrompt += `  Officer: ${recipientDetails?.officer || 'The Deputy / Assistant Commissioner of Income Tax'}\n`;
  userPrompt += `  Office / Ward: ${recipientDetails?.office || 'Centralized Processing Centre, Income Tax Department'}\n`;
  userPrompt += `  Address: ${recipientDetails?.address || 'Bengaluru'}\n`;

  userPrompt += `\nNotice Details:\n`;
  userPrompt += `  Notice / Intimation No.: ${mergedNoticeDetails.noticeNumber || '[extract from notice text below]'}\n`;
  userPrompt += `  Notice Date: ${mergedNoticeDetails.noticeDate || '[extract from notice text below]'}\n`;
  userPrompt += `  Section: ${mergedNoticeDetails.section || '[extract from notice text below]'}\n`;
  userPrompt += `  Assessment Year / Period: ${mergedNoticeDetails.assessmentYear || '[extract from notice text below]'}\n`;
  if (mergedNoticeDetails.din) userPrompt += `  DIN: ${mergedNoticeDetails.din}\n`;

  userPrompt += `\nKey points the reply must address (from the taxpayer):\n${keyPoints}\n`;

  if (extractedText) {
    userPrompt += `\n=== UPLOADED NOTICE TEXT (use this to fill any "[extract from notice text below]" fields above, and to pull exact figures / department wording for quotations) ===\n`;
    userPrompt += extractedText.slice(0, 8000);
    userPrompt += `\n=== END OF NOTICE TEXT ===\n`;
  }

  // Inject user's writing style as a USER-message block (not in the system
  // prompt). Putting per-user data in the system text would invalidate the
  // 5-minute Anthropic ephemeral cache on every call — keep the system
  // prompt literally constant per server boot.
  const styleRow = styleProfileRepo.findByUserId(req.user.id);
  if (styleRow) {
    const rules = JSON.parse(styleRow.style_rules);
    userPrompt += `\n=== USER WRITING STYLE (match this voice while keeping the letter structure) ===\n`;
    userPrompt += `Tone: ${rules.tone ?? 'formal'}\n`;
    userPrompt += `Formality: ${rules.formalityLevel ?? 7}/10\n`;
    userPrompt += `Paragraph style: ${rules.paragraphStyle ?? 'moderate'}\n`;
    userPrompt += `Opening pattern: ${rules.openingStyle ?? 'standard'}\n`;
    userPrompt += `Closing pattern: ${rules.closingStyle ?? 'standard'}\n`;
    userPrompt += `Citation style: ${rules.citationStyle ?? 'standard section references'}\n`;
    userPrompt += `Key phrases to use: ${(rules.typicalPhrases ?? []).join(', ') || 'none specified'}\n`;
    userPrompt += `Style description: ${rules.overallDescription ?? ''}\n`;
  }

  userPrompt += `\n=== YOUR TASK ===\n`;
  userPrompt += `Produce the COMPLETE reply letter in GitHub-Flavoured Markdown per the structure in the system prompt. Start with the 2-column summary header table, then the \`**Subject:**\` line, then the salutation and body sections 1–6, then the closing block. End the letter after the closing block — do NOT add any filing instructions or appendix after it.\n`;
  userPrompt += `Do NOT output any bracketed placeholders like [NAME] or [TBD] in the final letter — use the supplied values or a sensible plain-language fallback.\n`;

  const sse = new SseWriter(res);
  let fullResponse = '';

  try {
    const provider = pickChatProvider();
    const usage = await provider.streamChat(
      { systemPrompt: NOTICE_SYSTEM_PROMPT, userMessage: userPrompt, maxTokens: MAX_TOKENS },
      (text) => { fullResponse += text; sse.writeText(text); },
    );

    // Only create the notice record and log usage after successful generation.
    // This ensures failed attempts never consume quota or appear in saved drafts.
    const inputData = JSON.stringify({ noticeType, subType, senderDetails, recipientDetails, noticeDetails: mergedNoticeDetails, keyPoints });
    const title = `${noticeType.toUpperCase()} - ${subType || 'Reply'} - ${mergedNoticeDetails.noticeNumber || 'Draft'}`;
    const noticeId = noticeRepo.create(req.user.id, noticeType, subType ?? null, title, inputData, billingUserId);
    if (fullResponse) {
      noticeRepo.updateContent(noticeId, fullResponse);
    }

    // Log TOTAL input tokens consumed (fresh + cache reads + cache writes) so
    // the admin dashboard reflects true model context size, not just the
    // billed-fresh subset Anthropic returns in `input_tokens`.
    const totalInput = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
    usageRepo.logWithBilling(clientIp, req.user!.id, billingUserId, totalInput, usage.outputTokens, usage.costUsd, false, usage.modelUsed, usage.withSearch, 'notice');

    // Log to the immutable feature_usage table so the monthly quota is
    // unaffected by notice deletions (same pattern as board resolutions,
    // bank statements, uploads, and AI suggestions).
    featureUsageRepo.logWithBilling(req.user!.id, billingUserId, 'notice');

    sse.writeDone({ noticeId });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[notices] Generation error: ${errMsg.slice(0, 200)}`);
    sse.writeError('Failed to generate notice draft. Please try again.');
  }

  sse.end();
});

// ── List user's notices ──
// The notices list still scopes to the actor (data isolation), but the
// usage counter on the response shows the shared-pool remaining capacity.
router.get('/', async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const notices = noticeRepo.findByUser(req.user.id);
  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : undefined;
  const billingUserId = billingUser?.id ?? req.user.id;
  const plan = billingUser?.plan ?? actor?.plan ?? 'free';
  const limit = NOTICE_LIMITS[plan] ?? NOTICE_LIMITS.free;
  const used = featureUsageRepo.countThisMonthByBillingUser(billingUserId, 'notice');
  res.json({ notices, usage: { used, limit } });
});

// ── Get single notice ──
router.get('/:id', async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const notice = noticeRepo.findById(req.params.id);
  if (!notice || notice.user_id !== req.user.id) {
    res.status(404).json({ error: 'Notice not found' });
    return;
  }
  res.json(notice);
});

// ── Update notice draft ──
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const notice = noticeRepo.findById(req.params.id);
  if (!notice || notice.user_id !== req.user.id) {
    res.status(404).json({ error: 'Notice not found' });
    return;
  }
  const { content, title } = req.body;
  noticeRepo.updateDraft(req.params.id, content ?? notice.generated_content, title ?? notice.title);
  res.json({ success: true });
});

// ── Delete notice ──
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const deleted = noticeRepo.deleteById(req.params.id, req.user.id);
  if (!deleted) {
    res.status(404).json({ error: 'Notice not found' });
    return;
  }
  res.json({ success: true });
});

export default router;
