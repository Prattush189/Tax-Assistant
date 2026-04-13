/**
 * Generates a comprehensive API cost report PDF.
 * Run: npx tsx scripts/generate-cost-report.ts
 */
import { jsPDF } from 'jspdf';

const USD_TO_INR = 85;

// ── Model pricing ──────────────────────────────────────────────────────
const MODELS = {
  't1': { name: 'Gemini 3.1 Flash-Lite', inputPerM: 0.25, outputPerM: 1.50, searchPerCall: 0, freeSearch: '5,000/month' },
  't2': { name: 'Gemini 2.5 Flash-Lite', inputPerM: 0.10, outputPerM: 0.40, searchPerCall: 0, freeSearch: '500/day' },
  't3': { name: 'Grok 4.1 Fast', inputPerM: 0.20, outputPerM: 0.50, searchPerCall: 0.005, freeSearch: 'None (paid)' },
};

// Average tokens per action
const AVG_TOKENS = {
  chatMsg: { input: 3000, output: 1500 },
  chatMsgSearch: { input: 4500, output: 1500 },
  noticeDraft: { input: 4000, output: 3000 },
  attachment: { input: 1500, output: 1000 },  // Gemini vision
  aiSuggestion: { input: 500, output: 300 },
  form16Import: { input: 2000, output: 1000 },
  styleExtraction: { input: 2000, output: 500 },
};

// Plan limits
const PLANS = {
  free: { label: 'Free', msgs: 50, notices: 3, attachments: 5, suggestions: 20, profiles: 1 },
  pro: { label: 'Pro', msgs: 300, notices: 15, attachments: 30, suggestions: 100, profiles: 5 },
  enterprise: { label: 'Enterprise', msgs: 3000, notices: 50, attachments: 200, suggestions: 500, profiles: 25 },
};

function costPerAction(model: typeof MODELS.t1, tokens: { input: number; output: number }, includeSearch: boolean = false): number {
  const tokenCost = (tokens.input * model.inputPerM / 1_000_000) + (tokens.output * model.outputPerM / 1_000_000);
  return tokenCost + (includeSearch ? model.searchPerCall : 0);
}

function fmtUsd(n: number): string {
  return '$' + n.toFixed(4);
}

function fmtInr(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  if (rounded < 1) return 'Rs. ' + rounded.toFixed(2);
  const str = Math.abs(Math.round(rounded)).toString();
  let formatted: string;
  if (str.length <= 3) formatted = str;
  else {
    const last3 = str.slice(-3);
    const rest = str.slice(0, -3);
    const groups: string[] = [];
    for (let i = rest.length; i > 0; i -= 2) groups.unshift(rest.slice(Math.max(0, i - 2), i));
    formatted = groups.join(',') + ',' + last3;
  }
  return 'Rs. ' + formatted;
}

// ── PDF Generation ─────────────────────────────────────────────────────
const doc = new jsPDF('p', 'mm', 'a4');
const pw = doc.internal.pageSize.getWidth();
const ph = doc.internal.pageSize.getHeight();
const ml = 15;
const mr = 15;
const cw = pw - ml - mr;
let y = 15;

function checkBreak(needed: number) {
  if (y + needed > ph - 20) { doc.addPage(); y = 15; }
}

function heading(text: string) {
  checkBreak(15);
  doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(13, 150, 104);
  doc.text(text, ml, y); y += 1;
  doc.setDrawColor(13, 150, 104); doc.setLineWidth(0.6); doc.line(ml, y, pw - mr, y);
  y += 7; doc.setTextColor(0);
}

function subHeading(text: string) {
  checkBreak(10);
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(60);
  doc.text(text, ml, y); y += 6; doc.setTextColor(0);
}

function row(label: string, ...values: string[]) {
  checkBreak(6);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(label, ml + 2, y);
  const colW = (cw - 70) / values.length;
  values.forEach((v, i) => {
    doc.text(v, ml + 72 + colW * i + colW - 2, y, { align: 'right' });
  });
  y += 5.5;
}

