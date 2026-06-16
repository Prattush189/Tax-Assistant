/**
 * Seed the semantic-tier vector index (learned_embeddings) from a firm's
 * EXISTING learned_classifications — so the experimental semantic tier
 * has data to match against immediately, instead of starting empty and
 * only growing as new corrections come in.
 *
 * Scope: one firm at a time, resolved from an admin's email (or a raw
 * billing-user id). Only admin firms are eligible — the tier is
 * admin-gated, so seeding a non-admin firm would be dead weight.
 *
 * Usage (on the server, with the prod DB):
 *   DB_PATH=/var/lib/tax-assistant/tax-assistant.db \
 *     npx tsx server/scripts/backfill-embeddings.ts --email you@example.com
 *   # or:  --billing <billing_user_id>
 *
 * Idempotent: re-running upserts the same (firm, fingerprint, direction)
 * rows, so it's safe to run after teaching new rules.
 */
import db from '../db/index.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { getBillingUser } from '../lib/billing.js';
import { embedTexts } from '../lib/embedder.js';
import { learnedEmbeddingsRepo, type DirectionScope } from '../db/repositories/learnedEmbeddingsRepo.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('--email');
  const billingArg = arg('--billing');

  let billingUserId: string;
  if (billingArg) {
    billingUserId = billingArg;
  } else if (email) {
    const user = userRepo.findByIdentifier(email);
    if (!user) { console.error(`No user found for ${email}`); process.exit(1); }
    if (user.role !== 'admin') {
      console.error(`User ${email} is role='${user.role}', not admin — the semantic tier is admin-gated. Aborting.`);
      process.exit(1);
    }
    billingUserId = getBillingUser(user).id;
  } else {
    console.error('Pass --email <admin email> or --billing <billing_user_id>');
    process.exit(1);
  }

  const rules = db.prepare(
    `SELECT fingerprint, category, subcategory, direction_scope, sample_narration
       FROM learned_classifications
      WHERE billing_user_id = ? AND disabled_at IS NULL`,
  ).all(billingUserId) as Array<{
    fingerprint: string;
    category: string;
    subcategory: string | null;
    direction_scope: DirectionScope;
    sample_narration: string | null;
  }>;

  console.log(`Firm ${billingUserId}: ${rules.length} learned rules to embed.`);
  if (rules.length === 0) {
    console.log('Nothing to backfill. Teach some rules first (correct a row → "remember").');
    return;
  }

  // Embed all fingerprints in one batch, then upsert each.
  const texts = rules.map((r) => r.fingerprint || r.sample_narration || '');
  console.log('Embedding (loads the model on first run, ~30MB download)…');
  const vecs = await embedTexts(texts);

  let written = 0;
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (!texts[i].trim()) continue;
    learnedEmbeddingsRepo.append({
      billingUserId,
      fingerprint: r.fingerprint,
      sampleNarration: r.sample_narration,
      vec: vecs[i],
      category: r.category,
      subcategory: r.subcategory,
      direction: r.direction_scope,
    });
    written++;
  }

  console.log(`Done. ${written} embeddings written. Firm index now holds ${learnedEmbeddingsRepo.countForUser(billingUserId)} vectors.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
