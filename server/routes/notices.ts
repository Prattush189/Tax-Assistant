import { Router, Response } from 'express';
import { pickChatProvider } from '../lib/chatProvider.js';
import { SseWriter } from '../lib/sseStream.js';
import { BreakerOpenError } from '../lib/circuitBreaker.js';
import { noticeRepo } from '../db/repositories/noticeRepo.js';
import { styleProfileRepo } from '../db/repositories/styleProfileRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { getBillingUser } from '../lib/billing.js';
import { AuthRequest } from '../types.js';
import { retrieveContext } from '../rag/index.js';

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

(6) \`## 4. SUPPORTING CASE LAWS / LEGAL PRECEDENTS\` — a numbered list using \`**(i)** <heading>:\`, \`**(ii)** <heading>:\` etc. Under each, a short paragraph stating the principle and the citation in this exact form: \`[Assessee] v. [Department], (Year) Volume ITR/GSTL Page (Court abbreviation)\`. Cite 2–4 precedents. Only use real judgments — never fabricate a citation; if unsure, state the principle as a "well-settled rule" without a fake citation.

(7) \`## 5. RELIEF SOUGHT\` — a numbered list \`(1) (2) (3) ...\` of the exact prayers. Include precise rupee amounts wherever the notice has quantified figures (e.g. refund, interest withdrawal, demand rectification).

(8) \`## 6. DOCUMENTS ENCLOSED\` — a numbered list of 4–6 realistic enclosures appropriate to the notice type (copy of intimation, copy of ITR, Form 10-ID / Form 3CEB / Form 3CB-3CD, TDS/TCS certificates, bank proofs, etc.).

(9) Closing block — on separate lines, in this order:
\`Thanking you,\`
\`For <Sender Name>\`
\`Authorised Signatory\`
\`Name:\`
\`Designation:\` (infer: Director / Managing Director for companies, Proprietor for sole-prop, Partner for firms)
\`Place:\`
\`Date:\`
Use the values from the provided sender details; do NOT output bracketed placeholders.

(10) (Optional) \`## HOW TO FILE THIS <RECTIFICATION|REPLY>\` — only when the notice is amenable to an online remedy (e.g. intimation u/s 143(1), DRC-01, DRC-03). Render a GFM table with columns "Step" and "Action" listing 4–6 concrete portal steps, followed by a single \`**Deadline:** ...\` line stating the statutory time limit.

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
- Complete every sentence — never truncate mid-argument.`;

// ── Generate notice draft (streaming) ──
router.post('/generate', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const { noticeType, subType, senderDetails, recipientDetails, noticeDetails, keyPoints, extractedText } = req.body;

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
  const used = noticeRepo.countByBillingUserMonth(billingUserId);

  if (used >= limit) {
    res.status(429).json({
      error: `You've reached your monthly notice draft limit (${limit}). Upgrade your plan for more.`,
      upgrade: true,
    });
    return;
  }

  // Save notice record — stamped with both user_id (actor) and billing_user_id (pool).
  const inputData = JSON.stringify({ noticeType, subType, senderDetails, recipientDetails, noticeDetails, keyPoints });
  const title = `${noticeType.toUpperCase()} - ${subType || 'Reply'} - ${noticeDetails?.noticeNumber || 'Draft'}`;
  const noticeId = noticeRepo.create(req.user.id, noticeType, subType, title, inputData, billingUserId);

  // ── Build the user prompt ────────────────────────────────────────────────
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
  userPrompt += `  Notice / Intimation No.: ${noticeDetails?.noticeNumber || '[extract from notice text below]'}\n`;
  userPrompt += `  Notice Date: ${noticeDetails?.noticeDate || '[extract from notice text below]'}\n`;
  userPrompt += `  Section: ${noticeDetails?.section || '[extract from notice text below]'}\n`;
  userPrompt += `  Assessment Year / Period: ${noticeDetails?.assessmentYear || '[extract from notice text below]'}\n`;
  if (noticeDetails?.din) userPrompt += `  DIN: ${noticeDetails.din}\n`;

  userPrompt += `\nKey points the reply must address (from the taxpayer):\n${keyPoints}\n`;

  if (extractedText) {
    userPrompt += `\n=== UPLOADED NOTICE TEXT (use this to fill any "[extract from notice text below]" fields above, and to pull exact figures / department wording for quotations) ===\n`;
    userPrompt += extractedText.slice(0, 8000);
    userPrompt += `\n=== END OF NOTICE TEXT ===\n`;
  }

  const ragQuery = `${noticeType} ${subType || ''} section ${noticeDetails?.section || ''} notice reply`;
  const ragContext = retrieveContext(ragQuery);
  if (ragContext) {
    userPrompt += `\n=== SUPPLEMENTARY ACT REFERENCE (use for accurate section numbers / sub-section text) ===\n${ragContext}\n`;
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
  userPrompt += `Produce the COMPLETE reply letter in GitHub-Flavoured Markdown per the structure in the system prompt. Start with the 2-column summary header table, then the \`**Subject:**\` line, then the salutation and body sections 1–6, then the closing block, and (if applicable) section "HOW TO FILE THIS RECTIFICATION" as a final appendix.\n`;
  userPrompt += `Do NOT output any bracketed placeholders like [NAME] or [TBD] in the final letter — use the supplied values or a sensible plain-language fallback.\n`;

  const sse = new SseWriter(res);
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
  let fullResponse = '';

  try {
    const provider = pickChatProvider();
    const usage = await provider.streamChat(
      { systemPrompt: NOTICE_SYSTEM_PROMPT, userMessage: userPrompt, maxTokens: MAX_TOKENS },
      (text) => { fullResponse += text; sse.writeText(text); },
    );
    // Log TOTAL input tokens consumed (fresh + cache reads + cache writes) so
    // the admin dashboard reflects true model context size, not just the
    // billed-fresh subset Anthropic returns in `input_tokens`.
    const totalInput = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
    usageRepo.logWithBilling(clientIp, req.user!.id, billingUserId, totalInput, usage.outputTokens, usage.costUsd, false, usage.modelUsed, usage.withSearch, 'notice');

    if (fullResponse) {
      noticeRepo.updateContent(noticeId, fullResponse);
    }

    sse.writeDone({ noticeId });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[notices] Generation error: ${errMsg.slice(0, 200)}`);
    if (err instanceof BreakerOpenError) {
      sse.writeError(`Notice generation is temporarily unavailable (upstream "${err.upstream}" is degraded). Please retry in ${Math.ceil(err.retryAfterMs / 1000)} seconds.`);
    } else {
      sse.writeError('Failed to generate notice draft. Please try again.');
    }
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
  const used = noticeRepo.countByBillingUserMonth(billingUserId);
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
