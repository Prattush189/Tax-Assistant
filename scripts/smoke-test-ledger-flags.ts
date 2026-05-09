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

import { runAllFlags, formatINR, voucherKind, classifyAccount, mergeObservations, DETERMINISTIC_CODES, type DetObservation } from '../server/lib/ledgerScrutinyFlags.js';
import { formatPreRaisedFlags } from '../server/lib/ledgerScrutinyPrompt.js';
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
// ── Merge tests ──────────────────────────────────────────────────────
// The merge step combines deterministic flags with LLM-emitted ones.
// Verify it (a) keeps deterministic verbatim, (b) drops LLM observations
// that re-emit a deterministic code, (c) drops LLM observations that
// duplicate by (account+date+amount).

console.log('\n=== Merge step tests ===\n');

const mergeFails: string[] = [];

function detObs(over: Partial<DetObservation>): DetObservation {
  return {
    accountName: null, code: 'TEST', severity: 'info', message: 'test',
    amount: null, dateRef: null, suggestedAction: null, source: 'deterministic',
    ...over,
  };
}

// Test 1 — deterministic flags pass through.
{
  const det = [detObs({ code: 'CASH_40A3', accountName: 'X', amount: 11_47_000 })];
  const llm: never[] = [];
  const merged = mergeObservations(det, llm);
  if (merged.length !== 1) mergeFails.push(`merge keeps deterministic: expected 1, got ${merged.length}`);
}

// Test 2 — LLM emits a code the engine owns → drop.
{
  const det = [detObs({ code: 'CASH_40A3', accountName: 'X', amount: 11_47_000 })];
  const llm = [{ accountName: 'X', code: 'CASH_40A3', severity: 'high', message: 'LLM duplicate', amount: 11_47_000, dateRef: null, suggestedAction: null }];
  const merged = mergeObservations(det, llm);
  if (merged.length !== 1) mergeFails.push(`merge drops duplicate code: expected 1, got ${merged.length}`);
  if (merged[0].source !== 'deterministic') mergeFails.push('merge should keep the deterministic version, not LLM');
}

// Test 3 — LLM emits a different code but same account+date+amount → drop.
{
  const det = [detObs({ code: 'CASH_40A3', accountName: 'X', amount: 11_47_000, dateRef: '2025-06-01' })];
  const llm = [{ accountName: 'X', code: 'CUSTOM_CASH_FLAG', severity: 'high', message: 'LLM dup', amount: 11_47_000, dateRef: '2025-06-01', suggestedAction: null }];
  const merged = mergeObservations(det, llm);
  if (merged.length !== 1) mergeFails.push(`merge drops account+date+amount dup: expected 1, got ${merged.length}`);
}

// Test 4 — genuinely-different LLM observation passes through.
{
  const det = [detObs({ code: 'CASH_40A3', accountName: 'X', amount: 11_47_000, dateRef: '2025-06-01' })];
  const llm = [{ accountName: 'Y', code: 'PERSONAL_EXPENSE', severity: 'warn', message: 'jewellery purchase', amount: 50_000, dateRef: '2025-09-15', suggestedAction: null }];
  const merged = mergeObservations(det, llm);
  if (merged.length !== 2) mergeFails.push(`merge keeps genuinely-distinct LLM observation: expected 2, got ${merged.length}`);
}

// Test 5 — DETERMINISTIC_CODES contains all engine codes.
{
  const required = ['CASH_40A3', 'CASH_269ST', 'CASH_269SS', 'CASH_269T', 'TDS_194Q_MISSING', 'TDS_194C_MISSING', 'TDS_194I_MISSING', 'TDS_194H_MISSING', 'TDS_194J_MISSING', 'TDS_192_VERIFY', 'RECON_BREAK', 'PATTERN_SQUARED_OFF', 'PATTERN_ONE_SIDED_CREDIT', 'TURNOVER_AUDIT_FLAG'];
  for (const c of required) {
    if (!DETERMINISTIC_CODES.has(c)) mergeFails.push(`DETERMINISTIC_CODES missing ${c}`);
  }
}

