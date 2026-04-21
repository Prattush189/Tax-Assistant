import { Router, Response } from 'express';
import {
  GEMINI_CHAT_MODEL_THINK_FB,
  GEMINI_THINK_FB_INPUT_COST,
  GEMINI_THINK_FB_OUTPUT_COST,
  GEMINI_API_KEYS,
} from '../lib/gemini.js';
import { streamGeminiChat } from '../lib/geminiChat.js';
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

// ── Build letter header server-side ──────────────────────────────────────────
// Pre-filling all known fields eliminates unfilled [PLACEHOLDER] variables in
// the AI output. The model only writes the body (paragraphs + case laws).
function buildLetterHeader(
  senderDetails: Record<string, string> | undefined,
  recipientDetails: Record<string, string> | undefined,
  noticeDetails: Record<string, string> | undefined,
  noticeType: string,
  subType: string | undefined,
): string {
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // IST
  const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

  const lines: string[] = [];

  // Sender block
  if (senderDetails?.name) lines.push(senderDetails.name);
  if (senderDetails?.address) lines.push(senderDetails.address);
  if (senderDetails?.pan) lines.push(`PAN: ${senderDetails.pan}`);
  if (senderDetails?.gstin) lines.push(`GSTIN: ${senderDetails.gstin}`);

  lines.push('');
  lines.push(`Date: ${dateStr}`);
  lines.push('');

  // Recipient block
  lines.push('To,');
  if (recipientDetails?.officer) {
    lines.push(`The ${recipientDetails.officer},`);
  } else {
    // Sensible defaults by notice type
    const defaultOfficers: Record<string, string> = {
      'income-tax': 'The Income Tax Officer / Assessing Officer,',
      'gst': 'The Deputy Commissioner of Central Tax,',
    };
    const typeKey = noticeType.toLowerCase().includes('gst') ? 'gst' : 'income-tax';
    lines.push(defaultOfficers[typeKey] ?? 'The Competent Authority,');
  }
  if (recipientDetails?.office) lines.push(`${recipientDetails.office},`);
  if (recipientDetails?.address) lines.push(recipientDetails.address);

  lines.push('');

  // Subject line
  const section = noticeDetails?.section ?? noticeType;
  const noticeNum = noticeDetails?.noticeNumber ?? '[Notice No. to be filled]';
  const noticeDate = noticeDetails?.noticeDate ?? '[Notice Date]';
  const ay = noticeDetails?.assessmentYear ?? '';
  const actName = noticeType.toLowerCase().includes('gst')
    ? 'the CGST Act, 2017'
    : 'the Income Tax Act, 1961';
  const subjectAy = ay ? ` for ${ay}` : '';
  const subjectSub = subType ? ` — ${subType}` : '';
  lines.push(`Subject: Reply to Notice / Intimation No. ${noticeNum} dated ${noticeDate} u/s ${section} of ${actName}${subjectAy}${subjectSub}`);

  lines.push('');

  // DIN / Reference line (only if provided)
  if (noticeDetails?.din) {
    lines.push(`Reference: DIN ${noticeDetails.din}`);
    lines.push('');
  }

  lines.push('Respected Sir/Madam,');
  lines.push('');

  return lines.join('\n');
}

function buildLetterClosing(
  senderDetails: Record<string, string> | undefined,
): string {
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

  // Only build the signing block — the model writes the final submission
  // paragraph. We provide known values; model fills in designation from context.
  const lines: string[] = [
    'Yours faithfully,',
    '',
    senderDetails?.name ?? '[Signatory Name]',
    '[Appropriate designation — Director / Proprietor / Partner / Authorised Signatory]',
  ];

  if (senderDetails?.pan) lines.push(`PAN: ${senderDetails.pan}`);
  if (senderDetails?.gstin) lines.push(`GSTIN: ${senderDetails.gstin}`);
  lines.push(`Date: ${dateStr}`);

  return lines.join('\n');
}

