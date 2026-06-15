/**
 * Node wrapper around the PaddleOCR Python worker.
 *
 * Why subprocess-per-upload (not a long-running daemon):
 *   - PaddleOCR import + model warmup is ~1-2s. For our volume (a
 *     few statements per minute, never thousands per second) the
 *     simpler subprocess model is fine.
 *   - A daemon adds an orchestration surface (process lifecycle,
 *     restart-on-crash, request queue) we don't need at this scale.
 *   - Each upload runs in isolation: a crashed worker can't poison
 *     a subsequent upload.
 *
 * Cost & timing on a typical 4-vCPU VPS:
 *   - 1-2s Python startup
 *   - ~3-5s per page of OCR (CPU only, no GPU)
 *   - A 21-page scanned ICICI statement: ~60-90 seconds end-to-end
 *
 * Caller responsibility — surface a "this may take 30-90 seconds"
 * message to the user; OCR is slow but free.
 */

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

/** A positioned OCR token. Shape-compatible with pdfGrid's RawItem so
 *  it can be fed straight into buildGridFromItems. `y` is FLATTENED to
 *  one continuous axis across all pages (page-relative y + cumulative
 *  page-height offset), mirroring extractPdfGrid's Phase 1. */
export interface OcrItem {
  text: string;
  x: number;
  y: number;
  width: number;
}

/**
 * Render OCR tokens into COLUMN-ALIGNED text so the structurer can read
 * transaction direction from column position. The naive "join every
 * token in a y-band with spaces" output collapses empty cells: a
 * withdrawal-only row ("… 200.00 [blank] 9800.00") and a deposit-only
 * row ("… [blank] 500.00 10300.00") flatten to the SAME shape ("…
 * <num> <num>"), so the model can't tell deposit from withdrawal and
 * mis-signs ~half the rows. We fix that by detecting the right-side
 * numeric column x-centres (Withdrawal / Deposit / Balance are
 * narrow, well-separated) and placing each row's numeric tokens into
 * fixed slots, preserving blanks. Output rows look like:
 *   "01-04-2025 UPI/payee | 200.00 |  | 9800.00"   (withdrawal)
 *   "02-04-2025 NEFT/payee |  | 500.00 | 10300.00"  (deposit)
 * The structurer then reads the header row (also aligned) to label the
 * columns and signs every row from its column, not a guess.
 *
 * Falls back to a naive per-row join when there isn't enough numeric-
 * column structure to detect (covers non-tabular pages / banners).
 * Exported for unit testing.
 */
export function renderColumnAlignedPage(pageItems: OcrItem[]): string {
  if (pageItems.length === 0) return '';
  const Y_BAND = 8; // px @ ~200 dpi — one printed line
  const sorted = [...pageItems].sort((a, b) => a.y - b.y || a.x - b.x);
  // Cluster into y-band rows.
  const rows: OcrItem[][] = [];
  let cur: OcrItem[] = [];
  let curY = -Infinity;
  for (const it of sorted) {
    if (cur.length === 0 || Math.abs(it.y - curY) <= Y_BAND) {
      cur.push(it);
      curY = cur.length === 1 ? it.y : (curY + it.y) / 2;
    } else {
      rows.push(cur);
      cur = [it];
      curY = it.y;
    }
  }
  if (cur.length) rows.push(cur);

  const naive = () => rows.map(r => r.map(t => t.text).join(' ')).join('\n');

  const dateRe = /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/;
  const isNum = (s: string) => /^-?[\d,]+\.?\d*$/.test(s.replace(/\s/g, '')) && /\d/.test(s);
  // Transaction rows: a date token AND a numeric token.
  const txRows = rows.filter(r =>
    r.some(t => dateRe.test(t.text.trim())) && r.some(t => isNum(t.text)));
  if (txRows.length < 3) return naive();

  // Numeric column centres from transaction rows. Numbers sit in
  // narrow, well-separated columns (unlike wide narration), so a
  // gap-split on their x cleanly recovers Withdrawal/Deposit/Balance.
  const GAP = 35;
  const numXs = txRows.flatMap(r => r.filter(t => isNum(t.text)).map(t => t.x)).sort((a, b) => a - b);
  const centers: number[] = [];
  {
    let prev = -Infinity, sum = 0, n = 0;
    for (const x of numXs) {
      if (n > 0 && x - prev > GAP) { centers.push(sum / n); sum = 0; n = 0; }
      sum += x; n++; prev = x;
    }
    if (n > 0) centers.push(sum / n);
  }
  if (centers.length < 2) return naive();
  const leftBound = Math.min(...centers) - 30; // narration/date sit left of the first numeric column

  return rows.map(r => {
    const rs = [...r].sort((a, b) => a.x - b.x);
    const leftText = rs.filter(t => t.x < leftBound).map(t => t.text).join(' ');
    const cells = new Array(centers.length).fill('');
    for (const t of rs.filter(t => t.x >= leftBound)) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = Math.abs(t.x - centers[c]);
        if (d < bd) { bd = d; best = c; }
      }
      cells[best] = cells[best] ? `${cells[best]} ${t.text}` : t.text;
    }
    return [leftText, ...cells].join(' | ');
  }).join('\n');
}

