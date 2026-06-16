/**
 * Vector store for the semantic classification tier (EXPERIMENTAL).
 *
 * Stores per-firm BGE-small embeddings of categorized narrations so a
 * new row that's semantically close to a past correction inherits its
 * category — even when the exact fingerprint differs. This is the
 * "continuous learning" layer: a correction is ONE appended row,
 * applied to the next statement instantly, with no model retraining.
 *
 * Scoped by billing_user_id like learned_classifications — a firm's CAs
 * share the same vector memory.
 *
 * Vectors are 384 × float32, L2-normalized, stored as a 1536-byte BLOB
 * so cosine similarity is a plain dot product at read time.
 */
import crypto from 'crypto';
import db from '../index.js';

export type DirectionScope = 'credit' | 'debit' | 'either';

export interface EmbeddingRecord {
  vec: Float32Array;
  category: string;
  subcategory: string | null;
  direction: DirectionScope;
}

const stmts = {
  upsert: db.prepare(
    `INSERT INTO learned_embeddings
       (id, billing_user_id, fingerprint, sample_narration, vec, category, subcategory, direction_scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(billing_user_id, fingerprint, direction_scope) DO UPDATE SET
       vec = excluded.vec,
       category = excluded.category,
       subcategory = excluded.subcategory,
       sample_narration = excluded.sample_narration`,
  ),
  listByUser: db.prepare(
    `SELECT vec, category, subcategory, direction_scope
       FROM learned_embeddings WHERE billing_user_id = ?`,
  ),
  countByUser: db.prepare(
    `SELECT COUNT(*) AS n FROM learned_embeddings WHERE billing_user_id = ?`,
  ),
};

function vecToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function bufferToVec(buf: Buffer): Float32Array {
  // Copy out of the (possibly shared/larger) sqlite-returned buffer into
  // a standalone Float32Array so callers own their memory.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

export const learnedEmbeddingsRepo = {
  /** Insert or replace the embedding for (firm, fingerprint, direction). */
  append(rec: {
    billingUserId: string;
    fingerprint: string;
    sampleNarration: string | null;
    vec: Float32Array;
    category: string;
    subcategory: string | null;
    direction: DirectionScope;
  }): void {
    stmts.upsert.run(
      crypto.randomBytes(16).toString('hex'),
      rec.billingUserId,
      rec.fingerprint,
      rec.sampleNarration,
      vecToBuffer(rec.vec),
      rec.category,
      rec.subcategory,
      rec.direction,
    );
  },

  /** All embeddings for a firm, ready for in-memory nearest-neighbour. */
  loadForUser(billingUserId: string): EmbeddingRecord[] {
    const rows = stmts.listByUser.all(billingUserId) as Array<{
      vec: Buffer;
      category: string;
      subcategory: string | null;
      direction_scope: DirectionScope;
    }>;
    return rows.map((r) => ({
      vec: bufferToVec(r.vec),
      category: r.category,
      subcategory: r.subcategory,
      direction: r.direction_scope,
    }));
  },

  countForUser(billingUserId: string): number {
    return (stmts.countByUser.get(billingUserId) as { n: number }).n;
  },
};
