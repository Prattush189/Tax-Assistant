/** Where each sample statement goes now that there is no mapping screen
 *  (src/lib/statementRouting — the exact functions the uploader calls).
 *
 *  Checks: every sample a bank rule matches is submitted straight away
 *  (its rows agree with the printed running balance), and nothing else is
 *  mapped by a guess the balances don't prove. Prints the route of every
 *  file. Run: npx tsx scripts/smoke-statement-routing.mts [samples dir]
 *  (protected PDFs: STATEMENT_PASSWORDS="<file name>=<password>;…")
 */
// pdfGrid pulls in pdfjs, which touches these browser globals at import.
class DM { a=1;b=0;c=0;d=1;e=0;f=0; constructor(_?:unknown){} multiply(){return this;} translate(){return this;} scale(){return this;} rotate(){return this;} invertSelf(){return this;} }
(globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = DM;
class P2 { constructor(_?:unknown){} addPath(){} moveTo(){} lineTo(){} closePath(){} }
(globalThis as unknown as { Path2D: unknown }).Path2D = P2;
class ID { width:number;height:number;data:Uint8ClampedArray; constructor(w:number,h:number){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);} }
(globalThis as unknown as { ImageData: unknown }).ImageData = ID;

const fs = await import('node:fs');
const path = await import('node:path');
const { pathToFileURL } = await import('node:url');
const { pdfjs } = await import('react-pdf');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve('node_modules/pdfjs-dist/build/pdf.worker.mjs')).href;
const Papa = (await import('papaparse')).default;
const { extractPdfGrid, rowsToFakeGrid, PdfPasswordError } = await import('../src/lib/pdfGrid');
const { excelToRows } = await import('../src/lib/excelToRows');
const { routePdf, routeSpreadsheet, rowsToTsv } = await import('../src/lib/statementRouting');
type Route = Awaited<ReturnType<typeof routePdf>>;

const DIR = process.argv[2] ?? 'C:/Users/Prattush/Downloads/Smart AI/Statements';
if (!fs.existsSync(DIR)) { console.log(`samples not found: ${DIR} — skipped`); process.exit(0); }
const files = fs.readdirSync(DIR).filter(f => /\.(pdf|csv|xlsx?)$/i.test(f)).sort();

let pass = 0, fail = 0;
const ck = (n: string, ok: boolean) => { ok ? pass++ : fail++; if (!ok) console.log(`  ✗ ${n}`); };
const describe = (r: Route) => r.kind === 'mapped'
  ? `mapped    ${r.bank} — ${r.checked.mapped.rows.length} rows, ${r.checked.agreeing}/${r.checked.checkpoints} balances agree`
  : r.kind === 'ledger' ? `ledger    (${r.erp}) — told to use Ledger Scrutiny`
  : r.meta?.formatReason ? `AI reader ${r.meta.formatReason}${r.meta.detectedBank ? ` (${r.meta.detectedBank})` : ''} → filed as format request`
  : 'AI reader scan (OCR) — not filed';
const tally: Record<string, number> = {};

for (const f of files) {
  const full = path.join(DIR, f);
  const buf = new Uint8Array(fs.readFileSync(full));
  const isPdf = /\.pdf$/i.test(f);
  const file = new File([buf], f, { type: isPdf ? 'application/pdf' : /\.csv$/i.test(f) ? 'text/csv' : 'application/vnd.ms-excel' });
  let route: Route;
  let note = '';
  try {
    if (isPdf) {
      let grid;
      try {
        grid = await extractPdfGrid(file);
      } catch (e) {
        if (!(e instanceof PdfPasswordError)) throw e;
        // Passwords: STATEMENT_PASSWORDS="<file name>=<password>;…" (kept
        // out of the repo), or "… PASSWORD 1234.pdf" in the file name.
        const pw = (process.env.STATEMENT_PASSWORDS ?? '').split(';').map(kv => kv.split('=')).find(([k]) => k === f)?.[1]
          ?? /password\s+(\S+?)\.pdf$/i.exec(f)?.[1];
        if (!pw) { console.log(`${f}\n  → password-protected, no password in the name — skipped`); continue; }
        grid = await extractPdfGrid(file, pw);
        note = ' [password-protected; password sent along]';
      }
      route = await routePdf(grid, file);
    } else {
      const rows = /\.csv$/i.test(f)
        ? Papa.parse<string[]>(new TextDecoder().decode(buf), { skipEmptyLines: true }).data as string[][]
        : await excelToRows(file);
      const grid = rows ? rowsToFakeGrid(rows) : null;
      if (!rows || !grid) { console.log(`${f}\n  → empty sheet`); continue; }
      route = routeSpreadsheet(grid);
      if (route.kind === 'reader') note = ` [sheet sent as ${rowsToTsv(rows).split('\n').length}-line TSV]`;
    }
  } catch (e) {
    console.log(`${f}\n  → ERROR ${(e as Error).message.slice(0, 160)}`);
    fail++;
    continue;
  }
  console.log(`${f}\n  → ${describe(route)}${note}`);
  const key = route.kind === 'reader' ? `reader:${route.meta?.formatReason ?? 'scan'}` : route.kind;
  tally[key] = (tally[key] ?? 0) + 1;
  // A mapped route is either a rule the balances don't contradict or a
  // header guess they prove — never an unchecked guess.
  if (route.kind === 'mapped') {
    ck(`${f}: mapped rows are non-empty`, route.checked.mapped.rows.length > 0);
    ck(`${f}: mapped rows not contradicted by balances`, !route.checked.contradicted);
    if (route.bank === 'Columns recognised') ck(`${f}: header guess proven by balances`, route.checked.proven);
  }
  // A rule that matched but disagrees is a regression in that rule.
  ck(`${f}: no bank rule contradicted by its own balances`, !(route.kind === 'reader' && route.meta?.formatReason === 'rule-mismatch'));
}

console.log('\nroutes:', JSON.stringify(tally));
console.log(`${pass} checks passed, ${fail} failed`);
if (fail) process.exit(1);
