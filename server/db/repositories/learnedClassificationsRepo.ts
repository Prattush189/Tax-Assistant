/**
 * Per-firm memory layer for bank-statement classification.
 *
 * When the user corrects a row's category and explicitly chooses to
 * remember it, we store a `(billing_user_id, fingerprint, direction)`
 * mapping here. The classifier checks this table BEFORE the
 * deterministic anchors and AI fallback — so the firm gradually
 * teaches the system its own recurring counterparties without
 * re-explaining them every statement.
 *
 * Scope: `billing_user_id` (not `user_id`) — CAs in the same firm
 * share learned rules. Pratik teaches "ACME DISTRIBUTORS = Inventory
 * Purchase" once, Riya benefits on her next upload.
 *
 * Soft-delete: disabled rules stay in the table (visible on the
 * management page so the user can re-enable). Hard-delete only on
 * explicit user action via deleteById.
 */
import crypto from 'crypto';
import db from '../index.js';

export type DirectionScope = 'credit' | 'debit' | 'either';

export interface LearnedClassificationRow {
  id: string;
  billing_user_id: string;
  fingerprint: string;
  category: string;
  subcategory: string | null;
  direction_scope: DirectionScope;
  sample_narration: string | null;
  hit_count: number;
  created_by_user_id: string | null;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
  last_applied_at: string | null;
}

export interface UpsertInput {
  billingUserId: string;
  fingerprint: string;
  category: string;
  subcategory: string | null;
  directionScope: DirectionScope;
  sampleNarration: string | null;
  createdByUserId: string;
}