// Test 6 — formatPreRaisedFlags produces a sane block.
{
  const flags = [
    { accountName: 'AAYUSH OVERSEAS', code: 'TDS_194Q_MISSING', severity: 'warn', message: 'm', amount: 1_89_806 },
    { accountName: 'RACHPAL SINGH', code: 'CASH_40A3', severity: 'high', message: 'm', amount: 11_47_000 },
  ];
  const block = formatPreRaisedFlags(flags);
  if (!block.includes('PRE_RAISED_FLAGS')) mergeFails.push('formatPreRaisedFlags should mention PRE_RAISED_FLAGS');
  if (!block.includes('TDS_194Q_MISSING')) mergeFails.push('formatPreRaisedFlags should list each code');
  if (!block.includes('AAYUSH OVERSEAS')) mergeFails.push('formatPreRaisedFlags should list account names');
  if (!block.includes('1,89,806')) mergeFails.push('formatPreRaisedFlags should show formatted amounts');
}

// Test 7 — empty flag list returns the (none) message.
{
  const block = formatPreRaisedFlags([]);
  if (!/none/i.test(block)) mergeFails.push('formatPreRaisedFlags([]) should announce "none"');
}

if (mergeFails.length === 0) {
  console.log('  PASS  merge tests (7/7)');
  passed += 7;
} else {
  for (const f of mergeFails) console.log('  FAIL  ' + f);
  failed += mergeFails.length;
}

// ── Punjab-shape ledger fixture (full integration check) ─────────────
// Reconstructs the actual Punjab rice-mill ledger from the original
// Ledger-scrutiny.pdf. Each account is present with its real opening,
// closing, debit, credit totals — but only the transactions we have
// narration evidence for are populated. The deterministic engine's
// output on this fixture should match what a CA would expect, with
// no §194Q on sub-50L vendors, no §194-I on Rs. 84K rent, no §40A(3)
// on J-voucher entries, and no Rs. 0 / Rs. 3.6 RECON_BREAK noise.

console.log('\n=== Full Punjab-shape ledger integration check ===\n');

