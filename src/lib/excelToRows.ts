/**
 * Client-side Excel (.xlsx / .xls) → 2D rows extractor.
 *
 * Mirrors the CSV path: load the workbook, take every worksheet,
 * convert to an array-of-arrays (header row included), then concatenate
 * sheets with a separator row so the column-mapping wizard sees a
 * single grid.
 *
 * Two engines, chosen by the file's actual magic bytes (NOT its
 * extension — banks mislabel constantly):
 *
 *   • Modern .xlsx (OOXML, a ZIP — starts with "PK") → ExcelJS. This is
 *     the well-tested path with native Date handling.
 *
 *   • Legacy binary .xls (BIFF5/BIFF8, an OLE2 compound document) and
 *     the HTML-table-renamed-".xls" files that ICICI / Bank of Baroda /
 *     HDFC net-banking hand out → SheetJS (xlsx). ExcelJS only reads
 *     OOXML and returns an EMPTY workbook (0 worksheets) on these,
 *     which used to surface as the misleading "Excel appears empty or
 *     has no data rows" error. SheetJS reads all of them. It's lazily
 *     imported so the common .xlsx path never pulls it into the bundle.
 *
 * The wizard / applyMapping pipeline already tolerates noise rows (page
 * totals, openers, blanks, the metadata header block these bank exports
 * carry), so we don't try to be clever about which sheet "the data" is
 * on — we hand it the lot and let the wizard map it.
 */
import ExcelJS from 'exceljs';

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) {
    // YYYY-MM-DD — wizard's date detector handles this format natively.
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'object') {
    const v = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: unknown }> };
    if (Array.isArray(v.richText)) return v.richText.map(rt => String(rt.text ?? '')).join('');
    if (typeof v.text === 'string') return v.text;
    if (v.result != null) return cellText(v.result);
    return '';
  }
  return String(value).trim();
}

/** Modern OOXML .xlsx via ExcelJS. Returns null if there are no rows. */
async function xlsxViaExcelJs(buf: ArrayBuffer): Promise<string[][] | null> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const all: string[][] = [];
  const sheetCount = wb.worksheets.length;
  for (const ws of wb.worksheets) {
    if (ws.rowCount === 0) continue;
    if (sheetCount > 1) {
      all.push([`-- Sheet: ${ws.name} --`]);
    }
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as unknown[];
      // ExcelJS pads index 0 (1-based columns) — slice from 1.
      const cells = (values.length > 0 ? values.slice(1) : []).map(cellText);
      if (cells.some(c => c !== '')) all.push(cells);
    });
  }
  return all.length ? all : null;
}

/**
 * Legacy binary .xls / HTML-table .xls via SheetJS. `raw: false` gives
 * each cell's DISPLAYED text (same as the CSV path / what the user sees
 * in Excel), so "5,445.00" and "19/04/2026" arrive as strings the
 * wizard's number/date detectors already understand. Lazy-imported.
 */
async function xlsViaSheetJs(buf: ArrayBuffer): Promise<string[][] | null> {
  const mod = await import('xlsx');
  // SheetJS is CJS; under esbuild/Vite interop its API may sit on the
  // module namespace or on `.default`. Normalise either way.
  const XLSX = ('read' in mod ? mod : (mod as { default: typeof mod }).default) as typeof import('xlsx');
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false });
  const all: string[][] = [];
  const multi = wb.SheetNames.length > 1;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      blankrows: false,
      defval: '',
      raw: false,
    });
    if (!rows.length) continue;
    if (multi) all.push([`-- Sheet: ${name} --`]);
    for (const r of rows) {
      const cells = (r as unknown[]).map(c => (c == null ? '' : String(c).trim()));
      if (cells.some(c => c !== '')) all.push(cells);
    }
  }
  return all.length ? all : null;
}

export async function excelToRows(file: File): Promise<string[][] | null> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 4));
  // "PK" (0x50 0x4B) is the ZIP local-file-header magic → an OOXML
  // .xlsx. Anything else (OLE2 .xls "D0 CF 11 E0", an HTML table, …)
  // goes to SheetJS.
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (isZip) {
    try {
      const rows = await xlsxViaExcelJs(buf);
      if (rows) return rows;
      // Parsed but empty — fall through to SheetJS as a last resort in
      // case ExcelJS silently dropped a non-standard workbook.
    } catch (err) {
      console.warn('[excelToRows] ExcelJS failed on a ZIP file, falling back to SheetJS:', err);
    }
  }
  return xlsViaSheetJs(buf);
}
