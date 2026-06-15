/**
 * OCR engine bake-off harness.
 *
 * Compares the CURRENT scanned-PDF pipeline (PaddleOCR → column-align →
 * Gemini structurer) against a candidate (marker, https://github.com/
 * datalab-to/marker) on the same statement(s), so the switch decision is
 * made on numbers, not vibes.
 *
 * Note: Docling was trialled (June 2026) and rejected — on a 21pp ICICI
 * scan it dropped ~57 rows (TableFormer missed dense same-date clusters)
 * and ran 4.5-5.5 min on CPU vs Paddle's seconds. Paddle + the balance-
 * delta reconciliation won decisively, so the production engine stays
 * Paddle. The docling engine was removed from this harness with it.
 *
 * The scoring is LABEL-FREE on purpose. We don't hand-key ground truth;
 * the bank's own running-BALANCE column is the oracle. Every honest row
 * must satisfy  balance[i] - balance[i-1] == signed_amount[i], and the
 * whole statement must satisfy  opening + Σ(signed amounts) == closing.
 * So we score each engine on how well its output ties to that chain —
 * which is exactly the failure mode we care about (the ICICI scan closed
 * ₹6.5L off because amount cells were misread).
 *
 * Four metrics per engine, matching the decision table we agreed on:
 *   1. balanceTieRate   — % rows where |amount| == |balance delta|.
 *                         The raw digit-accuracy signal.
 *   2. signAgreeRate    — % rows where sign(amount) == sign(delta).
 *                         The column/sign-correctness signal (the hard
 *                         class the balance checksum can't fully fix).
 *   3. rowYield         — rows emitted vs date-lines in the raw text
 *                         (proxy for dropped rows).
 *   4. latency + cost   — wall-clock per statement; token/page cost.
 * Plus the headline: does opening + Σamounts reconcile to closing, and
 * by how much does it drift if not.
 *
 * Usage:
 *   npx tsx scripts/bakeoff-ocr-engines.ts <statement.pdf> [more.pdf ...] \
 *       [--engines paddle,marker] \
 *       [--opening 680.44] [--closing 0.02] \
 *       [--truth path/to/known-good.csv]   # optional row-count anchor
 *
 * Engines are skipped (not failed) when unavailable, so you can run the
 * paddle side on a box without marker, or the marker side without a
 * Gemini key — each prints why it was skipped.
 *
 * Env:
 *   GEMINI_API_KEY / GEMINI_API_KEYS  — needed for the paddle engine's
 *                                       structurer call.
 *   MARKER_BIN                        — marker CLI (default: marker_single).
 *   PADDLE_PYTHON                     — python with paddleocr (default python3).
 */

import { readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

import { extractPdfTextWithPaddleOcr, checkPaddleOcrAvailable } from '../server/lib/paddleOcr.js';
import { structureOcrTextIntoRows, estimateTxnRows } from '../server/lib/paddleStructurer.js';
import { GEMINI_API_KEYS } from '../server/lib/gemini.js';

// ── Pricing knobs (approximate — confirm before quoting) ───────────────
// Gemini Flash-Lite structurer call. Update from the live price sheet;
// these are order-of-magnitude so the cost column is comparable, not exact.
const GEMINI_IN_PER_M = 0.10;   // $ / 1M input tokens
const GEMINI_OUT_PER_M = 0.40;  // $ / 1M output tokens
// marker hosted Datalab API list price; self-hosting on a GPU you own is
// ~0 marginal $ (amortized infra) but you pay it in ops + a GPU.
const MARKER_API_PER_PAGE = 0.003; // $ / page via Datalab API

interface BakeRow {
  date: string | null;
  narration: string;
  /** Signed: debit negative, credit positive. */
  amount: number;
  balance: number | null;
}

interface EngineRun {
  rows: BakeRow[];
  /** Raw text the engine produced, for the date-line yield estimate. */
  rawText: string;
  pageCount: number;
  latencyMs: number;
  /** Gemini token usage when the engine made an LLM call (paddle path). */
  tokens?: { inTok: number; outTok: number };
  note?: string;
}

interface Engine {
  name: string;
  available(): Promise<{ ok: boolean; reason?: string }>;
  run(pdf: Buffer): Promise<EngineRun>;
  /** $ estimate for one run, given its measured usage. */
  costUsd(run: EngineRun): { value: number; basis: string };
}

const signByType = (type: 'credit' | 'debit', mag: number) =>
  type === 'debit' ? -Math.abs(mag) : Math.abs(mag);

// ── Engine A: the current pipeline ─────────────────────────────────────
const paddleGeminiEngine: Engine = {
  name: 'paddle+gemini (current)',
  async available() {
    if (!(GEMINI_API_KEYS[0])) return { ok: false, reason: 'GEMINI_API_KEY not set' };
    const paddleOk = await checkPaddleOcrAvailable();
    if (!paddleOk) return { ok: false, reason: 'PaddleOCR/pdf2image not importable (see scripts/install-paddle-ocr.sh)' };
    return { ok: true };
  },
  async run(pdf) {
    const ocr = await extractPdfTextWithPaddleOcr(pdf);
    const t0 = Date.now();
    const structured = await structureOcrTextIntoRows(ocr.pages);
    const structureMs = Date.now() - t0;
    const rows: BakeRow[] = structured.transactions.map((t) => ({
      date: t.date,
      narration: t.narration,
      amount: t.amount == null ? 0 : signByType(t.type, t.amount),
      balance: t.balance,
    }));
    return {
      rows,
      rawText: ocr.pages.join('\n'),
      pageCount: ocr.pageCount,
      latencyMs: ocr.durationMs + structureMs,
      tokens: { inTok: structured.inputTokens, outTok: structured.outputTokens },
      note: `model=${structured.modelUsed}`,
    };
  },
  costUsd(run) {
    const t = run.tokens ?? { inTok: 0, outTok: 0 };
    const value = (t.inTok / 1e6) * GEMINI_IN_PER_M + (t.outTok / 1e6) * GEMINI_OUT_PER_M;
    return { value, basis: `${t.inTok}in/${t.outTok}out tok; OCR compute ~free (CPU)` };
  },
};

// ── Engine B: marker ───────────────────────────────────────────────────
const MARKER_BIN = process.env.MARKER_BIN ?? 'marker_single';

const markerEngine: Engine = {
  name: 'marker',
  async available() {
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn(MARKER_BIN, ['--help'], { stdio: 'ignore' });
      p.on('close', () => resolve(true));        // ran (any exit code) → installed
      p.on('error', () => resolve(false));       // ENOENT → not installed
    });
    return ok ? { ok: true } : { ok: false, reason: `'${MARKER_BIN}' not on PATH (pip install marker-pdf; or set MARKER_BIN)` };
  },
  async run(pdf) {
    const tmp = path.join(os.tmpdir(), 'bakeoff-marker', crypto.randomBytes(6).toString('hex'));
    mkdirSync(tmp, { recursive: true });
    const pdfPath = path.join(tmp, 'in.pdf');
    const outDir = path.join(tmp, 'out');
    mkdirSync(outDir, { recursive: true });
    const { writeFileSync } = await import('fs');
    writeFileSync(pdfPath, pdf);

    const t0 = Date.now();
    await new Promise<void>((resolve, reject) => {
      const p = spawn(MARKER_BIN, [pdfPath, '--output_dir', outDir, '--output_format', 'markdown'], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let err = '';
      p.stderr.on('data', (d) => { err += d.toString(); });
      p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`marker exited ${code}: ${err.slice(0, 300)}`)));
      p.on('error', reject);
    });
    const latencyMs = Date.now() - t0;

    const md = readAllMarkdown(outDir);
    const { rows, pageCount } = parseMarkerMarkdown(md);
    return { rows, rawText: md, pageCount: pageCount || countMarkerPages(md), latencyMs, note: 'table-parse heuristic' };
  },
  costUsd(run) {
    return {
      value: run.pageCount * MARKER_API_PER_PAGE,
      basis: `${run.pageCount}pp @ $${MARKER_API_PER_PAGE}/pg (Datalab API); self-host GPU ≈ $0 marginal`,
    };
  },
};