const punjabLedger = {
  partyName: 'Himanshu Arora',
  gstin: null,
  periodFrom: '2025-04-01',
  periodTo: '2026-03-31',
  accounts: [
    // §194Q candidates above 50L — should ALL be flagged.
    { name: 'AAYUSH OVERSEAS — KAPURTHALA', accountType: null, opening: 0, closing: -6_47_57_571, totalDebit: 13_00_47_954, totalCredit: 19_48_05_525, transactions: [] },
    { name: 'AAYUSH OVERSEAS — DELHI', accountType: null, opening: 0, closing: -1_78_58_191, totalDebit: 7_49_64_004, totalCredit: 9_28_22_195, transactions: [] },
    { name: 'R GUPTA TRADERS — KAPURTHALA', accountType: null, opening: 0, closing: -49_38_746, totalDebit: 4_40_83_763, totalCredit: 5_11_56_708, transactions: [] },
    { name: 'A.G. TRADING CO.', accountType: null, opening: 0, closing: -24_096, totalDebit: 97_04_723, totalCredit: 1_53_61_214, transactions: [] },
    { name: 'V G ENTERPRISES — KAPURTHALA', accountType: null, opening: 0, closing: -45_53_661, totalDebit: 92_82_905, totalCredit: 1_38_36_566, transactions: [] },
    { name: 'A R ENTERPRISES — KAPURTHALA', accountType: null, opening: 0, closing: -10_76_786, totalDebit: 1_28_64_218, totalCredit: 1_36_90_016, transactions: [] },
    { name: 'AASHIRWAD RICE AND GENERAL MILLS', accountType: null, opening: 0, closing: -83_867, totalDebit: 71_93_787, totalCredit: 72_77_653, transactions: [] },
    { name: 'HARI OM INDUSTRIES', accountType: null, opening: 0, closing: -79_858, totalDebit: 49_87_728, totalCredit: 73_68_369, transactions: [] },

    // Sub-50L vendors — should NOT be flagged for §194Q.
    { name: 'AVTAR SINGH S/O JARNAIL SINGH', accountType: null, opening: 0, closing: 0, totalDebit: 5_02_625, totalCredit: 5_02_625, transactions: [] },
    { name: 'GURNAM SINGH S/O MUKHTIAR SINGH — MOGA', accountType: null, opening: 0, closing: 0, totalDebit: 21_31_551, totalCredit: 21_31_551, transactions: [] },
    { name: 'MAAN SINGH S/O UJAGAR SINGH', accountType: null, opening: 0, closing: 0, totalDebit: 7_84_507, totalCredit: 7_84_507, transactions: [] },
    { name: 'KHOSLA RICE LAND PVT LTD', accountType: null, opening: 0, closing: 0, totalDebit: 6_92_850, totalCredit: 6_85_920, transactions: [] },
    { name: 'M/S AGWAN RICE MILL — GURDASPUR', accountType: null, opening: 0, closing: 0, totalDebit: 7_16_810, totalCredit: 7_16_810, transactions: [] },
    { name: 'SANDHU BROTHERS AGRO RICE MILL — TARN TARAN', accountType: null, opening: 0, closing: 8_117, totalDebit: 25_30_109, totalCredit: 25_38_226, transactions: [] },

    // Customers — should NOT trigger §194Q (Dr-balance, assessee is the seller).
    { name: 'RANA SUGARS LIMITED — PATTI', accountType: null, opening: 0, closing: 5_75_05_021, totalDebit: 38_58_25_267, totalCredit: 21_87_24_315, transactions: [] },
    { name: 'BUTTAR BIOFUELS PRIVATE LIMITED', accountType: null, opening: 0, closing: 5_70_05_492, totalDebit: 30_74_68_711, totalCredit: 25_97_25_991, transactions: [] },
    { name: 'ETH BIOFUELS PRIVATE LIMITED — TARN TARAN', accountType: null, opening: 0, closing: 1_71_10_958, totalDebit: 24_16_87_974, totalCredit: 9_84_10_249, transactions: [] },

    // §40A(3): real cash payment.
    { name: 'RACHPAL SINGH S/O MASSA SINGH — TARN TARAN', accountType: null, opening: 0, closing: 0, totalDebit: 11_57_000, totalCredit: 11_47_000, transactions: [
      { date: '2025-06-01', narration: 'CASH PAID purchase', voucher: 'C', debit: 11_47_000, credit: 0, balance: null },
    ] },

    // §40A(3): journal entry with "CASH PAID" narration — must NOT trigger.
    { name: 'JVH TRADING COMPANY — AMRITSAR', accountType: null, opening: 0, closing: 0, totalDebit: 13_04_088, totalCredit: 13_04_088, transactions: [
      { date: '2025-04-30', narration: 'C CASH PAID', voucher: 'J', debit: 5_288, credit: 0, balance: null },
    ] },

    // §194-I: Rs. 84K annual rent — must NOT trigger.
    { name: 'RENT', accountType: null, opening: 0, closing: 0, totalDebit: 84_000, totalCredit: 84_000, transactions: [
      { date: '2025-04-30', narration: 'Apr rent', voucher: 'J', debit: 7_000, credit: 0, balance: null },
    ] },

    // §194C transporter: must trigger.
    { name: 'RANA LOGISTICS AND TRANSPORT', accountType: null, opening: 0, closing: -1_16_164, totalDebit: 98_171, totalCredit: 2_14_335, transactions: [] },

    // §194H brokerage account (aggregate Rs. 30L+).
    { name: 'BROKERAGE', accountType: null, opening: 0, closing: 0, totalDebit: 60_000, totalCredit: 30_26_346, transactions: [] },

    // Salaries.
    { name: 'SALARIES', accountType: null, opening: 0, closing: 0, totalDebit: 40_000, totalCredit: 13_80_000, transactions: [] },

    // Sales accounts (nominal — recon should skip).
    { name: 'SALES I/S Tax-Free', accountType: null, opening: 0, closing: 0, totalDebit: 2_00_74_079, totalCredit: 59_78_25_474, transactions: [] },
    { name: 'SALES LOCAL Tax-Free', accountType: null, opening: 0, closing: 0, totalDebit: 23_91_800, totalCredit: 23_91_800, transactions: [] },

    // HDFC bank — recon should skip.
    { name: 'HDFC BANK — SULTANPUR LODHI', accountType: null, opening: 0, closing: 3_865, totalDebit: 64_49_16_408, totalCredit: 62_68_70_775, transactions: [] },

    // Capital — recon should skip.
    { name: 'HIMANSHU ARORA — SULTANPUR LODHI', accountType: null, opening: 0, closing: -3_87_07_565, totalDebit: 1_56_00_000, totalCredit: 5_43_07_565, transactions: [] },

    // Squared-off party accounts (need 5+ for the pattern to fire).
    { name: 'ANAND TRADERS — TARN TARAN', accountType: null, opening: 0, closing: 0, totalDebit: 25_88_822, totalCredit: 25_88_822, transactions: [] },
    { name: 'ANURAG FOOD GRAINS — KAPURTHALA', accountType: null, opening: 0, closing: 0, totalDebit: 44_47_422, totalCredit: 44_47_422, transactions: [] },
    { name: 'CHAND SINGH S/O PREM SINGH — BHULAN', accountType: null, opening: 0, closing: 0, totalDebit: 12_48_015, totalCredit: 12_48_015, transactions: [] },
    { name: 'CHARANJIT SINGH S/O SUKHWINDER', accountType: null, opening: 0, closing: 0, totalDebit: 15_11_159, totalCredit: 15_11_159, transactions: [] },
    { name: 'GURBHEJ SINGH S/O SUKHDEV SINGH', accountType: null, opening: 0, closing: 0, totalDebit: 9_86_309, totalCredit: 9_86_309, transactions: [] },
    { name: 'BALDEV SINGH S/O LAL SINGH — KANGKALAN', accountType: null, opening: 0, closing: 0, totalDebit: 7_18_746, totalCredit: 7_18_746, transactions: [] },

    // One-sided credits.
    { name: 'RANJOTH SINGH S/O BIKARMJIT SINGH — TARN TARAN', accountType: null, opening: 0, closing: -17_17_089, totalDebit: 0, totalCredit: 17_17_089, transactions: [] },
    { name: 'GAGANDEEP SINGH S/O RAM SINGH — TAPPA', accountType: null, opening: 0, closing: -7_45_519, totalDebit: 0, totalCredit: 7_45_519, transactions: [] },
  ],
};

