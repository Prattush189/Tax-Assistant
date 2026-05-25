/**
 * Trial Balance upload step. Accepts Excel/CSV, lets the user pick
 * the right sheet (multi-sheet workbooks), then identify which
 * columns hold account name + debit balance + credit balance.
 *
 * Supports optional previous-year TB for Schedule III's
 * comparative-year column. Both years share the mapping (account
 * names are identical across years), so the mapping step only
 * looks at the current-year row labels.
 */
import { useRef, useState } from 'react';
import { Upload, FileCheck2, X } from 'lucide-react';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { Card, Field, TextInput } from '../../itr/shared/Inputs';
import { extractPdfGrid } from '../../../lib/pdfGrid';
import type { TbBsDraft, TbUpload, TbBsInputType } from '../lib/uiModel';
import { cn } from '../../../lib/utils';

interface Props {
  draft: TbBsDraft;
  onChange: (patch: Partial<TbBsDraft>) => void;
}

const ACCEPT = '.xlsx,.xls,.csv,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/pdf';
const MAX_BYTES = 10 * 1024 * 1024;

function readCell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'object') {
    const v = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: unknown }> };
    if (Array.isArray(v.richText)) return v.richText.map((rt) => String(rt.text ?? '')).join('');
    if (typeof v.text === 'string') return v.text;
    if (v.result != null) return String(v.result);
    return '';
  }
  return String(value).trim();
}

async function parseFile(file: File): Promise<{ sheetName: string; rows: string[][] } | { workbook: ExcelJS.Workbook; sheets: string[] } | null> {
  const lname = file.name.toLowerCase();

  // CSV — fastest path, no fancy library work.
  if (lname.endsWith('.csv') || file.type === 'text/csv') {
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
    const rows = parsed.data as string[][];
    return rows.length ? { sheetName: 'CSV', rows } : null;
  }

  // PDF — reuse the grid extractor from bank-statements/ledger-compare.
  // BS PDFs from Tally / Busy / Marg have text layers we can grid;
  // scanned PDFs return null (we toast the user to re-export as Excel).
  if (lname.endsWith('.pdf') || file.type === 'application/pdf') {
    const grid = await extractPdfGrid(file);
    if (!grid || grid.rows.length === 0) return null;
    return { sheetName: 'PDF', rows: grid.rows };
  }

  // Excel — workbook with possibly multiple sheets.
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheets = wb.worksheets.filter((ws) => ws.rowCount > 0);
  if (sheets.length === 0) return null;
  if (sheets.length === 1) {
    const rows = extractRows(sheets[0]);
    return { sheetName: sheets[0].name, rows };
  }
  return { workbook: wb, sheets: sheets.map((s) => s.name) };
}

function extractRows(ws: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[];
    const cells = (values.length > 0 ? values.slice(1) : []).map(readCell);
    if (cells.some((c) => c !== '')) rows.push(cells);
  });
  return rows;
}

interface UploadPanelProps {
  label: string;
  hint: string;
  upload: TbUpload | undefined;
  onUpdate: (upload: TbUpload | undefined) => void;
}

