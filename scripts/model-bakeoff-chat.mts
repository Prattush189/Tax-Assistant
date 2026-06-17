/**
 * Head-to-head: gemini-2.5-flash-lite (current primary) vs
 * gemini-3.1-flash-lite-preview (current fallback) on the exact question
 * classes the chat-QA audit flagged as REAL bugs. Answers "would switching
 * the primary to 3.1 actually fix most issues?" with data, not a guess.
 *
 * Uses the production system prompt (extracted from chat.ts) + Google Search
 * grounding, exactly like the live chat route. Each case is run RUNS times per
 * model and graded with the same mustContain/mustNotContain logic as
 * chat-eval.ts. Reports per-model correctness and per-case where they differ.
 *
 *   GEMINI_API_KEY=xxxx npx tsx scripts/model-bakeoff-chat.mts
 *   RUNS=5 GEMINI_API_KEY=xxxx npx tsx scripts/model-bakeoff-chat.mts
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { referenceUrlsBlock } from '../server/lib/officialReferenceUrls.js';

const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '';
if (!API_KEY) { console.error('GEMINI_API_KEY required.'); process.exit(2); }

const RUNS = Number(process.env.RUNS ?? 4);
const MAX_TOKENS = 4096;
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const T2 = 'gemini-2.5-flash-lite';          // current primary
const T1 = 'gemini-3.1-flash-lite-preview';  // current fallback

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadSystemPrompt(): string {
  const src = readFileSync(join(ROOT, 'server', 'routes', 'chat.ts'), 'utf8');
  const m = src.match(/const SYSTEM_INSTRUCTION = `([\s\S]*?)`;/);
  if (!m) throw new Error('Could not extract SYSTEM_INSTRUCTION');
  return m[1].replace("${referenceUrlsBlock('chat')}", referenceUrlsBlock('chat'))
    .replace(/\\`/g, '`').replace(/\\\$/g, '$');
}
const SYSTEM_PROMPT = loadSystemPrompt();

interface Case { name: string; prompt: string; mustContain: string[]; mustNotContain: string[]; }
// Drawn from the audit's confirmed-real recurring bugs + the client's jija case.
const CASES: Case[] = [
  { name: 'Std deduction new regime', prompt: 'Standard deduction in the new tax regime for salaried employees for FY 2025-26?',
    mustContain: ['75,000'], mustNotContain: ['50,000'] },
  { name: 'New regime slabs FY25-26', prompt: 'What are the new tax regime income tax slabs for FY 2025-26?',
    mustContain: ['4,00,000', '24,00,000', '30%'], mustNotContain: ['15,00,000 and above'] },
  { name: 'LTCG 112A rate', prompt: 'Tax rate on long-term capital gains from listed equity shares under section 112A for AY 2026-27?',
    mustContain: ['12.5%', '1,25,000'], mustNotContain: ['10% above ₹1,00,000', '10% above ₹1 lakh'] },
  { name: 'Crypto VDA set-off', prompt: 'How is cryptocurrency income taxed in India and can losses be set off?',
    mustContain: ['30%', '115bbh'], mustNotContain: ['losses can be set off', 'loss can be set off'] },
  { name: 'GST on software/IT services', prompt: 'What is the GST rate on software development and IT services in India?',
    mustContain: ['18%'], mustNotContain: [] },
  { name: 'Gift from jija (relative)', prompt: 'If I receive money as a gift from my real sister’s husband (jija), is it exempt as a gift from a relative?',
    mustContain: ['exempt'], mustNotContain: ['not a relative', 'is not a relative'] },
  { name: 'ITR-U time limit (FA2025=48mo)', prompt: 'What is the current time limit to file an updated return (ITR-U) under section 139(8A)?',
    mustContain: ['48 month'], mustNotContain: ['24 month'] },
];

const norm = (s: string) => s.toLowerCase().replace(/,/g, '');
function grade(reply: string, c: Case): { pass: boolean; fails: string[] } {
  const h = norm(reply); const fails: string[] = [];
  for (const n of c.mustContain) if (!h.includes(norm(n))) fails.push(`missing "${n}"`);
  for (const f of c.mustNotContain) if (h.includes(norm(f))) fails.push(`forbidden "${f}"`);
  return { pass: fails.length === 0, fails };
}

async function ask(model: string, prompt: string): Promise<string> {
  const res = await fetch(`${BASE}/models/${model}:generateContent?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: MAX_TOKENS },
      tools: [{ google_search: {} }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const j: any = await res.json();
  return (j.candidates?.[0]?.content?.parts ?? []).filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('');
}

async function main() {
  console.log(`\nHead-to-head bakeoff — RUNS=${RUNS} per case per model, grounded, prod prompt.\n`);
  const score: Record<string, { pass: number; total: number }> = { [T2]: { pass: 0, total: 0 }, [T1]: { pass: 0, total: 0 } };
  const perCase: Record<string, Record<string, number>> = {};

  for (const c of CASES) {
    perCase[c.name] = { [T2]: 0, [T1]: 0 };
    for (const model of [T2, T1]) {
      for (let i = 0; i < RUNS; i++) {
        try {
          const reply = await ask(model, c.prompt);
          const g = grade(reply, c);
          score[model].total++; if (g.pass) { score[model].pass++; perCase[c.name][model]++; }
        } catch (err) {
          console.log(`  ${model} "${c.name}" run ${i + 1}: ERROR ${(err as Error).message}`);
          score[model].total++; // count as a non-pass attempt
        }
      }
    }
    const a = perCase[c.name][T2], b = perCase[c.name][T1];
    const flag = b > a ? '  << 3.1 better' : a > b ? '  << 2.5 better' : '';
    console.log(`${c.name.padEnd(34)}  2.5: ${a}/${RUNS}   3.1: ${b}/${RUNS}${flag}`);
  }

  console.log('\n════════ OVERALL ════════');
  for (const model of [T2, T1]) {
    const s = score[model];
    console.log(`${model.padEnd(32)} ${s.pass}/${s.total} correct (${Math.round((s.pass / s.total) * 100)}%)`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