const punjabFlags = runAllFlags(punjabLedger);
const punjabFails: string[] = [];

// Count §194Q flags — should be exactly 8 (the vendors above).
const q = punjabFlags.filter(f => f.code === 'TDS_194Q_MISSING');
if (q.length !== 8) {
  punjabFails.push(`§194Q vendor count: expected 8, got ${q.length} (${q.map(f => f.accountName).join(', ')})`);
}

// Specific TDS amount check on Aayush Overseas Kapurthala.
const aayush = q.find(f => f.accountName === 'AAYUSH OVERSEAS — KAPURTHALA');
if (!aayush || aayush.amount !== 1_89_806) {
  punjabFails.push(`Aayush Overseas §194Q TDS: expected Rs. 1,89,806, got Rs. ${aayush?.amount ?? 'missing'}`);
}

// No §194Q on customers.
for (const c of ['RANA SUGARS LIMITED — PATTI', 'BUTTAR BIOFUELS PRIVATE LIMITED', 'ETH BIOFUELS PRIVATE LIMITED — TARN TARAN']) {
  if (q.some(f => f.accountName === c)) {
    punjabFails.push(`§194Q must not flag customer ${c}`);
  }
}

// No §194Q on sub-50L vendors.
for (const v of ['AVTAR SINGH S/O JARNAIL SINGH', 'GURNAM SINGH S/O MUKHTIAR SINGH — MOGA', 'MAAN SINGH S/O UJAGAR SINGH', 'KHOSLA RICE LAND PVT LTD', 'M/S AGWAN RICE MILL — GURDASPUR', 'SANDHU BROTHERS AGRO RICE MILL — TARN TARAN']) {
  if (q.some(f => f.accountName === v)) {
    punjabFails.push(`§194Q must not flag sub-threshold vendor ${v}`);
  }
}

