/**
 * Smoke test for the ITR validator pipeline: schema validation, business
 * rules, digest, and creation-info stamping.
 * Run: npx tsx server/scripts/test-itr-validator.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateItr1 } from '../lib/itr/validator.js';
import { runBusinessRules } from '../lib/itr/businessRules.js';
import { buildCreationInfo } from '../lib/itr/creationInfo.js';
import { stampDigest, computeDigest } from '../lib/itr/digest.js';
import { STATES } from '../lib/itr/enums/states.js';
import { COUNTRIES } from '../lib/itr/enums/countries.js';
import { NATURE_OF_BUSINESS } from '../lib/itr/enums/natureOfBusiness.js';
import { TDS_SECTIONS } from '../lib/itr/enums/sections.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturePath = path.join(
  __dirname,
  '..',
  'lib',
  'itr',
  '__fixtures__',
  'itr1-minimal.json',
);

const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

// --- Positive test: hand-crafted fixture should be valid
const positive = validateItr1(fixture);
if (!positive.valid) {
  console.error('[test-itr-validator] ✗ POSITIVE: ITR-1 fixture is INVALID');
  for (const err of positive.errors.slice(0, 40)) {
    console.error(`  - ${err.path}: ${err.message} ${JSON.stringify(err.params ?? {})}`);
  }
  process.exit(1);
}
console.log('[test-itr-validator] ✓ POSITIVE: ITR-1 fixture is VALID');

// --- Negative test: delete a required top-level section, expect failure
const broken = JSON.parse(JSON.stringify(fixture));
delete broken.ITR.ITR1.Verification;
const negative = validateItr1(broken);
if (negative.valid) {
  console.error(
    '[test-itr-validator] ✗ NEGATIVE: removed Verification but validator still passed',
  );
  process.exit(1);
}
const mentionsVerification = negative.errors.some((e) =>
  (e.message + JSON.stringify(e.params ?? {})).toLowerCase().includes('verification'),
);
if (!mentionsVerification) {
  console.error(
    '[test-itr-validator] ✗ NEGATIVE: validator failed but did not mention Verification',
  );
  for (const err of negative.errors.slice(0, 10)) {
    console.error(`  - ${err.path}: ${err.message} ${JSON.stringify(err.params ?? {})}`);
  }
  process.exit(1);
}
console.log(
  `[test-itr-validator] ✓ NEGATIVE: missing Verification surfaced (${negative.errors.length} error(s))`,
);

// --- Business rules: fixture should have no blocking BR violations
const brViolations = runBusinessRules('ITR1', fixture);
const blocking = brViolations.filter((v) => v.severity === 'error');
if (blocking.length > 0) {
  console.error('[test-itr-validator] ✗ BUSINESS RULES: fixture hit blocking rules:');
  for (const v of blocking) console.error(`  - ${v.ruleId}: ${v.message}`);
  process.exit(1);
}
console.log(`[test-itr-validator] ✓ BUSINESS RULES: 0 blocking, ${brViolations.length} total`);

// --- Business rules: craft a violation (80C > 150k) and expect BR-80C-CAP
const badBR = JSON.parse(JSON.stringify(fixture));
badBR.ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80C = 200000;
const brBad = runBusinessRules('ITR1', badBR);
if (!brBad.some((v) => v.ruleId === 'BR-80C-CAP')) {
  console.error('[test-itr-validator] ✗ BR-80C-CAP did not fire for Section80C=200000');
  process.exit(1);
}
console.log('[test-itr-validator] ✓ BR-80C-CAP fired for over-cap 80C');

// --- Digest: stamp and re-verify
const stamped = stampDigest(JSON.parse(JSON.stringify(fixture)));
const digest = stamped.ITR.ITR1.CreationInfo.Digest;
if (typeof digest !== 'string' || digest.length !== 44) {
  console.error(`[test-itr-validator] ✗ DIGEST: expected 44-char base64, got ${String(digest).length} chars`);
  process.exit(1);
}
// Re-stamping should be deterministic
const re = stampDigest(JSON.parse(JSON.stringify(stamped)));
if (re.ITR.ITR1.CreationInfo.Digest !== digest) {
  console.error('[test-itr-validator] ✗ DIGEST: re-stamp produced a different value (non-deterministic)');
  process.exit(1);
}
console.log(`[test-itr-validator] ✓ DIGEST: ${digest}`);

// Stamped fixture should still be schema-valid (Digest pattern allows 44 chars)
const stampedValid = validateItr1(stamped);
if (!stampedValid.valid) {
  console.error('[test-itr-validator] ✗ STAMPED: post-stamp fixture failed schema validation:');
  for (const e of stampedValid.errors.slice(0, 5)) console.error(`  - ${e.path}: ${e.message}`);
  process.exit(1);
}
console.log('[test-itr-validator] ✓ STAMPED: post-digest fixture still schema-valid');

// --- CreationInfo helper
const ci = buildCreationInfo({ swId: 'SW12345678' });
if (ci.SWCreatedBy !== 'SW12345678' || !/^\d{4}-\d{2}-\d{2}$/.test(ci.JSONCreationDate)) {
  console.error('[test-itr-validator] ✗ CreationInfo helper returned unexpected fields:', ci);
  process.exit(1);
}
console.log('[test-itr-validator] ✓ CreationInfo: SWCreatedBy + date format OK');

// --- Enums sanity
const ENUM_COUNTS: Array<[string, number, readonly unknown[]]> = [
  ['STATES', 38, STATES],
  ['COUNTRIES', 200, COUNTRIES],
  ['NATURE_OF_BUSINESS', 300, NATURE_OF_BUSINESS],
  ['TDS_SECTIONS', 40, TDS_SECTIONS],
];
for (const [name, min, arr] of ENUM_COUNTS) {
  if (arr.length < min) {
    console.error(`[test-itr-validator] ✗ ENUM ${name}: expected ≥${min} entries, got ${arr.length}`);
    process.exit(1);
  }
}
console.log(
  `[test-itr-validator] ✓ ENUMS: ${STATES.length} states, ${COUNTRIES.length} countries, ${NATURE_OF_BUSINESS.length} NoB, ${TDS_SECTIONS.length} sections`,
);

console.log('[test-itr-validator] all checks passed');
process.exit(0);
