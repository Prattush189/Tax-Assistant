import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { pickChatProvider } from '../lib/chatProvider.js';
import { SseWriter } from '../lib/sseStream.js';
import { sanitizeNoticeCitations } from '../lib/noticeCitationSanitizer.js';

import { noticeRepo } from '../db/repositories/noticeRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { styleProfileRepo } from '../db/repositories/styleProfileRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { enforceTokenQuota } from '../lib/tokenQuota.js';
import { getBillingUser } from '../lib/billing.js';
import { getUsagePeriodStart } from '../lib/planLimits.js';
// Notice extraction runs through extractVisionWithFallback (Gemini 3.1
// Flash-Lite Preview → Gemini 2.5 Flash-Lite). The Anthropic provider
// was removed from the project; Gemini handles all vision now.
import { extractVisionWithFallback } from '../lib/visionFallback.js';
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

(5) \`## 3. LEGAL SUBMISSIONS\` — the heart of the reply. Break into lettered sub-parts \`### A. <heading>\`, \`### B. <heading>\`, etc. Each sub-part states one discrete legal point with the exact section cited and sub-section where applicable.

STATUTORY QUOTATIONS — STRICTEST RULE
You may NOT invent or paraphrase statutory text inside a \`> "..."\` blockquote. A quotation attributed to a section is read by the Assessing Officer as the literal text of the statute; producing fake statutory text is the single most damaging failure mode of this reply.
- If you can pull the actual text of a section from your web search results (incometaxindia.gov.in / cbic.gov.in / indiankanoon.org of the bare Act), include it in a blockquote AND append the source URL on its own line directly underneath the blockquote in the form \`Source: <full URL>\`.
- If you cannot verify the exact text, DO NOT use a blockquote. Instead, write the principle in your own prose with the section reference — e.g. "Section 115BAB(2) prescribes the conditions of eligibility, which the assessee satisfies." Prose paraphrases without a URL are acceptable; blockquoted "quotations" without a URL are forbidden.
- Any blockquote that begins with a section number (\`Section X(Y): "..."\`) MUST be followed by a \`Source:\` URL line. If you cannot supply one, do not emit the blockquote — rewrite the point in prose with the section reference instead.

ARITHMETIC RECONSTRUCTION (when challenging a computational demand)
If the reply disputes the quantum of a demand raised by CPC / AO, include a small GFM table inside the relevant sub-part showing the department's computation alongside the assessee's correct computation, line by line (e.g. "Total Income", "Tax @ rate", "Surcharge", "Cess", "Interest u/s 234A/B/C/F", "Demand"). Without this side-by-side, the reply asserts an error without showing it.

OPERATIVE FORMS — ALWAYS REFERENCE
Many tax options have an operative election form that must be filed within a statutory window. When the reply turns on any of these options, the reply MUST explicitly state whether the form was filed, when, and attach a copy in section 6 DOCUMENTS ENCLOSED:
- Section 115BAA (existing domestic company, 22%) → Form 10-IC, by due date of return u/s 139(1) of the FIRST AY for which the option is exercised
- Section 115BAB (new manufacturing domestic company, 15%) → Form 10-ID, same timing rule
- Section 115BAC (individuals / HUF / AOP / BOI default new regime) → Form 10-IEA when opting OUT (for business income) or no form (salaried, exercised in the return itself)
- Section 44AD / 44ADA / 44AE presumptive → declared in the return itself
- Section 11(2) accumulation by trust → Form 10
- Section 35(2AB) weighted R&D deduction → Form 3CL approval
Failing to reference the operative form when the reply hangs on it is a substantive defect. If you don't know whether the form was filed, write that as an open factual question ("Subject to confirmation that Form 10-ID was filed within the due date u/s 139(1)") rather than asserting a state of facts.

(6) \`## 4. SUPPORTING CASE LAWS / LEGAL PRECEDENTS\` — OPTIONAL section. Include it ONLY if you can cite real judgments you have just verified through web search. There is NO minimum count — zero citations is acceptable and far preferable to a single fabricated one. If you cannot confidently cite at least one real judgment with a verifiable source URL, OMIT THIS ENTIRE SECTION (skip from "## 3" straight to "## 5 RELIEF SOUGHT"). Do NOT emit the heading with a placeholder body such as "Not applicable", "N/A", "None", or "No case law at this stage" — that is worse than omitting the section, because it advertises the gap. Either provide a real cited judgment or leave the heading out entirely; the next section is renumbered from "## 5" to "## 4" automatically when this section is absent. Each entry must be a numbered item \`**(i)** <heading>:\`, \`**(ii)** <heading>:\` followed by a short paragraph stating the principle, then the citation in this exact form on its own line: \`Assessee v. Department, (Year) Volume ITR/GSTL Page (Court abbreviation) — [Source](<full source URL from search results>)\`. The markdown link is MANDATORY — the URL inside the parentheses must be a working link to indiankanoon.org, itat.gov.in, sci.gov.in, livelaw.in, taxmann.com, or another authoritative source that you saw in the search results for this query. Use the literal word "Source" as the link text so it renders as a compact, clickable hyperlink in the PDF. A citation without a verifiable URL will be stripped from the final letter automatically — do not produce them. Fabricating a citation (inventing a case name, volume, page, or year that does not exist) is a hard rule violation and degrades the quality of the entire reply.

(7) \`## 5. RELIEF SOUGHT\` — a numbered list \`(1) (2) (3) ...\` of the exact prayers. Include precise rupee amounts wherever the notice has quantified figures (e.g. refund, interest withdrawal, demand rectification).

(8) \`## 6. DOCUMENTS ENCLOSED\` — a numbered list of 4–6 realistic enclosures appropriate to the notice type (copy of intimation, copy of ITR, Form 10-ID / Form 3CEB / Form 3CB-3CD, TDS/TCS certificates, bank proofs, etc.).

(9) Closing block — output each item on its own line using GFM hard line breaks (two trailing spaces before the newline). The exact order is:
\`Thanking you,  \`
\`For <Sender Name>  \`
\`Authorised Signatory  \`
\`Name: <natural person's full name — e.g. "Hemendra Goyal" — NEVER the company name>  \`
\`Designation: <inferred — Director / Managing Director for companies, Proprietor for sole-prop, Partner for firms>  \`
\`Place: <sender city / address>  \`
\`Date: <today's IST date>  \`
Use the values from the provided sender details; do NOT output bracketed placeholders. Do NOT add any section after the closing block.

FORMATTING RULES (strict)
- Output GitHub-Flavoured Markdown only — no HTML, no front-matter, no fenced code blocks except when quoting machine output.
- Use \`**...**\` for labels and emphasis on key phrases (\`**PAN**\`, \`**Subject:**\`, \`**Section 115JB(5A)**\`, \`**Rs. 55,380/-**\`). DO NOT bold whole paragraphs.
- Rupee amounts: always in plain ASCII — \`Rs. 55,380/-\` or \`Rs. 3,52,881\`. NEVER use the Unicode \`Rs.\` character (U+20B9). The PDF renderer cannot display it.
- Section numbers: always cite precisely, with sub-section where applicable: "Section 115JB(5A)", "Section 143(1)(a)", "Rule 8D(2)(iii)".
- Statutory quotations: blockquotes ONLY for verified, URL-cited text (see "STATUTORY QUOTATIONS — STRICTEST RULE" above). Otherwise paraphrase in prose; do not blockquote unverified text.
- Never leave square-bracket placeholders ([NAME], [DATE], [TBD]) in the final letter. If a value is genuinely missing, write a sensible plain-language fallback ("the Assessing Officer", "the undersigned").
- Numbered section headings \`## 1. ...\` through \`## 6. ...\` must appear in that exact sequence; skip a section only if truly not applicable.

QUALITY BAR
- NO FABRICATION. The single highest rule. Fabricating ANY of the following is a hard failure: (a) case-law citations (volume, year, page, court), (b) statutory text inside a blockquote, (c) circular / notification numbers, (d) form numbers. If you have any doubt about whether something is real, omit it. Plain statutory reasoning is always acceptable; invented text never is.
- Be precise about section numbers and sub-sections — a wrong citation sinks the reply.
- Write in the voice of a practising senior advocate: precise, assertive, respectful. No marketing language, no emojis, no hedging about being AI-generated.
- Complete every sentence — never truncate mid-argument.

PROCEDURAL VEHICLE — pick the RIGHT remedy
The remedy chosen in the Subject line and Relief section MUST match the type of notice. Wrong vehicle = the reply is procedurally inadmissible and will be returned unactioned. Decision tree:
- CPC intimation u/s 143(1) with a computational / option / mismatch error → REPLY u/s 154 RECTIFICATION (filed online via the e-portal). NOT a stay application.
- Order u/s 143(3) / 144 / 147 / 263 / 154 (post-rectification) that you wish to challenge → APPEAL u/s 246A to CIT(A) within 30 days.
- Recovery demand notice u/s 156 followed by recovery action while a CIT(A) appeal is pending → STAY APPLICATION u/s 220(6) to the Jurisdictional AO (or PCIT for higher quantum).
- Penalty notice u/s 271/270A → REPLY explaining no concealment / no inaccurate particulars, requesting drop of penalty.
- GST DRC-01A pre-show-cause → SUBMISSIONS replying to the pre-SCN, requesting closure.
- GST DRC-03 voluntary payment opportunity → either pay and file DRC-03 OR submit reply explaining why payment is not due.
- Section 133(6) information call → REPLY furnishing the information requested; no relief sought, no formal grievance.
A Section 220(6) stay is NEVER appropriate as the first response to a 143(1) intimation — section 154 rectification is. If the notice details supplied to you describe a CPC intimation, pick 154 rectification, even if the user's "key points" hint at a stay; politely correct the framing in your reply.

SELF-VERIFICATION (run before finalising your output)
Mentally re-read the draft and confirm:
1. Every \`> "..."\` blockquote is either (a) followed by a \`Source: <URL>\` line you actually saw in search results, or (b) deleted in favour of prose. If neither, you must rewrite that block as prose before emitting.
2. The Subject line and Relief section reference the right procedural vehicle per the decision tree above.
3. If a tax option (115BAA, 115BAB, 115BAC, 11(2) accumulation, etc.) is invoked, the operative form (10-IC, 10-ID, 10-IEA, 10) is named and its filing status is stated or flagged as "subject to confirmation".
4. The \`Name:\` line in the closing block is a person's name, not the company. If you only have a company name in the inputs, write \`Name: <Authorised Director / Authorised Signatory>\` rather than echoing the company.
5. If you challenge a numerical demand, a side-by-side computation table is present.
6. The case-law section (## 4) either contains entries each with a URL, or is omitted entirely.
A draft that fails any of (1)–(4) is unacceptable. Self-correct before producing your final output.

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

Inline citation form: when the supporting authority is an official notification, circular, or judgment URL surfaced by the search, append a short bracketed reference at the end of the relevant sentence using markdown link syntax so the URL is clickable in the rendered PDF — e.g. \`(see [CBDT Circular No. 12/2024](<full URL>) dated 15.05.2024)\` or \`(see [ITAT Mumbai, ITA No. 1234/2023](<full URL>) dated 02.02.2024)\`. The link text should be the precise document number; the URL goes inside the parentheses. If you do not have a verifiable URL for the reference, drop the link and emit just the bracketed reference as plain text.`;

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
  const periodStart = (billingUser ?? actor) ? getUsagePeriodStart(billingUser ?? actor!) : new Date(0).toISOString().replace('Z', '');
  // Per-feature notice cap removed — only the cross-feature token
  // budget gates now. `used` still tracked for analytics logging.
  void featureUsageRepo.countSinceForBillingUser(billingUserId, 'notice', periodStart);
  const tokenQuota = enforceTokenQuota(req, res);
  if (!tokenQuota.ok) return;

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';

  // ── Server-side notice extraction (when a file was uploaded) ──
  // Cost is logged to usageRepo under feature='notice' so it appears alongside
  // the draft cost in the admin dashboard, but the chat attachment_upload
  // counter is intentionally NOT incremented here.
  // PDF page-count gate. Server-side backstop for the client check in
  // NoticeForm — protects against direct API uploads that bypass the
  // browser. Counts `/Type /Page` markers in the PDF binary; cheap
  // (no pdfjs dependency on the server) and accurate enough.
  // Cap is plan-tiered: Free / Pro = 10 pages, Enterprise = 50.
  // Notices are usually 1-3 pages but enterprise users sometimes
  // upload bundled assessment-order packs that genuinely run longer.
  // Notice PDF page count is no longer capped — the multer file-size
  // limit and token budget are the only gates.
  let extractionMeta: { mergedNoticeNumber?: string; mergedNoticeDate?: string; mergedSection?: string; mergedAssessmentYear?: string; mergedDin?: string } = {};
  if (req.file) {
    try {
      // Gemini vision — handles both PDF and image notices natively.
      // Tier-1 Gemini 3.1 Flash-Lite Preview, tier-2 fallback to
      // Gemini 2.5 Flash-Lite when tier 1 returns syntactically-valid
      // JSON with no usable summary (the same `looksValid` pattern
      // bank-statement extraction uses to defeat empty responses).
      const extractStartMs = Date.now();
      const extraction = await extractVisionWithFallback<{
        summary: string;
        noticeNumber: string | null;
        noticeDate: string | null;
        section: string | null;
        assessmentYear: string | null;
        din: string | null;
      }>(req.file.buffer, req.file.mimetype, NOTICE_EXTRACTION_PROMPT, {
        // Reject empty-summary responses so tier 2 fires. Notice
        // extraction MUST produce a summary — that's the field the
        // downstream draft generation reads. If it's missing the
        // first call effectively failed even though the JSON parsed.
        looksValid: (data) => {
          const d = data as { summary?: unknown } | null;
          return !!d && typeof d.summary === 'string' && d.summary.trim().length > 0;
        },
      });

      // extraction.data is typed by the generic; the prior `?? {}`
      // narrowed it to `{}` and broke field access. GeminiJsonResult
      // guarantees `data: T` is set on a successful resolve.
      const data = extraction.data;
      extractedText = (extractedText ?? '') + (data.summary ?? '');
      extractionMeta = {
        mergedNoticeNumber: data.noticeNumber ?? undefined,
        mergedNoticeDate: data.noticeDate ?? undefined,
        mergedSection: data.section ?? undefined,
        mergedAssessmentYear: data.assessmentYear ?? undefined,
        mergedDin: data.din ?? undefined,
      };

      // Log vision cost to api_usage. Tagged 'notice_extract' (not
      // plain 'notice') so the admin dashboard can distinguish the
      // PDF-extract pass from the draft-generation pass — they have
      // different cost profiles (extract = vision input, no search;
      // draft = text input + search grounding) and merging them into
      // one label hides which is the bigger spend.
      try {
        const cost = extraction.inputTokens * GEMINI_T2_INPUT_COST + extraction.outputTokens * GEMINI_T2_OUTPUT_COST;
        usageRepo.logWithBilling(clientIp, req.user.id, billingUserId, extraction.inputTokens, extraction.outputTokens, cost, false, extraction.modelUsed, false, 'notice_extract', 0, 'success', 0, Date.now() - extractStartMs);
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

  // Reload-resume: persist a placeholder row UPFRONT with status='generating'
  // so a tab close + reload mid-draft re-attaches via /api/notices and the
  // frontend manager's polling loop. Dedup against an in-progress run for
  // the same input fingerprint so a panicked retry doesn't double-bill the
  // user. Hash captures the meaningful identity of the request — not the
  // full prompt (which includes large extracted text), but enough to detect
  // an exact repeat.
  const inputData = JSON.stringify({ noticeType, subType, senderDetails, recipientDetails, noticeDetails: mergedNoticeDetails, keyPoints });
  const title = `${noticeType.toUpperCase()} - ${subType || 'Reply'} - ${mergedNoticeDetails.noticeNumber || 'Draft'}`;
  const fileHash = crypto.createHash('sha256')
    .update(`${noticeType}|${subType ?? ''}|${senderDetails?.pan ?? ''}|${mergedNoticeDetails.noticeNumber ?? ''}|${keyPoints ?? ''}`)
    .digest('hex');

  const inProgress = noticeRepo.findInProgressByHashForUser(req.user.id, fileHash);
  if (inProgress) {
    console.log(`[notices] re-attaching to in-progress notice ${inProgress.id} instead of starting a new run`);
    sse.writeDone({ noticeId: inProgress.id, resumed: true });
    sse.end();
    return;
  }

  const noticeId = noticeRepo.createPlaceholder(req.user.id, noticeType, subType ?? null, title, inputData, fileHash, billingUserId);

  const draftStartMs = Date.now();
  try {
    const provider = pickChatProvider();
    const usage = await provider.streamChat(
      {
        systemPrompt: NOTICE_SYSTEM_PROMPT,
        userMessage: userPrompt,
        maxTokens: MAX_TOKENS,
        onFallback: () => { sse.writeEvent({ providerFallback: true }); },
      },
      (text) => { fullResponse += text; sse.writeText(text); },
    );

    let sanitizationReport = { changed: false, droppedEntries: 0, totalEntries: 0, keptEntries: 0 };
    if (fullResponse) {
      // Strip any case-law citations the model produced without a
      // verifiable source URL, and strip the entire section when the
      // model leaves it empty or as a "Not applicable" placeholder.
      // The model has been told (in the system prompt) that URL-less
      // citations will be removed and that the section should be
      // omitted when no real citations exist; this is the automated
      // enforcement of those rules. See noticeCitationSanitizer for
      // the precise behaviour.
      //
      // The streamed text the user saw mid-generation may have
      // included a fabricated citation that gets stripped here —
      // that's acceptable because the persisted draft (which is what
      // the user will refresh / save / export) is now clean, and the
      // SSE 'done' event tells the frontend the canonical content
      // changed so it can re-fetch and replace the live view.
      const sanitized = sanitizeNoticeCitations(fullResponse);
      sanitizationReport = sanitized.report;
      if (sanitized.report.changed) {
        console.log(`[notices] sanitised notice ${noticeId}: dropped ${sanitized.report.droppedEntries}/${sanitized.report.totalEntries} citation(s) without an authoritative source URL`);
      }
      fullResponse = sanitized.text;

      // updateContent flips status='generating' → 'generated' and clears
      // any previous error_message. Quota is debited here too (only on
      // success) via featureUsageRepo below.
      noticeRepo.updateContent(noticeId, fullResponse);
    } else {
      // Empty response from the model. Treat as error so the row doesn't
      // sit forever on 'generating' or appear as a successful empty draft.
      noticeRepo.setError(noticeId, req.user.id, 'Model returned an empty response');
      sse.writeError('Failed to generate notice draft — empty model response. Please try again.');
      sse.end();
      return;
    }

    // Log TOTAL input tokens consumed (fresh + cache reads + cache writes) so
    // the admin dashboard reflects true model context size, not just the
    // billed-fresh subset Anthropic returns in `input_tokens`.
    const totalInput = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
    usageRepo.logWithBilling(clientIp, req.user!.id, billingUserId, totalInput, usage.outputTokens, usage.costUsd, false, usage.modelUsed, usage.withSearch, 'notice', 0, 'success', 0, Date.now() - draftStartMs);

    // Log to the immutable feature_usage table so the monthly quota is
    // unaffected by notice deletions (same pattern as board resolutions,
    // bank statements, uploads, and AI suggestions).
    featureUsageRepo.logWithBilling(req.user!.id, billingUserId, 'notice');

    // Signal to the frontend whether the live-streamed text drifted
    // from the persisted canonical content because of citation
    // sanitisation. The client uses this to re-fetch the notice from
    // /api/notices/:id so the displayed draft matches what got saved
    // (and what the user will export / file). Without this flag the
    // user could read a fabricated citation on screen, hit "Export
    // PDF", and only then realise the PDF didn't contain it — or
    // worse, copy the on-screen text manually.
    sse.writeDone({
      noticeId,
      citationsSanitized: sanitizationReport.changed,
      citationsDropped: sanitizationReport.droppedEntries,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[notices] Generation error: ${errMsg.slice(0, 200)}`);
    // Mark the placeholder row as 'error' so the polling loop stops and
    // the user sees the failure in the list with a recoverable error
    // message rather than a forever-'generating' row.
    try {
      noticeRepo.setError(noticeId, req.user!.id, errMsg);
    } catch (e) {
      console.error('[notices] failed to mark notice as error:', e);
    }
    // Log the failed attempt to api_usage with status='failed' so the
    // admin dashboard sees the wasted spend, but it does NOT count
    // toward the user's token budget (sumTokensThisMonth excludes
    // status='failed'). Token counts are 0 since we don't have a
    // usage object on the failure path.
    try {
      usageRepo.logWithBilling(clientIp, req.user!.id, billingUserId, 0, 0, 0, false, undefined, false, 'notice', 0, 'failed');
    } catch (e) {
      console.error('[notices] failed-attempt log failed:', e);
    }
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
  const periodStart = (billingUser ?? actor) ? getUsagePeriodStart(billingUser ?? actor!) : new Date(0).toISOString().replace('Z', '');
  const used = featureUsageRepo.countSinceForBillingUser(billingUserId, 'notice', periodStart);
  // `usage.limit` removed — there's no per-feature cap any more, only
  // the cross-feature token budget. Clients should fall back to
  // displaying just `used` (analytics counter).
  res.json({ notices, usage: { used } });
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
