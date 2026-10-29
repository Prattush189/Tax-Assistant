/**
 * Read a bank-statement PDF with Claude (Haiku by default) — the PDF
 * itself, no OCR text and no column mapping.
 *
 * Why: on the 2026-10-28 bake-off (10 scanned statements, first 3 pages)
 * this beat PaddleOCR + Gemini structurer — 398 rows / 99% of printed
 * balances reconciling vs 341 rows / 96% (the OCR path dropped 46 of 100
 * rows on one ICICI scan), at ~55% of the cost. On 13 digital statements
 * with no mapping it got 11 files ≥99% right — but one file came back
 * with every debit/credit swapped, so the output is NEVER trusted
 * blindly: `check` re-walks the running balance and the caller falls
 * back to PaddleOCR when it fails.
 *
 * Shape matches what the PaddleOCR structurer feeds persistStatement:
 * date, narration, type, unsigned amount, balance.
 */

import { spawn } from 'child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { claudeComplete, CLAUDE_MODEL_FAST, type ClaudeCompletion } from './claude.js';
import { splitPdfByPages } from './pdfChunker.js';

/** ~40 rows/page × 6 pages ≈ 240 rows ≈ 10K output tokens — well under the cap. */
const PAGES_PER_CHUNK = 6;
const CHUNK_CONCURRENCY = 3;
const MAX_TOKENS = 24_000;
/** Share of balance checkpoints that must reconcile (after repair). */
const PASS_RATIO = 0.98;
/** Fewer checkpoints than this can't prove anything — let OCR decide. */
const MIN_CHECKPOINTS = 3;

const PROMPT = [
  'This is an Indian bank statement. Transcribe EVERY transaction row in order, one per line, as TSV with exactly these 5 columns:',
  'date (YYYY-MM-DD) <TAB> narration <TAB> withdrawal/debit (number or empty) <TAB> deposit/credit (number or empty) <TAB> running balance (number; prefix with - if printed as Dr / overdrawn)',
  'Rules: use the transaction (posting) date, not the value date, when both are printed; copy amounts exactly as printed, without commas; one line per transaction even if the narration wraps; skip headers, page totals and opening/closing summary lines; no commentary.',
  'After the last row output a line: ---END:N--- where N is the number of rows. If the pages contain no transactions output only ---END:0---.',
].join('\n');

const TABLE_PROMPT = [
  'Below is part of an Indian bank statement exported as a spreadsheet. Transcribe EVERY transaction row in order, one per line, as TSV with exactly these 5 columns:',
  'date (YYYY-MM-DD) <TAB> narration <TAB> withdrawal/debit (number or empty) <TAB> deposit/credit (number or empty) <TAB> running balance (number; prefix with - if it is Dr / overdrawn)',
  'Rules: use the header to tell which column is which; use the transaction (posting) date, not the value date; copy amounts exactly, without commas; if a single amount column has a Dr/Cr marker, put it under withdrawal or deposit accordingly; skip opening/closing summary and total lines; no commentary.',
  'After the last row output a line: ---END:N--- where N is the number of rows. If there are no transactions output only ---END:0---.',
].join('\n');

export interface ClaudeStatementRow {
  date: string | null;
  narration: string;
  type: 'credit' | 'debit';
  /** Unsigned magnitude; direction is `type`. */
  amount: number;
  balance: number | null;
}

export interface ClaudeStatementRead {
  rows: ClaudeStatementRow[];
  usages: Array<{ inputTokens: number; outputTokens: number; modelUsed: string }>;
  check: {
    /** Balance checkpoints (rows with a balance after the first). */
    checkpoints: number;
    reconciled: number;
    /** Single misread balances corrected from the amounts. */
    repaired: number;
    passed: boolean;
    reason: string;
  };
  chunks: number;
}

function parseTsv(text: string): { rows: ClaudeStatementRow[]; declared: number | null } {
  const num = (s: string | undefined): number | null => {
    const t = (s ?? '').replace(/[,\s₹]/g, '');
    if (!t) return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  };
  const rows: ClaudeStatementRow[] = [];
  for (const line of text.split('\n')) {
    const c = line.split('\t');
    if (c.length < 5 || !/^\d{4}-\d{2}-\d{2}$/.test(c[0].trim())) continue;
    const dr = num(c[2]);
    const cr = num(c[3]);
    if (!dr && !cr) continue; // no amount — not a posting we can use
    rows.push({
      date: c[0].trim(),
      narration: c[1].trim(),
      type: cr ? 'credit' : 'debit',
      amount: Math.abs((cr || dr) as number),
      balance: num(c[4]),
    });
  }
  const trailer = /---END:(\d+)---/.exec(text);
  return { rows, declared: trailer ? Number(trailer[1]) : null };
}

