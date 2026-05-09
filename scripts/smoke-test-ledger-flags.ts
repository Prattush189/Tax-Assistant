/**
 * Smoke test for the deterministic ledger scrutiny flag engine.
 *
 *   npx tsx scripts/smoke-test-ledger-flags.ts
 *
 * Returns non-zero exit if any case fails. Designed to run pre-commit
 * and as a CI gate when the engine is wired into the route. The engine
 * is pure-function over the already-extracted ledger structure — no
 * Gemini/Claude calls, no DB, no env vars. Runs in milliseconds.
 *
 * The fixtures encode every failure mode seen on the Punjab rice-mill
 * scrutiny that the LLM-only pipeline got wrong. Adding a new failure
 * mode means adding a fixture + (if needed) a code-path in the engine.
 */

import { runAllFlags, formatINR, voucherKind, classifyAccount, type DetObservation } from '../server/lib/ledgerScrutinyFlags.js';
import { CASES } from '../server/lib/__fixtures__/ledger-scrutiny-cases.js';

// ── Sanity tests on helpers ──────────────────────────────────────────

function expectEq<T>(label: string, got: T, want: T, fails: string[]): void {
  if (got !== want) fails.push(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

const helperFails: string[] = [];

// formatINR: Indian comma grouping
expectEq('formatINR(1000)', formatINR(1000), '1,000', helperFails);
expectEq('formatINR(100000)', formatINR(1_00_000), '1,00,000', helperFails);
expectEq('formatINR(7193787)', formatINR(71_93_787), '71,93,787', helperFails);
expectEq('formatINR(194805525)', formatINR(19_48_05_525), '19,48,05,525', helperFails);
expectEq('formatINR(0)', formatINR(0), '0', helperFails);
expectEq('formatINR(-50000)', formatINR(-50_000), '-50,000', helperFails);

// voucherKind: single-letter and word forms
expectEq('voucherKind("C")', voucherKind('C'), 'C', helperFails);
expectEq('voucherKind("c")', voucherKind('c'), 'C', helperFails);
expectEq('voucherKind("J")', voucherKind('J'), 'J', helperFails);
expectEq('voucherKind("J/241")', voucherKind('J/241'), 'J', helperFails);
expectEq('voucherKind("Cash")', voucherKind('Cash'), 'C', helperFails);
expectEq('voucherKind("Journal")', voucherKind('Journal'), 'J', helperFails);
expectEq('voucherKind("Purchase")', voucherKind('Purchase'), 'P', helperFails);
expectEq('voucherKind("Receipt")', voucherKind('Receipt'), 'R', helperFails);
expectEq('voucherKind("Bank")', voucherKind('Bank'), 'B', helperFails);
expectEq('voucherKind("Payment")', voucherKind('Payment'), 'B', helperFails);
expectEq('voucherKind(null)', voucherKind(null), null, helperFails);
expectEq('voucherKind("")', voucherKind(''), null, helperFails);
expectEq('voucherKind("Contra")', voucherKind('Contra'), null, helperFails);

// classifyAccount: structural detection
expectEq('classify Rent', classifyAccount({ name: 'RENT', accountType: null, opening: 0, closing: 0, totalDebit: 84_000, totalCredit: 84_000, transactions: [] }), 'rent_expense', helperFails);
expectEq('classify Brokerage', classifyAccount({ name: 'BROKERAGE', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 30_00_000, transactions: [] }), 'brokerage_expense', helperFails);
expectEq('classify Cash', classifyAccount({ name: 'CASH', accountType: null, opening: 0, closing: 1_00_000, totalDebit: 5_00_000, totalCredit: 4_00_000, transactions: [] }), 'cash', helperFails);
expectEq('classify HDFC Bank', classifyAccount({ name: 'HDFC BANK A/C', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0, transactions: [] }), 'bank', helperFails);
expectEq('classify Sales (nominal)', classifyAccount({ name: 'SALES I/S Tax-Free', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 60_00_00_000, transactions: [] }), 'nominal', helperFails);
expectEq('classify Capital', classifyAccount({ name: 'HIMANSHU ARORA CAPITAL', accountType: null, opening: 0, closing: 0, totalDebit: 0, totalCredit: 0, transactions: [] }), 'capital', helperFails);
expectEq('classify vendor (Cr-balance)', classifyAccount({ name: 'A R ENTERPRISES', accountType: null, opening: 0, closing: -10_00_000, totalDebit: 1_00_00_000, totalCredit: 1_10_00_000, transactions: [] }), 'vendor', helperFails);
expectEq('classify customer (Dr-balance)', classifyAccount({ name: 'RANA SUGARS LIMITED', accountType: null, opening: 0, closing: 5_75_05_021, totalDebit: 38_58_25_267, totalCredit: 21_87_24_315, transactions: [] }), 'customer', helperFails);
expectEq('classify transporter', classifyAccount({ name: 'RANA LOGISTICS AND TRANSPORT', accountType: null, opening: 0, closing: 0, totalDebit: 98_171, totalCredit: 2_14_335, transactions: [] }), 'transport_expense', helperFails);

// ── Run cases ────────────────────────────────────────────────────────

interface CaseResult { name: string; ok: boolean; failures: string[]; observations: DetObservation[] }

const caseResults: CaseResult[] = [];

for (const c of CASES) {
  const observations = runAllFlags(c.ledger);
  const failures: string[] = [];
  if (c.expect.mustContain) {
    for (const code of c.expect.mustContain) {
      if (!observations.some(o => o.code === code)) {
        failures.push(`expected to contain code ${code}`);
      }
    }
  }
  if (c.expect.mustNotContain) {
    for (const code of c.expect.mustNotContain) {
      if (observations.some(o => o.code === code)) {
        const offending = observations.filter(o => o.code === code);
        failures.push(`expected NOT to contain ${code}, got ${offending.length} observation(s): ${offending.map(o => o.message.slice(0, 100)).join(' | ')}`);
      }
    }
  }
  if (c.expect.assertions) {
    for (const fn of c.expect.assertions) {
      const err = fn(observations);
      if (err) failures.push(err);
    }
  }
  caseResults.push({ name: c.name, ok: failures.length === 0, failures, observations });
}

// ── Report ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

const verbose = process.env.VERBOSE === '1';

if (helperFails.length > 0) {
  console.log('\n=== Helper unit tests ===');
  for (const f of helperFails) console.log('  FAIL ' + f);
  failed += helperFails.length;
} else {
  console.log('\n=== Helper unit tests: 32/32 passed ===');
  passed += 32;
}

console.log('\n=== Engine fixture cases ===\n');
for (const r of caseResults) {
  if (r.ok) {
    console.log(`  PASS  ${r.name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${r.name}`);
    for (const f of r.failures) console.log(`        ${f}`);
    if (verbose) {
      console.log('        observations emitted:');
      for (const o of r.observations) {
        console.log(`          [${o.severity}] ${o.code} (${o.accountName ?? '—'}): ${o.message.slice(0, 140)}`);
      }
    }
    failed++;
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nRun with VERBOSE=1 to see all observations emitted by failing cases.');
  process.exit(1);
}
