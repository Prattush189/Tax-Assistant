/**
 * CPU sentence embedder for the semantic classification tier.
 *
 * Wraps transformers.js (@huggingface/transformers) running BGE-small
 * (33M params, 384-dim) via onnxruntime-node, int8-quantized. Runs on
 * CPU — no GPU — and is loaded LAZILY: the heavy `@huggingface/
 * transformers` module is `import()`-ed only on the first embed call,
 * which is gated behind an admin + env flag. So importing this file is
 * cheap and a missing/broken native binary can never crash server
 * startup — it just makes the (already-optional) semantic tier no-op.
 *
 * Vectors are mean-pooled and L2-normalized, so cosine similarity is a
 * plain dot product (see semanticTier.bestMatch).
 */
import path from 'node:path';

// Model + cache. The cache dir is persistent (outside node_modules) so
// `npm install` on deploy doesn't wipe the ~30MB int8 download and force
// a re-fetch from the HF hub on the next admin upload.
const MODEL_ID = process.env.EMBED_MODEL ?? 'Xenova/bge-small-en-v1.5';
const CACHE_DIR = process.env.MODELS_CACHE_DIR ?? path.join(process.cwd(), '.models-cache');

export const EMBED_DIM = 384;

// Loaded once, lazily. The `any`-typed extractor avoids leaking
// transformers.js types across the codebase (and keeps tsc happy even
// before the dep is installed on a given machine).
let extractorPromise: Promise<(texts: string[], opts: object) => Promise<{ data: Float32Array }>> | null = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const tf = await import('@huggingface/transformers');
      tf.env.cacheDir = CACHE_DIR;
      tf.env.allowRemoteModels = true;
      // int8 (q8) keeps the resident footprint ~150MB and is plenty
      // precise for nearest-neighbour matching of short narrations.
      const extractor = await tf.pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
      return extractor as unknown as (texts: string[], opts: object) => Promise<{ data: Float32Array }>;
    })().catch((err) => {
      // Reset so a transient failure (e.g. first-run hub download blip)
      // can retry on the next call instead of being cached forever.
      extractorPromise = null;
      throw err;
    });
  }
  return extractorPromise;
}

/**
 * Embed a batch of texts → one L2-normalized Float32Array (length 384)
 * per input. Empty input short-circuits. Throws if the model can't load
 * (callers MUST catch and fall through to their non-semantic path).
 */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const out = await extractor(texts, { pooling: 'mean', normalize: true });
  const flat = out.data; // Float32Array of length texts.length * EMBED_DIM
  const dim = flat.length / texts.length;
  const vecs: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    // .slice() copies into a fresh buffer (byteOffset 0) so each vector
    // owns its memory — safe to store as a BLOB later.
    vecs.push(flat.slice(i * dim, (i + 1) * dim));
  }
  return vecs;
}

/** Convenience single-text embed. */
export async function embedOne(text: string): Promise<Float32Array> {
  const [v] = await embedTexts([text]);
  return v;
}

/** Optional warm-up (e.g. on first admin request) so the first real
 *  embed doesn't pay the model-load latency. Best-effort. */
export async function warmEmbedder(): Promise<void> {
  await getExtractor();
}