/**
 * Walk the running balance: balance(i) = balance(i-1) + credit − debit,
 * with signed balances (Dr / overdrawn negative, as the prompt asks).
 * Deliberately NOT sign-agnostic — a fully swapped debit/credit read
 * must fail here, not pass as "inverted".
 *
 * Repair: a single misread balance digit breaks two checkpoints (that
 * row, and the next one measured from the bad value). When the next
 * row's balance is consistent with the amounts measured from the row
 * BEFORE the bad one, the bad balance is replaced by the computed one.
 * (PNB scan: 38,084.88 read as 38,064.88 by both Haiku and Sonnet.)
 *
 * Newest-first statements (Bank of Baroda's OpTransactionHistory, some
 * ICICI exports) print the latest transaction first, so the balance
 * walks backwards. When the rows only reconcile in reverse, they are put
 * in date order (in place) and accepted.
 */
export function checkAndRepairBalances(rows: ClaudeStatementRow[]): ClaudeStatementRead['check'] {
  const original = rows.map(r => ({ ...r }));
  const forward = walkBalances(rows);
  if (forward.passed) return forward;
  const reversed = original.reverse();
  const back = walkBalances(reversed);
  if (!back.passed) return forward;
  rows.splice(0, rows.length, ...reversed);
  return { ...back, reason: `${back.reason}; listed newest-first, re-ordered by date` };
}

function walkBalances(rows: ClaudeStatementRow[]): ClaudeStatementRead['check'] {
  const signed = (r: ClaudeStatementRow) => (r.type === 'credit' ? r.amount : -r.amount);
  const near = (a: number, b: number) => Math.abs(a - b) < 1.01;
  let repaired = 0;
  // Index of the previous row that has a balance.
  let prevIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].balance == null) continue;
    if (prevIdx >= 0) {
      let acc = 0;
      for (let k = prevIdx + 1; k <= i; k++) acc += signed(rows[k]);
      const expected = rows[prevIdx].balance! + acc;
      if (!near(rows[i].balance!, expected)) {
        // Look one balance ahead: does it reconcile from `expected`?
        let j = i + 1;
        while (j < rows.length && rows[j].balance == null) j++;
        if (j < rows.length) {
          let acc2 = 0;
          for (let k = i + 1; k <= j; k++) acc2 += signed(rows[k]);
          if (near(rows[j].balance!, expected + acc2)) {
            rows[i].balance = Math.round(expected * 100) / 100;
            repaired++;
          }
        }
      }
    }
    prevIdx = i;
  }
  let checkpoints = 0;
  let reconciled = 0;
  prevIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].balance == null) continue;
    if (prevIdx >= 0) {
      let acc = 0;
      for (let k = prevIdx + 1; k <= i; k++) acc += signed(rows[k]);
      checkpoints++;
      if (near(rows[i].balance!, rows[prevIdx].balance! + acc)) reconciled++;
    }
    prevIdx = i;
  }
  const ratio = checkpoints ? reconciled / checkpoints : 0;
  // A short statement (SBI: 2 rows, 1 checkpoint) can't offer three
  // checkpoints; accept it only when every checkpoint it has reconciles.
  const withBalance = rows.filter(r => r.balance != null).length;
  const needed = Math.max(1, Math.min(MIN_CHECKPOINTS, withBalance - 1));
  const passed = checkpoints >= needed && (checkpoints >= MIN_CHECKPOINTS ? ratio >= PASS_RATIO : reconciled === checkpoints);
  const reason = checkpoints < needed
    ? `only ${checkpoints} balance checkpoint(s) — cannot verify`
    : `${reconciled}/${checkpoints} balances reconcile (${(ratio * 100).toFixed(1)}%, need ${PASS_RATIO * 100}%)`;
  return { checkpoints, reconciled, repaired, passed, reason };
}

/**
 * One single-page PDF per page, in order. Bank PDFs are very often
 * encrypted with an owner password (HDFC, PNB, J&K): they open without
 * one, but pdf-lib can't decrypt, and pages it copies stay encrypted —
 * Claude then sees blank pages and returns 0 rows. Those go through
 * poppler's pdfseparate (installed for PaddleOCR), which writes readable
 * pages. No poppler → throw, and the caller falls back to PaddleOCR.
 */
