/** Verify the pooled-employee-cash + contra-269ST + balance-repair fixes
 *  against the exact patterns from the Laj Overseas sample ledger, whose
 *  scrutiny report produced 349 HIGHs (324 CASH_40A3 — 306 of them on one
 *  pooled "CASUAL LABOUR" wage head — 20 CASH_269ST on bank→cash Contra
 *  withdrawals, 4 CASH_269T on a salary-advance register) plus 15 phantom
 *  "closing Rs. 0" RECON_BREAKs from dropped Tally closing-balance footers.
 *  Pure functions, no DB.
 *  Run: npx tsx scripts/smoke-pooled-cash-recon.mts
 */
import {
  runAllFlags, classifyAccount, voucherKind, repairBalancesFromSource,
  applyPlausibilityGuards,
  type DetLedger, type DetAccount, type DetTransaction, type DetObservation,
} from '../server/lib/ledgerScrutinyFlags.ts';

const acc = (p: Partial<DetAccount> & { name: string }): DetAccount => ({
  name: p.name, accountType: null,
  opening: p.opening ?? 0, closing: p.closing ?? 0,
  totalDebit: p.totalDebit ?? 0, totalCredit: p.totalCredit ?? 0,
  transactions: p.transactions ?? [],
});
const tx = (p: Partial<DetTransaction>): DetTransaction => ({
  date: p.date ?? null, narration: p.narration ?? null, voucher: p.voucher ?? null,
  debit: p.debit ?? 0, credit: p.credit ?? 0, balance: null,
});

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`); };

// ── 1. Classification ────────────────────────────────────────────────
check('CASUAL LABOUR -> salary_expense', classifyAccount(acc({ name: 'CASUAL LABOUR' })) === 'salary_expense');
check('Bonus Payable -> salary_expense', classifyAccount(acc({ name: 'Bonus Payable' })) === 'salary_expense');
check('Advance to Employee -> employee_advance', classifyAccount(acc({ name: 'Advance to Employee' })) === 'employee_advance');
check('SALARY ADVANCE -> employee_advance (order)', classifyAccount(acc({ name: 'SALARY ADVANCE' })) === 'employee_advance');
check('Contra voucher -> X (not null)', voucherKind('Contra') === 'X');
check('Cash Payment voucher -> C', voucherKind('Cash Payment') === 'C');

// ── 2. Flag behaviour on the Laj Overseas patterns ──────────────────
// 30 days of Rs. 16,000/day cash wage muster (was 306 per-day HIGHs).
const wageTxs = Array.from({ length: 30 }, (_, i) =>
  tx({ date: `2024-04-${String((i % 28) + 1).padStart(2, '0')}`, voucher: 'Cash Payment', debit: 16_000 }));
// Salary-advance register paid in cash (was 17 §40A(3) HIGHs + §269T HIGH).
const advTxs = [
  tx({ date: '2024-04-12', voucher: 'Cash Payment', debit: 89_816 }),
  tx({ date: '2024-04-13', voucher: 'Cash Payment', debit: 18_502 }),
  tx({ date: '2024-05-14', voucher: 'Cash Payment', debit: 1_01_002 }),
];
// Cash book: Contra bank→cash withdrawals ≥ 2L (was 20 §269ST HIGHs),
// plus one GENUINE ≥2L cash receipt that must still fire.
const cashTxs = [
  tx({ date: '2024-04-25', narration: 'Cr PNB A/C 1453002122228624', voucher: 'Contra', debit: 3_00_000 }),
  tx({ date: '2024-05-23', narration: 'Cr PNB A/C 1453002122228624', voucher: 'Contra', debit: 5_00_000 }),
  tx({ date: '2024-06-01', narration: 'Cr PNB A/C withdrawal', voucher: null, debit: 2_00_000 }), // bank narration, unknown vch
  tx({ date: '2024-07-10', narration: 'Cr RAMESH KUMAR', voucher: 'Receipt', debit: 2_50_000 }),  // genuine — must flag
];

const ledger: DetLedger = {
  partyName: 'Laj Overseas', gstin: null, periodFrom: '2024-04-01', periodTo: '2025-03-31',
  accounts: [
    acc({ name: 'CASUAL LABOUR', totalDebit: 4_80_000, totalCredit: 4_80_000, transactions: wageTxs }),
    acc({ name: 'Advance to Employee', opening: 24_40_880, totalDebit: 2_09_320, transactions: advTxs, closing: 26_50_200 }),
    acc({ name: 'Cash', totalDebit: 12_50_000, totalCredit: 10_00_000, closing: 2_50_000, transactions: cashTxs }),
  ],
};
const obs = runAllFlags(ledger);
const of = (code: string, name?: string) => obs.filter(o => o.code === code && (name === undefined || o.accountName === name));

check('wage head -> zero per-day CASH_40A3', of('CASH_40A3', 'CASUAL LABOUR').length === 0, `(got ${of('CASH_40A3', 'CASUAL LABOUR').length})`);
check('wage head -> no structuring flag', of('CASH_40A3_STRUCTURING', 'CASUAL LABOUR').length === 0);
check('wage head -> ONE pooled WARN', of('CASH_EMPLOYEE_POOLED', 'CASUAL LABOUR').length === 1 && of('CASH_EMPLOYEE_POOLED', 'CASUAL LABOUR')[0].severity === 'warn');
check('advance head -> zero CASH_40A3', of('CASH_40A3', 'Advance to Employee').length === 0);
check('advance head -> no §269T/SS', of('CASH_269T', 'Advance to Employee').length === 0 && of('CASH_269SS', 'Advance to Employee').length === 0);
check('advance head -> ONE pooled WARN', of('CASH_EMPLOYEE_POOLED', 'Advance to Employee').length === 1);
const st = of('CASH_269ST', 'Cash');
check('contra withdrawals -> no §269ST', !st.some(o => o.amount === 3_00_000 || o.amount === 5_00_000 || o.amount === 2_00_000), `(got ${st.length} flags)`);
check('genuine 2.5L cash receipt -> §269ST still fires', st.some(o => o.amount === 2_50_000));

// ── 3. Balance repair from source text ──────────────────────────────
// Mirrors sample page 2: totals 24,02,258 / 39,74,074, footer
// "Cr Closing Balance 15,71,816.00" dropped by the extractor -> closing 0.
const rawText = [
  `Laj Overseas
