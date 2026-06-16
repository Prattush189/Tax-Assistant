/** End-to-end smoke for the semantic tier: embed → store as BLOB →
 *  load back → nearest-neighbour match. Proves the Float32Array↔BLOB
 *  round-trip is lossless and bestMatch picks the right category.
 *
 *  Run: npx tsx scripts/smoke-semantic-tier.mts
 */
import os from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(os.tmpdir(), 'tagging-test-seed.db');

const dbMod = await import('../server/db/index.ts');
const db = dbMod.default;
const { embedTexts } = await import('../server/lib/embedder.ts');
const { learnedEmbeddingsRepo } = await import('../server/db/repositories/learnedEmbeddingsRepo.ts');
const { bestMatch } = await import('../server/lib/semanticTier.ts');

const cos = (a: Float32Array, b: Float32Array) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; };

// FK requires a real user id — borrow one from the seed DB.
const u = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
if (!u) { console.error('seed DB has no users'); process.exit(1); }
const FIRM = u.id;
const FPS = ['acme distributors', 'reliance fresh grocery', 'salary infosys'];

// clean any prior test rows for these fingerprints
db.prepare(`DELETE FROM learned_embeddings WHERE billing_user_id = ? AND fingerprint IN (${FPS.map(() => '?').join(',')})`).run(FIRM, ...FPS);

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`); };

console.log('embedding + storing 3 taught rules…');
const seed = await embedTexts(FPS);
learnedEmbeddingsRepo.append({ billingUserId: FIRM, fingerprint: FPS[0], sampleNarration: 'ACME DISTRIBUTORS', vec: seed[0], category: 'Inventory Purchase', subcategory: null, direction: 'debit' });
learnedEmbeddingsRepo.append({ billingUserId: FIRM, fingerprint: FPS[1], sampleNarration: 'RELIANCE FRESH', vec: seed[1], category: 'Personal', subcategory: null, direction: 'debit' });
learnedEmbeddingsRepo.append({ billingUserId: FIRM, fingerprint: FPS[2], sampleNarration: 'SALARY', vec: seed[2], category: 'Salary', subcategory: null, direction: 'credit' });

const index = learnedEmbeddingsRepo.loadForUser(FIRM).filter(r => true);
const acme = index.find(r => r.category === 'Inventory Purchase')!;
check('BLOB round-trip lossless', cos(acme.vec, seed[0]) > 0.9999, `cos=${cos(acme.vec, seed[0]).toFixed(5)}`);

// near-duplicate of a taught debit → should inherit its category
const [q1] = await embedTexts(['acme distributors mumbai']);
const m1 = bestMatch(q1, index, 'debit', 0.85);
check('near-dup matches taught category', m1?.category === 'Inventory Purchase', `→ ${m1?.category} (${m1?.score.toFixed(3)})`);

// direction filter: same text but as a CREDIT must NOT match the debit rule
const m2 = bestMatch(q1, index, 'credit', 0.85);
check('direction filter excludes wrong-side match', m2 === null, `→ ${m2 ? m2.category : 'null'}`);

// unrelated payee → no match
const [q3] = await embedTexts(['xyz unknown random payee 999']);
const m3 = bestMatch(q3, index, 'debit', 0.85);
check('unrelated payee → null', m3 === null, `→ ${m3 ? m3.category : 'null'}`);

// cleanup
db.prepare(`DELETE FROM learned_embeddings WHERE billing_user_id = ? AND fingerprint IN (${FPS.map(() => '?').join(',')})`).run(FIRM, ...FPS);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
