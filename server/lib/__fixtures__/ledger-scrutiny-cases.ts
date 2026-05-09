// Test fixtures for the deterministic ledger scrutiny flag engine.
//
// Each case is a minimal ExtractedLedger snippet that exercises a single
// rule. The cases mirror real-world failure modes seen on the
// Punjab rice-mill ledger (FY 2025-26):
//
//   - §194Q hallucinated TDS figures across sub-threshold vendors
//   - §194-I flagged on Rs. 84,000 annual rent despite Rs. 50,000/month limit
//   - §194C contradiction ("Rs. 98,171 exceeds Rs. 1,00,000")
//   - §40A(3) flagged on J-voucher journal entries
//   - RECON_BREAK noise (Rs. 0, Rs. 3.6, Rs. 2,475)
//   - Sub-threshold §194Q ("Rs. 0 (purchases above Rs. 50 lakh)")
//   - Squared-off accounts not flagged at all
//   - One-sided credits on personal accounts not flagged
//
// The smoke-test asserts the *new* engine handles each case correctly.

import type { DetLedger } from '../ledgerScrutinyFlags.js';

// ── Builders ─────────────────────────────────────────────────────────

function ledger(accounts: DetLedger['accounts']): DetLedger {
  return {
    partyName: 'Test Assessee',
    gstin: null,
    periodFrom: '2025-04-01',
    periodTo: '2026-03-31',
    accounts,
  };
}

function vendorAcct(name: string, opts: {
  totalCredit: number;       // purchases booked
  totalDebit?: number;       // payments made
  opening?: number;
  closing?: number;          // signed: <0 = Cr balance
  txns?: DetLedger['accounts'][number]['transactions'];
}): DetLedger['accounts'][number] {
  return {
    name,
    accountType: null,
    opening: opts.opening ?? 0,
    closing: opts.closing ?? -(opts.totalCredit - (opts.totalDebit ?? 0)),
    totalDebit: opts.totalDebit ?? opts.totalCredit, // squared-off default
    totalCredit: opts.totalCredit,
    transactions: opts.txns ?? [],
  };
}

// ── Test cases ───────────────────────────────────────────────────────

export interface TestCase {
  name: string;
  ledger: DetLedger;
  expect: {
    /** Codes that MUST appear at least once. */
    mustContain?: string[];
    /** Codes that MUST NOT appear. */
    mustNotContain?: string[];
    /** Specific assertions on emitted observations. */
    assertions?: Array<(obs: import('../ledgerScrutinyFlags.js').DetObservation[]) => string | null>;
  };
}