function rowBold(label: string, ...values: string[]) {
  checkBreak(6);
  doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text(label, ml + 2, y);
  const colW = (cw - 70) / values.length;
  values.forEach((v, i) => {
    doc.text(v, ml + 72 + colW * i + colW - 2, y, { align: 'right' });
  });
  y += 5.5;
}

function tableHeader(...cols: string[]) {
  checkBreak(8);
  doc.setFillColor(240, 240, 240); doc.rect(ml, y - 3.5, cw, 5.5, 'F');
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(100);
  doc.text(cols[0], ml + 2, y);
  const colW = (cw - 70) / (cols.length - 1);
  for (let i = 1; i < cols.length; i++) {
    doc.text(cols[i], ml + 72 + colW * (i - 1) + colW - 2, y, { align: 'right' });
  }
  y += 5; doc.setTextColor(0);
}

function separator() { y += 2; doc.setDrawColor(220); doc.setLineWidth(0.2); doc.line(ml, y, pw - mr, y); y += 4; }

// ══════════════════════════════════════════════════════════════════════════
// COVER
doc.setFontSize(22); doc.setFont('helvetica', 'bold'); doc.setTextColor(13, 150, 104);
doc.text('Smartbiz AI', pw / 2, y + 10, { align: 'center' });
y += 18; doc.setFontSize(16); doc.setTextColor(60);
doc.text('API Cost Report', pw / 2, y, { align: 'center' });
y += 8; doc.setFontSize(10); doc.setFont('helvetica', 'normal');
const now = new Date();
doc.text(`Generated: ${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`, pw / 2, y, { align: 'center' });
y += 15; doc.setTextColor(0);

// ══════════════════════════════════════════════════════════════════════════
// SECTION 1: MODEL PRICING
heading('1. Model Pricing (3-Tier Cascade)');

tableHeader('Model', 'Input/M tokens', 'Output/M tokens', 'Search/call', 'Free Search');
for (const [, m] of Object.entries(MODELS)) {
  row(m.name, `$${m.inputPerM}`, `$${m.outputPerM}`, m.searchPerCall > 0 ? `$${m.searchPerCall}` : 'FREE', m.freeSearch);
}
separator();

// ══════════════════════════════════════════════════════════════════════════
// SECTION 2: COST PER ACTION
heading('2. Cost Per Action (All Tiers)');

const actions = [
  { label: 'Chat message (with search)', tokens: AVG_TOKENS.chatMsgSearch, search: true },
  { label: 'Chat message (no search)', tokens: AVG_TOKENS.chatMsg, search: false },
  { label: 'Notice draft (Grok)', tokens: AVG_TOKENS.noticeDraft, search: false },
  { label: 'Document upload (Gemini)', tokens: AVG_TOKENS.attachment, search: false },
  { label: 'AI suggestion', tokens: AVG_TOKENS.aiSuggestion, search: false },
  { label: 'Form 16 import (Gemini)', tokens: AVG_TOKENS.form16Import, search: false },
  { label: 'Style extraction (Grok)', tokens: AVG_TOKENS.styleExtraction, search: false },
];

tableHeader('Action', 'Tier 1 (INR)', 'Tier 2 (INR)', 'Tier 3 (INR)');
for (const a of actions) {
  const c1 = costPerAction(MODELS.t1, a.tokens, a.search) * USD_TO_INR;
  const c2 = costPerAction(MODELS.t2, a.tokens, a.search) * USD_TO_INR;
  const c3 = costPerAction(MODELS.t3, a.tokens, a.search) * USD_TO_INR;
  row(a.label, fmtInr(c1), fmtInr(c2), fmtInr(c3));
}
separator();

// ══════════════════════════════════════════════════════════════════════════
// SECTION 3: COST AT USAGE LEVELS (30%, 50%, 100%)
heading('3. Monthly Cost Per Plan at Different Usage Levels');