const stmts = {
  // Hot path: classifier lookup. Returns the active rule for this
  // fingerprint on this direction (or 'either'). 'either' rules are a
  // valid fallback when no direction-specific rule exists — ORDER BY
  // ensures direction-specific wins over 'either' when both exist.
  lookupForClassify: db.prepare(`
    SELECT * FROM learned_classifications
    WHERE billing_user_id = ?
      AND fingerprint = ?
      AND disabled_at IS NULL
      AND (direction_scope = ? OR direction_scope = 'either')
    ORDER BY (direction_scope = 'either') ASC
    LIMIT 1
  `),

  // Management page list. Includes disabled rules so the user can
  // re-enable them; UI filters by status when needed.
  listForBillingUser: db.prepare(`
    SELECT lc.*, u.name AS created_by_name
    FROM learned_classifications lc
    LEFT JOIN users u ON u.id = lc.created_by_user_id
    WHERE lc.billing_user_id = ?
    ORDER BY lc.updated_at DESC
  `),

  findById: db.prepare(
    'SELECT * FROM learned_classifications WHERE id = ? AND billing_user_id = ?'
  ),

  // Find an EXISTING active rule for the same (billing_user, fingerprint,
  // direction). Used by upsert to decide insert vs update. Direction
  // 'either' collides with both 'credit' and 'debit' specific rules
  // (matched by the unique partial index), so we explicitly check both.
  findActive: db.prepare(`
    SELECT * FROM learned_classifications
    WHERE billing_user_id = ?
      AND fingerprint = ?
      AND direction_scope = ?
      AND disabled_at IS NULL
    LIMIT 1
  `),

  insert: db.prepare(`
    INSERT INTO learned_classifications (
      id, billing_user_id, fingerprint, category, subcategory,
      direction_scope, sample_narration, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),

  // Update existing rule's category/subcategory/sample. Bumps
  // updated_at; does NOT reset hit_count (history preserved).
  updateRule: db.prepare(`
    UPDATE learned_classifications
       SET category = ?,
           subcategory = ?,
           sample_narration = COALESCE(?, sample_narration),
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ?
       AND billing_user_id = ?
  `),

  // Increment hit_count and stamp last_applied_at. Called from the
  // classifier on every fired rule.
  recordHit: db.prepare(`
    UPDATE learned_classifications
       SET hit_count = hit_count + 1,
           last_applied_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ?
  `),

  // Soft-delete: rule stops applying but stays for potential re-enable.
  disable: db.prepare(`
    UPDATE learned_classifications
       SET disabled_at = datetime('now', '+5 hours', '+30 minutes'),
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ?
       AND billing_user_id = ?
       AND disabled_at IS NULL
  `),

  enable: db.prepare(`
    UPDATE learned_classifications
       SET disabled_at = NULL,
           updated_at = datetime('now', '+5 hours', '+30 minutes')
     WHERE id = ?
       AND billing_user_id = ?
  `),

  deleteById: db.prepare(
    'DELETE FROM learned_classifications WHERE id = ? AND billing_user_id = ?'
  ),

  // Batch counts for the bank-statement response — exposes how many
  // rules a billing user has accumulated so the UI can decide whether
  // to surface a "you have N learned rules" affordance.
  countActiveForBillingUser: db.prepare(`
    SELECT COUNT(*) AS n
    FROM learned_classifications
    WHERE billing_user_id = ?
      AND disabled_at IS NULL
  `),
};

export const learnedClassificationsRepo = {
  /**
   * Returns the active rule whose fingerprint matches AND whose
   * direction_scope applies to this transaction's direction. Used on
   * the classifier hot path; expect dozens of calls per statement.
   * Returns null when no rule applies.
   */
  lookupForClassify(
    billingUserId: string,
    fingerprint: string,
    direction: 'credit' | 'debit',
  ): LearnedClassificationRow | null {
    const row = stmts.lookupForClassify.get(
      billingUserId,
      fingerprint,
      direction,
    ) as LearnedClassificationRow | undefined;
    return row ?? null;
  },

  /**
   * Insert a new rule, or update the existing active rule for the
   * same (billing_user, fingerprint, direction_scope). Idempotent
   * from the caller's perspective.
   *
   * Why upsert instead of plain insert: the user may correct a rule
   * later ("ACME DISTRIBUTORS" was Inventory Purchase, but now it's
   * Travel Expense after the supplier changed business). Second
   * correction should overwrite, not create a duplicate that the
   * unique index would reject.
   */
  upsert(input: UpsertInput): LearnedClassificationRow {
    const existing = stmts.findActive.get(
      input.billingUserId,
      input.fingerprint,
      input.directionScope,
    ) as LearnedClassificationRow | undefined;

    if (existing) {
      stmts.updateRule.run(
        input.category,
        input.subcategory,
        input.sampleNarration,
        existing.id,
        input.billingUserId,
      );
      return stmts.findById.get(existing.id, input.billingUserId) as LearnedClassificationRow;
    }

    const id = crypto.randomBytes(16).toString('hex');
    stmts.insert.run(
      id,
      input.billingUserId,
      input.fingerprint,
      input.category,
      input.subcategory,
      input.directionScope,
      input.sampleNarration,
      input.createdByUserId,
    );
    return stmts.findById.get(id, input.billingUserId) as LearnedClassificationRow;
  },

  /**
   * Fast hit-counter update. Best-effort: if the rule was deleted
   * concurrently the UPDATE is a no-op. Don't throw on miss because
   * a missed hit-count tick doesn't affect correctness.
   */
  recordHit(id: string): void {
    try {
      stmts.recordHit.run(id);
    } catch (err) {
      console.error('[learnedClassificationsRepo] recordHit failed:', err);
    }
  },

  listForBillingUser(
    billingUserId: string,
  ): Array<LearnedClassificationRow & { created_by_name: string | null }> {
    return stmts.listForBillingUser.all(billingUserId) as Array<
      LearnedClassificationRow & { created_by_name: string | null }
    >;
  },

  findById(id: string, billingUserId: string): LearnedClassificationRow | null {
    const row = stmts.findById.get(id, billingUserId) as LearnedClassificationRow | undefined;
    return row ?? null;
  },

  disable(id: string, billingUserId: string): boolean {
    const info = stmts.disable.run(id, billingUserId);
    return info.changes > 0;
  },

  enable(id: string, billingUserId: string): boolean {
    const info = stmts.enable.run(id, billingUserId);
    return info.changes > 0;
  },

  deleteById(id: string, billingUserId: string): boolean {
    const info = stmts.deleteById.run(id, billingUserId);
    return info.changes > 0;
  },

  countActiveForBillingUser(billingUserId: string): number {
    const row = stmts.countActiveForBillingUser.get(billingUserId) as { n: number };
    return row.n;
  },

  /**
   * Bulk-update categories for a list of rule IDs (used by the
   * management page's bulk-reassign action). Runs in a single
   * transaction so partial failures roll back cleanly.
   */
  bulkUpdateCategory(
    billingUserId: string,
    ids: string[],
    category: string,
    subcategory: string | null,
  ): number {
    if (ids.length === 0) return 0;
    const update = db.prepare(`
      UPDATE learned_classifications
         SET category = ?,
             subcategory = ?,
             updated_at = datetime('now', '+5 hours', '+30 minutes')
       WHERE id = ?
         AND billing_user_id = ?
    `);
    const tx = db.transaction((bulkIds: string[]) => {
      let changed = 0;
      for (const id of bulkIds) {
        const info = update.run(category, subcategory, id, billingUserId);
        changed += info.changes;
      }
      return changed;
    });
    return tx(ids);
  },
};
