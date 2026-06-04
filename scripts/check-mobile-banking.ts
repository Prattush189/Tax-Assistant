import { classifyRow } from '../server/lib/bankClassifier';
const cases = [
  'MOBILE BANKING MMT/IMPS/509523467771/irham shaf/JAKAOHKADAL',
  'MOBILE BANKING MMT/IMPS/518915807723/IMPS/SHABIR AHM/Jammu And Kashm',
  'CHEQUE 615 TRFR TO: NAKETA GOYAL',
];
for (const n of cases) {
  const r = classifyRow({ narration: n, type: 'debit' });
  console.log(`${n.slice(0, 60).padEnd(60)} → ${r?.category} / ${r?.subcategory ?? '-'}`);
}
