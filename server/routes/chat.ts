// server/routes/chat.ts
import { Router, Response } from 'express';
import { GEMINI_T1_INPUT_COST, GEMINI_T1_OUTPUT_COST, GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST, GEMINI_PRIMARY_INPUT_COST, GEMINI_PRIMARY_OUTPUT_COST, GEMINI_CHAT_MODEL_T1, GEMINI_CHAT_MODEL_T2, GEMINI_CHAT_MODEL_PRIMARY, GEMINI_FLEX, GEMINI_FLEX_SERVICE_TIER, GEMINI_API_KEYS } from '../lib/gemini.js';
import { confirmUsed, getActiveKeyIndex } from '../lib/searchQuota.js';
import { streamGeminiChat } from '../lib/geminiChat.js';
import { referenceUrlsBlock } from '../lib/officialReferenceUrls.js';
import { chatRepo } from '../db/repositories/chatRepo.js';
import { messageRepo } from '../db/repositories/messageRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { getUserLimits, getEffectivePlan } from '../lib/planLimits.js';
import { getBillingUserId, getBillingUser } from '../lib/billing.js';
import { enforceTokenQuota } from '../lib/tokenQuota.js';
import { SseWriter } from '../lib/sseStream.js';
import { AuthRequest } from '../types.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const router = Router();

const MAX_TOKENS = 4096;

// ── Plan-based message limits ──
// Counts messages against the BILLING user (inviter for shared-pool members,
// self for standalone users). Pairs with usageRepo.logWithBilling below.
function getMessageCount(billingUserId: string, period: 'day' | 'month'): number {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // IST
  let since: string;
  if (period === 'day') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    since = start.toISOString().replace('Z', '');
  } else {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    since = start.toISOString().replace('Z', '');
  }
  return usageRepo.countByBillingUser(billingUserId, since);
}

