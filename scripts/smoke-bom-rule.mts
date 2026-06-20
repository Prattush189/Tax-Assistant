/** Bank of Maharashtra per-bank rule — verified on a synthetic grid that
 *  mimics BOM's fragmented digital-PDF layout (metadata banner, a
 *  header row, then each transaction split prefix/main/suffix with the
 *  amount columns sometimes bleeding into the reference column). Proves
 *  the balance-chain reconstruction without shipping the real statement.
 *  Run: npx tsx scripts/smoke-bom-rule.mts
 */
// pdfGrid pulls in pdfjs, which touches these browser globals at import.
class DM { a=1;b=0;c=0;d=1;e=0;f=0; constructor(_?:unknown){} multiply(){return this;} translate(){return this;} scale(){return this;} rotate(){return this;} invertSelf(){return this;} }
(globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = DM;
class P2 { constructor(_?:unknown){} addPath(){} moveTo(){} lineTo(){} closePath(){} }
(globalThis as unknown as { Path2D: unknown }).Path2D = P2;
class ID { width:number;height:number;data:Uint8ClampedArray; constructor(w:number,h:number){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);} }
(globalThis as unknown as { ImageData: unknown }).ImageData = ID;

const { applyMapping } = await import('../src/lib/pdfGrid');
const { detectAndMapBank } = await import('../src/lib/perBankRules');

// 6-column grid, exactly the shape extractPdfGrid produces for BOM.
const rows: string[][] = [
  ['Account Holder Names', 'JAGJIT CHEMIST & DRUG STORE', '', '', 'Primary GSTIN', 'NA'],
  ['Phone No', '2234060 Email Id', '', 'bom1245@mahabank.co.in', 'GSTIN', 'NA'],
  ['Branch No', '01245 Branch Name', 'MOHALI', '', 'IFSC', 'MAHB0001245'],
  ['Sr No', 'Date Particulars', 'Debit', '', 'Credit', 'Balance Channel'],
  ['', '/Reference No', '', '', '', ''],
  // txn 1 — credit 100 (clean columns). prefix / main / suffix.
  ['', 'UPI 111111111111/UTIB/ALICE', '', '', '', ''],
  ['1', '01/04/2025', '-', '111111111111', '100.00', '1,100.00 UPI'],
  ['', 'PAY/UPI', '', '', '', ''],
  // txn 2 — debit 50, but the amount bled into the reference column and
  // Credit shows "-": the balance delta must recover it as −50.
  ['', 'UPI 222222222222/HDFC/BOB', '', '', '', ''],
  ['2', '02/04/2025', '', '222222222222 50.00', '-', '1,050.00 UPI'],
  ['', 'using app', '', '', '', ''],
  // txn 3 — credit 25.
  ['', 'UPI 333333333333/SBIN/CAR', '', '', '', ''],
  ['3', '03/04/2025', '-', '333333333333', '25.00', '1,075.00 UPI'],
  ['', 'note', '', '', '', ''],
];
const grid = {
  rows, columnCount: 6, columnXs: [0, 60, 120, 180, 240, 300],
  columnHeaders: ['Type', 'Date', 'Date', null, null, null],
  pageBreaks: [], pageCount: 1,
};

let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, x = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${x ? '  ' + x : ''}`); };

const det = detectAndMapBank(grid as never);
ck('detected Bank of Maharashtra', det?.bank === 'Bank of Maharashtra', `(got ${det?.bank})`);
if (!det) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }

const { rows: txns } = applyMapping(det.grid, det.mapping, 'bank');
ck('3 transactions reconstructed', txns.length === 3, `(got ${txns.length})`);
ck('amounts via balance delta: +100, −50, +25', JSON.stringify(txns.map(t => t.amount)) === JSON.stringify([100, -50, 25]), JSON.stringify(txns.map(t => t.amount)));
ck('misaligned debit (txn 2) recovered as −50', txns[1]?.amount === -50);
ck('balances preserved', JSON.stringify(txns.map(t => t.balance)) === JSON.stringify([1100, 1050, 1075]));
ck('dates parsed (dd/mm/yyyy → ISO)', txns[0]?.date === '2025-04-01' && txns[2]?.date === '2025-04-03');
ck('narration merges prefix+inline+suffix', (txns[0]?.narration || '').includes('UPI 111111111111/UTIB/ALICE') && (txns[0]?.narration || '').includes('PAY/UPI'));
// reconcile: opening + credits − debits == last balance
const opening = +(txns[0].balance! - txns[0].amount).toFixed(2);
let cr = 0, dr = 0; for (const t of txns) { if (t.amount > 0) cr += t.amount; else dr += -t.amount; }
ck('reconciles to closing balance', +(opening + cr - dr).toFixed(2) === txns[txns.length - 1].balance, `(opening ${opening} +${cr} −${dr})`);

// A non-BOM grid must NOT trip the rule (no "mahabank" fingerprint).
const other = { ...grid, rows: grid.rows.map(r => r.map(c => c.replace(/mahabank|MAHB0\d+/gi, 'xxx'))) };
ck('non-BOM grid not detected as BOM', detectAndMapBank(other as never)?.bank !== 'Bank of Maharashtra');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
