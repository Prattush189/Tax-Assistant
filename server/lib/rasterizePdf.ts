/**
 * Node wrapper around the Python downsampling rasterizer
 * (server/python/rasterize_worker.py).
 *
 * Purpose — cap Gemini Vision input tokens. Gemini processes PDF/image
 * input AS IMAGES: each page scales up to <=3072x3072 and tiles into
 * 768x768 tiles at 258 tokens/tile, so a full-res dense A4 page costs
 * ~3,000-4,100 input tokens. Sending the raw upload to vision (what the
 * bank-statement route does when PaddleOCR fails/times out) is why some
 * statements burned ~2M tokens. Downsampling each page to
 * VISION_DOWNSAMPLE_MAX_PX on the longest side collapses it to ~4 tiles
 * (~1,000 tokens) — a 3-4x cut — while keeping printed digits legible.
 *
 * Returns one JPEG Buffer per page, in page order. Callers send them to
 * Gemini as separate image parts (geminiVision accepts an array).
 *
 * Reuses the poppler + Pillow install already present for the OCR path,
 * so no new system/npm dependency. Mirrors paddleOcr.ts's spawn +
 * tempfile + timeout + cleanup shape.
 */

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

const PYTHON_BIN = process.env.PADDLE_PYTHON ?? 'python3';
const SCRIPT_PATH = path.resolve(process.cwd(), 'server/python/rasterize_worker.py');

/** Longest-side pixel cap for downsampled pages. ~1200px ≈ 4 Gemini
 *  tiles/page (~1,000 input tokens) — a 3-4x cut vs full-res, digits
 *  still legible. Bump toward 1600 if the vision path starts misreading
 *  balances on dense statements (see plan verification notes). */
export const VISION_DOWNSAMPLE_MAX_PX = 1200;

// Rasterization is fast (no OCR inference) but a big PDF still takes a
// few seconds; 2 min is ample and bounds a hung poppler process.
const RASTERIZE_TIMEOUT_MS = 2 * 60 * 1000;

export interface RasterizedPage {
  /** JPEG bytes for one page, longest side <= VISION_DOWNSAMPLE_MAX_PX. */
  buffer: Buffer;
  mimeType: 'image/jpeg';
}

/**
 * Downsample a PDF (or a single image) into per-page JPEG buffers.
 *
 * @param inputBuffer raw PDF or image bytes
 * @param mimeType    upload mime — decides the tempfile extension so the
 *                    Python side picks the PDF vs image branch
 * @param maxPx       longest-side cap (defaults to VISION_DOWNSAMPLE_MAX_PX)
 *
 * Throws on missing script / Python / poppler / timeout. Callers should
 * catch and fall back to sending the original bytes so an upload never
 * breaks outright when the rasterizer is unavailable.
 */
export async function downsampleForVision(
  inputBuffer: Buffer,
  mimeType: string,
  maxPx: number = VISION_DOWNSAMPLE_MAX_PX,
): Promise<RasterizedPage[]> {
  if (!existsSync(SCRIPT_PATH)) {
    throw new Error(`rasterize worker script missing at ${SCRIPT_PATH}`);
  }
  const tmpDir = path.join(tmpdir(), 'vision-raster');
  mkdirSync(tmpDir, { recursive: true });
  const stem = crypto.randomBytes(8).toString('hex');
  const ext = mimeType === 'application/pdf'
    ? 'pdf'
    : (mimeType.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
  const inPath = path.join(tmpDir, `${stem}.${ext}`);
  const outPath = path.join(tmpDir, `${stem}.json`);
  writeFileSync(inPath, inputBuffer);

  let imagePaths: string[] = [];
  try {
    imagePaths = await runRasterizer(inPath, outPath, maxPx);
    return imagePaths.map((p) => ({
      buffer: readFileSync(p),
      mimeType: 'image/jpeg' as const,
    }));
  } finally {
    try { unlinkSync(inPath); } catch { /* ignore */ }
    try { unlinkSync(outPath); } catch { /* ignore */ }
    for (const p of imagePaths) {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  }
}

function runRasterizer(inPath: string, outPath: string, maxPx: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const py = spawn(PYTHON_BIN, [SCRIPT_PATH, inPath, outPath, String(maxPx)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    py.stderr.on('data', (d) => { stderr += d.toString(); });

    const killTimer = setTimeout(() => {
      py.kill('SIGKILL');
      reject(new Error(`rasterizer timed out after ${RASTERIZE_TIMEOUT_MS}ms`));
    }, RASTERIZE_TIMEOUT_MS);

    py.on('close', (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        let msg = stderr.slice(0, 500);
        try {
          const parsed = JSON.parse(stderr.split('\n').find((l) => l.trim().startsWith('{')) ?? '{}');
          if (parsed.error) msg = parsed.error;
        } catch { /* keep raw msg */ }
        reject(new Error(`rasterizer exited ${code}: ${msg}`));
        return;
      }
      if (!existsSync(outPath)) {
        reject(new Error(`rasterizer exited 0 but wrote no output at ${outPath}`));
        return;
      }
      try {
        const parsed = JSON.parse(readFileSync(outPath, 'utf-8')) as { images?: unknown };
        if (!Array.isArray(parsed.images) || parsed.images.some((p) => typeof p !== 'string')) {
          reject(new Error('rasterizer returned malformed output (no images array)'));
          return;
        }
        resolve(parsed.images as string[]);
      } catch (e) {
        reject(new Error(`rasterizer output parse failed: ${(e as Error).message}`));
      }
    });

    py.on('error', (err) => {
      clearTimeout(killTimer);
      const isMissingPython = (err as NodeJS.ErrnoException).code === 'ENOENT';
      reject(new Error(
        isMissingPython
          ? `Python binary "${PYTHON_BIN}" not found for rasterizer.`
          : `rasterizer spawn failed: ${err.message}`,
      ));
    });
  });
}