export interface PaddleOcrResult {
  /** Joined text per PDF page, in order. Feeds the LLM structurer
   *  fallback when the deterministic grid path can't auto-map. May
   *  contain empty strings for pages with no detected text. */
  pages: string[];
  /** All OCR tokens across the document, flattened with a continuous
   *  y-axis, for buildGridFromItems. Empty when the worker predates
   *  coordinate emission (graceful degradation → structurer path). */
  items: OcrItem[];
  /** Item-array indices where each page begins — passed to
   *  buildGridFromItems as pageBoundaries. */
  pageBoundaries: number[];
  /** Number of pages OCR'd. */
  pageCount: number;
  /** Wall-clock time spent in the Python subprocess. */
  durationMs: number;
}

const PYTHON_BIN = process.env.PADDLE_PYTHON ?? 'python3';
// Resolve relative to the project root so this works regardless of
// which cwd the Node process was launched from (the systemd unit on
// the VPS sets WorkingDirectory to /www/wwwroot/ai.smartbizin.com).
const SCRIPT_PATH = path.resolve(process.cwd(), 'server/python/ocr_worker.py');
// 5 minutes — generous enough for a 50-page scan on a busy VPS,
// short enough that a hung worker doesn't pin a request slot forever.
const TIMEOUT_MS = 5 * 60 * 1000;

/**
 * One-shot OCR: writes the PDF buffer to a tempfile, spawns the
 * Python worker, parses its JSON stdout, cleans up the tempfile.
 *
 * Throws on:
 *   - Python binary not found (typical: PaddleOCR not installed on VPS)
 *   - Worker exit code != 0
 *   - JSON parse failure on stdout
 *   - Timeout
 *
 * Callers are expected to catch and fall back to Gemini Vision so
 * uploads don't break entirely while PaddleOCR is being set up.
 */
export async function extractPdfTextWithPaddleOcr(
  pdfBuffer: Buffer,
): Promise<PaddleOcrResult> {
  if (!existsSync(SCRIPT_PATH)) {
    throw new Error(`PaddleOCR worker script missing at ${SCRIPT_PATH}`);
  }
  const tmpDir = path.join(tmpdir(), 'paddle-ocr');
  mkdirSync(tmpDir, { recursive: true });
  const stem = crypto.randomBytes(8).toString('hex');
  const pdfPath = path.join(tmpDir, `${stem}.pdf`);
  const outPath = path.join(tmpDir, `${stem}.json`);
  writeFileSync(pdfPath, pdfBuffer);

  const started = Date.now();
  try {
    return await runPython(pdfPath, outPath, started);
  } finally {
    // Best-effort cleanup of both the input PDF and the JSON output.
    try { unlinkSync(pdfPath); } catch { /* ignore */ }
    try { unlinkSync(outPath); } catch { /* ignore */ }
  }
}