const SYSTEM_INSTRUCTION = `You are "Smartbiz AI" — an expert on Indian Income Tax, GST, and financial planning.

SCOPE — answer broadly, refuse narrowly:
You MUST answer any question that touches Indian tax, finance, or related law. This explicitly includes (non-exhaustive):
- Income tax, GST, customs, TDS/TCS, capital gains, advance tax, presumptive taxation
- Every allowance, exemption, deduction, rebate, surcharge, or cess (HRA, LTA, child education allowance, hostel allowance, transport allowance, NPS, 80C/80D/80E/80G/80TTA/80EEA/80EEB, standard deduction, marginal relief, etc.)
- ITR forms, Form 16/16A/26AS/AIS/TIS, e-filing portal mechanics, refunds, rectifications
- Tax notices, intimations, scrutiny, demand orders, appeals, ITAT/CIT(A) procedure, penalties, prosecution thresholds
- Audit (tax audit, GST audit, statutory audit), bookkeeping for tax purposes, MSME compliance
- Corporate/LLP/partnership tax, MAT, AMT, dividend tax, buyback tax, transfer pricing basics
- International tax for Indian residents (DTAA, foreign income disclosure, TCS on LRS, NRI taxation)
- Recent changes / amendments — Finance Act, Budget proposals, CBDT/CBIC circulars and notifications, GST Council decisions, IT Act 2025 transition
- Adjacent legal/regulatory questions an Indian CA or taxpayer commonly asks: MCA filings, ROC, RBI/FEMA basics, SEBI for individual investors, EPFO/ESI, professional tax, stamp duty
- Personal financial planning that intersects with tax (mutual funds, ELSS, NPS, PPF, EPF, insurance, home loan, capital gains harvesting)

The ONLY topics to politely decline are things wholly unrelated to Indian tax / finance / regulatory work — e.g. recipes, sports, coding help, entertainment trivia, medical advice. Even then, give a one-line redirect; never lecture.

If the user's query is short or under-specified but could plausibly relate to any of the above areas, ASSUME it is in scope and answer (asking a brief follow-up only if you genuinely cannot tell which sub-topic they mean). Do NOT refuse a tax-adjacent question on grounds of vagueness — answer the most likely interpretation and offer to refine.

RULES:
- Default to FY 2025-26 (AY 2026-27). IT Act 2025 replaced IT Act 1961 (effective 1 Apr 2026).
- Scale response to complexity: short for factual lookups, detailed for analysis/comparisons.
- Use Markdown tables for rates/comparisons/thresholds. Use Indian number format (₹1,50,000).
- For charts: \`\`\`json-chart {"type":"bar","title":"...","data":[{"name":"Label","value":12345}]} \`\`\`
- NEVER fabricate section numbers, rates, or policy changes. Say "I'm not certain" if unsure.
- Think step-by-step. For any legal or tax classification, explicitly break down the statutory definition and map the user's facts to it before stating your conclusion.
- Cite section numbers (both old and new Act). Mention consulting a CA for official filing.

LATEST-DATA / WEB-SEARCH RULES (mandatory — your training data is stale):
- You have live Google Search grounding. USE IT for every factual claim involving rates, thresholds, slabs, surcharge tiers, cess, deduction limits, exemption ceilings, due dates, late-fee tables, section/rule numbers, or any "is this still applicable?" question. Do not rely on memory alone for these.
- Tax law in India changes every Budget cycle (Feb 1) and via mid-year CBDT/CBIC notifications. Anything you "know" about FY 2025-26, FY 2024-25, or earlier may already have been amended. Search before answering.
- Specifically: the IT Act 2025 (effective 1 Apr 2026) re-numbered most sections from the IT Act 1961. Do NOT serve a 1961-section answer for an FY 2025-26 / AY 2026-27 question without first confirming the current section number via search.
- If the search results contradict your prior answer or training data, **trust the search results** and update your answer.
- If web search returns nothing for the specific point, say so explicitly ("I couldn't find an authoritative confirmation for this — please verify with a CA before relying on it") instead of guessing.

STALE-MEMORY TRAPS — you MUST web-search these BEFORE answering, EVEN IF YOU FEEL CERTAIN (your training is one Budget cycle behind and is provably wrong on these):
- Capital-gains HOLDING PERIODS and RATES. The 36-month category was ABOLISHED (Finance Act 2024, transfers on/after 23-Jul-2024) — only 12 months (listed securities) and 24 months (everything else, incl. unlisted shares, property, gold, debentures, jewellery) now exist. LTCG is 12.5% (no indexation; property has a grandfathering option), STCG on listed equity (111A) is 20%, LTCG u/s 112A exemption is ₹1.25 lakh. Never state a "36-month" holding period.
- ITR-U (updated return, s.139(8A)): the window is 48 MONTHS (Finance Act 2025), not 24. Additional tax tiers: 25% / 50% / 60% / 70% by how late. Do not serve the old "24 months, 25%/50%" answer.
- GST rates / HSN classifications: the Sep-2025 GST rationalization changed many slabs. NEVER state a specific HSN's GST rate as fact from memory — give the HSN code, then say the rate must be confirmed on the GST portal (gst.gov.in) or the latest rate notification. Hedge every HSN-rate answer.
- ITR-form scope (which form, how many house properties, eligibility) and IT Act 1961→2025 section numbers — confirm via search; do not recite last year's form rules.
If a query touches any of the above, a search is MANDATORY even when you "know" the answer. Trust the search result over your memory, and if search is inconclusive, hedge explicitly rather than stating the remembered value.

TRUSTED CITATION SOURCES (prefer these, never cite anything else as primary authority):
- incometax.gov.in, incometaxindia.gov.in, eportal.incometax.gov.in (CBDT, Income Tax Department, e-filing portal)
- gst.gov.in, cbic.gov.in, cbic-gst.gov.in (CBIC, GST Council)
- mca.gov.in (MCA), sebi.gov.in (SEBI), rbi.org.in (RBI), epfindia.gov.in (EPFO)
- indiankanoon.org, itat.gov.in, sci.gov.in, livelaw.in (judgments — court / official reporters)
- Official press releases / circulars / notifications (PIB, CBDT/CBIC notification PDFs, Finance Act / Budget speech PDFs from indiabudget.gov.in)
- taxmann.com, taxsutra.com (commentary cross-checks only — never as the primary citation when an official source exists)

DO NOT cite blog posts, YouTube, Quora, generic Q&A sites, ChatGPT/AI summaries, or unofficial aggregators. If web search returns only such sources for a point, drop the citation and fall back to "as per the relevant CBDT/CBIC notification" wording without inventing a number.

Inline citation form: when a search result is the basis for a specific number or section, append a short bracketed reference at the end of that sentence — e.g. \`(per CBDT Circular No. 12/2024 dated 15.05.2024)\` or \`(per incometax.gov.in)\`. One reference per fact, not a wall of links.

HANDLING ATTACHED DOCUMENTS:
- If the user attaches a document and asks a vague question, your response MUST focus on the attached document's content.
- Describe what the document contains, highlight key information, and invite the user to ask specific questions.
- Do NOT ignore the attachment and answer a generic tax question instead.

DOWNLOADABLE PDF DOCUMENTS (only when explicitly requested):
- When the user explicitly asks for a PDF / a downloadable or printable document / a handout / a draft letter or notice reply / a report / a lecture handout, wrap the document's content between the markers [[PDF:Short Title]] and [[/PDF]], each on its own line. The app turns exactly that block into a downloadable, branded PDF (with a "Download PDF" button) — there is no other way for you to deliver a file, so you MUST use these markers when a document is requested.
- Write a one-line lead-in BEFORE the block (e.g. "Here's your document — use the Download PDF button below."). Everything between the markers becomes the PDF body: use normal Markdown only (## / ### headings, **bold**, GFM tables, - / 1. lists, > quotes). Do NOT place json-chart blocks inside the markers.
- Use the markers ONLY when a downloadable document is clearly the intent. For ordinary answers, never use them.
- Keep any disclaimer OUTSIDE the markers — the generated PDF already carries a footer disclaimer.
- Example:
  Here's your handout — tap Download PDF below.
  [[PDF:GST Basics for New Interns]]
  # GST Basics for New Interns
  ## 1. Registration thresholds
  ...
  [[/PDF]]

ABOUT THIS APP — IN-APP TOOLS:
You are the assistant INSIDE the Smartbiz AI web app, which has dedicated tools beyond this chat. When a user's request maps to one of these, answer their question AND point them to the right tool and where to find it (tab names below). These tools do the work deterministically — don't try to perform their job inside chat (e.g. don't hand-categorise a pasted statement); guide the user to the tool instead.
- Bank Statement Analyzer — "Books" tab -> "Bank Statements". Upload a bank statement (PDF / Excel / CSV); it auto-categorises every transaction, builds party-wise ledgers (downloadable as PDF or Word), and flags anomalies.
- Ledger Scrutiny & Compare — "Books" tab -> "Ledger Scrutiny". AI audit of a Tally / Busy / Marg ledger, plus a Compare mode that reconciles two parties' books bill-by-bill.
- Notice Reply — "Legal" tab -> "Notices". Drafts replies to Income-Tax / GST notices with verified section citations.
- Deeds & Agreements — "Legal" tab -> "Partnership Deeds". Generates partnership deeds, LLP agreements and rent agreements; download as PDF or editable Word.
- Board Resolutions — "Legal" tab -> "Board Resolutions". Ready-to-sign company board resolutions.
- Calculators & Slips — "Calculator" tab. Income-tax computation, Challan 280, salary slips, rent receipts.
(The "Books" tab also has TB -> Statements and CMA Report for paid plans.)
Only surface a tool when it is genuinely relevant to what was asked — never recite this list unprompted.

OTHER SMARTBIZ TECHNOLOGIES PRODUCTS:
Smartbiz Technologies also sells separate software — SmartTax, SmartGST, SmartBilling (and similarly-named SmartBiz products). These are DIFFERENT applications, not part of this app. Handle questions about them in two buckets:
- PRODUCT INFO (what the products are, features, pricing, latest versions / updates, and download or purchase links): the company's official website https://new.smartbizindia.com/ is the authoritative source. Answer at a high level if you can, and ALWAYS point the user to https://new.smartbizindia.com/ for the full, current details and download links. Never invent a feature, version number, price, or download URL — if you're not sure, just give the website. Prefer the website over generic web-search results for anything about these products.
- SOFTWARE SUPPORT (operating, configuring, troubleshooting, licensing, or billing issues with one of those products): do NOT guess steps — say this assistant doesn't provide support for those products and direct the user to the official Smartbiz Technologies help desk (contact details on https://new.smartbizindia.com/).
A general tax/GST question that merely name-drops a product is still answered normally; only treat it as a product/support question when that's actually what was asked.

${referenceUrlsBlock('chat')}`;