function UploadPanel({ label, hint, upload, onUpdate }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [pendingWb, setPendingWb] = useState<{ wb: ExcelJS.Workbook; sheets: string[]; filename: string } | null>(null);
  const u = upload ?? {};

  const patch = (p: Partial<TbUpload>) => onUpdate({ ...u, ...p });

  const onFile = async (file: File) => {
    if (file.size > MAX_BYTES) { toast.error('File exceeds 10 MB.'); return; }
    setProcessing(true);
    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    try {
      const res = await parseFile(file);
      if (!res) {
        // Scanned-PDF case: extractPdfGrid returns null when the PDF
        // has no text layer (image-only — common with very old
        // Marg exports or scanned hard copies). Tell the user the
        // exact workaround instead of a generic parse error.
        if (isPdf) {
          toast.error(
            'This PDF appears to be scanned (no text layer). Re-export from Tally / Busy / Marg as Excel (.xlsx) — that path works.',
            { duration: 8000 },
          );
        } else {
          toast.error('Could not parse the file. Check it has data rows.');
        }
        return;
      }
      if ('workbook' in res) {
        setPendingWb({ wb: res.workbook, sheets: res.sheets, filename: file.name });
        return;
      }
      patch({ filename: file.name, sheetName: res.sheetName, rows: res.rows });
    } catch (err) {
      console.error(err);
      // Same diagnostic split on the error path — pdfjs throws on
      // some scanned PDFs rather than returning null.
      if (isPdf) {
        toast.error(
          'Could not read this PDF. If it\'s a scanned document, re-export from your accounting software as Excel.',
          { duration: 8000 },
        );
      } else {
        toast.error('Failed to read the file. Try saving as .xlsx and uploading again.');
      }
    } finally {
      setProcessing(false);
    }
  };

  const pickSheet = (sheetName: string) => {
    if (!pendingWb) return;
    const ws = pendingWb.wb.getWorksheet(sheetName);
    if (!ws) return;
    const rows = extractRows(ws);
    patch({ filename: pendingWb.filename, sheetName, rows });
    setPendingWb(null);
  };

  const onClear = () => {
    onUpdate(undefined);
    setPendingWb(null);
  };

  const hasRows = (u.rows?.length ?? 0) > 0;
  const totalCols = u.rows?.[0]?.length ?? 0;

  return (
    <Card title={label}>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{hint}</p>

      {!hasRows && !pendingWb && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={processing}
          className="w-full flex flex-col items-center gap-2 py-6 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors disabled:opacity-50"
        >
          <Upload className="w-5 h-5 text-gray-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {processing ? 'Reading file…' : 'Choose Excel / CSV'}
          </span>
        </button>
      )}

      {pendingWb && (
        <div className="space-y-2">
          <p className="text-sm text-gray-700 dark:text-gray-300">Multi-sheet workbook — pick the TB sheet:</p>
          <div className="grid grid-cols-2 gap-2">
            {pendingWb.sheets.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => pickSheet(s)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-800 hover:border-emerald-400 text-left text-gray-800 dark:text-gray-200"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasRows && (
        <>
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-800/60 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <FileCheck2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{u.filename}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Sheet: {u.sheetName} · {(u.rows?.length ?? 0).toLocaleString('en-IN')} rows
                </p>
              </div>
            </div>
            <button type="button" onClick={onClear} className="p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/30">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          <Field label="Year label" hint="Used in the Schedule III column header (e.g., FY 24-25)">
            <TextInput value={u.yearLabel} onChange={(v) => patch({ yearLabel: v })} placeholder="FY 24-25" />
          </Field>

          <div className="grid grid-cols-3 gap-2 mt-2">
            <ColumnPicker label="Account name column" totalCols={totalCols} rows={u.rows!} value={u.accountColumn ?? 0} onChange={(c) => patch({ accountColumn: c })} />
            <ColumnPicker label="Debit balance column" totalCols={totalCols} rows={u.rows!} value={u.debitColumn ?? -1} onChange={(c) => patch({ debitColumn: c >= 0 ? c : null })} allowNone />
            <ColumnPicker label="Credit balance column" totalCols={totalCols} rows={u.rows!} value={u.creditColumn ?? -1} onChange={(c) => patch({ creditColumn: c >= 0 ? c : null })} allowNone />
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
            Use both Debit and Credit columns when the TB has them split. If your TB has a single signed balance column, pick it as <span className="font-medium">Debit</span> and leave Credit as "None".
          </p>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
    </Card>
  );
}

function ColumnPicker({ label, totalCols, rows, value, onChange, allowNone }: {
  label: string;
  totalCols: number;
  rows: string[][];
  value: number;
  onChange: (col: number) => void;
  allowNone?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-[11px] uppercase text-gray-500 dark:text-gray-400 tracking-wider mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full px-2 py-1.5 text-xs rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700"
      >
        {allowNone && <option value={-1}>None</option>}
        {Array.from({ length: totalCols }, (_, i) => (
          <option key={i} value={i}>
            Col {i + 1} ({(rows[0]?.[i] ?? '').slice(0, 20) || '—'})
          </option>
        ))}
      </select>
    </label>
  );
}

export function TbUploadStep({ draft, onChange }: Props) {
  const inputType: TbBsInputType = draft.inputType ?? 'tb';
  const isBs = inputType === 'bs';
  const setInputType = (next: TbBsInputType) => onChange({ inputType: next });

  return (
    <div className="space-y-4">
      <Card title="What are you uploading?">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Both paths produce the same Schedule III / ICAI Non-Corporate / Tally output. The TB path
          asks you to map ~100 ledger accounts; the BS path is faster since the rows are already
          aggregated.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setInputType('tb')}
            className={cn(
              'p-3 rounded-lg border text-left',
              inputType === 'tb'
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 ring-2 ring-emerald-500/30'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300',
            )}
          >
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Trial Balance</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Raw ledger balances from Tally / Busy / Marg. ~100–200 rows; map each to a canonical line.
            </p>
          </button>
          <button
            type="button"
            onClick={() => setInputType('bs')}
            className={cn(
              'p-3 rounded-lg border text-left',
              inputType === 'bs'
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 ring-2 ring-emerald-500/30'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300',
            )}
          >
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Balance Sheet</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Already-prepared BS. ~20–30 aggregated rows; faster mapping.
            </p>
          </button>
        </div>
      </Card>

      <UploadPanel
        label={`Current-year ${isBs ? 'Balance Sheet' : 'Trial Balance'} (required)`}
        hint={isBs
          ? 'Excel, CSV, or PDF — Tally / Busy / Marg BS exports all work.'
          : 'Tally / Busy / Marg TB exports work — we\'ll guide column selection.'}
        upload={draft.currentTb}
        onUpdate={(u) => onChange({ currentTb: u })}
      />
      <UploadPanel
        label={`Previous-year ${isBs ? 'Balance Sheet' : 'Trial Balance'} (optional)`}
        hint={isBs
          ? 'Comparative figures required when the entity has filed before. Skip for first filing.'
          : 'Schedule III requires comparative figures when the entity has filed before. Skip if this is the first filing.'}
        upload={draft.previousTb}
        onUpdate={(u) => onChange({ previousTb: u })}
      />
    </div>
  );
}