/** Recursively collect every .md marker wrote (it nests under a stem dir). */
function readAllMarkdown(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.toLowerCase().endsWith('.md')) out.push(readFileSync(full, 'utf-8'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.join('\n\n');
}

function countMarkerPages(md: string): number {
  // marker emits a page-break comment between pages in markdown mode.
  const m = md.match(/\{(\d+)\}-+|<!--\s*page/gi);
  return m ? m.length : 0;
}

/**
 * Heuristic markdown-table → rows parser. marker emits transactions as
 * GitHub pipe tables; we find the table that looks like a statement (has
 * a date-ish column) and map columns by header keyword. Deliberately
 * forgiving — this is a bake-off probe, not the production parser. If
 * marker wins, the real parser gets written properly (and likely reads
 * marker's structured JSON output, not markdown).
 */
function parseMarkerMarkdown(md: string): { rows: BakeRow[]; pageCount: number } {
  const lines = md.split('\n');
  const rows: BakeRow[] = [];
  // Gather contiguous pipe-table blocks.
  let block: string[] = [];
  const flush = () => { if (block.length >= 2) consumeTable(block, rows); block = []; };
  for (const ln of lines) {
    if (ln.trim().startsWith('|')) block.push(ln);
    else flush();
  }
  flush();
  return { rows, pageCount: countMarkerPages(md) };
}

function splitCells(line: string): string[] {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

const num = (s: string): number | null => {
  const cleaned = s.replace(/[,\s₹]/g, '');
  if (!/\d/.test(cleaned)) return null;
  const n = Number(cleaned.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

function consumeTable(block: string[], out: BakeRow[]): void {
  const header = splitCells(block[0]).map((h) => h.toLowerCase());
  const find = (...keys: string[]) => header.findIndex((h) => keys.some((k) => h.includes(k)));
  const dateCol = find('date', 'txn date', 'value date');
  const narrCol = find('particular', 'narration', 'description', 'details', 'remarks');
  const balCol = find('balance', 'closing bal');
  const wdCol = find('withdraw', 'debit', ' dr', 'dr.');
  const depCol = find('deposit', 'credit', ' cr', 'cr.');
  const amtCol = find('amount');
  if (dateCol < 0 || balCol < 0) return; // not a transaction table

  // Skip header + markdown separator (---) row.
  for (let i = 1; i < block.length; i++) {
    const cells = splitCells(block[i]);
    if (cells.every((c) => /^-{2,}:?$/.test(c) || c === '')) continue;
    const date = dateCol < cells.length ? cells[dateCol] : '';
    if (!/\d{1,2}[-/](?:\d{1,2}|[A-Za-z]{3})[-/]\d{2,4}/.test(date)) continue;
    const balance = balCol < cells.length ? num(cells[balCol]) : null;
    const wd = wdCol >= 0 && wdCol < cells.length ? num(cells[wdCol]) : null;
    const dep = depCol >= 0 && depCol < cells.length ? num(cells[depCol]) : null;
    const amt = amtCol >= 0 && amtCol < cells.length ? num(cells[amtCol]) : null;

    let signed = 0;
    if (wd != null && wd !== 0) signed = -Math.abs(wd);
    else if (dep != null && dep !== 0) signed = Math.abs(dep);
    else if (amt != null) signed = amt; // single-amount column: sign unknown → leave as printed
    out.push({
      date,
      narration: narrCol >= 0 && narrCol < cells.length ? cells[narrCol] : '',
      amount: signed,
      balance,
    });
  }
}

// ── Scoring ────────────────────────────────────────────────────────────
interface Score {
  rowCount: number;
  estRows: number;
  rowYield: number;          // rowCount / estRows
  withDelta: number;
  balanceTieRate: number;    // |amt| == |delta|
  signAgreeRate: number;     // sign(amt) == sign(delta)
  opening: number | null;
  closing: number | null;
  sumSigned: number;
  reconciles: boolean;
  driftAbs: number;
  latencyMs: number;
  costUsd: number;
  costBasis: string;
  note?: string;
}

function scoreRun(
  run: EngineRun,
  engine: Engine,
  openingOverride: number | null,
  closingOverride: number | null,
): Score {
  const rows = run.rows;
  // Anchor opening from the first row's chain when not supplied.
  const opening = openingOverride ?? (rows[0]?.balance != null ? rows[0].balance - rows[0].amount : null);
  const closing = closingOverride ?? [...rows].reverse().find((r) => r.balance != null)?.balance ?? null;

  let withDelta = 0, magMatch = 0, signMatch = 0;
  let prev = opening;
  for (const r of rows) {
    if (prev != null && r.balance != null) {
      const delta = r.balance - prev;
      if (Math.abs(delta) > 0.005 && Math.abs(r.amount) > 0.005) {
        withDelta++;
        if (Math.abs(Math.abs(delta) - Math.abs(r.amount)) <= Math.max(1, Math.abs(delta) * 0.02)) magMatch++;
        if (Math.sign(delta) === Math.sign(r.amount)) signMatch++;
      }
    }
    if (r.balance != null) prev = r.balance;
  }

  const sumSigned = rows.reduce((s, r) => s + r.amount, 0);
  const expected = opening != null && closing != null ? closing - opening : null;
  const driftAbs = expected != null ? Math.abs(sumSigned - expected) : NaN;
  const reconciles = expected != null && driftAbs <= Math.max(1, Math.abs(expected) * 0.005);

  const estRows = estimateTxnRows(run.rawText);
  const cost = engine.costUsd(run);

  return {
    rowCount: rows.length,
    estRows,
    rowYield: estRows > 0 ? rows.length / estRows : NaN,
    withDelta,
    balanceTieRate: withDelta > 0 ? magMatch / withDelta : NaN,
    signAgreeRate: withDelta > 0 ? signMatch / withDelta : NaN,
    opening,
    closing,
    sumSigned,
    reconciles,
    driftAbs,
    latencyMs: run.latencyMs,
    costUsd: cost.value,
    costBasis: cost.basis,
    note: run.note,
  };
}

// ── Reporting ──────────────────────────────────────────────────────────
const pct = (x: number) => Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—';
const money = (x: number) => Number.isFinite(x) ? x.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—';

function report(file: string, results: Array<{ engine: string; score?: Score; skipped?: string; error?: string }>) {
  console.log(`\n## ${path.basename(file)}\n`);
  const rowsMd: string[][] = [[
    'metric', ...results.map((r) => r.engine),
  ]];
  const cell = (r: typeof results[number], pick: (s: Score) => string) =>
    r.score ? pick(r.score) : (r.skipped ? `skipped: ${r.skipped}` : `ERROR: ${r.error}`);

  rowsMd.push(['rows emitted', ...results.map((r) => cell(r, (s) => `${s.rowCount} (est ${s.estRows})`))]);
  rowsMd.push(['row yield', ...results.map((r) => cell(r, (s) => pct(s.rowYield)))]);
  rowsMd.push(['balance-tie (magnitude)', ...results.map((r) => cell(r, (s) => `${pct(s.balanceTieRate)} of ${s.withDelta}`))]);
  rowsMd.push(['sign agreement', ...results.map((r) => cell(r, (s) => `${pct(s.signAgreeRate)} of ${s.withDelta}`))]);
  rowsMd.push(['reconciles to closing', ...results.map((r) => cell(r, (s) => s.reconciles ? 'YES' : `NO (drift ${money(s.driftAbs)})`))]);
  rowsMd.push(['opening → closing', ...results.map((r) => cell(r, (s) => `${money(s.opening ?? NaN)} → ${money(s.closing ?? NaN)}`))]);
  rowsMd.push(['latency', ...results.map((r) => cell(r, (s) => `${(s.latencyMs / 1000).toFixed(1)}s`))]);
  rowsMd.push(['cost / statement', ...results.map((r) => cell(r, (s) => `$${s.costUsd.toFixed(4)}`))]);

  // Render as a markdown table.
  const widths = rowsMd[0].map((_, c) => Math.max(...rowsMd.map((row) => (row[c] ?? '').length)));
  const fmt = (row: string[]) => '| ' + row.map((c, i) => (c ?? '').padEnd(widths[i])).join(' | ') + ' |';
  console.log(fmt(rowsMd[0]));
  console.log('| ' + widths.map((w) => '-'.repeat(w)).join(' | ') + ' |');
  for (const row of rowsMd.slice(1)) console.log(fmt(row));

  for (const r of results) {
    if (r.score?.costBasis) console.log(`  - ${r.engine} cost basis: ${r.score.costBasis}`);
    if (r.score?.note) console.log(`  - ${r.engine} note: ${r.score.note}`);
  }
}

// ── CLI ────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const files: string[] = [];
  let engines = ['paddle', 'marker'];
  let opening: number | null = null;
  let closing: number | null = null;
  let truth: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--engines') engines = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--opening') opening = Number(argv[++i]);
    else if (a === '--closing') closing = Number(argv[++i]);
    else if (a === '--truth') truth = argv[++i];
    else files.push(a);
  }
  return { files, engines, opening, closing, truth };
}

async function main() {
  const { files, engines: wanted, opening, closing, truth } = parseArgs(process.argv.slice(2));
  if (files.length === 0) {
    console.error('Usage: npx tsx scripts/bakeoff-ocr-engines.ts <statement.pdf> [...] [--engines paddle,marker] [--opening N] [--closing N] [--truth file.csv]');
    process.exit(1);
  }
  if (truth && existsSync(truth)) {
    const lines = readFileSync(truth, 'utf-8').trim().split('\n').length - 1;
    console.log(`(truth CSV ${path.basename(truth)}: ${lines} data rows — compare against 'rows emitted')`);
  }

  const allEngines: Engine[] = [];
  if (wanted.includes('paddle')) allEngines.push(paddleGeminiEngine);
  if (wanted.includes('marker')) allEngines.push(markerEngine);

  // Resolve availability once.
  const avail = new Map<string, { ok: boolean; reason?: string }>();
  for (const e of allEngines) avail.set(e.name, await e.available());
  for (const e of allEngines) {
    const a = avail.get(e.name)!;
    console.log(`engine ${e.name}: ${a.ok ? 'available' : `UNAVAILABLE (${a.reason})`}`);
  }

  for (const file of files) {
    if (!existsSync(file)) { console.error(`skip (missing): ${file}`); continue; }
    const pdf = readFileSync(file);
    const results: Array<{ engine: string; score?: Score; skipped?: string; error?: string }> = [];
    for (const e of allEngines) {
      const a = avail.get(e.name)!;
      if (!a.ok) { results.push({ engine: e.name, skipped: a.reason }); continue; }
      try {
        const run = await e.run(pdf);
        results.push({ engine: e.name, score: scoreRun(run, e, opening, closing) });
      } catch (err) {
        results.push({ engine: e.name, error: (err as Error).message.slice(0, 200) });
      }
    }
    report(file, results);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
