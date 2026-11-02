/** Where each sample ledger goes now that there is no mapping screen
 *  (src/lib/ledgerRouting — the exact functions the ledger uploader and
 *  the compare view call).
 *
 *  Checks: a mapped route always has transactions and accounts (or a
 *  party), is never contradicted by its own running balances, and a
 *  header guess is only used when the balances prove it. Prints the
 *  route of every file. Run: npx tsx scripts/smoke-ledger-routing.mts [dir]
 *  ("-scrutiny" files are the app's own audit reports, not ledgers.)
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
const { extractPdfGrid, rowsToFakeGrid } = await import('../src/lib/pdfGrid');
const { excelToRows } = await import('../src/lib/excelToRows');
const { routeLedgerPdf, routeLedgerSheet } = await import('../src/lib/ledgerRouting');
type Route = ReturnType<typeof routeLedgerPdf>;

const DIR = process.argv[2] ?? 'C:/Users/Prattush/Downloads/Smart AI/Ledgers';
if (!fs.existsSync(DIR)) { console.log(`samples not found: ${DIR} — skipped`); process.exit(0); }
const files = fs.readdirSync(DIR).filter(f => /\.(pdf|csv|xlsx?)$/i.test(f) && !/-scrutiny/i.test(f)).sort();

let pass = 0, fail = 0;
const ck = (n: string, ok: boolean) => { ok ? pass++ : fail++; if (!ok) console.log(`  ✗ ${n}`); };
const describe = (r: Route) => {
  if (r.kind === 'mapped') {
    const c = r.checked;
    return `mapped    ${r.software} — ${c.mapped.rows.length} rows, ${c.extracted?.accounts.length} account(s), running balances ${c.agreeing}/${c.checkpoints}`;
  }
  return r.meta?.formatReason
    ? `AI reader ${r.meta.formatReason}${r.meta.detectedSoftware ? ` (${r.meta.detectedSoftware})` : ''} → filed as format request`
    : 'AI vision (scan, after cost confirmation) — not filed';
};
const tally: Record<string, number> = {};

for (const f of files) {
  const buf = new Uint8Array(fs.readFileSync(path.join(DIR, f)));
  const isPdf = /\.pdf$/i.test(f);
  let route: Route;
  try {
    if (isPdf) {
      route = routeLedgerPdf(await extractPdfGrid(new File([buf], f, { type: 'application/pdf' })));
    } else {
      const rows = /\.csv$/i.test(f)
        ? Papa.parse<string[]>(new TextDecoder().decode(buf), { skipEmptyLines: true }).data as string[][]
        : await excelToRows(new File([buf], f));
      const grid = rows ? rowsToFakeGrid(rows) : null;
      if (!grid) { console.log(`${f}\n  → empty sheet`); continue; }
      route = routeLedgerSheet(grid);
    }
  } catch (e) {
    console.log(`${f}\n  → ERROR ${(e as Error).message.slice(0, 160)}`);
    fail++;
    continue;
  }
  console.log(`${f}\n  → ${describe(route)}`);
  const key = route.kind === 'reader' ? `reader:${route.meta?.formatReason ?? 'scan'}` : route.kind;
  tally[key] = (tally[key] ?? 0) + 1;
  if (route.kind === 'mapped') {
    ck(`${f}: mapped ledger is usable`, route.checked.usable && !!route.checked.extracted);
    ck(`${f}: not contradicted by running balances`, !route.checked.contradicted);
    if (route.software === 'Columns recognised') ck(`${f}: header guess proven by balances`, route.checked.proven);
  }
}

console.log('\nroutes:', JSON.stringify(tally));
console.log(`${pass} checks passed, ${fail} failed`);
if (fail) process.exit(1);