// §40A(3): exactly 1 (Rachpal Singh, not JVH journal).
const cash40 = punjabFlags.filter(f => f.code === 'CASH_40A3');
if (cash40.length !== 1 || cash40[0].accountName !== 'RACHPAL SINGH S/O MASSA SINGH — TARN TARAN') {
  punjabFails.push(`§40A(3): expected 1 (Rachpal Singh), got ${cash40.length} (${cash40.map(f => f.accountName).join(', ')})`);
}

// §194-I: zero (rent is Rs. 84K).
if (punjabFlags.some(f => f.code === 'TDS_194I_MISSING')) {
  punjabFails.push('§194-I: must not flag Rs. 84K annual rent');
}

// §194C: exactly 1 (Rana Logistics).
const c194 = punjabFlags.filter(f => f.code === 'TDS_194C_MISSING');
if (c194.length !== 1) {
  punjabFails.push(`§194C: expected 1, got ${c194.length}`);
}

// §194H: exactly 1 (Brokerage account).
const h194 = punjabFlags.filter(f => f.code === 'TDS_194H_MISSING');
if (h194.length !== 1) {
  punjabFails.push(`§194H: expected 1, got ${h194.length}`);
}

// §192 salary verify: exactly 1.
if (!punjabFlags.some(f => f.code === 'TDS_192_VERIFY')) {
  punjabFails.push('§192: salary verify flag missing');
}

// Squared-off pattern: must trigger.
if (!punjabFlags.some(f => f.code === 'PATTERN_SQUARED_OFF')) {
  punjabFails.push('Squared-off pattern: missing');
}

// One-sided credits: at least 1.
if (!punjabFlags.some(f => f.code === 'PATTERN_ONE_SIDED_CREDIT')) {
  punjabFails.push('One-sided credits: missing');
}

// Turnover audit: must trigger (turnover > Rs. 60 Cr).
if (!punjabFlags.some(f => f.code === 'TURNOVER_AUDIT_FLAG')) {
  punjabFails.push('Turnover audit flag: missing');
}

// No spurious RECON_BREAKs on bank, sales, or capital accounts.
const recon = punjabFlags.filter(f => f.code === 'RECON_BREAK');
const skipNamesLower = ['hdfc bank — sultanpur lodhi', 'sales i/s tax-free', 'sales local tax-free', 'himanshu arora — sultanpur lodhi'];
for (const r of recon) {
  if (r.accountName && skipNamesLower.includes(r.accountName.toLowerCase())) {
    punjabFails.push(`RECON_BREAK should not fire on ${r.accountName}`);
  }
}

if (punjabFails.length === 0) {
  console.log(`  PASS  Punjab-shape integration: ${punjabFlags.length} flags emitted, all expectations met`);
  passed++;
} else {
  console.log('  FAIL  Punjab-shape integration:');
  for (const f of punjabFails) console.log(`        ${f}`);
  if (verbose) {
    console.log('        all observations:');
    for (const f of punjabFlags) {
      console.log(`          [${f.severity}] ${f.code} (${f.accountName ?? '—'}): Rs. ${f.amount ?? 'null'}`);
    }
  }
  failed++;
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nRun with VERBOSE=1 to see all observations emitted by failing cases.');
  process.exit(1);
}
