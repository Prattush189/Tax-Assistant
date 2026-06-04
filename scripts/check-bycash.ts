import { classifyRow } from '../server/lib/bankClassifier';
const cases = [
  { narration: 'By Cash: 2',   type: 'credit' as const },
  { narration: 'By Cash: 128', type: 'credit' as const },
  { narration: 'By Cash: 89',  type: 'credit' as const },
];
for (const c of cases) {
  const r = classifyRow(c);
  console.log(`${c.narration} (${c.type}) → ${r?.category} / ${r?.subcategory ?? '-'}`);
}
