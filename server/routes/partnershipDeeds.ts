import crypto from 'crypto';
import { Router, Response } from 'express';
import { pickChatProvider } from '../lib/chatProvider.js';
import { SseWriter } from '../lib/sseStream.js';
import {
  partnershipDeedRepo,
  PartnershipDeedTemplateId,
} from '../db/repositories/partnershipDeedRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { getUserLimits } from '../lib/planLimits.js';
import { getBillingUser } from '../lib/billing.js';
import { AuthRequest } from '../types.js';

const router = Router();

const MAX_TOKENS = 8192;

const TEMPLATE_IDS: readonly PartnershipDeedTemplateId[] = [
  'partnership_deed',
  'llp_agreement',
  'reconstitution_deed',
  'retirement_deed',
  'dissolution_deed',
];

function isValidTemplateId(v: unknown): v is PartnershipDeedTemplateId {
  return typeof v === 'string' && TEMPLATE_IDS.includes(v as PartnershipDeedTemplateId);
}

function parseUiPayload(row: { ui_payload: string }): Record<string, unknown> {
  try {
    return JSON.parse(row.ui_payload);
  } catch {
    return {};
  }
}

function istDateString(): string {
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
}

const TEMPLATE_GOVERNING_ACT: Record<PartnershipDeedTemplateId, string> = {
  partnership_deed: 'Indian Partnership Act, 1932',
  llp_agreement: 'Limited Liability Partnership Act, 2008',
  reconstitution_deed: 'Indian Partnership Act, 1932 (Sections 31–32)',
  retirement_deed: 'Indian Partnership Act, 1932 (Section 32)',
  dissolution_deed: 'Indian Partnership Act, 1932 (Sections 39–55)',
};

const TEMPLATE_TITLES: Record<PartnershipDeedTemplateId, string> = {
  partnership_deed: 'Partnership Deed (Formation)',
  llp_agreement: 'LLP Agreement',
  reconstitution_deed: 'Reconstitution Deed',
  retirement_deed: 'Retirement Deed',
  dissolution_deed: 'Dissolution Deed',
};