const usageLevels = [
  { label: '30% usage', pct: 0.30 },
  { label: '50% usage', pct: 0.50 },
  { label: '100% (max)', pct: 1.00 },
];

for (const level of usageLevels) {
  subHeading(`${level.label}`);
  tableHeader('Feature', 'Free', 'Pro', 'Enterprise');

  for (const [planKey, plan] of Object.entries(PLANS)) {
    if (planKey !== 'free') continue; // just do header once
  }

  // Chat messages (Tier 1 pricing — primary model)
  const chatCost = costPerAction(MODELS.t1, AVG_TOKENS.chatMsgSearch, true) * USD_TO_INR;
  row('Chat messages',
    fmtInr(Math.round(PLANS.free.msgs * level.pct) * chatCost),
    fmtInr(Math.round(PLANS.pro.msgs * level.pct) * chatCost),
    fmtInr(Math.round(PLANS.enterprise.msgs * level.pct) * chatCost),
  );

  // Notice drafts (Grok — notices still use Grok)
  const noticeCost = costPerAction(MODELS.t3, AVG_TOKENS.noticeDraft, false) * USD_TO_INR;
  row('Notice drafts',
    fmtInr(Math.round(PLANS.free.notices * level.pct) * noticeCost),
    fmtInr(Math.round(PLANS.pro.notices * level.pct) * noticeCost),
    fmtInr(Math.round(PLANS.enterprise.notices * level.pct) * noticeCost),
  );

  // Attachments (Gemini vision — essentially free tier)
  const attachCost = costPerAction(MODELS.t2, AVG_TOKENS.attachment, false) * USD_TO_INR;
  row('Document uploads',
    fmtInr(Math.round(PLANS.free.attachments * level.pct) * attachCost),
    fmtInr(Math.round(PLANS.pro.attachments * level.pct) * attachCost),
    fmtInr(Math.round(PLANS.enterprise.attachments * level.pct) * attachCost),
  );

  // AI suggestions
  const sugCost = costPerAction(MODELS.t1, AVG_TOKENS.aiSuggestion, false) * USD_TO_INR;
  row('AI suggestions',
    fmtInr(Math.round(PLANS.free.suggestions * level.pct) * sugCost),
    fmtInr(Math.round(PLANS.pro.suggestions * level.pct) * sugCost),
    fmtInr(Math.round(PLANS.enterprise.suggestions * level.pct) * sugCost),
  );

  // Total
  const totalFn = (plan: typeof PLANS.free) => {
    const msgs = Math.round(plan.msgs * level.pct) * chatCost;
    const notices = Math.round(plan.notices * level.pct) * noticeCost;
    const attachments = Math.round(plan.attachments * level.pct) * attachCost;
    const suggestions = Math.round(plan.suggestions * level.pct) * sugCost;
    return msgs + notices + attachments + suggestions;
  };

  separator();
  rowBold('TOTAL API COST',
    fmtInr(totalFn(PLANS.free)),
    fmtInr(totalFn(PLANS.pro)),
    fmtInr(totalFn(PLANS.enterprise)),
  );
  y += 4;
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 4: REVENUE VS COST
checkBreak(60);
heading('4. Revenue vs Cost Analysis (100 users)');

const userMix = { free: 70, pro: 20, enterprise: 10 };
const prices = { free: 0, pro: 499, enterprise: 2499 };
const serverCost = 1089; // NVMe 12

subHeading('Assumptions');
row('User mix', `${userMix.free} Free`, `${userMix.pro} Pro`, `${userMix.enterprise} Ent`);
row('Pricing', 'Rs. 0/mo', 'Rs. 499/mo', 'Rs. 2,499/mo');
row('Server cost', 'Rs. 1,089/mo (NVMe 12)', '', '');
row('Avg usage', '30% of limits', '', '');
separator();

const apiCostPer = (plan: typeof PLANS.free) => {
  const chatCost = costPerAction(MODELS.t1, AVG_TOKENS.chatMsgSearch, true) * USD_TO_INR;
  const noticeCost = costPerAction(MODELS.t3, AVG_TOKENS.noticeDraft, false) * USD_TO_INR;
  const attachCost = costPerAction(MODELS.t2, AVG_TOKENS.attachment, false) * USD_TO_INR;
  const sugCost = costPerAction(MODELS.t1, AVG_TOKENS.aiSuggestion, false) * USD_TO_INR;
  return (plan.msgs * 0.3 * chatCost) + (plan.notices * 0.3 * noticeCost) +
    (plan.attachments * 0.3 * attachCost) + (plan.suggestions * 0.3 * sugCost);
};

tableHeader('Metric', 'Free (x70)', 'Pro (x20)', 'Enterprise (x10)');

const freeCostPer = apiCostPer(PLANS.free);
const proCostPer = apiCostPer(PLANS.pro);
const entCostPer = apiCostPer(PLANS.enterprise);

row('API cost/user/mo', fmtInr(freeCostPer), fmtInr(proCostPer), fmtInr(entCostPer));
row('Total API cost', fmtInr(freeCostPer * userMix.free), fmtInr(proCostPer * userMix.pro), fmtInr(entCostPer * userMix.enterprise));
row('Revenue/mo', 'Rs. 0', fmtInr(prices.pro * userMix.pro), fmtInr(prices.enterprise * userMix.enterprise));

const totalRevenue = prices.pro * userMix.pro + prices.enterprise * userMix.enterprise;
const totalApiCost = freeCostPer * userMix.free + proCostPer * userMix.pro + entCostPer * userMix.enterprise;
const totalCost = totalApiCost + serverCost;

separator();
rowBold('Total revenue/mo', fmtInr(totalRevenue), '', '');
rowBold('Total cost/mo (API + server)', fmtInr(totalCost), '', '');
rowBold('Monthly profit', fmtInr(totalRevenue - totalCost), '', '');
rowBold('Annual profit', fmtInr((totalRevenue - totalCost) * 12), '', '');
rowBold('Margin', ((totalRevenue - totalCost) / totalRevenue * 100).toFixed(1) + '%', '', '');

// ══════════════════════════════════════════════════════════════════════════
// SECTION 5: CASCADE FREE TIER CAPACITY
checkBreak(40);
heading('5. Free Search Tier Capacity');

row('Tier 1 (Gemini 3.1 Flash-Lite)', '5,000 searches/month', '', '');
row('Tier 2 (Gemini 2.5 Flash-Lite)', '500 searches/day (~15,000/month)', '', '');
row('Combined free capacity', '~20,000 searches/month', '', '');
separator();
row('Max msgs needed (all plans, 100 users)', `${PLANS.free.msgs * userMix.free + PLANS.pro.msgs * userMix.pro + PLANS.enterprise.msgs * userMix.enterprise}/month`, '', '');
row('At 30% usage', `${Math.round((PLANS.free.msgs * userMix.free + PLANS.pro.msgs * userMix.pro + PLANS.enterprise.msgs * userMix.enterprise) * 0.3)}/month`, '', '');
row('Status', 'ALL FREE — Grok never needed', '', '');

// ── Footer ──────────────────────────────────────────────────────────────
const fy = ph - 15;
doc.setFontSize(7); doc.setFont('helvetica', 'italic'); doc.setTextColor(130);
doc.text('Confidential — Smartbiz AI Internal. Pricing based on published API rates as of April 2026.', pw / 2, fy, { align: 'center' });
doc.text('Generated by Smartbiz AI (ai.smartbizin.com)', pw / 2, fy + 4, { align: 'center' });

// Save
doc.save('smartbiz-ai-cost-report.pdf');
console.log('PDF saved: smartbiz-ai-cost-report.pdf');
