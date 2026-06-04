import { classifyRow, validateDirectionCategory } from '../server/lib/bankClassifier';

const cases = [
  { narration: 'CHEQUE 591 CASH PAID: SELF 2527 SRINAGAR - KARAN NAGAR,00059', type: 'debit' as const, amount: 100000 },
  { narration: 'BY CASH - SRINAGAR - KARAN NAGAR', type: 'debit' as const, amount: 238 },
  { narration: 'CHEQUE 598 CASH PAID: Self 3476 DELHI - LAJPAT NAGAR CENTRAL', type: 'debit' as const, amount: 500000 },
];

for (const c of cases) {
  const r = classifyRow(c);
  // simulate post-classify direction validator
  const sim = r
    ? [{ type: c.type, category: r.category, subcategory: r.subcategory }]
    : [{ type: c.type, category: 'Other', subcategory: null }];
  validateDirectionCategory(sim);
  console.log(
    `${c.narration.slice(0, 60).padEnd(60)} (${c.type}) → ${r?.category ?? 'null'} / ${r?.subcategory ?? '-'}  → after-validator: ${sim[0]!.category} / ${sim[0]!.subcategory ?? '-'}`,
  );
}