// ── System prompt ────────────────────────────────────────────────────────
// Gemini 3 Flash with Google Search grounding produces the deed body as
// GitHub-Flavoured Markdown. Search grounding is used to pull current
// stamp-duty rates for the user's state under the relevant State Stamp Act.
const PARTNERSHIP_DEED_SYSTEM_PROMPT = `You are a senior corporate / commercial advocate practising in India with 25+ years of experience drafting partnership deeds, LLP agreements, and partnership amendment instruments. You are deeply familiar with the Indian Partnership Act, 1932; the Limited Liability Partnership Act, 2008; the Indian Stamp Act, 1899 (and each State's amendment); and standard commercial drafting conventions used by Indian law firms.

YOUR TASK
Draft a complete, signature-ready deed in GitHub-Flavoured Markdown. The output must be precise, legally sound, structured per Indian commercial drafting conventions, and contain NO bracketed placeholders in the operative text — except where the document genuinely requires a hand-fillable blank (witness signatures, notary seal, registration number).

You will be given: the template type, the firm's particulars, partner details, banking authority, and any template-specific blocks (incoming partner, retiring partner, dissolution plan). Use the supplied values exactly. Do not invent partner names, PANs, capital amounts, dates, or addresses.

DOCUMENT STRUCTURE (produce every section that applies, in this order)

(1) **Preamble** — Title in ALL CAPS centred (the AI host's PDF wraps this in a stamp-paper banner; you only emit the deed body). Then the parties block:
   "THIS DEED OF PARTNERSHIP / LLP AGREEMENT / DEED OF RECONSTITUTION / DEED OF RETIREMENT / DEED OF DISSOLUTION is made and executed at <principal place>, on this <today's IST date>"
   followed by a numbered list of parties (one paragraph per partner) in this format:
   "(1) <Mr/Ms/Mrs/Shri> <Name>, aged <age> years, son/daughter/wife of ____, resident of <address>, holding PAN <PAN>, hereinafter referred to as the 'First Partner / Party of the First Part';"
   For an LLP Agreement, refer to 'Designated Partners' instead of 'Partners' where appropriate.

(2) **Recitals (WHEREAS clauses)** — 2 to 4 short whereas clauses establishing the background. For a formation deed: that the parties wish to carry on business in partnership. For reconstitution: that the firm was formed by deed dated ____, and the parties now wish to admit a new partner. For retirement: that the named partner wishes to retire. For dissolution: that the parties have mutually agreed to dissolve.
   End with: "NOW THIS DEED WITNESSETH AS UNDER:"

(3) **Operative clauses** — numbered \`## 1.\`, \`## 2.\`, ... in this order (skip clauses not applicable to the template):
   1. Name and Style of the Firm
   2. Nature of Business
   3. Principal Place of Business
   4. Commencement Date and Duration (at-will OR fixed term)
   5. Capital Contribution — render a GFM table with columns "Partner", "Capital Contribution (Rs.)" and totals row
   6. Profit and Loss Sharing — table with "Partner", "Profit Share (%)"; for reconstitution, ALSO include "Revised Share (%)" column
   7. Books of Account — location, accounting period, audit if applicable
   8. Banking Operations — name the operating partners and the singly/jointly mode supplied by the user
   9. Drawings, Salary, Interest on Capital — standard provisions allowed under Section 40(b) of the Income Tax Act, 1961 (interest @ up to 12% p.a., remuneration as per the slab)
   10. Powers and Duties of Partners
   11. Admission, Retirement, Death, and Insolvency of Partners (omit for retirement / dissolution deeds)
   12. Arbitration Clause — if user enabled it, cite the Arbitration & Conciliation Act, 1996
   13. Dispute Resolution and Jurisdiction — cite the courts at the firm's principal place
   14. Special Clauses — render any user-supplied special clauses as separately numbered sub-clauses

For RECONSTITUTION deeds: ALSO include a clause "Admission of New Partner(s)" with the incoming partner block, effective date, capital contribution, and revised share table.

For RETIREMENT deeds: ALSO include "Retirement and Settlement" with the retiring partner's name, effective date, settlement amount in Rs., and settlement mode. State that the continuing partners shall be discharged of all liabilities arising thereafter.

For DISSOLUTION deeds: include "Mode of Dissolution", "Settlement of Accounts (Section 48 IPA)" with the user-supplied settlement plan, "Asset Distribution" if specific allocations are provided, and "Liability Discharge" with the user-supplied plan.

(4) **Stamp Duty Schedule** — a sub-heading \`## Schedule A — Stamp Duty\` containing a short paragraph in this exact form:
   "This deed is chargeable to stamp duty under Article ____ of the <State> Stamp Act / Indian Stamp Act, 1899 as applicable to the State of <state>. As of the date of execution, the applicable stamp duty is approximately Rs. ____. The deed shall be executed on non-judicial stamp paper of the appropriate value."
   Use Google Search to look up the CURRENT stamp duty payable on a partnership deed (or LLP agreement) in the user's state and quote the figure. If the rate is ad-valorem on capital, state both the rate and the resulting computed amount based on the supplied total capital. If you cannot determine the rate confidently, state "as per the prevailing rate under the <State> Stamp Act" without inventing a number.

(5) **Testimonium** — Closing paragraph in this exact form:
   "IN WITNESS WHEREOF, the parties hereto have set their respective hands to this deed at <principal place> on the day, month and year first hereinabove written, in the presence of the witnesses subscribing hereinbelow."

DO NOT emit the witness signature block, partner signature lines, notary attestation, or Section 58 registration block — the AI host renders these into the PDF as fillable templates. End the body after the testimonium.

FORMATTING RULES (strict)
- Output GitHub-Flavoured Markdown only — no HTML, no front-matter, no fenced code blocks.
- All rupee amounts in plain ASCII: \`Rs. 5,00,000/-\` or \`Rs. 12,50,000\`. NEVER use the Unicode rupee character (the PDF renderer cannot display it).
- Use \`**bold**\` for clause headings inside paragraphs ("**The First Partner shall**...") and key amounts/dates. Do not bold full paragraphs.
- Numbered clause headings \`## 1. NAME AND STYLE OF THE FIRM\` etc. — keep the sequence consistent.
- Statutory references must be precise: "Section 4 of the Indian Partnership Act, 1932", "Section 23 of the Limited Liability Partnership Act, 2008", "Section 40(b) of the Income Tax Act, 1961".
- Tables must use GFM pipe-table syntax with a header row and \`---\` separator.
- Never use square-bracket placeholders like [NAME] or [TBD] in the operative text. If a value is genuinely missing, write a sensible legal fallback ("the parties hereto", "as may be mutually agreed").

QUALITY BAR
- Be precise with section numbers and citations — a wrong citation undermines the deed's legal standing.
- Use formal legal English: "the Firm", "the Parties hereto", "hereinafter", "hereinabove", "hereunder".
- For LLP Agreements specifically: use "Designated Partners" terminology, cite the LLP Act 2008 sections, and do NOT refer to the Indian Partnership Act 1932 except where contrasting.
- Stamp duty: use the search tool to ground your figure on current State Stamp Act rates. Cite the source naturally in prose ("as currently notified under the <State> Stamp (Amendment) Act").
- Write in the voice of a practising senior advocate: precise, formal, assertive. No marketing language, no emojis, no hedging about being AI-generated.
- Complete every clause — never truncate mid-sentence.`;

