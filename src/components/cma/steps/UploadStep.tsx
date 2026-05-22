/**
 * Upload step — accepts a free-form Excel/CSV with P&L + BS data,
 * shows a sheet picker, lets the user identify which columns hold
 * the historical year values, and saves the raw rows into the draft.
 *
 * Free-form input means we DON'T require a template. The downside
 * is mapping work (handled by the next step); the upside is users
 * can upload their Tally / Busy / Marg export directly.
 *
 * On change: the rows and year-label config persist via the draft's
 * `historical` block; the next step (Mapping) reads from there.
 */
import { useRef, useState } from 'react';
import { Upload, FileCheck2, X } from 'lucide-react';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { Card, Field, TextInput } from '../../itr/shared/Inputs';
import type { CmaDraft, HistoricalUpload } from '../lib/uiModel';

interface Props {
  draft: CmaDraft;
  onChange: (patch: Partial<CmaDraft>) => void;
}

const ACCEPT = '.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv';
const MAX_BYTES = 10 * 1024 * 1024;

export function UploadStep({ draft, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const historical = draft.historical ?? {};
  const [sheetOptions, setSheetOptions] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  // Holds the parsed workbook in component state when there are
  // multiple sheets — the user picks one and we extract rows from it.
  // Single-sheet workbooks or CSVs commit rows directly without this
  // intermediate state.
  const [pendingWorkbook, setPendingWorkbook] = useState<ExcelJS.Workbook | null>(null);

  const patchHistorical = (p: Partial<HistoricalUpload>) => {
    onChange({ historical: { ...historical, ...p } });
  };

  const extractSheet = (wb: ExcelJS.Workbook, sheetName: string, filename: string) => {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) return;
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as unknown[];
      const cells = (values.length > 0 ? values.slice(1) : []).map((v) => {
        if (v == null) return '';
        if (v instanceof Date) {
          const y = v.getFullYear();
          const m = String(v.getMonth() + 1).padStart(2, '0');
          const d = String(v.getDate()).padStart(2, '0');
          return `${y}-${m}-${d}`;
        }
        if (typeof v === 'object') {
          const obj = v as { text?: unknown; result?: unknown; richText?: Array<{ text?: unknown }> };
          if (Array.isArray(obj.richText)) return obj.richText.map((rt) => String(rt.text ?? '')).join('');
          if (typeof obj.text === 'string') return obj.text;
          if (obj.result != null) return String(obj.result);
          return '';
        }
        return String(v).trim();
      });
      if (cells.some((c) => c !== '')) rows.push(cells);
    });
    patchHistorical({ filename, sheetName, rows });
    setPendingWorkbook(null);
    setSheetOptions([]);
  };

  const handleFile = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error('File exceeds 10 MB. Reduce file size and try again.');
      return;
    }
    setProcessing(true);
    try {
      if (file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv') {
        const text = await file.text();
        const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
        const rows = parsed.data as string[][];
        if (!rows.length) { toast.error('CSV appears empty.'); return; }
        patchHistorical({ filename: file.name, sheetName: 'CSV', rows });
        return;
      }
      const buf = await file.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const sheets = wb.worksheets.filter((ws) => ws.rowCount > 0);
      if (sheets.length === 0) {
        toast.error('Workbook has no data sheets.');
        return;
      }
      if (sheets.length === 1) {
        extractSheet(wb, sheets[0].name, file.name);
        return;
      }
      // Multi-sheet — surface a picker for the user.
      setPendingWorkbook(wb);
      setSheetOptions(sheets.map((s) => s.name));
      patchHistorical({ filename: file.name });
    } catch (err) {
      console.error(err);
      toast.error('Could not read the file. Try saving as .xlsx and re-uploading.');
    } finally {
      setProcessing(false);
    }
  };

  const onClear = () => {
    onChange({ historical: undefined });
    setPendingWorkbook(null);
    setSheetOptions([]);
  };

  const hasRows = (historical.rows?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <Card title="Upload P&L + Balance Sheet">
        {!hasRows && !sheetOptions.length && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={processing}
            className="w-full flex flex-col items-center gap-2 py-8 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors disabled:opacity-50"
          >
            <Upload className="w-6 h-6 text-gray-400" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {processing ? 'Reading file…' : 'Choose Excel / CSV (P&L + BS combined)'}
            </span>
            <span className="text-xs text-gray-400">
              Supports Tally / Busy / Marg / generic exports — we'll guide column mapping next
            </span>
          </button>
        )}

        {sheetOptions.length > 0 && pendingWorkbook && (
          <div className="space-y-2">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Workbook has multiple sheets. Pick the one containing your financials:
            </p>
            <div className="grid grid-cols-2 gap-2">
              {sheetOptions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => extractSheet(pendingWorkbook, s, historical.filename ?? 'workbook.xlsx')}
                  className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-800 hover:border-emerald-400 dark:hover:border-emerald-600 text-gray-800 dark:text-gray-200 text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {hasRows && (
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-800/60">
            <div className="flex items-center gap-2 min-w-0">
              <FileCheck2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{historical.filename}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Sheet: {historical.sheetName} · {(historical.rows?.length ?? 0).toLocaleString('en-IN')} rows
                </p>
              </div>
            </div>
            <button type="button" onClick={onClear} className="p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/30">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
      </Card>

      {hasRows && (
        <Card title="Year labels">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Label the two historical years your file covers. We'll project the next {draft.projectionHorizon ?? 3} years from these.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Earlier year">
              <TextInput
                value={historical.yearLabels?.[0]}
                onChange={(v) => patchHistorical({ yearLabels: [v ?? '', historical.yearLabels?.[1] ?? ''] })}
                placeholder="FY 23-24"
              />
            </Field>
            <Field label="Latest year">
              <TextInput
                value={historical.yearLabels?.[1]}
                onChange={(v) => patchHistorical({ yearLabels: [historical.yearLabels?.[0] ?? '', v ?? ''] })}
                placeholder="FY 24-25"
              />
            </Field>
          </div>
        </Card>
      )}
    </div>
  );
}
