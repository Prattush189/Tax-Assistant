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
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

export interface PaddleOcrResult {
  /** One entry per PDF page, in order. May contain empty strings for
   *  pages PaddleOCR couldn't detect any text on (very rare even for
   *  decorative covers). */
  pages: string[];
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
  const tmpFile = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.pdf`);
  writeFileSync(tmpFile, pdfBuffer);

  const started = Date.now();
  try {
    return await runPython(tmpFile, started);
  } finally {
    try { unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
  }
}

function runPython(pdfPath: string, started: number): Promise<PaddleOcrResult> {
  return new Promise((resolve, reject) => {
    const py = spawn(PYTHON_BIN, [SCRIPT_PATH, pdfPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    py.stdout.on('data', (d) => { stdout += d.toString(); });
    py.stderr.on('data', (d) => { stderr += d.toString(); });

    const killTimer = setTimeout(() => {
      py.kill('SIGKILL');
      reject(new Error(`PaddleOCR timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    py.on('close', (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        // Try to extract the error JSON the worker writes to stderr
        // before falling back to the raw stderr tail.
        let msg = stderr.slice(0, 500);
        try {
          const parsed = JSON.parse(stderr.split('\n').find((l) => l.trim().startsWith('{')) ?? '{}');
          if (parsed.error) msg = parsed.error;
        } catch { /* keep raw msg */ }
        reject(new Error(`PaddleOCR exited ${code}: ${msg}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { pages?: unknown };
        if (!Array.isArray(parsed.pages)) {
          reject(new Error(`PaddleOCR returned malformed output: ${stdout.slice(0, 200)}`));
          return;
        }
        resolve({
          pages: parsed.pages.map((p) => (typeof p === 'string' ? p : '')),
          durationMs: Date.now() - started,
        });
      } catch (e) {
        reject(new Error(`PaddleOCR JSON parse failed: ${(e as Error).message}`));
      }
    });

    py.on('error', (err) => {
      clearTimeout(killTimer);
      // ENOENT here means PYTHON_BIN doesn't exist on the host — the
      // most common failure mode on a fresh VPS. Phrase the message
      // so the operator immediately knows what to install.
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
 * PaddleOCR is wired up. Spawns Python with `-c 'import paddleocr'`
 * and returns true if it exits 0. Does NOT touch any PDFs.
 */
export async function checkPaddleOcrAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const py = spawn(PYTHON_BIN, ['-c', 'import paddleocr'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    py.on('close', (code) => resolve(code === 0));
    py.on('error', () => resolve(false));
  });
}