function runPython(pdfPath: string, outPath: string, started: number): Promise<PaddleOcrResult> {
  return new Promise((resolve, reject) => {
    const py = spawn(PYTHON_BIN, [SCRIPT_PATH, pdfPath, outPath], {
      // PaddleOCR / paddlepaddle / opencv chatter to stdout is
      // discarded — the worker writes its JSON to outPath instead.
      // We keep stderr piped so an early exit (e.g. import error)
      // still gives us a useful message to log.
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    py.stderr.on('data', (d) => { stderr += d.toString(); });

    const killTimer = setTimeout(() => {
      py.kill('SIGKILL');
      reject(new Error(`PaddleOCR timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    py.on('close', (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        // Try to extract the structured error JSON the worker writes
        // to stderr; fall back to the raw stderr tail otherwise.
        let msg = stderr.slice(0, 500);
        try {
          const parsed = JSON.parse(stderr.split('\n').find((l) => l.trim().startsWith('{')) ?? '{}');
          if (parsed.error) msg = parsed.error;
        } catch { /* keep raw msg */ }
        reject(new Error(`PaddleOCR exited ${code}: ${msg}`));
        return;
      }
      if (!existsSync(outPath)) {
        reject(new Error(`PaddleOCR exited 0 but wrote no output file at ${outPath}`));
        return;
      }
      let raw: string;
      try {
        raw = readFileSync(outPath, 'utf-8');
      } catch (e) {
        reject(new Error(`PaddleOCR output read failed: ${(e as Error).message}`));
        return;
      }
      try {
        const parsed = JSON.parse(raw) as { pages?: unknown };
        if (!Array.isArray(parsed.pages)) {
          reject(new Error(`PaddleOCR returned malformed output: ${raw.slice(0, 200)}`));
          return;
        }
        // Two output shapes:
        //   - new: pages = [{ text, width, height, items:[{text,x,y,w}] }]
        //   - old: pages = ["text", ...]  (worker predating coordinate
        //     emission — flatten to text only, items stays empty so the
        //     route falls through to the structurer)
        const pageTexts: string[] = [];
        const items: OcrItem[] = [];
        const pageBoundaries: number[] = [];
        let yOffset = 0;
        for (const p of parsed.pages) {
          pageBoundaries.push(items.length);
          if (typeof p === 'string') {
            // Old worker — no coordinates; use the joined text as-is.
            pageTexts.push(p);
            continue;
          }
          const page = (p ?? {}) as { text?: unknown; width?: unknown; height?: unknown; items?: unknown };
          const pageHeight = typeof page.height === 'number' && page.height > 0 ? page.height : 0;
          // Collect this page's positioned tokens (page-relative y for
          // the column renderer; flattened y for the global `items`).
          const pageOcrItems: OcrItem[] = [];
          if (Array.isArray(page.items)) {
            for (const it of page.items as Array<Record<string, unknown>>) {
              if (!it || typeof it.text !== 'string' || !it.text.trim()) continue;
              const x = typeof it.x === 'number' ? it.x : 0;
              const y = typeof it.y === 'number' ? it.y : 0;
              const w = typeof it.w === 'number' ? it.w : 0;
              pageOcrItems.push({ text: it.text, x, y, width: w });
              items.push({ text: it.text, x, y: yOffset + y, width: w });
            }
          }
          // Column-aligned text (preserves Withdrawal/Deposit columns so
          // the structurer reads direction correctly) when we have
          // coordinates; else fall back to the worker's joined text.
          pageTexts.push(
            pageOcrItems.length > 0
              ? renderColumnAlignedPage(pageOcrItems)
              : (typeof page.text === 'string' ? page.text : ''),
          );
          // Continuous y across pages (mirrors extractPdfGrid: page
          // height + small gap). 0-height pages contribute no offset.
          yOffset += pageHeight + 20;
        }
        resolve({
          pages: pageTexts,
          items,
          pageBoundaries,
          pageCount: parsed.pages.length,
          durationMs: Date.now() - started,
        });
      } catch (e) {
        reject(new Error(`PaddleOCR JSON parse failed: ${(e as Error).message}`));
      }
    });

    py.on('error', (err) => {
      clearTimeout(killTimer);
      const isMissingPython = (err as NodeJS.ErrnoException).code === 'ENOENT';
      reject(new Error(
        isMissingPython
          ? `Python binary "${PYTHON_BIN}" not found. Install Python 3 and PaddleOCR (see scripts/install-paddle-ocr.sh).`
          : `PaddleOCR spawn failed: ${err.message}`,
      ));
    });
  });
}

/**
 * Quick health-check used at boot or in an admin endpoint to confirm
 * PaddleOCR is wired up. Imports BOTH paddleocr and pdf2image — the
 * worker needs both, and a server with only paddleocr installed
 * passes an import-paddleocr-only check and then dies at page-
 * rasterization time on every upload (observed 2026-06-12: every
 * "OCR" upload silently fell back to vision because pdf2image was
 * missing). Does NOT touch any PDFs.
 */
export async function checkPaddleOcrAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const py = spawn(PYTHON_BIN, ['-c', 'import paddleocr, pdf2image'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    py.on('close', (code) => resolve(code === 0));
    py.on('error', () => resolve(false));
  });
}
