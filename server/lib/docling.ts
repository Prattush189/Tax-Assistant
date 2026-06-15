/**
 * Node wrapper around the Docling Python worker (server/python/docling_worker.py).
 *
 * Same subprocess-per-upload model as paddleOcr.ts — Docling is Python-
 * only and its model warmup amortises across the pages of one statement.
 *
 * Unlike the PaddleOCR path, Docling returns STRUCTURED transaction rows
 * directly (its TableFormer reconstructs the statement table), so there's
 * no Gemini structurer call downstream — the route feeds these rows
 * straight into deriveAmountsFromBalance. `markdown` is returned so the
 * caller can fall back to the structurer when Docling found no table.
 *
 * Timing: CPU-only, expect ~2-6s/page (layout + table + OCR models).
 * A 21-page statement ≈ 1-2 min. Surface a "this may take a minute"
 * message, same as the PaddleOCR path.
 */

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

export interface DoclingRow {
  date: string | null;            // ISO YYYY-MM-DD
  narration: string;
  type: 'credit' | 'debit';
  /** Unsigned printed magnitude; null when the cell was blank. The route
   *  signs it by `type` and cross-checks against the balance delta. */
  amount: number | null;
  balance: number | null;
}

export interface DoclingResult {
  transactions: DoclingRow[];
  pageCount: number;
  /** Full document markdown — feeds the structurer fallback + the
   *  date-line yield estimate in the bake-off harness. */
  markdown: string;
  durationMs: number;
}

const PYTHON_BIN = process.env.DOCLING_PYTHON ?? process.env.PADDLE_PYTHON ?? 'python3';
const SCRIPT_PATH = path.resolve(process.cwd(), 'server/python/docling_worker.py');
// 10 minutes — Docling on CPU is slower than Paddle; a 50-page scan with
// full-page OCR can run several minutes. Short enough that a hung worker
// doesn't pin a slot forever.
const TIMEOUT_MS = 10 * 60 * 1000;

export async function extractWithDocling(pdfBuffer: Buffer): Promise<DoclingResult> {
  if (!existsSync(SCRIPT_PATH)) {
    throw new Error(`Docling worker script missing at ${SCRIPT_PATH}`);
  }
  const tmpDir = path.join(tmpdir(), 'docling');
  mkdirSync(tmpDir, { recursive: true });
  const stem = crypto.randomBytes(8).toString('hex');
  const pdfPath = path.join(tmpDir, `${stem}.pdf`);
  const outPath = path.join(tmpDir, `${stem}.json`);
  writeFileSync(pdfPath, pdfBuffer);

  const started = Date.now();
  try {
    return await runPython(pdfPath, outPath, started);
  } finally {
    try { unlinkSync(pdfPath); } catch { /* ignore */ }
    try { unlinkSync(outPath); } catch { /* ignore */ }
  }
}

function runPython(pdfPath: string, outPath: string, started: number): Promise<DoclingResult> {
  return new Promise((resolve, reject) => {
    const py = spawn(PYTHON_BIN, [SCRIPT_PATH, pdfPath, outPath], {
      // Docling chatters model-download/progress to stdout; discard it.
      // Worker writes JSON to outPath. Keep stderr for structured errors.
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    py.stderr.on('data', (d) => { stderr += d.toString(); });

    const killTimer = setTimeout(() => {
      py.kill('SIGKILL');
      reject(new Error(`Docling timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    py.on('close', (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        let msg = stderr.slice(0, 500);
        try {
          const parsed = JSON.parse(stderr.split('\n').find((l) => l.trim().startsWith('{')) ?? '{}');
          if (parsed.error) msg = parsed.error;
        } catch { /* keep raw msg */ }
        reject(new Error(`Docling exited ${code}: ${msg}`));
        return;
      }
      // Surface the worker's diagnostic line (raw-vs-kept counts, drop
      // reasons, table headers) so a low row yield is debuggable from the
      // pm2 log without re-running. The worker writes one JSON line to
      // stderr; everything else there is Docling's own warnings.
      const diagLine = stderr.split('\n').find((l) => l.includes('"diag"'));
      if (diagLine) console.log(`[docling] ${diagLine.trim().slice(0, 800)}`);
      if (!existsSync(outPath)) {
        reject(new Error(`Docling exited 0 but wrote no output at ${outPath}`));
        return;
      }
      let raw: string;
      try {
        raw = readFileSync(outPath, 'utf-8');
      } catch (e) {
        reject(new Error(`Docling output read failed: ${(e as Error).message}`));
        return;
      }
      try {
        const parsed = JSON.parse(raw) as {
          transactions?: unknown; page_count?: unknown; markdown?: unknown;
        };
        if (!Array.isArray(parsed.transactions)) {
          reject(new Error(`Docling returned malformed output: ${raw.slice(0, 200)}`));
          return;
        }
        const transactions: DoclingRow[] = [];
        for (const t of parsed.transactions as Array<Record<string, unknown>>) {
          if (!t || typeof t !== 'object') continue;
          const type = t.type === 'credit' || t.type === 'debit' ? t.type : null;
          if (!type) continue;
          const amount = typeof t.amount === 'number' && Number.isFinite(t.amount) ? Math.abs(t.amount) : null;
          const balance = typeof t.balance === 'number' && Number.isFinite(t.balance) ? t.balance : null;
          transactions.push({
            date: typeof t.date === 'string' ? t.date : null,
            narration: typeof t.narration === 'string' ? t.narration : '',
            type,
            amount,
            balance,
          });
        }
        resolve({
          transactions,
          pageCount: typeof parsed.page_count === 'number' ? parsed.page_count : 0,
          markdown: typeof parsed.markdown === 'string' ? parsed.markdown : '',
          durationMs: Date.now() - started,
        });
      } catch (e) {
        reject(new Error(`Docling JSON parse failed: ${(e as Error).message}`));
      }
    });

    py.on('error', (err) => {
      clearTimeout(killTimer);
      const isMissingPython = (err as NodeJS.ErrnoException).code === 'ENOENT';
      reject(new Error(
        isMissingPython
          ? `Python binary "${PYTHON_BIN}" not found. Install Python 3 and Docling (see scripts/install-docling.sh).`
          : `Docling spawn failed: ${err.message}`,
      ));
    });
  });
}

/**
 * Health-check used at boot / by the bake-off harness to confirm Docling
 * is importable. Does NOT touch any PDFs.
 */
export async function checkDoclingAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const py = spawn(PYTHON_BIN, ['-c', 'import docling'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    py.on('close', (code) => resolve(code === 0));
    py.on('error', () => resolve(false));
  });
}
