/**
 * Client-side Excel (.xlsx / .xls) → 2D rows extractor.
 *
 * Mirrors the CSV path: load the workbook with ExcelJS, take every
 * worksheet, convert to an array-of-arrays (header row included), then
 * concatenate sheets with a separator row so the column-mapping
 * wizard sees a single grid.
 *
 * The wizard / applyMapping pipeline already tolerates noise rows
 * (page totals, openers, blanks), so we don't try to be clever about
 * which sheet "the data" is on — we let the wizard handle it.
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

export async function excelToRows(file: File): Promise<string[][] | null> {
  const buf = await file.arrayBuffer();
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