const NOTICE_SYSTEM_PROMPT = `You are a senior Indian tax litigation advocate with 20+ years of experience drafting replies to Income Tax Department, GST, and other regulatory notices. You have deep knowledge of the Income Tax Act 1961 (and its 2025 recodification), CGST Act 2017, IGST Act, and associated rules.

SEARCH FIRST, THEN WRITE:
Before writing the letter body, use your search capability to:
1. Verify the exact current section numbers and sub-sections applicable to this notice type
2. Find 2-3 relevant judgments from ITAT, High Courts, or Supreme Court that directly support the taxpayer's position — verify they exist before citing
3. Confirm whether the IT Act 2025 has renumbered any sections cited here

YOUR TASK:
You will be given a pre-filled letter header and closing. Your job is to write ONLY the numbered body paragraphs that go between them — starting at paragraph 1 and ending at the Enclosures list.

Do NOT rewrite the header. Do NOT rewrite the closing. Output ONLY the body starting from paragraph 1.

BODY STRUCTURE (write in this order):
1. Opening paragraph — identify the assessee, the notice, and the assessment year
2. Facts paragraph — state the relevant facts specific to this notice
3. Legal position paragraph — cite exact sections with subsections from the applicable Act
4. Case law paragraph — cite 2-3 real judgments with full citation: Party Name v. Party Name, (Year) Volume ITR/GST Page (Court)
5. Submission paragraph — state what relief is being sought
6. Enclosures — list 4-6 specific, realistic documents appropriate for this notice type

STRICT FORMATTING RULES — READ CAREFULLY:
- Output PLAIN TEXT ONLY — absolutely no markdown, no asterisks (**), no hash (#), no underscores, no bullets (-)
- Do NOT bold anything. The words "Enclosures:" and "Subject:" and "Respected Sir/Madam," must appear as plain text, NOT bold
- NEVER use the Rs. symbol as the Unicode character Rs. — write "Rs." in plain ASCII always (the PDF renderer cannot display special currency characters)
- Keep all sentences and amounts written in plain ASCII characters only
- Number ALL paragraphs sequentially (1, 2, 3...) — never use bold or formatting on the numbers
- Write "Enclosures:" as a plain line, then list items as "1." "2." etc.
- Do NOT truncate mid-sentence — complete every sentence fully
- Write amounts as: Rs. 55,380 (not Rs.55,380 and never the Unicode Rs. symbol)

CITATION FORMAT FOR CASE LAWS (use exactly this format):
As held by the Hon'ble [Court name] in [Assessee] v. [Department/ITO/AO], (Year) Volume ITR/GST Page (Court abbreviation), it was held that [brief principle].

NEVER fabricate case names, citations, or section numbers. Only cite cases and sections you have verified via search.`;

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

  // ── Build pre-filled letter header (server-side substitution) ──────────────
  // This eliminates [PLACEHOLDER] variables in the AI output: we give the model
  // a ready-to-use header and closing; it only writes the numbered body.
  const letterHeader = buildLetterHeader(senderDetails, recipientDetails, noticeDetails, noticeType, subType);
  const letterClosing = buildLetterClosing(senderDetails);

  // ── Build the user prompt ────────────────────────────────────────────────
  // Clearly separate "data to use" from "notice text to extract missing fields from".
  let userPrompt = '';

  // 1. Known data block — model uses these exact values, highest priority
  userPrompt += `=== LETTER DATA (use these values exactly) ===\n`;
  userPrompt += `Notice Type: ${noticeType}\n`;
  if (subType) userPrompt += `Sub-type: ${subType}\n`;

  // Sender fields — mark missing ones so the model knows to look in the notice text
  userPrompt += `\nSender / Assessee:\n`;
  userPrompt += `  Name: ${senderDetails?.name || '[EXTRACT FROM NOTICE BELOW]'}\n`;
  userPrompt += `  Address: ${senderDetails?.address || '[EXTRACT FROM NOTICE BELOW]'}\n`;
  userPrompt += `  PAN: ${senderDetails?.pan || '[EXTRACT FROM NOTICE BELOW]'}\n`;
  if (senderDetails?.gstin || noticeType.toLowerCase().includes('gst')) {
    userPrompt += `  GSTIN: ${senderDetails?.gstin || '[EXTRACT FROM NOTICE BELOW]'}\n`;
  }
  if (senderDetails?.designation) {
    userPrompt += `  Signatory Designation: ${senderDetails.designation}\n`;
  }

  userPrompt += `\nRecipient (Officer / Authority):\n`;
  userPrompt += `  Officer: ${recipientDetails?.officer || '[EXTRACT FROM NOTICE BELOW or use standard designation]'}\n`;
  userPrompt += `  Office / Ward: ${recipientDetails?.office || '[EXTRACT FROM NOTICE BELOW]'}\n`;
  userPrompt += `  Address: ${recipientDetails?.address || '[EXTRACT FROM NOTICE BELOW or use standard CPC/office address]'}\n`;

  userPrompt += `\nNotice Details:\n`;
  userPrompt += `  Notice / Intimation No.: ${noticeDetails?.noticeNumber || '[EXTRACT FROM NOTICE BELOW]'}\n`;
  userPrompt += `  Notice Date: ${noticeDetails?.noticeDate || '[EXTRACT FROM NOTICE BELOW]'}\n`;
  userPrompt += `  Section: ${noticeDetails?.section || '[EXTRACT FROM NOTICE BELOW]'}\n`;
  userPrompt += `  Assessment Year / Period: ${noticeDetails?.assessmentYear || '[EXTRACT FROM NOTICE BELOW]'}\n`;
  if (noticeDetails?.din) userPrompt += `  DIN: ${noticeDetails.din}\n`;

  userPrompt += `\nKey points the reply must address:\n${keyPoints}\n`;

  // 2. Uploaded notice text — used to extract any missing fields above
  if (extractedText) {
    userPrompt += `\n=== UPLOADED NOTICE TEXT (extract any [EXTRACT FROM NOTICE BELOW] fields from this) ===\n`;
    userPrompt += extractedText.slice(0, 6000);
    userPrompt += `\n=== END OF NOTICE TEXT ===\n`;
  }

  // 3. RAG context for accurate section references
  const ragQuery = `${noticeType} ${subType || ''} section ${noticeDetails?.section || ''} notice reply`;
  const ragContext = retrieveContext(ragQuery);
  if (ragContext) {
    userPrompt += `\n=== SUPPLEMENTARY ACT REFERENCE (use for accurate section numbers) ===\n${ragContext}\n`;
  }

  // 4. Pre-filled header and closing — model copies these verbatim
  userPrompt += `\n=== PRE-FILLED LETTER HEADER (copy this VERBATIM as the start of your response) ===\n`;
  userPrompt += letterHeader;
  userPrompt += `\n=== END OF HEADER ===\n`;

  userPrompt += `\n=== PRE-FILLED LETTER CLOSING (copy this VERBATIM as the end of your response, after the Enclosures list) ===\n`;
  userPrompt += letterClosing;
  userPrompt += `\n=== END OF CLOSING ===\n`;

  userPrompt += `\n=== YOUR TASK ===\n`;
  userPrompt += `Output the COMPLETE letter in this order:\n`;
  userPrompt += `1. Copy the PRE-FILLED LETTER HEADER verbatim\n`;
  userPrompt += `2. Write numbered paragraphs 1 through N as the body\n`;
  userPrompt += `3. Write the Enclosures list (plain numbered lines — "Enclosures:" as plain text, no bold)\n`;
  userPrompt += `4. Copy the PRE-FILLED LETTER CLOSING verbatim, replacing "[Appropriate designation...]" with the correct designation inferred from the assessee type (Director for companies, Proprietor for sole-prop, Partner for firms, etc.)\n`;
  userPrompt += `\nFor any field marked [EXTRACT FROM NOTICE BELOW]: scan the uploaded notice text and use the real value you find there. If genuinely not found anywhere, write a brief descriptive placeholder in plain words (e.g., "Income Tax Ward 1, Delhi") — NEVER output [bracket] variables in the final letter.\n`;
  userPrompt += `REMEMBER: Write all rupee amounts as "Rs. X,XX,XXX" in plain ASCII — never use the Unicode rupee symbol (Rs.) as it breaks PDF font rendering and appears as a garbled character.\n`;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Inject user's writing style if they've set one up via Settings
  let systemPrompt = NOTICE_SYSTEM_PROMPT;
  try {
    const styleRow = styleProfileRepo.findByUserId(req.user.id);
    if (styleRow) {
      const rules = JSON.parse(styleRow.style_rules);
      systemPrompt += `\n\nWRITING STYLE PREFERENCE:
The user prefers the following writing style. Match it closely while keeping the letter structure:
- Tone: ${rules.tone ?? 'formal'}
- Formality: ${rules.formalityLevel ?? 7}/10
- Paragraph style: ${rules.paragraphStyle ?? 'moderate'}
- Opening pattern: ${rules.openingStyle ?? 'standard'}
- Closing pattern: ${rules.closingStyle ?? 'standard'}
- Citation style: ${rules.citationStyle ?? 'standard section references'}
- Key phrases to use: ${(rules.typicalPhrases ?? []).join(', ') || 'none specified'}
- Style description: ${rules.overallDescription ?? ''}`;
    }
  } catch {
    // Style lookup failure should never block notice generation
  }

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
  let fullResponse = '';

  // Pick a Gemini API key (round-robin across available keys)
  const apiKey = GEMINI_API_KEYS[Math.floor(Math.random() * Math.max(1, GEMINI_API_KEYS.length))] ?? '';

  try {
    const stream = streamGeminiChat(
      GEMINI_CHAT_MODEL_THINK_FB,
      systemPrompt,
      [], // no prior history for notice generation
      userPrompt,
      apiKey,
      MAX_TOKENS,
      true, // always enable Google Search so section numbers and case laws are accurate
    );

    for await (const chunk of stream) {
      if (chunk.text) {
        fullResponse += chunk.text;
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
      if (chunk.done) {
        const inputTok = chunk.inputTokens ?? 0;
        const outputTok = chunk.outputTokens ?? 0;
        const cost = inputTok * GEMINI_THINK_FB_INPUT_COST + outputTok * GEMINI_THINK_FB_OUTPUT_COST;
        usageRepo.logWithBilling(clientIp, req.user!.id, billingUserId, inputTok, outputTok, cost, false, GEMINI_CHAT_MODEL_THINK_FB, true, 'notice');
      }
    }

    // Save generated content
    if (fullResponse) {
      noticeRepo.updateContent(noticeId, fullResponse);
    }

    res.write(`data: ${JSON.stringify({ done: true, noticeId })}\n\n`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[notices] Generation error: ${errMsg.slice(0, 200)}`);
    res.write(`data: ${JSON.stringify({ error: true, message: 'Failed to generate notice draft. Please try again.' })}\n\n`);
  }

  res.end();
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