async function splitIntoPages(pdf: Buffer): Promise<Buffer[]> {
  let encrypted = false;
  try {
    await PDFDocument.load(pdf);
  } catch {
    encrypted = true;
  }
  if (!encrypted) return (await splitPdfByPages(pdf, 1)).map(c => c.buffer);
  return withTempDir(async dir => {
    const src = path.join(dir, 'in.pdf');
    await writeFile(src, pdf);
    await run('pdfseparate', [src, path.join(dir, 'p-%d.pdf')]);
    const files = (await readdir(dir)).filter(f => /^p-\d+\.pdf$/.test(f))
      .sort((a, b) => Number(a.slice(2, -4)) - Number(b.slice(2, -4)));
    if (files.length === 0) throw new Error('pdfseparate produced no pages');
    return Promise.all(files.map(f => readFile(path.join(dir, f))));
  });
}

/** Run a tool; `stdin` is written to it (used for passwords, so they never
 *  appear in a process listing). */
function run(cmd: string, args: string[], stdin?: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [stdin == null ? 'ignore' : 'pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr!.on('data', d => { err += String(d); });
    p.on('error', e => reject(new Error(`${cmd} unavailable: ${e.message}`)));
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(0, 200)}`))));
    if (stdin != null) p.stdin!.end(stdin);
  });
}

async function withTempDir<T>(use: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'stmt-pdf-'));
  try {
    return await use(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** PyMuPDF (installed with PaddleOCR) re-saves the original objects with
 *  encryption off — lossless. The password arrives on stdin. Exit 3 =
 *  wrong password. */
const UNLOCK_PY = [
  'import sys, fitz',
  'pw = sys.stdin.read()',
  'doc = fitz.open(sys.argv[1])',
  'if doc.needs_pass and not doc.authenticate(pw): sys.exit(3)',
  'doc.save(sys.argv[2], encryption=fitz.PDF_ENCRYPT_NONE)',
].join('\n');

/**
 * Remove the user password from a protected PDF (the user typed it in
 * the browser to unlock it), so every reader downstream — Claude,
 * PaddleOCR, vision — gets a plain PDF. PyMuPDF first; poppler's
 * pdftocairo (which redraws the pages into a new PDF) if Python or
 * PyMuPDF is missing. The password is never logged. Throws when neither
 * can open the file (wrong password).
 */
export async function unlockPdf(pdf: Buffer, password: string): Promise<Buffer> {
  return withTempDir(async dir => {
    const src = path.join(dir, 'in.pdf');
    const out = path.join(dir, 'out.pdf');
    await writeFile(src, pdf);
    try {
      await run(process.env.PADDLE_PYTHON ?? 'python3', ['-c', UNLOCK_PY, src, out], password);
    } catch (err) {
      if (/exited 3\b/.test((err as Error).message)) throw new Error('wrong PDF password');
      // pdftocairo takes the password only as an argument.
      await run('pdftocairo', ['-pdf', '-upw', password, src, out]);
    }
    return readFile(out);
  });
}

/** A chunk is either PDF pages or spreadsheet rows (header kept apart so
 *  every half of a split chunk still carries it). */
type Chunk = { pages: Buffer[] } | { header: string; lines: string[] };
const chunkSize = (c: Chunk) => ('pages' in c ? c.pages.length : c.lines.length);
const halve = (c: Chunk): [Chunk, Chunk] => {
  if ('pages' in c) { const m = Math.ceil(c.pages.length / 2); return [{ pages: c.pages.slice(0, m) }, { pages: c.pages.slice(m) }]; }
  const m = Math.ceil(c.lines.length / 2);
  return [{ header: c.header, lines: c.lines.slice(0, m) }, { header: c.header, lines: c.lines.slice(m) }];
};

async function readChunk(
  chunk: Chunk,
  label: string,
  usages: ClaudeStatementRead['usages'],
): Promise<ClaudeStatementRow[]> {
  const content = 'pages' in chunk
    ? [
        ...chunk.pages.map((b, i) => ({ type: 'file', file: { file_data: `data:application/pdf;base64,${b.toString('base64')}`, filename: `${label}-${i + 1}.pdf` } })),
        { type: 'text', text: PROMPT },
      ]
    : `${TABLE_PROMPT}\n\nSPREADSHEET (tab-separated, first line is the header):\n${chunk.header}\n${chunk.lines.join('\n')}`;
  let r: ClaudeCompletion;
  try {
    r = await claudeComplete([{ role: 'user', content: content as never }],
      { model: CLAUDE_MODEL_FAST, maxTokens: MAX_TOKENS, effort: 'medium', timeoutMs: 600_000 });
  } catch (err) {
    const u = (err as { claudeUsage?: ClaudeCompletion }).claudeUsage;
    if (u) usages.push({ inputTokens: u.inputTokens, outputTokens: u.outputTokens, modelUsed: u.model });
    // An empty answer is a legitimate "no transactions in this chunk".
    if (u && /no text/i.test((err as Error).message)) return [];
    throw err;
  }
  usages.push({ inputTokens: r.inputTokens, outputTokens: r.outputTokens, modelUsed: r.model });
  if (r.finishReason === 'length') {
    // Output cap hit: halve the chunk and read each half.
    if (chunkSize(chunk) <= 1) throw new Error(`${label}: output cap hit on a single page/row`);
    const [a, b] = halve(chunk);
    return [
      ...await readChunk(a, `${label}a`, usages),
      ...await readChunk(b, `${label}b`, usages),
    ];
  }
  const { rows, declared } = parseTsv(r.text);
  if (declared != null && declared !== rows.length) {
    console.warn(`[claudeStatementReader] ${label}: trailer says ${declared} rows, parsed ${rows.length}`);
  }
  return rows;
}

async function readChunks(chunks: Array<{ chunk: Chunk; label: string }>): Promise<ClaudeStatementRead> {
  const usages: ClaudeStatementRead['usages'] = [];
  const results: ClaudeStatementRow[][] = new Array(chunks.length);
  let next = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, async () => {
      while (next < chunks.length) {
        const i = next++;
        results[i] = await readChunk(chunks[i].chunk, chunks[i].label, usages);
      }
    }));
  } catch (err) {
    // Chunks that finished were billed by Anthropic — hand their usage to
    // the caller so it can log them.
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { usages });
  }
  const rows = results.flat();
  const check = checkAndRepairBalances(rows);
  return { rows, usages, check, chunks: chunks.length };
}

export async function readStatementPdfWithClaude(pdf: Buffer): Promise<ClaudeStatementRead> {
  const pages = await splitIntoPages(pdf);
  const chunks: Array<{ chunk: Chunk; label: string }> = [];
  for (let i = 0; i < pages.length; i += PAGES_PER_CHUNK) {
    chunks.push({ chunk: { pages: pages.slice(i, i + PAGES_PER_CHUNK) }, label: `pages ${i + 1}-${Math.min(i + PAGES_PER_CHUNK, pages.length)}` });
  }
  return readChunks(chunks);
}

/** ~150 rows ≈ 6K output tokens per chunk. */
const ROWS_PER_TABLE_CHUNK = 150;

/**
 * A spreadsheet statement (CSV / Excel) no bank rule recognised, as
 * tab-separated text with its header first. Unlike text pulled out of a
 * PDF, the columns here are explicit, so the "is that the amount or the
 * balance?" ambiguity that sank Claude-on-PDF-text doesn't arise. Same
 * output format and balance check as the PDF reader.
 */
export async function readStatementTableWithClaude(tsv: string): Promise<ClaudeStatementRead> {
  return readChunks(splitTable(tsv, ROWS_PER_TABLE_CHUNK).map((c, i) => ({
    chunk: c,
    label: `rows ${i * ROWS_PER_TABLE_CHUNK + 1}-${i * ROWS_PER_TABLE_CHUNK + c.lines.length}`,
  })));
}

/**
 * Cut a spreadsheet (TSV) into row chunks that each carry the header.
 * Bank exports put a meta block (name, IFSC, period…) above the table;
 * the header is the first line naming a date column and an amount
 * column. Anything above it rides along in the first chunk's body
 * (harmless — readers skip non-transaction lines).
 */
export function splitTable(tsv: string, rowsPerChunk: number): Array<{ header: string; lines: string[] }> {
  const lines = tsv.split(/\r?\n/).filter(l => l.replace(/\t/g, '').trim());
  const isHeader = (l: string) => /\bdate\b/i.test(l) && /\b(debit|credit|withdrawal|deposit|amount|balance|dr|cr)\b/i.test(l);
  const h = Math.max(0, lines.slice(0, 40).findIndex(isHeader));
  const header = lines[h] ?? '';
  const body = [...lines.slice(0, h), ...lines.slice(h + 1)];
  const out: Array<{ header: string; lines: string[] }> = [];
  for (let i = 0; i < body.length; i += rowsPerChunk) out.push({ header, lines: body.slice(i, i + rowsPerChunk) });
  return out;
}
