// Sanity check + re-calibration helper for tokenEstimate.ts.
//
// Re-run after any change to the per-row constants
// (BANK_RAW_TOKENS_PER_ROW, LEDGER_SCRUTINY_RAW_TOKENS_PER_ROW,
// ROW_INPUT_FRAC, ROW_OUTPUT_FRAC) to see what each scenario size
// produces. Goal: per-row weighted output × 1.5 margin should land
// near the empirically observed RAW tokens/row × weight × margin.
//
// Today's calibration target (2026-05):
//   bank:   80-100 raw tokens / row  → ~442 weighted / row
//   ledger: 60-80 raw tokens / row   → ~349 weighted / row scrutiny-only,
//                                       ~791 weighted / row including extract
//
//   npx tsx scripts/check-token-estimator.ts
import { estimateBankStatementText, estimateLedgerScrutinyOnly, estimateLedgerText } from '../server/lib/tokenEstimate.js';

const scenarios = [
  { label: '50-row bank chunk',     chars: 3_500 },
  { label: '200-row bank stmt',     chars: 14_000 },
  { label: '50-row ledger',         chars: 3_500 },
  { label: '500-row ledger',        chars: 35_000 },
  { label: 'huge 8000-row ledger',  chars: 560_000 },
];

console.log('scenario                | rows  | bank-w   | scrutiny-w | ledger-total-w | bank/row | ledger/row');
console.log('------------------------|-------|----------|------------|----------------|----------|-----------');
for (const s of scenarios) {
  const rows = Math.ceil(s.chars / 70);
  const bank = estimateBankStatementText(s.chars);
  const scr = estimateLedgerScrutinyOnly(s.chars);
  const tot = estimateLedgerText(s.chars);
  console.log(
    s.label.padEnd(23),
    '|', String(rows).padStart(5),
    '|', String(bank).padStart(8),
    '|', String(scr).padStart(10),
    '|', String(tot).padStart(14),
    '|', String(Math.round(bank / rows)).padStart(8),
    '|', String(Math.round(tot / rows)).padStart(8),
  );
}
