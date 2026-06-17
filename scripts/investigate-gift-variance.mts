/**
 * THROWAWAY INVESTIGATION — answer-variance on the "gift from jija" question.
 *
 * Why: a client reported the chatbot answering the §56(2)(x) "gift from real
 * sister's husband (jija)" question WRONG, but on re-asking it answered RIGHT.
 * That's variance, not a missing fact. This script quantifies the variance and
 * isolates its cause WITHOUT changing any app code.
 *
 * It hits Gemini directly, replicating server/lib/geminiChat.ts's request, and
 * sweeps a 2×3 matrix:
 *   models : gemini-2.5-flash-lite (prod primary) | gemini-3.1-flash-lite-preview (prod fallback)
 *   config : PROD (default temp, search ON) | LOW-TEMP (0.0, search ON) | NO-SEARCH (default temp, search OFF)
 * running each cell RUNS times (default 5) and tallying EXEMPT(correct) vs
 * TAXABLE(wrong) vs MIXED/UNCLEAR.
 *
 * The system prompt is extracted verbatim from server/routes/chat.ts at runtime
 * (no copy, no drift). The correct answer is EXEMPT: a sister's husband is a
 * relative via the "spouse of a brother/sister" clause [Explanation to 56(2)(x)].
 *
 * Run:
 *   GEMINI_API_KEY=xxxx npx tsx scripts/investigate-gift-variance.mts
 *   # optional: RUNS=8 GEMINI_API_KEY=xxxx npx tsx scripts/investigate-gift-variance.mts
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { referenceUrlsBlock } from '../server/lib/officialReferenceUrls.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const API_KEY =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '';
if (!API_KEY) {
  console.error('GEMINI_API_KEY (or GOOGLE_AI_API_KEY) is required.');
  console.error('  Run:  GEMINI_API_KEY=xxxx npx tsx scripts/investigate-gift-variance.mts');
  process.exit(2);
}

const RUNS = Number(process.env.RUNS ?? 5);
const MAX_TOKENS = 4096; // matches chat.ts MAX_TOKENS
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Production model line-up (server/lib/gemini.ts)
const T2 = 'gemini-2.5-flash-lite';         // prod primary
const T1 = 'gemini-3.1-flash-lite-preview'; // prod fallback

// The exact client question.
const QUESTION =
  'Act like an income tax expert. And please let me know if I get an amount as ' +
  "gift from my real sister's husband (Jija), will it be exempt under the " +
  'category of gifts from relatives';

// ── Pull SYSTEM_INSTRUCTION verbatim out of chat.ts (no drift) ────────────
function loadSystemPrompt(): string {
  const src = readFileSync(join(ROOT, 'server', 'routes', 'chat.ts'), 'utf8');
  const m = src.match(/const SYSTEM_INSTRUCTION = `([\s\S]*?)`;/);
  if (!m) throw new Error('Could not extract SYSTEM_INSTRUCTION from chat.ts');
  return m[1]
    .replace("${referenceUrlsBlock('chat')}", referenceUrlsBlock('chat'))
    .replace(/\\`/g, '`')
    .replace(/\\\$/g, '$');
}

const SYSTEM_PROMPT = loadSystemPrompt();

interface Cfg { label: string; temperature?: number; search: boolean; }
const CONFIGS: Cfg[] = [
  { label: 'PROD     (default temp, search ON )', temperature: undefined, search: true },
  { label: 'LOW-TEMP (temp 0.0,    search ON )', temperature: 0, search: true },
  { label: 'NO-SEARCH(default temp, search OFF)', temperature: undefined, search: false },
];

async function askGemini(model: string, cfg: Cfg): Promise<string> {
  const generationConfig: Record<string, unknown> = { maxOutputTokens: MAX_TOKENS };
  if (cfg.temperature !== undefined) generationConfig.temperature = cfg.temperature;
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: QUESTION }] }],
    generationConfig,
  };
  if (cfg.search) body.tools = [{ google_search: {} }];

  const res = await fetch(`${BASE}/models/${model}:generateContent?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json: any = await res.json();
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('');
}

// ── Heuristic verdict (a HINT only — full replies are printed for the eye) ──
function verdict(reply: string): 'EXEMPT' | 'TAXABLE' | 'MIXED' | 'UNCLEAR' {
  const t = reply.toLowerCase();
  const exempt = /\bexempt\b|is (your |a )?relative|qualif\w* as (a |your )?relative|fully exempt|not taxable|no (income )?tax/.test(t);
  const taxable = /not (a |your )?relative|is not (considered )?(a |your )?relative|does not qualif\w*|not covered|\btaxable\b|not exempt|chargeable to tax|exceed\w*\s*(₹|rs\.?\s?)?50/.test(t);
  if (exempt && !taxable) return 'EXEMPT';
  if (taxable && !exempt) return 'TAXABLE';
  if (exempt && taxable) return 'MIXED';
  return 'UNCLEAR';
}

async function main() {
  console.log(`\nInvestigating answer-variance on the jija-gift question`);
  console.log(`Correct answer = EXEMPT (sister's husband IS a relative via the "spouse of a brother/sister" clause).`);
  console.log(`RUNS per cell = ${RUNS}   |   system prompt length = ${SYSTEM_PROMPT.length} chars\n`);

  const summary: Array<{ model: string; cfg: string; counts: Record<string, number> }> = [];

  for (const model of [T2, T1]) {
    for (const cfg of CONFIGS) {
      const counts: Record<string, number> = { EXEMPT: 0, TAXABLE: 0, MIXED: 0, UNCLEAR: 0, ERROR: 0 };
      console.log(`\n══ ${model}  |  ${cfg.label} ══`);
      for (let i = 1; i <= RUNS; i++) {
        try {
          const reply = await askGemini(model, cfg);
          const v = verdict(reply);
          counts[v]++;
          const oneLine = reply.replace(/\s+/g, ' ').trim().slice(0, 240);
          console.log(`  run ${i}: ${v.padEnd(7)} | ${oneLine}${reply.length > 240 ? '…' : ''}`);
        } catch (err) {
          counts.ERROR++;
          console.log(`  run ${i}: ERROR   | ${(err as Error).message}`);
        }
      }
      summary.push({ model, cfg: cfg.label, counts });
    }
  }

  console.log(`\n\n════════════════ SUMMARY (EXEMPT = correct, TAXABLE = wrong) ════════════════`);
  for (const s of summary) {
    const c = s.counts;
    console.log(
      `${s.model.padEnd(30)} ${s.cfg}  →  ` +
      `EXEMPT ${c.EXEMPT}  TAXABLE ${c.TAXABLE}  MIXED ${c.MIXED}  UNCLEAR ${c.UNCLEAR}  ERR ${c.ERROR}`,
    );
  }
  console.log(`\nReminder: MIXED/UNCLEAR usually means the reply explained the rule then`);
  console.log(`concluded correctly — read the per-run lines above before trusting the tally.\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
