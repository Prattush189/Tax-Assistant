/**
 * Diagnose WHY Gemini is still being called on bank statements.
 *
 * Re-runs the GLOBAL deterministic classifier (the same RULES table the
 * upload pre-pass uses) over every stored transaction and reports the rows
 * it CAN'T categorise — those are the ones that fall through to Gemini.
 * Grouped by noise-stripped fingerprint and ranked by frequency, so the
 * top of the list is exactly where adding a rule buys the most AI savings.
 *
 * It is READ-ONLY (never writes to the DB) and prints aggregated
 * FINGERPRINTS + counts — not raw statements — so the output is safe to
 * share. (Learned rules, the semantic tier, and the AI-decision cache catch
 * some of these per-firm, so this is an UPPER BOUND on the global gap; the
 * frequent patterns here are still the right thing to fix globally.)
 *
 * Run on the server, with the same env as the app so DB_PATH points at prod:
 *   npx tsx server/scripts/analyze-ai-fallthrough.ts            # all data
 *   npx tsx server/scripts/analyze-ai-fallthrough.ts --days 1   # last 24h
 *   npx tsx server/scripts/analyze-ai-fallthrough.ts --top 60   # show 60
 */
import db from '../db/index.js';
import {
  classifyRow,
  extractNarrationFingerprint,
  extractCounterparty,
} from '../lib/bankClassifier.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const days = parseInt(arg('--days') ?? '', 10);
const topN = parseInt(arg('--top') ?? '40', 10) || 40;

// Pull narration + signed amount. Optionally scope to statements ingested in
// the last N days (bank_statements.created_at is an IST 'YYYY-MM-DD HH:MM:SS'
// string, so a lexicographic >= comparison against the cutoff works).
let rows: Array<{ narration: string | null; amount: number }>;
if (Number.isFinite(days) && days > 0) {
  const cutoff = new Date(Date.now() + 5.5 * 3600_000 - days * 86400_000)
    .toISOString().replace('Z', '').replace('T', ' ').slice(0, 19);
  rows = db.prepare(
    `SELECT bt.narration, bt.amount
       FROM bank_transactions bt
       JOIN bank_statements bs ON bs.id = bt.statement_id
      WHERE bs.created_at >= ?`,
  ).all(cutoff) as Array<{ narration: string | null; amount: number }>;
  console.log(`Scope: statements ingested since ${cutoff} (last ${days} day(s)).`);
} else {
  rows = db.prepare('SELECT narration, amount FROM bank_transactions').all() as Array<{
    narration: string | null; amount: number;
  }>;
  console.log('Scope: all stored transactions.');
}

type Bucket = {
  fingerprint: string;
  count: number;
  credits: number;
  debits: number;
  sample: string;
  counterparty: string | null;
};
const buckets = new Map<string, Bucket>();
let total = 0;
let resolved = 0;
let fellThrough = 0;

for (const r of rows) {
  const narration = (r.narration ?? '').trim();
  if (!narration || r.amount === 0) continue;
  total++;
  const type: 'credit' | 'debit' = r.amount >= 0 ? 'credit' : 'debit';
  const out = classifyRow({ narration, type, amount: r.amount }, { includeExperimental: true });
  if (out) { resolved++; continue; }
  fellThrough++;
  const fp = extractNarrationFingerprint(narration) || narration.slice(0, 40).toLowerCase();
  const b = buckets.get(fp) ?? {
    fingerprint: fp, count: 0, credits: 0, debits: 0,
    sample: narration.slice(0, 70), counterparty: extractCounterparty(narration),
  };
  b.count++;
  if (type === 'credit') b.credits++; else b.debits++;
  buckets.set(fp, b);
}

const ranked = [...buckets.values()].sort((a, b) => b.count - a.count);

console.log('');
console.log(`Transactions analysed : ${total.toLocaleString('en-IN')}`);
console.log(`Resolved locally      : ${resolved.toLocaleString('en-IN')} (${total ? ((resolved / total) * 100).toFixed(1) : '0'}%)`);
console.log(`Fell through to AI     : ${fellThrough.toLocaleString('en-IN')} (${total ? ((fellThrough / total) * 100).toFixed(1) : '0'}%)`);
console.log(`Distinct AI fingerprints: ${ranked.length.toLocaleString('en-IN')}`);
const covered = ranked.slice(0, topN).reduce((a, b) => a + b.count, 0);
console.log(`Top ${topN} patterns cover ${covered.toLocaleString('en-IN')} of the ${fellThrough.toLocaleString('en-IN')} AI rows (${fellThrough ? ((covered / fellThrough) * 100).toFixed(0) : '0'}%).`);
console.log('');
console.log(`Top ${topN} fall-through patterns (fix these first):`);
console.log('  count  cr/dr   counterparty            fingerprint  |  sample');
console.log('  ' + '-'.repeat(96));
for (const b of ranked.slice(0, topN)) {
  const cnt = String(b.count).padStart(5);
  const crdr = `${b.credits}/${b.debits}`.padStart(7);
  const cp = (b.counterparty ?? '—').slice(0, 22).padEnd(22);
  console.log(`  ${cnt}  ${crdr}  ${cp}  ${b.fingerprint.slice(0, 28).padEnd(28)} | ${b.sample}`);
}
console.log('');
console.log('Paste the block above back to share it — it is aggregated fingerprints + counts, not raw statements.');