// ── List user's drafts (with usage counter) ──────────────────────────────
router.get('/drafts', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }

  const rows = partnershipDeedRepo.findByUserId(req.user.id);
  const drafts = rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    template_id: r.template_id,
    name: r.name,
    ui_payload: parseUiPayload(r),
    generated_content: r.generated_content,
    exported_at: r.exported_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  const actor = userRepo.findById(req.user.id);
  if (!actor) { res.status(401).json({ error: 'User not found' }); return; }
  const billingUser = getBillingUser(actor);
  const limits = getUserLimits(billingUser);
  const used = featureUsageRepo.countThisMonthByBillingUser(billingUser.id, 'partnership_deeds');

  res.json({ drafts, usage: { used, limit: limits.partnershipDeeds } });
});

// ── Create empty draft (no AI yet, no quota debit) ──────────────────────
router.post('/drafts', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }

  const { template_id, name, ui_payload } = req.body ?? {};

  if (!isValidTemplateId(template_id)) {
    res.status(400).json({ error: 'template_id must be one of ' + TEMPLATE_IDS.join(', ') });
    return;
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const actor = userRepo.findById(req.user.id);
  if (!actor) { res.status(401).json({ error: 'User not found' }); return; }
  const billingUser = getBillingUser(actor);
  const billingUserId = billingUser.id;

  const payloadStr =
    typeof ui_payload === 'string' ? ui_payload : JSON.stringify(ui_payload ?? {});

  const draft = partnershipDeedRepo.create(
    req.user.id,
    template_id,
    name.trim(),
    payloadStr,
    billingUserId,
  );

  res.status(201).json({
    ...draft,
    ui_payload: parseUiPayload(draft),
  });
});

// ── Get single draft ────────────────────────────────────────────────────
router.get('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = partnershipDeedRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }
  res.json({ ...draft, ui_payload: parseUiPayload(draft) });
});

// ── Autosave (name and/or ui_payload) ───────────────────────────────────
router.patch('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = partnershipDeedRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }

  const { name, ui_payload } = req.body ?? {};
  if (typeof name === 'string' && name.trim().length > 0) {
    partnershipDeedRepo.updateName(draft.id, req.user.id, name.trim());
  }
  if (ui_payload !== undefined) {
    const payloadStr = typeof ui_payload === 'string' ? ui_payload : JSON.stringify(ui_payload);
    partnershipDeedRepo.updatePayload(draft.id, req.user.id, payloadStr);
  }
  res.json({ success: true });
});