export const CASES: TestCase[] = [

  // ── §194Q correctness ─────────────────────────────────────────────

  {
    name: '§194Q: vendor at Rs. 5.02 lakh — must NOT trigger',
    ledger: ledger([
      vendorAcct('AVTAR SINGH S/O JARNAIL SINGH', { totalCredit: 5_02_625 }),
    ]),
    expect: { mustNotContain: ['TDS_194Q_MISSING'] },
  },

  {
    name: '§194Q: vendor at Rs. 49.87 lakh — must NOT trigger (just below threshold)',
    ledger: ledger([
      vendorAcct('HARI OM INDUSTRIES', { totalCredit: 49_87_728, totalDebit: 49_87_728, closing: 0 }),
    ]),
    expect: { mustNotContain: ['TDS_194Q_MISSING'] },
  },

  {
    name: '§194Q: vendor at exactly Rs. 50 lakh — must NOT trigger (strictly greater required)',
    ledger: ledger([
      vendorAcct('EXACTLY FIFTY LAKH TRADERS', { totalCredit: 50_00_000 }),
    ]),
    expect: { mustNotContain: ['TDS_194Q_MISSING'] },
  },

  {
    name: '§194Q: vendor at Rs. 72.78 lakh — TDS = Rs. 2,278 (not Rs. 2,194)',
    ledger: ledger([
      vendorAcct('AASHIRWAD RICE AND GENERAL MILLS', { totalCredit: 72_77_653, totalDebit: 71_93_787 }),
    ]),
    expect: {
      mustContain: ['TDS_194Q_MISSING'],
      assertions: [
        (obs) => {
          const o = obs.find(x => x.code === 'TDS_194Q_MISSING');
          if (!o) return 'no TDS_194Q_MISSING observation';
          if (o.amount !== 2278) return `expected amount Rs. 2,278, got Rs. ${o.amount}`;
          if (!/22,77,653/.test(o.message)) return 'message should mention excess Rs. 22,77,653';
          return null;
        },
      ],
    },
  },

  {
    name: '§194Q: large vendor — TDS computed correctly per excess',
    ledger: ledger([
      vendorAcct('AAYUSH OVERSEAS — KAPURTHALA', { totalCredit: 19_48_05_525, totalDebit: 13_00_47_954, closing: -6_47_57_571 }),
    ]),
    expect: {
      mustContain: ['TDS_194Q_MISSING'],
      assertions: [
        (obs) => {
          const o = obs.find(x => x.code === 'TDS_194Q_MISSING');
          if (!o) return 'missing observation';
          // (19,48,05,525 - 50,00,000) × 0.001 = 18,98,05,525 × 0.001 = 1,89,805.525 → 1,89,806
          if (o.amount !== 1_89_806) return `expected Rs. 1,89,806, got Rs. ${o.amount}`;
          return null;
        },
      ],
    },
  },

  {
    name: '§194Q: customer (Dr-balance) — must NOT trigger even with high turnover',
    ledger: ledger([
      // Rana Sugars — assessee SELLS to them, so §194Q is the buyer's
      // problem, not the assessee's.
      {
        name: 'RANA SUGARS LIMITED',
        accountType: null,
        opening: 0,
        closing: 5_75_05_021,           // Dr balance — receivable
        totalDebit: 38_58_25_267,       // sales invoiced
        totalCredit: 21_87_24_315,       // receipts
        transactions: [],
      },
    ]),
    expect: { mustNotContain: ['TDS_194Q_MISSING'] },
  },

  // ── §194C ─────────────────────────────────────────────────────────

  {
    name: '§194C: transporter aggregate Rs. 2,14,335 (Cr) — must trigger',
    ledger: ledger([
      {
        name: 'RANA LOGISTICS AND TRANSPORT',
        accountType: null,
        opening: 0, closing: -1_16_164,
        totalDebit: 98_171, totalCredit: 2_14_335,
        transactions: [
          { date: '2025-05-15', narration: 'Freight bill', voucher: 'J', debit: 0, credit: 50_000, balance: null },
          { date: '2025-08-20', narration: 'Freight bill', voucher: 'J', debit: 0, credit: 60_000, balance: null },
          { date: '2025-11-30', narration: 'Freight bill', voucher: 'J', debit: 0, credit: 1_04_335, balance: null },
        ],
      },
    ]),
    expect: { mustContain: ['TDS_194C_MISSING'] },
  },

  {
    name: '§194C: transporter aggregate Rs. 95,000 — must NOT trigger',
    ledger: ledger([
      {
        name: 'SMALL TRANSPORT CO',
        accountType: null,
        opening: 0, closing: 0,
        totalDebit: 95_000, totalCredit: 95_000,
        transactions: [
          { date: '2025-05-15', narration: 'Freight', voucher: 'J', debit: 0, credit: 25_000, balance: null },
          { date: '2025-08-20', narration: 'Freight', voucher: 'J', debit: 0, credit: 70_000, balance: null },
        ],
      },
    ]),
    expect: { mustNotContain: ['TDS_194C_MISSING'] },
  },

  // ── §194-I rent ───────────────────────────────────────────────────

  {
    name: '§194-I: annual rent Rs. 84,000 (~Rs. 7,000/month) — must NOT trigger',
    ledger: ledger([
      {
        name: 'RENT',
        accountType: null,
        opening: 0, closing: 0,
        totalDebit: 84_000, totalCredit: 84_000,
        transactions: [
          { date: '2025-04-30', narration: 'Apr rent', voucher: 'J', debit: 7_000, credit: 0, balance: null },
          { date: '2025-05-31', narration: 'May rent', voucher: 'J', debit: 7_000, credit: 0, balance: null },
        ],
      },
    ]),
    expect: { mustNotContain: ['TDS_194I_MISSING'] },
  },

  {
    name: '§194-I: monthly rent Rs. 60,000 — must trigger',
    ledger: ledger([
      {
        name: 'RENT',
        accountType: null,
        opening: 0, closing: 0,
        totalDebit: 7_20_000, totalCredit: 7_20_000,
        transactions: [
          { date: '2025-04-30', narration: 'Apr rent', voucher: 'J', debit: 60_000, credit: 0, balance: null },
          { date: '2025-05-31', narration: 'May rent', voucher: 'J', debit: 60_000, credit: 0, balance: null },
        ],
      },
    ]),
    expect: { mustContain: ['TDS_194I_MISSING'] },
  },

  // ── §40A(3) — voucher discipline ──────────────────────────────────

  {
    name: '§40A(3): cash voucher Rs. 11,47,000 — must trigger HIGH',
    ledger: ledger([
      vendorAcct('RACHPAL SINGH S/O MASSA SINGH', {
        totalCredit: 11_47_000, totalDebit: 11_57_000,
        txns: [
          { date: '2025-06-01', narration: 'CASH PAID purchase', voucher: 'C', debit: 11_47_000, credit: 0, balance: null },
        ],
      }),
    ]),
    expect: {
      mustContain: ['CASH_40A3'],
      assertions: [
        (obs) => {
          const o = obs.find(x => x.code === 'CASH_40A3');
          if (o?.severity !== 'high') return `expected severity high, got ${o?.severity}`;
          return null;
        },
      ],
    },
  },

  {
    name: '§40A(3): journal entry "CASH PAID" Rs. 5,288 — must NOT trigger (J voucher)',
    ledger: ledger([
      vendorAcct('JVH TRADING COMPANY', {
        totalCredit: 13_04_088, totalDebit: 13_04_088, closing: 0,
        txns: [
          { date: '2025-04-30', narration: 'C CASH PAID', voucher: 'J', debit: 5_288, credit: 0, balance: null },
        ],
      }),
    ]),
    expect: { mustNotContain: ['CASH_40A3'] },
  },

  {
    name: '§40A(3): cash voucher exactly Rs. 10,000 — must NOT trigger (limit is strict >)',
    ledger: ledger([
      vendorAcct('SOME VENDOR', {
        totalCredit: 10_000, totalDebit: 10_000, closing: 0,
        txns: [
          { date: '2025-06-01', narration: 'Cash', voucher: 'C', debit: 10_000, credit: 0, balance: null },
        ],
      }),
    ]),
    expect: { mustNotContain: ['CASH_40A3'] },
  },

  {
    name: '§40A(3): transporter cash Rs. 30,000 — must NOT trigger (Rs. 35,000 transporter limit)',
    ledger: ledger([
      {
        name: 'BAS TRANSPORT CO',
        accountType: null,
        opening: 0, closing: 0,
        totalDebit: 30_000, totalCredit: 30_000,
        transactions: [
          { date: '2025-06-01', narration: 'Freight cash', voucher: 'C', debit: 30_000, credit: 0, balance: null },
        ],
      },
    ]),
    expect: { mustNotContain: ['CASH_40A3'] },
  },

  // ── Reconciliation ────────────────────────────────────────────────

  {
    name: 'RECON_BREAK: clean tie-out — must NOT flag',
    ledger: ledger([
      vendorAcct('CLEAN VENDOR', {
        totalCredit: 10_00_000, totalDebit: 10_00_000, opening: 0, closing: 0,
      }),
    ]),
    expect: { mustNotContain: ['RECON_BREAK'] },
  },

  {
    name: 'RECON_BREAK: Rs. 3.6 sub-rupee gap — must NOT flag (below materiality)',
    ledger: ledger([
      {
        name: 'SALEEM GILL',
        accountType: null,
        opening: 0, closing: -0.4, // computed will be 0, gap 0.4
        totalDebit: 3_63_303.6, totalCredit: 3_63_303.6,
        transactions: [],
      },
    ]),
    expect: { mustNotContain: ['RECON_BREAK'] },
  },

  {
    name: 'RECON_BREAK: vendor with credit-direction closing — must tie cleanly when sign convention is right',
    ledger: ledger([
      // Vendor pays Rs. 1.36 Cr in bills, assessee paid Rs. 1.29 Cr,
      // closing Rs. 8.26 lakh credit (payable). Must NOT flag.
      vendorAcct('A R ENTERPRISES', {
        totalCredit: 1_36_90_016, totalDebit: 1_28_64_218,
        opening: 0, closing: -8_25_798,
      }),
    ]),
    expect: { mustNotContain: ['RECON_BREAK'] },
  },

  {
    name: 'RECON_BREAK: nominal account (Sales) closes to Trading — must NOT flag',
    ledger: ledger([
      {
        name: 'SALES I/S Tax-Free',
        accountType: null,
        opening: 0, closing: 0,
        totalDebit: 2_00_74_079, totalCredit: 59_78_25_474,
        transactions: [],
      },
    ]),
    expect: { mustNotContain: ['RECON_BREAK'] },
  },

  {
    name: 'RECON_BREAK: bank account vs book — must NOT flag (separate reconciliation)',
    ledger: ledger([
      {
        name: 'HDFC BANK — SULTANPUR LODHI',
        accountType: null,
        opening: 17_385, closing: 3_865,
        totalDebit: 64_49_16_408, totalCredit: 62_68_70_775,
        transactions: [],
      },
    ]),
    expect: { mustNotContain: ['RECON_BREAK'] },
  },

  {
    name: 'RECON_BREAK: real material gap Rs. 2,50,988 — must flag',
    ledger: ledger([
      vendorAcct('UNRECONCILED VENDOR', {
        totalCredit: 1_00_00_000, totalDebit: 0, opening: 50_000, closing: -1_02_50_988,
      }),
    ]),
    expect: { mustContain: ['RECON_BREAK'] },
  },

  // ── Patterns ──────────────────────────────────────────────────────

  {
    name: 'PATTERN_SQUARED_OFF: 5+ exactly-balanced vendor accounts — must flag once',
    ledger: ledger([
      vendorAcct('A TRADERS',  { totalCredit: 25_88_822, totalDebit: 25_88_822, closing: 0 }),
      vendorAcct('B TRADERS',  { totalCredit: 44_47_422, totalDebit: 44_47_422, closing: 0 }),
      vendorAcct('C TRADERS',  { totalCredit: 12_48_015, totalDebit: 12_48_015, closing: 0 }),
      vendorAcct('D TRADERS',  { totalCredit: 15_11_159, totalDebit: 15_11_159, closing: 0 }),
      vendorAcct('E TRADERS',  { totalCredit: 9_86_309,  totalDebit: 9_86_309,  closing: 0 }),
      vendorAcct('F TRADERS',  { totalCredit: 7_18_746,  totalDebit: 7_18_746,  closing: 0 }),
    ]),
    expect: { mustContain: ['PATTERN_SQUARED_OFF'] },
  },

  {
    name: 'PATTERN_ONE_SIDED_CREDIT: Cr-only personal account Rs. 17 lakh — must flag',
    ledger: ledger([
      vendorAcct('RANJOTH SINGH S/O BIKARMJIT SINGH', {
        totalCredit: 17_17_089, totalDebit: 0, closing: -17_17_089,
      }),
    ]),
    expect: { mustContain: ['PATTERN_ONE_SIDED_CREDIT'] },
  },

  // ── Turnover / §44AB ──────────────────────────────────────────────

  {
    name: 'TURNOVER_AUDIT_FLAG: turnover Rs. 60 Cr — must trigger',
    ledger: ledger([
      {
        name: 'SALES I/S Tax-Free',
        accountType: null,
        opening: 0, closing: 0,
        totalDebit: 0, totalCredit: 59_78_25_474,
        transactions: [],
      },
      {
        name: 'SALES LOCAL Tax-Free',
        accountType: null,
        opening: 0, closing: 0,
        totalDebit: 0, totalCredit: 23_91_800,
        transactions: [],
      },
    ]),
    expect: { mustContain: ['TURNOVER_AUDIT_FLAG'] },
  },

  // ── §269ST ───────────────────────────────────────────────────────

  {
    name: '§269ST: cash receipt of Rs. 2,50,000 to Cash account — must trigger',
    ledger: ledger([
      {
        name: 'CASH',
        accountType: null,
        opening: 0, closing: 2_50_000,
        totalDebit: 2_50_000, totalCredit: 0,
        transactions: [
          { date: '2025-08-15', narration: 'Cash from customer X', voucher: 'C', debit: 2_50_000, credit: 0, balance: null },
        ],
      },
    ]),
    expect: { mustContain: ['CASH_269ST'] },
  },
];
