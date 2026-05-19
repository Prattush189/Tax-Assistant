/** Quick sanity for formatDate — confirms YYYY-MM-DD → DD/MM/YYYY mapping. */
import { formatDate } from '../src/lib/utils';

const cases: Array<{ input: string | null; expected: string }> = [
  { input: '2025-05-31', expected: '31/05/2025' },
  { input: '2025-12-31', expected: '31/12/2025' },
  { input: '2026-01-03', expected: '03/01/2026' },
  { input: '2025-04-01', expected: '01/04/2025' },
  { input: null, expected: '' },
  { input: '', expected: '' },
  { input: 'not-a-date', expected: '' },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const got = formatDate(c.input);
  if (got === c.expected) {
    pass++;
    console.log(`pass: ${JSON.stringify(c.input)} -> ${JSON.stringify(got)}`);
  } else {
    fail++;
    console.log(`FAIL: ${JSON.stringify(c.input)} -> expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(got)}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