243, Abadi Gobindgarh
A & A ENTERPRISES
Ledger Account
1-Apr-24 to 31-Mar-25
Page 2
Date Particulars Vch Type Vch No. Debit Credit
29-Jul-24 Dr DIE BLOCKS A/C Purchase Mfg 142 1,34,927.00
24,02,258.00 39,74,074.00
Cr Closing Balance 15,71,816.00
39,74,074.00 39,74,074.00`,
  `Laj Overseas
243, Abadi Gobindgarh
Cash Book
1-Apr-24 to 31-Mar-25
Page 68
Date Particulars Vch Type Vch No. Debit Credit
1-Apr-24 Cr Opening Balance 5,24,457.00
2-Apr-24 Dr CASUAL LABOUR Cash Payment 46 16,000.00`,
].join('\n--- PAGE BREAK ---\n');

const repairLedger: DetLedger = {
  partyName: 'Laj Overseas', gstin: null, periodFrom: null, periodTo: null,
  accounts: [
    // dropped closing footer -> extractor left closing 0
    acc({ name: 'A & A ENTERPRISES', opening: 0, closing: 0, totalDebit: 24_02_258, totalCredit: 39_74_074 }),
    // dropped Cr opening row -> opening 0; closing extracted fine
    acc({ name: 'Cash Book', opening: 0, closing: -3_24_457, totalDebit: 5_00_000, totalCredit: 3_00_000 }),
    // correct extraction that MUST NOT be touched (no candidates / no improvement)
    acc({ name: 'UNRELATED VENDOR', opening: 10_000, closing: 5_000, totalDebit: 0, totalCredit: 5_000 }),
  ],
};
const stats = repairBalancesFromSource(repairLedger, rawText);
check('closing footer recovered (Cr -> negative)', repairLedger.accounts[0].closing === -15_71_816, `(got ${repairLedger.accounts[0].closing})`);
check('recon now ties on repaired account', Math.abs(repairLedger.accounts[0].opening + 24_02_258 - 39_74_074 - repairLedger.accounts[0].closing) < 1);
check('opening row recovered for cash book', repairLedger.accounts[1].opening === -5_24_457, `(got ${repairLedger.accounts[1].opening})`);
check('untouched account stays untouched', repairLedger.accounts[2].opening === 10_000 && repairLedger.accounts[2].closing === 5_000);
check('stats counted', stats.closingRepaired === 1 && stats.openingRepaired === 1, `(got c=${stats.closingRepaired} o=${stats.openingRepaired})`);

// After repair, RECON_BREAK must be gone for the repaired vendor.
const obs2 = runAllFlags(repairLedger);
check('repaired vendor -> no RECON_BREAK', !obs2.some(o => o.code === 'RECON_BREAK' && o.accountName === 'A & A ENTERPRISES'));

// ── 4. Plausibility guards ───────────────────────────────────────────
const detObs = (p: Partial<DetObservation> & { code: string }): DetObservation => ({
  accountName: p.accountName ?? null, code: p.code, severity: p.severity ?? 'high',
  message: p.message ?? 'x', amount: p.amount ?? 10_000, dateRef: p.dateRef ?? null,
  suggestedAction: null, source: 'deterministic',
});

// 4a. Repetition collapse: 306 same-code HIGHs on one account -> ONE warn.
const floodLedger: DetLedger = {
  partyName: null, gstin: null, periodFrom: null, periodTo: null,
  accounts: [acc({ name: 'MYSTERY HEAD' })],
};
const flood = Array.from({ length: 306 }, (_, i) =>
  detObs({ code: 'CASH_40A3', accountName: 'MYSTERY HEAD', amount: 16_000, dateRef: `2024-04-${String((i % 28) + 1).padStart(2, '0')}` }));
flood.push(detObs({ code: 'CASH_40A3', accountName: 'OTHER PARTY', amount: 50_000 })); // lone finding — untouched
const collapsed = applyPlausibilityGuards(floodLedger, flood);
const mystery = collapsed.filter(o => o.accountName === 'MYSTERY HEAD');
check('306-flood -> ONE collapsed observation', mystery.length === 1, `(got ${mystery.length})`);
check('collapsed flood demoted high -> warn', mystery[0]?.severity === 'warn');
check('collapsed flood aggregates amount', mystery[0]?.amount === 306 * 16_000, `(got ${mystery[0]?.amount})`);
check('lone finding on other account untouched', collapsed.some(o => o.accountName === 'OTHER PARTY' && o.severity === 'high'));
check('under-threshold groups untouched', applyPlausibilityGuards(floodLedger, flood.slice(0, 9)).length === 9);

// 4b. Extraction-quality gate: 15 RECON_BREAKs over 40 eligible accounts
// (>30%) -> ONE EXTRACTION_QUALITY info; 2 breaks over 40 -> left alone.
const gateLedger: DetLedger = {
  partyName: null, gstin: null, periodFrom: null, periodTo: null,
  accounts: Array.from({ length: 40 }, (_, i) => acc({ name: `PARTY ${i} TRADERS` })),
};
const manyBreaks = Array.from({ length: 15 }, (_, i) =>
  detObs({ code: 'RECON_BREAK', severity: 'info', accountName: `PARTY ${i} TRADERS`, amount: 1_00_000 }));
const gated = applyPlausibilityGuards(gateLedger, manyBreaks);
check('mass recon breaks -> gated to ONE notice', gated.filter(o => o.code === 'RECON_BREAK').length === 0 && gated.filter(o => o.code === 'EXTRACTION_QUALITY').length === 1, `(got ${gated.map(o => o.code).join(',')})`);
const fewBreaks = manyBreaks.slice(0, 2);
check('few recon breaks -> kept as findings', applyPlausibilityGuards(gateLedger, fewBreaks).filter(o => o.code === 'RECON_BREAK').length === 2);
check('guards idempotent', applyPlausibilityGuards(gateLedger, gated).length === gated.length);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
