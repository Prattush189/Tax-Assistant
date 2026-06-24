/**
 * Semantic classification tier (PUBLIC — on for every firm by default).
 *
 * Sits between the exact learned-rules table and the AI call. For a row
 * the exact fingerprint match missed, it finds the nearest past
 * correction in the firm's embedding index (learnedEmbeddingsRepo) and,
 * if it's close enough, reuses that category. This generalizes the
 * learned-rules layer from exact-string to semantic match WITHOUT
 * retraining — the "learning" is just appending a vector on each
 * correction.
 *
 * Gating: ON for all firms. Self-limiting — a firm with an empty
 * embedding index is a no-op, so it costs nothing until that firm has
 * corrections to match against, and the index self-populates as users
 * correct rows (appendCorrectionEmbedding). Kill-switch: set
 * SEMANTIC_TIER=0 to disable globally. Threshold is conservative by
 * default (high precision) and tunable via SEMANTIC_TIER_THRESHOLD.
 */
import { learnedEmbeddingsRepo, type EmbeddingRecord, type DirectionScope } from '../db/repositories/learnedEmbeddingsRepo.js';
import { embedTexts } from './embedder.js';

// Cosine cutoff for a confident match. We embed the noise-stripped
// FINGERPRINT, so a true same-payee near-duplicate ("ACME DISTRIBUTORS"
// vs "ACME DISTRIBUTORS MUMBAI") scores ~0.9+, while different payees
// (zomato vs swiggy ≈ 0.49 in the smoke test) sit well below. 0.88
// defaults to high precision — a miss just falls through to the AI call
// (no regression); a false match would persist a wrong category, so we
// bias toward precision. Tune via SEMANTIC_TIER_THRESHOLD after observing.
export const SEMANTIC_THRESHOLD = (() => {
  const v = parseFloat(process.env.SEMANTIC_TIER_THRESHOLD ?? '');
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.88;
})();

/** On for ALL firms by default — the local model is public. Set
 *  `SEMANTIC_TIER=0` to disable globally (kill-switch). Self-limiting: a
 *  firm with an empty embedding index is a no-op, so this costs nothing
 *  until that firm has corrections to match against. (Was admin + env
 *  gated during the test phase; now public.) */
export function semanticTierEnabledFor(_billingUserId: string): boolean {
  return process.env.SEMANTIC_TIER !== '0';
}

export interface SemanticMatch {
  category: string;
  subcategory: string | null;
  score: number;
}

/**
 * Nearest-neighbour cosine match within a firm's index, restricted to
 * rules whose direction matches the row (or 'either'). Vectors are
 * pre-normalized, so cosine === dot product. Returns null below
 * threshold. O(index × 384) — sub-millisecond for thousands of vectors.
 */
export function bestMatch(
  query: Float32Array,
  index: EmbeddingRecord[],
  direction: 'credit' | 'debit',
  threshold = SEMANTIC_THRESHOLD,
): SemanticMatch | null {
  let best: SemanticMatch | null = null;
  for (const rec of index) {
    if (rec.direction !== 'either' && rec.direction !== direction) continue;
    const v = rec.vec;
    let dot = 0;
    for (let i = 0; i < v.length; i++) dot += v[i] * query[i];
    if (dot >= threshold && (!best || dot > best.score)) {
      best = { category: rec.category, subcategory: rec.subcategory, score: dot };
    }
  }
  return best;
}

/**
 * Append a single correction to the firm's vector memory. Embeds the
 * fingerprint (falling back to the raw narration) and upserts. Called
 * fire-and-forget from the reassign endpoint — best-effort, so callers
 * should `.catch()` and ignore failures.
 */
export async function appendCorrectionEmbedding(opts: {
  billingUserId: string;
  fingerprint: string;
  narration: string;
  category: string;
  subcategory: string | null;
  direction: DirectionScope;
}): Promise<void> {
  const text = opts.fingerprint || opts.narration.slice(0, 256);
  if (!text.trim()) return;
  const [vec] = await embedTexts([text]);
  if (!vec) return;
  learnedEmbeddingsRepo.append({
    billingUserId: opts.billingUserId,
    fingerprint: opts.fingerprint,
    sampleNarration: opts.narration.slice(0, 200),
    vec,
    category: opts.category,
    subcategory: opts.subcategory,
    direction: opts.direction,
  });
}
