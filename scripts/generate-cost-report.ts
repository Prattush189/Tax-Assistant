/**
 * Generates a comprehensive API cost report PDF for Smartbiz AI.
 * Reflects the 3-tier cascade with selective web search (~30% of messages).
 *
 * Run: npx tsx scripts/generate-cost-report.ts
 */
import { jsPDF } from 'jspdf';

const USD_TO_INR = 85;
const SEARCH_PCT = 0.30; // 30% of messages trigger web search

// ── Model pricing (per 1M tokens, USD) ─────────────────────────────────
const MODELS = {
  t1: { name: 'Gemini 3.1 Flash-Lite Preview', inputPerM: 0.25, outputPerM: 1.50, searchCost: 0, freeSearch: '5,000/month (shared Gemini 3)' },
  t2: { name: 'Gemini 2.5 Flash-Lite', inputPerM: 0.10, outputPerM: 0.40, searchCost: 0, freeSearch: '500/day (separate pool)' },
  t3: { name: 'Grok 4.1 Fast', inputPerM: 0.20, outputPerM: 0.50, searchCost: 0.005, freeSearch: 'None — $5/1K calls' },
};

// Average tokens per action type
const ACTIONS = [
  { key: 'chatPlain', label: 'Chat message (no search)', input: 3000, output: 1500, search: false, model: 't1' as const },
  { key: 'chatSearch', label: 'Chat message (with search)', input: 4500, output: 1500, search: true, model: 't1' as const },
  { key: 'chatBlended', label: 'Chat message (blended avg: 70% plain + 30% search)', input: 3450, output: 1500, search: false, model: 't1' as const, blended: true },
  { key: 'notice', label: 'Notice draft (Grok)', input: 4000, output: 3000, search: false, model: 't3' as const },
  { key: 'attachment', label: 'Document upload (Gemini vision)', input: 1500, output: 1000, search: false, model: 't2' as const },
  { key: 'suggestion', label: 'AI suggestion', input: 500, output: 300, search: false, model: 't1' as const },
  { key: 'form16', label: 'Form 16 import (Gemini vision)', input: 2000, output: 1000, search: false, model: 't2' as const },
  { key: 'style', label: 'Style extraction (Grok)', input: 2000, output: 500, search: false, model: 't3' as const },
];

// Plan limits
const PLANS = [
  { id: 'free', label: 'Free', price: 0, msgs: 50, notices: 3, attachments: 5, suggestions: 20 },
  { id: 'pro', label: 'Pro', price: 499, msgs: 300, notices: 15, attachments: 30, suggestions: 100 },
  { id: 'enterprise', label: 'Enterprise', price: 2499, msgs: 3000, notices: 50, attachments: 200, suggestions: 500 },
];

const USER_MIX = { free: 70, pro: 20, enterprise: 10 };
const SERVER_COST_MO = 1089;

// ── Helpers ────────────────────────────────────────────────────────────
function costUsd(model: typeof MODELS.t1, input: number, output: number, search: boolean): number {
  return (input * model.inputPerM / 1e6) + (output * model.outputPerM / 1e6) + (search ? model.searchCost : 0);
}

function blendedChatCostUsd(model: typeof MODELS.t1, searchPct: number): number {
  const plain = costUsd(model, 3000, 1500, false);
  const search = costUsd(model, 4500, 1500, false); // search itself is free within quota
  return plain * (1 - searchPct) + search * searchPct;
}

function fI(n: number): string {
  const r = Math.round(Math.abs(n) * 100) / 100;
  if (r < 1) return 'Rs. ' + r.toFixed(2);
  const s = Math.round(r).toString();
  if (s.length <= 3) return 'Rs. ' + s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const g: string[] = [];
  for (let i = rest.length; i > 0; i -= 2) g.unshift(rest.slice(Math.max(0, i - 2), i));
  return (n < 0 ? '-' : '') + 'Rs. ' + g.join(',') + ',' + last3;
}

function fU(n: number): string { return '$' + n.toFixed(4); }

// ── PDF ────────────────────────────────────────────────────────────────
const doc = new jsPDF('p', 'mm', 'a4');
const pw = doc.internal.pageSize.getWidth();
const ph = doc.internal.pageSize.getHeight();
const ml = 14; const mr = 14; const cw = pw - ml - mr;
let y = 15;