const MAX_HISTORY_MESSAGES = 6; // 3 turns — keeps context tight, reduces tokens

// Attachment limits per plan
// Plan-based attachment-per-message ceiling. Uses the standalone plan defaults;
// plugin overrides don't apply here (attachments PER MESSAGE, not monthly quota).
const ATTACHMENTS_PER_MESSAGE: Record<string, number> = {
  free: 1,
  pro: 3,
  enterprise: 5,
};

router.post('/chat', async (req: AuthRequest, res: Response) => {
  const { chatId, message, fileContext, fileContexts: rawFileContexts, profileContext, reasoningLevel: rawReasoning } = req.body;
  // Configurable thinking (Gemini 3): 'high' = Deep, anything else = Fast.
  // Defaults to Fast so ordinary chat stays snappy.
  const thinkingLevel: 'low' | 'high' = rawReasoning === 'high' ? 'high' : 'low';
  // Normalize: support both single fileContext and array fileContexts
  const fileContexts: { filename: string; mimeType: string; extractedData?: unknown }[] =
    rawFileContexts ?? (fileContext ? [fileContext] : []);

  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (!chatId || typeof chatId !== 'string') {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  if (message.length > 4000) {
    res.status(400).json({ error: 'message exceeds 4000 character limit' });
    return;
  }

  const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';

  // Check per-user message limit (resolves plugin_limits > plugin_plan > plan)
  const user = userRepo.findById(req.user.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  // Limits are resolved from the POOL owner (inviter for invited users).
  const billingUser = getBillingUser(user);
  const billingUserId = billingUser.id;
  const effectivePlan = getEffectivePlan(billingUser);

  // Cross-feature token budget is the only quota gate. The per-feature
  // message-count check that used to live here was already soft (just
  // logged a warning) and the field it read no longer exists.
  const tokenQuota = enforceTokenQuota(req, res);
  if (!tokenQuota.ok) return;

  // Check per-message attachment ceiling (separate from monthly attachment quota)
  const attachLimit = ATTACHMENTS_PER_MESSAGE[effectivePlan] ?? 1;
  if (fileContexts.length > attachLimit) {
    res.status(400).json({ error: `Your plan allows ${attachLimit} attachment(s) per message. Upgrade for more.`, upgrade: true });
    return;
  }

  // Verify chat belongs to user
  const chat = chatRepo.findById(chatId);
  if (!chat || chat.user_id !== req.user.id) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }

  // Persist user message (store first attachment for backward compat)
  const firstFile = fileContexts[0];
  messageRepo.create(chatId, 'user', message.trim(), firstFile?.filename, firstFile?.mimeType);

  // Load history from DB — convert 'model' role to 'assistant' for OpenAI format
  const dbMessages = messageRepo.findByChatId(chatId);
  const history: ChatCompletionMessageParam[] = dbMessages.slice(0, -1)
    .slice(-MAX_HISTORY_MESSAGES)
    .map(m => ({
      role: (m.role === 'model' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    }));

  // Ensure conversation starts with user message
  if (history.length > 0 && history[0].role !== 'user') {
    history.shift();
  }

  let userContent = message.trim();
  if (fileContexts.length > 0) {
    const contextBlocks: string[] = [];
    for (const fc of fileContexts) {
      const data: any = fc.extractedData ?? {};
      if (!data || typeof data !== 'object') continue;

      const parts: string[] = [`[Attached Document: ${fc.filename}]`];
      if (data.documentType) parts.push(`Type: ${data.documentType}`);
      if (data.summary) parts.push(`Summary: ${data.summary}`);

      // Tax-specific structured fields (only if present)
      const taxFields: string[] = [];
      if (data.financialYear) taxFields.push(`FY: ${data.financialYear}`);
      if (data.employerName) taxFields.push(`Employer: ${data.employerName}`);
      if (data.employeeName) taxFields.push(`Employee: ${data.employeeName}`);
      if (data.pan) taxFields.push(`PAN: ${data.pan}`);
      if (data.grossSalary) taxFields.push(`Gross Salary: ₹${data.grossSalary}`);
      if (data.tdsDeducted) taxFields.push(`TDS: ₹${data.tdsDeducted}`);
      if (data.deductions80C) taxFields.push(`80C: ₹${data.deductions80C}`);
      if (data.deductions80D) taxFields.push(`80D: ₹${data.deductions80D}`);
      if (taxFields.length > 0) parts.push(`Tax Data: ${taxFields.join(' | ')}`);

      // Key points
      if (Array.isArray(data.keyPoints) && data.keyPoints.length > 0) {
        parts.push('Key Points:\n' + data.keyPoints.map((p: string) => `  • ${p}`).join('\n'));
      }

      // Full text excerpt
      if (data.fullText) {
        parts.push(`Content Extract:\n${data.fullText}`);
      }

      contextBlocks.push(parts.join('\n'));
    }
    if (contextBlocks.length > 0) {
      userContent = `${contextBlocks.join('\n\n---\n\n')}\n\n---\n\nUser question about the attached document(s): ${userContent}`;
    }
  }

  // Profile context injection
  if (profileContext?.data) {
    userContent = `[Tax Profile: ${profileContext.name}]\nIncome: ₹${profileContext.data.gross_salary}, Other: ₹${profileContext.data.other_income}, FY: ${profileContext.data.fy}, Age: ${profileContext.data.age_category}\nDeductions: ${profileContext.data.deductions_data}\nHRA: ${profileContext.data.hra_data}\n\n${userContent}`;
  }

  const sse = new SseWriter(res);

  // Heartbeat keeps intermediate proxies (nginx, Cloudflare, etc.) from buffering
  // or dropping the connection while the model is still "thinking". The client
  // treats these as no-ops but uses any byte arrival to reset its idle watchdog.
  const HEARTBEAT_MS = 10_000;
  const heartbeat = setInterval(() => { sse.writeHeartbeat(); }, HEARTBEAT_MS);
  // Stop streaming cleanly if the client disconnects mid-response.
  const clientAbort = new AbortController();
  req.on('close', () => { clientAbort.abort(); });

  let fullResponse = '';

  // Retry logic: up to 3 attempts with exponential backoff
  const MAX_RETRIES = 3;

  try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        let stopReason: string | null = null;
        let inputTok = 0;
        let outputTok = 0;

        // ── Fast-mode cascade ─────────────────────────────────────────────
        // Primary  : Gemini 3.1 Flash-Lite (3.x monthly pool) — markedly more
        //            accurate on current-year facts (new-regime slabs, FA-2025
        //            changes like the 48-month ITR-U limit) than 2.5 in the
        //            chat-QA bakeoff; see scripts/model-bakeoff-chat.mts.
        // Fallback : Gemini 2.5 Flash-Lite (2.5 daily pool) — large independent
        //            daily search pool; backstops 3.1 when it's busy/over-quota.
        // Fallback only runs if the primary emitted zero text — we don't
        // restart the stream after partial output (would produce duplicated
        // responses on the client).
        // Web search grounding is always enabled — the chat has no local
        // reference data, so live search is the sole source of truth for
        // rates, sections, and amendments.
        const searchEnabled = true;
        let usedModel = '';
        const historyPlain = history.map(m => ({ role: m.role as string, content: m.content as string }));
        let primaryFailedMidStream = false;
        const callStartMs = Date.now();

        const activeIdx = getActiveKeyIndex();
        const fastApiKey = GEMINI_API_KEYS[activeIdx] ?? '';
        const flexTier = GEMINI_FLEX ? GEMINI_FLEX_SERVICE_TIER : null;

        // ── PRIMARY: Gemini 3 Flash (reasoning + superior grounding) ──
        // Configurable thinking (Fast/Deep). Optional Flex service tier.
        if (fastApiKey) {
          usedModel = GEMINI_CHAT_MODEL_PRIMARY;
          try {
            for await (const chunk of streamGeminiChat(GEMINI_CHAT_MODEL_PRIMARY, SYSTEM_INSTRUCTION, historyPlain, userContent, fastApiKey, MAX_TOKENS, searchEnabled, true, thinkingLevel, flexTier)) {
              if (chunk.text) { fullResponse += chunk.text; sse.writeText(chunk.text); }
              if (chunk.done) {
                inputTok = chunk.inputTokens ?? 0;
                outputTok = chunk.outputTokens ?? 0;
                stopReason = chunk.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn';
              }
            }
            confirmUsed('gemini-3', activeIdx, searchEnabled);
          } catch (err) {
            if (fullResponse) {
              primaryFailedMidStream = true;
              stopReason = 'network_error';
              console.warn('[chat] Gemini 3 Flash failed after partial output; keeping partial:', (err as Error).message?.slice(0, 120));
            } else {
              console.warn('[chat] Gemini 3 Flash failed, falling back to 3.1 Flash-Lite:', (err as Error).message?.slice(0, 120));
              usedModel = '';
              sse.writeEvent({ providerFallback: true });
            }
          }
        }

        // ── FALLBACK 1: Gemini 3.1 Flash-Lite (only if primary returned nothing) ──
        if (!fullResponse && !primaryFailedMidStream && fastApiKey) {
          usedModel = GEMINI_CHAT_MODEL_T1;
          try {
            for await (const chunk of streamGeminiChat(GEMINI_CHAT_MODEL_T1, SYSTEM_INSTRUCTION, historyPlain, userContent, fastApiKey, MAX_TOKENS, searchEnabled, true, thinkingLevel, null)) {
              if (chunk.text) { fullResponse += chunk.text; sse.writeText(chunk.text); }
              if (chunk.done) {
                inputTok = chunk.inputTokens ?? 0;
                outputTok = chunk.outputTokens ?? 0;
                stopReason = chunk.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn';
              }
            }
            confirmUsed('gemini-3', activeIdx, searchEnabled);
          } catch (err) {
            if (fullResponse) {
              primaryFailedMidStream = true;
              stopReason = 'network_error';
              console.warn('[chat] 3.1 Flash-Lite failed after partial output; keeping partial:', (err as Error).message?.slice(0, 120));
            } else {
              console.warn('[chat] 3.1 Flash-Lite failed, falling back to 2.5 Flash-Lite:', (err as Error).message?.slice(0, 120));
              usedModel = '';
              sse.writeEvent({ providerFallback: true });
            }
          }
        }

        // ── FALLBACK 2: Gemini 2.5 Flash-Lite (only when nothing produced yet). ──
        // Reuses the active key — 2.5 draws on its own large daily search pool,
        // independent of the 3.1 monthly pool the primary just failed on.
        if (!fullResponse && !primaryFailedMidStream) {
          const fbApiKey = GEMINI_API_KEYS[activeIdx] ?? '';
          if (fbApiKey) {
            usedModel = GEMINI_CHAT_MODEL_T2;
            try {
              for await (const chunk of streamGeminiChat(GEMINI_CHAT_MODEL_T2, SYSTEM_INSTRUCTION, historyPlain, userContent, fbApiKey, MAX_TOKENS, searchEnabled, true)) {
                if (chunk.text) { fullResponse += chunk.text; sse.writeText(chunk.text); }
                if (chunk.done) {
                  inputTok = chunk.inputTokens ?? 0;
                  outputTok = chunk.outputTokens ?? 0;
                  stopReason = chunk.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn';
                }
              }
              confirmUsed('gemini-2.5', activeIdx, searchEnabled);
            } catch (err) {
              console.warn('[chat] Fast fallback also failed:', (err as Error).message?.slice(0, 120));
              if (!fullResponse) { usedModel = ''; }
            }
          }
        }

        // Neither model produced output — treat this attempt as a failure so
        // the outer retry loop can try again (rather than silently returning
        // a blank reply).
        if (!fullResponse) {
          throw new Error('No response produced by any model');
        }

        // Persist model response
        messageRepo.create(chatId, 'model', fullResponse);

        // Auto-title
        if (chat.title === 'New Chat' && message.trim().length > 0) {
          const title = message.trim().slice(0, 60) + (message.trim().length > 60 ? '...' : '');
          chatRepo.updateTitle(chatId, title);
        }
        chatRepo.touchTimestamp(chatId);

        // Log usage — cost depends on which model was actually used.
        if ((inputTok > 0 || outputTok > 0) && fullResponse.length > 0) {
          const costMap: Record<string, [number, number]> = {
            [GEMINI_CHAT_MODEL_PRIMARY]: [GEMINI_PRIMARY_INPUT_COST, GEMINI_PRIMARY_OUTPUT_COST],
            [GEMINI_CHAT_MODEL_T1]: [GEMINI_T1_INPUT_COST, GEMINI_T1_OUTPUT_COST],
            [GEMINI_CHAT_MODEL_T2]: [GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST],
          };
          const [inputCost, outputCost] = costMap[usedModel] ?? [GEMINI_T2_INPUT_COST, GEMINI_T2_OUTPUT_COST];
          const cost = (inputTok * inputCost) + (outputTok * outputCost);
          usageRepo.logWithBilling(clientIp, req.user.id, billingUserId, inputTok, outputTok, cost, false, usedModel || undefined, searchEnabled, 'chat', 0, 'success', 0, Date.now() - callStartMs);
        } else {
          console.warn('[chat] skipping usage log — no tokens reported (likely partial/truncated stream)');
        }

        sse.writeDone({ stop_reason: stopReason });
        return;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const status = (err as any)?.status ?? 0;
        const isRetryable = [429, 500, 502, 503].includes(status) || errMsg.includes('rate_limit') || errMsg.includes('No response produced');
        console.warn(`[chat] Attempt ${attempt + 1}/${MAX_RETRIES} failed: ${errMsg.slice(0, 120)}`);

        // Don't retry if the client already hung up.
        if (clientAbort.signal.aborted) return;

        if (!isRetryable || attempt === MAX_RETRIES - 1) {
          const isRateLimit = status === 429 || errMsg.toLowerCase().includes('rate');
          const clientMessage = isRateLimit
            ? 'Too many requests. Please wait a moment and try again.'
            : "I'm having trouble connecting. Please try again in a moment.";
          sse.writeError(clientMessage);
          return;
        }

        // Exponential backoff: 2s, 4s, 6s
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  } finally {
    clearInterval(heartbeat);
    sse.end();
  }
});

export default router;
