/** Smoke-test the semantic-tier embedder: does it load, produce
 *  normalized 384-dim vectors, and score same-payee narrations higher
 *  than unrelated ones? Downloads the int8 model (~30MB) on first run.
 *
 *  Run: npx tsx scripts/smoke-embedder.mts
 */
import { embedTexts, EMBED_DIM } from '../server/lib/embedder.ts';

const cos = (a: Float32Array, b: Float32Array) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
};

const texts = [
  'avinash mehra',                       // 0
  'avinash kumar mehra hdfc',            // 1  same payee, different narration
  'zomato online ltd',                   // 2
  'swiggy bundl technologies',           // 3
  'interest paid by bank',               // 4
];

console.log('loading model + embedding…');
const v = await embedTexts(texts);

console.log(`dim=${v[0].length} (expected ${EMBED_DIM})`);
console.log(`||v0|| = ${Math.sqrt(cos(v[0], v[0])).toFixed(4)} (expected ~1.0 — normalized)`);
console.log('');
console.log(`mehra  vs mehra-variant : ${cos(v[0], v[1]).toFixed(3)}   ← expect HIGH (same payee)`);
console.log(`mehra  vs zomato        : ${cos(v[0], v[2]).toFixed(3)}   ← expect LOW`);
console.log(`mehra  vs interest      : ${cos(v[0], v[4]).toFixed(3)}   ← expect LOW`);
console.log(`zomato vs swiggy        : ${cos(v[2], v[3]).toFixed(3)}   ← both food, expect MID`);

const pass = v[0].length === EMBED_DIM
  && cos(v[0], v[1]) > 0.80
  && cos(v[0], v[1]) > cos(v[0], v[2]) + 0.15;
console.log(`\n${pass ? '[PASS]' : '[FAIL]'} same-payee clearly beats unrelated`);
if (!pass) process.exit(1);