function br(n: number) { if (y + n > ph - 18) { doc.addPage(); y = 15; } }
function hdr(t: string) {
  br(14); doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(13, 150, 104);
  doc.text(t, ml, y); doc.setDrawColor(13, 150, 104); doc.setLineWidth(0.5);
  y += 1; doc.line(ml, y, pw - mr, y); y += 7; doc.setTextColor(0);
}
function sub(t: string) { br(8); doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(60); doc.text(t, ml, y); y += 6; doc.setTextColor(0); }
function tblH(...c: string[]) {
  br(7); doc.setFillColor(242, 242, 242); doc.rect(ml, y - 3.5, cw, 5.5, 'F');
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(100);
  const w = (cw - 62) / (c.length - 1);
  doc.text(c[0], ml + 2, y);
  for (let i = 1; i < c.length; i++) doc.text(c[i], ml + 62 + w * (i - 1) + w - 1, y, { align: 'right' });
  y += 5; doc.setTextColor(0);
}
function r(label: string, ...v: string[]) {
  br(5.5); doc.setFontSize(8.5); doc.setFont('helvetica', 'normal');
  doc.text(label, ml + 2, y);
  const w = (cw - 62) / v.length;
  v.forEach((s, i) => doc.text(s, ml + 62 + w * i + w - 1, y, { align: 'right' }));
  y += 5;
}
function rb(label: string, ...v: string[]) {
  br(5.5); doc.setFontSize(8.5); doc.setFont('helvetica', 'bold');
  doc.text(label, ml + 2, y);
  const w = (cw - 62) / v.length;
  v.forEach((s, i) => doc.text(s, ml + 62 + w * i + w - 1, y, { align: 'right' }));
  y += 5;
}
function sep() { y += 1.5; doc.setDrawColor(225); doc.setLineWidth(0.15); doc.line(ml, y, pw - mr, y); y += 3; }
function note(t: string) {
  br(8); doc.setFontSize(7.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(120);
  const lines = doc.splitTextToSize(t, cw - 4);
  doc.text(lines, ml + 2, y); y += lines.length * 3.5; doc.setTextColor(0);
}

// ════════════════════════════════════════════════════════════════════════
// COVER
doc.setFontSize(24); doc.setFont('helvetica', 'bold'); doc.setTextColor(13, 150, 104);
doc.text('Smartbiz AI', pw / 2, 30, { align: 'center' });
doc.setFontSize(16); doc.setTextColor(60);
doc.text('API Cost & Pricing Report', pw / 2, 40, { align: 'center' });
doc.setFontSize(10); doc.setFont('helvetica', 'normal');
const now = new Date();
doc.text(`${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()} | Confidential`, pw / 2, 48, { align: 'center' });
doc.setTextColor(0); y = 60;

// Key metric boxes
doc.setFontSize(9); doc.setFont('helvetica', 'normal');
const boxes = [
  { label: 'Cascade', value: '3-Tier (Gemini 3.1 > 2.5 > Grok)' },
  { label: 'Web Search', value: 'Selective — 30% of messages' },
  { label: 'Free Search Capacity', value: '~20,000/month' },
  { label: 'Target Users', value: '100 (70 Free + 20 Pro + 10 Ent)' },
];
boxes.forEach((b, i) => {
  const bx = ml + (i % 2) * (cw / 2 + 2);
  const by = y + Math.floor(i / 2) * 14;
  doc.setDrawColor(200); doc.setLineWidth(0.3); doc.roundedRect(bx, by, cw / 2 - 2, 12, 2, 2, 'S');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(100);
  doc.text(b.label, bx + 3, by + 4.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(0);
  doc.text(b.value, bx + 3, by + 9);
});
y += 35;

// ════════════════════════════════════════════════════════════════════════
// 1. MODEL PRICING
hdr('1. Model Pricing (3-Tier Cascade)');
tblH('Tier / Model', 'Input / 1M', 'Output / 1M', 'Search / call', 'Free Quota');
r('Tier 1: ' + MODELS.t1.name, '$' + MODELS.t1.inputPerM, '$' + MODELS.t1.outputPerM, 'FREE', MODELS.t1.freeSearch);
r('Tier 2: ' + MODELS.t2.name, '$' + MODELS.t2.inputPerM, '$' + MODELS.t2.outputPerM, 'FREE', MODELS.t2.freeSearch);
r('Tier 3: ' + MODELS.t3.name, '$' + MODELS.t3.inputPerM, '$' + MODELS.t3.outputPerM, '$' + MODELS.t3.searchCost, MODELS.t3.freeSearch);
note('Cascade: every request tries Tier 1 first. If monthly quota exhausted, falls to Tier 2. If daily quota exhausted, falls to Tier 3 (paid).');
sep();

// ════════════════════════════════════════════════════════════════════════
// 2. COST PER ACTION
hdr('2. Cost Per Action');
note('Web search is selective (~30% of messages). Search is FREE within Gemini tier quotas. Notices use Grok (richer output). Uploads use Gemini vision (cheapest).');
y += 2;

tblH('Action', 'Tier 1 (INR)', 'Tier 2 (INR)', 'Tier 3 (INR)', 'USD (Tier 1)');
for (const a of ACTIONS) {
  if (a.key === 'chatBlended') {
    // Blended = 70% plain + 30% search tokens (search itself is free)
    const c1 = blendedChatCostUsd(MODELS.t1, SEARCH_PCT) * USD_TO_INR;
    const c2 = blendedChatCostUsd(MODELS.t2, SEARCH_PCT) * USD_TO_INR;
    const c3 = blendedChatCostUsd(MODELS.t3, SEARCH_PCT) * USD_TO_INR + MODELS.t3.searchCost * SEARCH_PCT * USD_TO_INR;
    rb(a.label, fI(c1), fI(c2), fI(c3), fU(blendedChatCostUsd(MODELS.t1, SEARCH_PCT)));
  } else {
    const m = MODELS[a.model];
    const c1 = costUsd(MODELS.t1, a.input, a.output, false) * USD_TO_INR;
    const c2 = costUsd(MODELS.t2, a.input, a.output, false) * USD_TO_INR;
    const c3 = costUsd(MODELS.t3, a.input, a.output, a.search) * USD_TO_INR;
    r(a.label, fI(c1), fI(c2), fI(c3), fU(costUsd(MODELS.t1, a.input, a.output, false)));
  }
}
sep();

// ════════════════════════════════════════════════════════════════════════
// 3. MONTHLY COST AT 30%, 50%, 100%
hdr('3. Monthly Cost Per Plan (All AI Features)');
note('Blended chat cost used (70% plain + 30% search). Notices on Grok. Uploads on Gemini 2.5 vision. Suggestions on Tier 1.');

const chatBlendedT1 = blendedChatCostUsd(MODELS.t1, SEARCH_PCT) * USD_TO_INR;
const noticeCostInr = costUsd(MODELS.t3, 4000, 3000, false) * USD_TO_INR;
const attachCostInr = costUsd(MODELS.t2, 1500, 1000, false) * USD_TO_INR;
const sugCostInr = costUsd(MODELS.t1, 500, 300, false) * USD_TO_INR;

function planCost(plan: typeof PLANS[0], pct: number) {
  const msgs = Math.round(plan.msgs * pct);
  const notices = Math.round(plan.notices * pct);
  const attach = Math.round(plan.attachments * pct);
  const sugs = Math.round(plan.suggestions * pct);
  return {
    chat: msgs * chatBlendedT1,
    notice: notices * noticeCostInr,
    attach: attach * attachCostInr,
    sug: sugs * sugCostInr,
    total: msgs * chatBlendedT1 + notices * noticeCostInr + attach * attachCostInr + sugs * sugCostInr,
  };
}

for (const pct of [0.30, 0.50, 1.00]) {
  sub(`At ${(pct * 100).toFixed(0)}% usage`);
  tblH('Feature', 'Free', 'Pro', 'Enterprise');
  const costs = PLANS.map(p => planCost(p, pct));

  r(`Chat msgs (${PLANS.map(p => Math.round(p.msgs * pct)).join(' / ')})`,
    fI(costs[0].chat), fI(costs[1].chat), fI(costs[2].chat));
  r(`Notice drafts (${PLANS.map(p => Math.round(p.notices * pct)).join(' / ')})`,
    fI(costs[0].notice), fI(costs[1].notice), fI(costs[2].notice));
  r(`Doc uploads (${PLANS.map(p => Math.round(p.attachments * pct)).join(' / ')})`,
    fI(costs[0].attach), fI(costs[1].attach), fI(costs[2].attach));
  r(`AI suggestions (${PLANS.map(p => Math.round(p.suggestions * pct)).join(' / ')})`,
    fI(costs[0].sug), fI(costs[1].sug), fI(costs[2].sug));
  sep();
  rb('TOTAL API COST / user / month', fI(costs[0].total), fI(costs[1].total), fI(costs[2].total));
  y += 3;
}

// ════════════════════════════════════════════════════════════════════════
// 4. SEARCH QUOTA CAPACITY
br(40);
hdr('4. Free Search Quota Analysis');

r('Tier 1 (Gemini 3.1)', '5,000 searches/month', '', '');
r('Tier 2 (Gemini 2.5)', '500/day x 30 = ~15,000/month', '', '');
rb('Combined free capacity', '~20,000 searches/month', '', '');
sep();

const maxMsgs = PLANS.reduce((a, p, i) => a + p.msgs * [USER_MIX.free, USER_MIX.pro, USER_MIX.enterprise][i], 0);
const searchMsgs30 = Math.round(maxMsgs * 0.30 * SEARCH_PCT);
const searchMsgs50 = Math.round(maxMsgs * 0.50 * SEARCH_PCT);
const searchMsgsMax = Math.round(maxMsgs * SEARCH_PCT);

r('Max msgs/month (all 100 users)', maxMsgs.toLocaleString(), '', '');
r('Search calls at 30% usage (30% of msgs)', searchMsgs30.toLocaleString(), '', '');
r('Search calls at 50% usage', searchMsgs50.toLocaleString(), '', '');
r('Search calls at 100% usage', searchMsgsMax.toLocaleString(), '', '');
rb('Free quota needed?', searchMsgsMax <= 20000 ? 'ALL FREE — Grok never needed' : 'Overflow to Grok at peak', '', '');
note(`With selective search (30% of messages), even at 100% plan usage the search calls (${searchMsgsMax.toLocaleString()}) stay well within the 20,000 free/month combined quota.`);

// ════════════════════════════════════════════════════════════════════════
// 5. REVENUE VS COST
br(50);
hdr('5. Revenue vs Cost (100 Users, 30% Avg Usage)');

const pct = 0.30;
tblH('Metric', 'Free (x70)', 'Pro (x20)', 'Enterprise (x10)', 'Total');

const fc = planCost(PLANS[0], pct);
const pc = planCost(PLANS[1], pct);
const ec = planCost(PLANS[2], pct);

r('API cost / user / mo', fI(fc.total), fI(pc.total), fI(ec.total), '');
r('Total API cost', fI(fc.total * USER_MIX.free), fI(pc.total * USER_MIX.pro), fI(ec.total * USER_MIX.enterprise),
  fI(fc.total * USER_MIX.free + pc.total * USER_MIX.pro + ec.total * USER_MIX.enterprise));
r('Revenue / mo', 'Rs. 0', fI(PLANS[1].price * USER_MIX.pro), fI(PLANS[2].price * USER_MIX.enterprise),
  fI(PLANS[1].price * USER_MIX.pro + PLANS[2].price * USER_MIX.enterprise));
sep();

const totalRev = PLANS[1].price * USER_MIX.pro + PLANS[2].price * USER_MIX.enterprise;
const totalApi = fc.total * USER_MIX.free + pc.total * USER_MIX.pro + ec.total * USER_MIX.enterprise;
const totalCost = totalApi + SERVER_COST_MO;

rb('Total revenue / mo', '', '', '', fI(totalRev));
rb('Total cost / mo (API + server)', '', '', '', fI(totalCost));
rb('Monthly profit', '', '', '', fI(totalRev - totalCost));
rb('Annual profit', '', '', '', fI((totalRev - totalCost) * 12));
rb('Margin', '', '', '', ((totalRev - totalCost) / totalRev * 100).toFixed(1) + '%');

y += 4;
note(`Server: NVMe 12 at Rs. ${SERVER_COST_MO}/mo. Pricing: Free Rs. 0, Pro Rs. 499/mo, Enterprise Rs. 2,499/mo. USD to INR rate: ${USD_TO_INR}.`);

// ════════════════════════════════════════════════════════════════════════
// 6. COMPARISON: BEFORE vs AFTER CASCADE
br(40);
hdr('6. Before vs After Cost Comparison');

tblH('Scenario', 'Before (All Grok)', 'After (Cascade)', 'Savings');
const grokBlended = (costUsd(MODELS.t3, 3000, 1500, false) * 0.7 + costUsd(MODELS.t3, 4500, 1500, true) * 0.3) * USD_TO_INR;

for (const plan of PLANS) {
  const before = plan.msgs * grokBlended;
  const after = plan.msgs * chatBlendedT1;
  const saving = ((before - after) / before * 100).toFixed(0);
  r(`${plan.label} (${plan.msgs} msgs)`, fI(before), fI(after), saving + '% saved');
}
sep();

const beforeTotal = PLANS.reduce((a, p, i) => a + p.msgs * grokBlended * [USER_MIX.free, USER_MIX.pro, USER_MIX.enterprise][i] * 0.3, 0);
const afterTotal = PLANS.reduce((a, p, i) => a + p.msgs * chatBlendedT1 * [USER_MIX.free, USER_MIX.pro, USER_MIX.enterprise][i] * 0.3, 0);
rb('All 100 users @ 30% usage', fI(beforeTotal) + '/mo', fI(afterTotal) + '/mo', ((beforeTotal - afterTotal) / beforeTotal * 100).toFixed(0) + '% saved');
rb('Annual savings', '', '', fI((beforeTotal - afterTotal) * 12));

// ── Footer ──────────────────────────────────────────────────────────────
const fy = ph - 12;
doc.setFontSize(6.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(140);
doc.text('Confidential — Smartbiz AI Internal. Based on published API rates as of April 2026. Actual costs may vary with usage patterns.', pw / 2, fy, { align: 'center' });
doc.text('Generated by Smartbiz AI (ai.smartbizin.com)', pw / 2, fy + 3.5, { align: 'center' });

doc.save('smartbiz-ai-cost-report.pdf');
console.log('PDF saved: smartbiz-ai-cost-report.pdf');
