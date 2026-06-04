import { classifyRow } from '../server/lib/bankClassifier';
import Papa from 'papaparse';
import fs from 'fs';

interface Row { Narration: string; Type: string; Amount: string; Category: string }
const rows = Papa.parse<Row>(
  fs.readFileSync('C:/Users/Prattush/Downloads/ICICI_Bank_2025-04-01_2026-03-31 (1).csv', 'utf8'),
  { header: true, skipEmptyLines: true },
).data;

let beforeOther = 0, afterOther = 0;
const stillOther: string[] = [];
const newlyCategorised: Record<string, number> = {};
for (const r of rows) {
  if (r.Category === 'Other') beforeOther++;
  const result = classifyRow({
    narration: r.Narration || '',
    type: r.Type === 'Credit' ? 'credit' : 'debit',
    amount: parseFloat(r.Amount),
  });
  const newCat = result?.category ?? 'Other';
  if (newCat === 'Other') afterOther++;
  if (r.Category === 'Other' && newCat !== 'Other') {
    newlyCategorised[newCat] = (newlyCategorised[newCat] || 0) + 1;
  }
  if (newCat === 'Other') stillOther.push(r.Narration);
}
console.log(`rows still Other after new rules: ${afterOther} / ${rows.length}  (was ${beforeOther})`);
console.log('newly categorised (formerly Other):');
Object.entries(newlyCategorised).forEach(([k, v]) => console.log(` ${k}: ${v}`));
console.log('\nstill Other (first 15):');
stillOther.slice(0, 15).forEach(n => console.log(` · ${n?.slice(0, 100)}`));
