/** Build a party-ledger PDF headlessly and assert it produces valid
 *  PDF bytes — incl. multi-page, undated rows, long + non-ASCII (₹)
 *  narrations, and a single-txn party. Run:
 *    npx tsx scripts/smoke-party-ledger.mts
 */
import { buildPartyLedgerDoc, buildCombinedLedgerDoc } from '../src/lib/partyLedgerPdf.ts';
import type { BankTransaction } from '../src/services/api.ts';

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`); };

const tx = (p: Partial<BankTransaction>): BankTransaction => ({
  id: p.id ?? Math.random().toString(36).slice(2),
  date: p.date ?? '2026-04-10',
  narration: p.narration ?? 'NEFT TXN',
  amount: p.amount ?? 0,
  balance: p.balance ?? null,
  category: p.category ?? 'Transfers',
  subcategory: p.subcategory ?? null,
  counterparty: p.counterparty ?? 'NAVYA WINDLAS',
  reference: p.reference ?? null,
  isRecurring: p.isRecurring ?? false,
  userOverride: p.userOverride ?? false,
  fingerprint: p.fingerprint ?? null,
});

const pdfBytes = (doc: ReturnType<typeof buildPartyLedgerDoc>): Uint8Array =>
  new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
const looksLikePdf = (b: Uint8Array) => b.length > 800 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF

// 1. Basic mixed inflow/outflow ledger.
{
  const txns = [
    tx({ date: '2026-04-08', amount: 500000, narration: 'By Cash deposit' }),
    tx({ date: '2026-04-12', amount: -541000, narration: 'To RTGS payment', reference: 'BARBR52026040700904851' }),
    tx({ date: '2026-04-19', amount: 1200000, narration: 'NEFT received' }),
  ];
  const doc = buildPartyLedgerDoc('NAVYA WINDLAS', txns, { bankName: 'Bank of Baroda', accountLabel: '768XXXXXXXX008', periodFrom: '2026-04-01', periodTo: '2026-04-19' });
  check('basic ledger → valid PDF', looksLikePdf(pdfBytes(doc)));
}

// 2. Multi-page: 200 txns must paginate without throwing.
{
  const txns = Array.from({ length: 200 }, (_, i) =>
    tx({ date: `2026-${String((i % 12) + 1).padStart(2, '0')}-15`, amount: (i % 2 ? -1 : 1) * (1000 + i), narration: `Txn line number ${i} with a fairly long narration to force wrapping across the particulars column width` }));
  const doc = buildPartyLedgerDoc('BULK PARTY', txns);
  const b = pdfBytes(doc);
  check('200-txn ledger paginates → valid PDF', looksLikePdf(b), `(pages=${doc.getNumberOfPages()})`);
  check('200-txn ledger is multi-page', doc.getNumberOfPages() > 1, `(pages=${doc.getNumberOfPages()})`);
}

// 3. Edge cases: undated row, ₹ symbol + curly quotes in narration, no meta.
{
  const txns = [
    tx({ date: null, amount: -2500, narration: 'Paid ₹2,500 — “service” charge' }),
    tx({ date: '2026-05-01', amount: 13452, narration: 'By PURCHASE ISS @ 18%' }),
  ];
  const doc = buildPartyLedgerDoc('(vidit windlas)', txns);
  check('₹/curly-quote/undated edge cases → valid PDF', looksLikePdf(pdfBytes(doc)));
}

// 4. Single transaction.
{
  const doc = buildPartyLedgerDoc('UTTAM JEWELLERS-PUNJAB NATIO', [tx({ amount: -100000, narration: 'To NEFT' })]);
  check('single-txn ledger → valid PDF', looksLikePdf(pdfBytes(doc)));
}

// 5. Empty (defensive — should still produce a header-only PDF, not throw).
{
  const doc = buildPartyLedgerDoc('EMPTY', []);
  check('empty ledger → valid PDF (no throw)', looksLikePdf(pdfBytes(doc)));
}

// 6. Combined ledger book — many parties, each a section, in one PDF.
{
  const parties = Array.from({ length: 24 }, (_, p) => ({
    name: `PARTY ${p} ${p % 3 === 0 ? 'PVT LTD' : ''}`.trim(),
    txns: Array.from({ length: 1 + (p % 6) }, (_, i) =>
      tx({ date: `2026-0${(p % 9) + 1}-${String((i % 28) + 1).padStart(2, '0')}`, amount: (i % 2 ? -1 : 1) * (5000 + p * 100 + i), narration: `Party ${p} txn ${i} narration` })),
  }));
  const doc = buildCombinedLedgerDoc(parties, { bankName: 'Bank of Baroda', periodFrom: '2026-04-01', periodTo: '2026-04-19' });
  const b = pdfBytes(doc);
  check('combined 24-party ledger → valid PDF', looksLikePdf(b), `(pages=${doc.getNumberOfPages()})`);
  check('combined ledger spans multiple pages', doc.getNumberOfPages() > 1);
}

// 7. Combined ledger skips empty parties and survives an all-empty list.
{
  const doc = buildCombinedLedgerDoc([
    { name: 'HAS TXNS', txns: [tx({ amount: -1000 })] },
    { name: 'EMPTY', txns: [] },
  ]);
  check('combined ledger with an empty party → valid PDF', looksLikePdf(pdfBytes(doc)));
  const docEmpty = buildCombinedLedgerDoc([]);
  check('combined ledger, zero parties → valid PDF (no throw)', looksLikePdf(pdfBytes(docEmpty)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
