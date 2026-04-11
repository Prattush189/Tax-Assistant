import { Router, Response } from 'express';
import { grok, GROK_MODEL } from '../lib/grok.js';
import { noticeRepo } from '../db/repositories/noticeRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
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

const NOTICE_SYSTEM_PROMPT = `You are a professional Indian tax and legal notice drafter. You draft replies to notices from the Income Tax Department, GST authorities, and other regulatory bodies.

OUTPUT FORMAT:
You MUST output the notice in this EXACT professional legal letter format. Do NOT use markdown headings, bullet points, or formatting. Use plain text letter format:

[Sender Name]
[Sender Address]
[City, State - Pincode]
PAN: [PAN Number] / GSTIN: [GSTIN if applicable]

Date: [DD/MM/YYYY]

To,
The [Officer Designation],
[Office Name / Ward / Circle],
[Department Address],
[City - Pincode]

Subject: Reply to Notice No. [Number] dated [Date] u/s [Section] for [AY/FY/Period]

Ref: [Notice reference, DIN if available]

Respected Sir/Madam,

1. I/We, [Name], bearing PAN [PAN], respectfully submit this reply in response to the above-referenced notice.

2. [Address each point raised in the notice sequentially, numbered]

3. [Provide factual clarifications with specific references to relevant sections of the Income Tax Act / GST Act]

4. [If applicable, explain any discrepancy with supporting details]

5. In view of the above submissions, it is respectfully submitted that [conclusion/request].

6. The following documents are enclosed in support of the above submissions:

Enclosures:
1. [Document 1]
2. [Document 2]
3. [Document 3]

I/We request your good office to kindly consider the above submissions and drop the proceedings / pass a favourable order.

I/We remain available for any further clarification or personal hearing as may be required.

Yours faithfully,

[Name]
[Designation / Status]
[PAN / GSTIN]
Place: [City]
Date: [DD/MM/YYYY]

RULES:
- Use formal, respectful legal language throughout
- Address EVERY point raised in the notice — do not skip any
- Cite specific section numbers from the relevant Act (Income Tax Act 2025/1961, CGST Act 2017)
- Include relevant case law references where applicable
- Be factual and precise — avoid emotional language
- Number all paragraphs sequentially
- Suggest realistic enclosures based on the notice type
- For Income Tax: reference Assessment Year, PAN, Ward/Circle
- For GST: reference GSTIN, tax period, ARN if applicable
- If notice details are incomplete, use placeholder brackets [___] for missing info
- Do NOT add markdown formatting (no ##, no **, no bullets). Use plain numbered paragraphs.`;

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

  // Build the user prompt
  let userPrompt = `Draft a professional reply to the following notice:\n\n`;
  userPrompt += `Notice Type: ${noticeType}\n`;
  if (subType) userPrompt += `Sub-type: ${subType}\n`;

  if (senderDetails) {
    userPrompt += `\nSender Details:\n`;
    if (senderDetails.name) userPrompt += `- Name: ${senderDetails.name}\n`;
    if (senderDetails.address) userPrompt += `- Address: ${senderDetails.address}\n`;
    if (senderDetails.pan) userPrompt += `- PAN: ${senderDetails.pan}\n`;
    if (senderDetails.gstin) userPrompt += `- GSTIN: ${senderDetails.gstin}\n`;
  }

  if (recipientDetails) {
    userPrompt += `\nRecipient (Officer) Details:\n`;
    if (recipientDetails.officer) userPrompt += `- Officer: ${recipientDetails.officer}\n`;
    if (recipientDetails.office) userPrompt += `- Office: ${recipientDetails.office}\n`;
    if (recipientDetails.address) userPrompt += `- Address: ${recipientDetails.address}\n`;
  }

  if (noticeDetails) {
    userPrompt += `\nNotice Details:\n`;
    if (noticeDetails.noticeNumber) userPrompt += `- Notice No.: ${noticeDetails.noticeNumber}\n`;
    if (noticeDetails.noticeDate) userPrompt += `- Notice Date: ${noticeDetails.noticeDate}\n`;
    if (noticeDetails.section) userPrompt += `- Section: ${noticeDetails.section}\n`;
    if (noticeDetails.assessmentYear) userPrompt += `- Assessment Year / Period: ${noticeDetails.assessmentYear}\n`;
    if (noticeDetails.din) userPrompt += `- DIN: ${noticeDetails.din}\n`;
  }

  userPrompt += `\nKey Points to Address:\n${keyPoints}\n`;

  if (extractedText) {
    userPrompt += `\nExtracted content from uploaded notice document:\n${extractedText}\n`;
  }

  // RAG: get relevant Act sections for context
  const ragQuery = `${noticeType} ${subType || ''} section ${noticeDetails?.section || ''} notice reply`;
  const ragContext = retrieveContext(ragQuery);
  if (ragContext) {
    userPrompt += `\n[Reference from Income Tax Acts for accurate section numbers]:\n${ragContext}\n`;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let fullResponse = '';

  try {
    const stream = await grok.chat.completions.create({
      model: GROK_MODEL,
      messages: [
        { role: 'system', content: NOTICE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: MAX_TOKENS,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        fullResponse += delta;
        res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
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