// ── Delete ──────────────────────────────────────────────────────────────
router.delete('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const deleted = partnershipDeedRepo.deleteById(req.params.id, req.user.id);
  if (!deleted) { res.status(404).json({ error: 'Draft not found' }); return; }
  res.json({ success: true });
});

// ── Mark exported (called after successful PDF download) ────────────────
router.post('/drafts/:id/mark-exported', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = partnershipDeedRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }
  partnershipDeedRepo.markExported(draft.id, req.user.id);
  res.json({ success: true });
});

// ── Generate deed body (SSE-streamed) ───────────────────────────────────
router.post('/drafts/:id/generate', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const draft = partnershipDeedRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) {
    res.status(404).json({ error: 'Draft not found' });
    return;
  }

  // Plan-limit gate — fail BEFORE opening the SSE stream so the client
  // sees a normal 429 JSON response (otherwise the stream would 200 + send
  // an error event which is harder to surface as an upgrade banner).
  const actor = userRepo.findById(req.user.id);
  if (!actor) { res.status(401).json({ error: 'User not found' }); return; }
  const billingUser = getBillingUser(actor);
  const billingUserId = billingUser.id;
  const limits = getUserLimits(billingUser);
  const used = featureUsageRepo.countThisMonthByBillingUser(billingUserId, 'partnership_deeds');
  if (used >= limits.partnershipDeeds) {
    res.status(429).json({
      error: `You've reached your monthly partnership deed limit (${limits.partnershipDeeds}). Upgrade your plan for more.`,
      upgrade: true,
      used,
      limit: limits.partnershipDeeds,
    });
    return;
  }

  // ── Build the user prompt ────────────────────────────────────────────
  const payload = parseUiPayload(draft) as Record<string, unknown>;
  const firm = (payload.firm ?? {}) as Record<string, unknown>;
  const partners = (payload.partners ?? []) as Array<Record<string, unknown>>;
  const banking = (payload.banking ?? {}) as Record<string, unknown>;
  const clauses = (payload.clauses ?? {}) as Record<string, unknown>;
  const state = typeof firm.state === 'string' ? firm.state : 'Maharashtra';

  let userPrompt = '';
  userPrompt += `=== DEED DATA (use these values exactly; do not invent or modify them) ===\n`;
  userPrompt += `Today's Date (IST): ${istDateString()}\n`;
  userPrompt += `Template: ${TEMPLATE_TITLES[draft.template_id]}\n`;
  userPrompt += `Governing Act: ${TEMPLATE_GOVERNING_ACT[draft.template_id]}\n`;
  userPrompt += `\nFirm:\n${JSON.stringify(firm, null, 2)}\n`;
  userPrompt += `\nPartners:\n${JSON.stringify(partners, null, 2)}\n`;
  userPrompt += `\nBanking Authority:\n${JSON.stringify(banking, null, 2)}\n`;
  userPrompt += `\nClauses:\n${JSON.stringify(clauses, null, 2)}\n`;

  if (draft.template_id === 'reconstitution_deed' && payload.reconstitution) {
    userPrompt += `\nReconstitution block:\n${JSON.stringify(payload.reconstitution, null, 2)}\n`;
  }
  if (draft.template_id === 'retirement_deed' && payload.retirement) {
    userPrompt += `\nRetirement block:\n${JSON.stringify(payload.retirement, null, 2)}\n`;
  }
  if (draft.template_id === 'dissolution_deed' && payload.dissolution) {
    userPrompt += `\nDissolution block:\n${JSON.stringify(payload.dissolution, null, 2)}\n`;
  }

  userPrompt += `\n=== STAMP DUTY GROUNDING INSTRUCTION ===\n`;
  userPrompt += `Use Google Search to look up the CURRENT stamp duty payable on a `;
  userPrompt += draft.template_id === 'llp_agreement'
    ? `Limited Liability Partnership (LLP) agreement `
    : `partnership deed `;
  userPrompt += `in the State of ${state} under the ${state} Stamp Act / the Indian Stamp Act as amended for ${state}. `;
  userPrompt += `Cite the rate, compute the amount on the supplied total capital where applicable, `;
  userPrompt += `and reflect the figure in Schedule A of the deed.\n`;

  userPrompt += `\n=== YOUR TASK ===\n`;
  userPrompt += `Produce the COMPLETE deed body in GitHub-Flavoured Markdown per the structure in `;
  userPrompt += `the system prompt. Begin with the preamble (title + parties block), then recitals, `;
  userPrompt += `then the numbered operative clauses, then Schedule A, then the testimonium. `;
  userPrompt += `End the body after the testimonium — do NOT emit witness or signature blocks.\n`;
  userPrompt += `Do NOT output bracketed placeholders in the operative text.\n`;

  const sse = new SseWriter(res);
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
  let fullResponse = '';

  // Reload-resume + dedup: hash the input fingerprint (template + payload
  // + state, since stamp duty depends on state) and refuse a parallel
  // run for the same draft+fingerprint that's already 'generating'.
  // Then flip the existing draft row to status='generating' so the
  // frontend list / sidebar reflect the in-flight state and the polling
  // loop can pick up completion. Node keeps the handler running on tab
  // close; the row updates to 'generated' or 'error' regardless.
  const fileHash = crypto.createHash('sha256')
    .update(`${draft.template_id}|${state}|${draft.ui_payload}`)
    .digest('hex');
  const inProgress = partnershipDeedRepo.findInProgressByHashForUser(req.user.id, fileHash);
  if (inProgress && inProgress.id !== draft.id) {
    console.log(`[partnership-deeds] re-attaching to in-progress draft ${inProgress.id} instead of starting a new run`);
    sse.writeDone({ draftId: inProgress.id, resumed: true });
    sse.end();
    return;
  }
  partnershipDeedRepo.markGenerating(draft.id, req.user.id, fileHash);

  try {
    const provider = pickChatProvider();
    const usage = await provider.streamChat(
      { systemPrompt: PARTNERSHIP_DEED_SYSTEM_PROMPT, userMessage: userPrompt, maxTokens: MAX_TOKENS },
      (text) => { fullResponse += text; sse.writeText(text); },
    );

    if (fullResponse) {
      // updateGeneratedContent flips status='generating' → 'generated'.
      partnershipDeedRepo.updateGeneratedContent(draft.id, req.user!.id, fullResponse);
    } else {
      partnershipDeedRepo.setError(draft.id, req.user!.id, 'Model returned an empty response');
      sse.writeError('Failed to generate partnership deed — empty model response. Please try again.');
      sse.end();
      return;
    }

    // Log TOTAL input tokens consumed (fresh + cache reads + cache writes).
    const totalInput = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
    usageRepo.logWithBilling(
      clientIp,
      req.user!.id,
      billingUserId,
      totalInput,
      usage.outputTokens,
      usage.costUsd,
      false,
      usage.modelUsed,
      usage.withSearch,
      'partnership_deed',
    );

    // Bill the monthly quota only on success.
    featureUsageRepo.logWithBilling(req.user!.id, billingUserId, 'partnership_deeds');

    sse.writeDone({ draftId: draft.id });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[partnership-deeds] Generation error: ${errMsg.slice(0, 200)}`);
    try {
      partnershipDeedRepo.setError(draft.id, req.user!.id, errMsg);
    } catch (e) {
      console.error('[partnership-deeds] failed to mark draft as error:', e);
    }
    sse.writeError('Failed to generate partnership deed. Please try again.');
  }

  sse.end();
});

export default router;
