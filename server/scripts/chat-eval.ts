/**
 * Chat regression smoke test.
 *
 * Sends a small battery of canonical tax questions to the running /api/chat
 * endpoint and asserts that the response contains (or does NOT contain)
 * specific substrings. Catches regressions like "LTCG rate drifts back to
 * the model's pre-Budget-2024 training data" before users do.
 *
 * Usage:
 *   # Start the dev server in one terminal:
 *   npm run dev:api
 *
 *   # In another:
 *   npm run chat:eval
 *
 *   # To point at a different host / token:
 *   CHAT_EVAL_BASE=https://staging.example.com CHAT_EVAL_TOKEN=xxxx npm run chat:eval
 *
 * Exit code 0 = all pass; 1 = one or more cases failed (non-fatal in local
 * dev, wire into CI to gate releases).
 */

interface Case {
  name: string;
  prompt: string;
  /** Every expect string MUST appear (case-insensitive). */
  mustContain: string[];
  /** No forbid string may appear (case-insensitive). These are the values
   *  the model drifts to when it leans on stale training data. */
  mustNotContain: string[];
}

const CASES: Case[] = [
  {
    name: 'LTCG listed equity FY 2025-26',
    prompt: 'What is the tax rate on long-term capital gain from listed equity shares for AY 2026-27?',
    mustContain: ['12.5%', '1,25,000'],
    // Historical 10% pre-Budget-2024 rate.
    mustNotContain: ['10% above ₹1,00,000', '10% above ₹1 lakh'],
  },
  {
    name: 'STCG listed equity current',
    prompt: 'STCG rate on equity shares held for less than 12 months in FY 2025-26?',
    mustContain: ['20%'],
    mustNotContain: ['15%'],
  },
  {
    name: 'New regime slab FY 2025-26',
    prompt: 'What are the new-regime income tax slabs for FY 2025-26?',
    mustContain: ['4,00,000', '24,00,000', '30%'],
    mustNotContain: ['15,00,000 and above'],
  },
  {
    name: 'Section 87A rebate new regime FY 2025-26',
    prompt: 'What is the maximum rebate under section 87A in the new regime for FY 2025-26?',
    mustContain: ['60,000', '12,00,000'],
    mustNotContain: ['25,000 if income up to ₹7,00,000'],
  },
  {
    name: '87A not on special rates',
    prompt: 'Can I claim section 87A rebate against my LTCG tax under section 112A?',
    mustContain: ['no', '87A'],
    mustNotContain: [],
  },
  {
    name: 'Standard deduction new regime',
    prompt: 'Standard deduction in new tax regime for salaried employees FY 2025-26?',
    mustContain: ['75,000'],
    mustNotContain: ['50,000'],
  },
  {
    name: 'VDA crypto tax',
    prompt: 'How is income from cryptocurrency taxed in India?',
    mustContain: ['30%', '115BBH'],
    mustNotContain: ['loss can be set off', 'losses can be set off'],
  },
  {
    name: 'TDS 194S crypto',
    prompt: 'TDS rate on sale of virtual digital assets under section 194S?',
    mustContain: ['1%'],
    mustNotContain: [],
  },
  {
    name: 'Section 44ADA limit',
    prompt: 'Gross receipts limit for presumptive taxation under section 44ADA?',
    mustContain: ['75', '50'],
    mustNotContain: [],
  },
  {
    name: 'Section 54 exemption cap',
    prompt: 'Is there a cap on section 54 capital-gains exemption?',
    mustContain: ['10', 'crore'],
    mustNotContain: ['no limit', 'unlimited', 'no cap'],
  },
  {
    name: 'NPS employer 14% new regime',
    prompt: 'What is the deduction limit for employer NPS contribution under 80CCD(2) in new regime?',
    mustContain: ['14%'],
    mustNotContain: ['10% of salary in new regime'],
  },
  {
    name: 'GST post 56th council',
    prompt: 'What are the current GST slab rates in India?',
    mustContain: ['5%', '18%', '40%'],
    mustNotContain: ['12% standard', '28% standard'],
  },
  {
    name: 'Angel tax abolished',
    prompt: 'Is angel tax under section 56(2)(viib) still applicable?',
    mustContain: ['abolished', '2025'],
    mustNotContain: [],
  },
  {
    name: 'Debt MF after April 2023',
    prompt: 'How are debt mutual funds purchased in June 2024 taxed when sold after 3 years?',
    mustContain: ['slab', '50AA'],
    mustNotContain: ['20% with indexation', 'LTCG 20%'],
  },
];

const BASE = process.env.CHAT_EVAL_BASE ?? 'http://localhost:3000';
const TOKEN = process.env.CHAT_EVAL_TOKEN; // required

if (!TOKEN) {
  console.error('[chat-eval] CHAT_EVAL_TOKEN env var is required (a valid JWT for a test user).');
  console.error('  Log in, copy the value of localStorage.tax_access_token from devtools, and re-run.');
  process.exit(2);
}

async function createChat(): Promise<string> {
  const r = await fetch(`${BASE}/api/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({}),
  });
  if (!r.ok) throw new Error(`createChat: ${r.status} ${await r.text()}`);
  const j: any = await r.json();
  return j.id ?? j.chat?.id;
}

async function streamMessage(chatId: string, message: string): Promise<string> {
  const r = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ chatId, message }),
  });
  if (!r.ok || !r.body) throw new Error(`chat: ${r.status} ${await r.text().catch(() => '')}`);

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const obj = JSON.parse(line.slice(6).trim());
        if (obj.text) out += obj.text;
        if (obj.done) return out;
        if (obj.error) throw new Error(obj.message ?? 'stream error');
      } catch { /* skip malformed chunks */ }
    }
  }
  return out;
}

function normalise(s: string): string {
  // strip commas between digits, normalise rupee formatting, lowercase
  return s.toLowerCase().replace(/[,]/g, '');
}

async function runCase(c: Case): Promise<{ pass: boolean; details: string[] }> {
  const chatId = await createChat();
  const reply = await streamMessage(chatId, c.prompt);
  const haystack = normalise(reply);
  const fails: string[] = [];
  for (const needle of c.mustContain) {
    if (!haystack.includes(normalise(needle))) fails.push(`  missing: "${needle}"`);
  }
  for (const forbid of c.mustNotContain) {
    if (haystack.includes(normalise(forbid))) fails.push(`  forbidden substring found: "${forbid}"`);
  }
  if (fails.length > 0) {
    fails.push(`  --- reply preview ---\n${reply.slice(0, 400)}${reply.length > 400 ? '…' : ''}`);
  }
  return { pass: fails.length === 0, details: fails };
}

async function main() {
  let passed = 0;
  let failed = 0;
  for (const c of CASES) {
    process.stdout.write(`• ${c.name} ... `);
    try {
      const result = await runCase(c);
      if (result.pass) { console.log('PASS'); passed++; }
      else { console.log('FAIL'); result.details.forEach(d => console.log(d)); failed++; }
    } catch (err) {
      console.log(`ERROR — ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }
  console.log(`\n${passed}/${CASES.length} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(2); });
