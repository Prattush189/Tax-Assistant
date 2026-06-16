/**
 * CLI export of the deduped payee list for a labeling pass (the admin
 * page has a Download button that does the same thing). Writes JSON with
 * empty label / confidence / needs_human fields for the labeler to fill;
 * the companion import reads the labeled file back.
 *
 * PRIVACY: contains payee names. The output file is gitignored — keep it
 * local.
 *
 * Usage (on the server, with the prod DB):
 *   DB_PATH=/var/lib/tax-assistant/tax-assistant.db \
 *     npx tsx server/scripts/export-payees-for-review.ts --min-count 5 --out payees-review.json
 *   # --min-count 5 → ~830 recurring payees (~29% of volume), good first batch
 *   # --min-count 1 → all ~9,418 distinct payees (the full long tail)
 */
import fs from 'node:fs';
import { buildPayeeReview } from '../lib/payeeExport.js';

const argv = process.argv;
const get = (flag: string, def: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : def; };
const minCount = parseInt(get('--min-count', '5'), 10);
const out = get('--out', 'payees-review.json');

const data = buildPayeeReview(minCount);
fs.writeFileSync(out, JSON.stringify(data, null, 2));
const covered = data.reduce((a, b) => a + b.count, 0);
console.log(`Wrote ${data.length} distinct payees (>=${minCount}x) to ${out} — covering ${covered} rows.`);
