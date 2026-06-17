/** Verify Wave-1 deterministic scrutiny fixes on the exact cases the
 *  audit flagged. Pure functions, no DB.
 *  Run: npx tsx scripts/smoke-scrutiny-flags.mts
 */
import { runAllFlags, classifyAccount, type DetLedger, type DetAccount } from '../server/lib/ledgerScrutinyFlags.ts';

const acc = (p: Partial<DetAccount> & { name: string }): DetAccount => ({
  name: p.name, accountType: null,
  opening: p.opening ?? 0, closing: p.closing ?? 0,
  totalDebit: p.totalDebit ?? 0, totalCredit: p.totalCredit ?? 0,
  transactions: p.transactions ?? [],
});

const ledger: DetLedger = {
  partyName: 'Test', gstin: null, periodFrom: '2025-04-01', periodTo: '2026-03-31',
  accounts: [
    // #2: opening/closing-stock journal — must be nominal (no 194Q / one-sided / recon)
    acc({ name: 'Stock', opening: 1_02_00_000, closing: 1_02_00_000, totalCredit: 1_02_00_000 }),
    // #1: static asset, B/F opening not captured -> structural gap, suppress RECON_BREAK
    acc({ name: 'MOBILE PHONE', opening: 15_279, closing: 15_279, totalCredit: 15_279 }),
    // a GENUINE dropped-transaction break -> must still fire
    acc({ name: 'ACME VENDOR PVT LTD', opening: 0, closing: 50_000, totalDebit: 1_00_000, totalCredit: 70_000 }),
    // #10: material one-sided credit (non-vendor) -> HIGH
    acc({ name: 'XYZ HOLDINGS', opening: 0, closing: -60_00_000, totalCredit: 60_00_000 }),
    // #12: five squared-off party accounts -> PATTERN_SQUARED_OFF (warn)
    ...Array.from({ length: 5 }, (_, i) => acc({ name: `SQ PARTY ${i}`, totalDebit: 6_00_000, totalCredit: 6_00_000, closing: 0 })),
  ],
};

const obs = runAllFlags(ledger);
const has = (code: string, name?: string | null) => obs.some(o => o.code === code && (name === undefined || o.accountName === name));
const sevOf = (code: string, name?: string | null) => obs.find(o => o.code === code && (name === undefined || o.accountName === name))?.severity;

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`); };

check('Stock classified nominal', classifyAccount(ledger.accounts[0]) === 'nominal');
check('Stock -> no §194Q', !has('TDS_194Q_MISSING', 'Stock'));
check('Stock -> no one-sided-credit', !has('PATTERN_ONE_SIDED_CREDIT', 'Stock'));
check('Stock -> no RECON_BREAK', !has('RECON_BREAK', 'Stock'));
check('MOBILE PHONE -> RECON_BREAK suppressed (structural)', !has('RECON_BREAK', 'MOBILE PHONE'));
check('genuine vendor break -> RECON_BREAK fires', has('RECON_BREAK', 'ACME VENDOR PVT LTD'));
check('material one-sided credit -> HIGH', sevOf('PATTERN_ONE_SIDED_CREDIT', 'XYZ HOLDINGS') === 'high', `(got ${sevOf('PATTERN_ONE_SIDED_CREDIT', 'XYZ HOLDINGS')})`);
check('squared-off -> warn (not info)', sevOf('PATTERN_SQUARED_OFF') === 'warn', `(got ${sevOf('PATTERN_SQUARED_OFF')})`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
