/**
 * Client-side Excel (.xlsx / .xls) → 2D rows extractor.
 *
 * Mirrors the CSV path: load the workbook with SheetJS, take every
 * sheet, convert to an array-of-arrays (header row included), then
 * concatenate sheets with a separator row so the column-mapping
 * wizard sees a single grid.
 *
 * The wizard / applyMapping pipeline already tolerates noise rows
 * (page totals, openers, blanks), so we don't try to be clever about
 * which sheet "the data" is on — we let the wizard handle it.
 */
import * as XLSX from 'xlsx';

export async function excelToRows(file: File): Promise<string[][] | null> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const all: string[][] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: '',
      raw: false,
    }) as unknown[][];
    if (rows.length === 0) continue;
    if (wb.SheetNames.length > 1) {
      all.push([`-- Sheet: ${name} --`]);
    }
    for (const r of rows) {
      all.push(r.map(c => (c == null ? '' : String(c).trim())));
    }
  }
  return all.length ? all : null;
}
