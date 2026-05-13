/**
 * Ledger compare flow: reconcile Entity A's copy of a ledger against
 * Entity B's copy. Each side runs through the same wizard pipeline as
 * the single ledger flow (PDF/CSV/Excel → grid → ColumnMappingWizard →
 * mappedRowsToExtractedLedger), then once both are extracted we POST to
 * /api/ledger-scrutiny/compare which returns a reconciliation report.
 */
import { useRef, useState } from 'react';
import { Loader2, Scale, Upload, FileCheck2, X } from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { ColumnMappingWizard } from '../shared/ColumnMappingWizard';
import { excelToRows } from '../../lib/excelToRows';
import {
  applyMapping,
  extractPdfGrid,
  mappedRowsToExtractedLedger,
  rowsToFakeGrid,
  type ColumnMapping,
  type PdfGrid,
} from '../../lib/pdfGrid';
import { detectAndMapLedgerErp } from '../../lib/perLedgerErpRules';
import {
  createLedgerComparison,
  type LedgerComparisonReport,
} from '../../services/api';
import { cn } from '../../lib/utils';

type Side = 'A' | 'B';

interface ExtractedLedger {
  partyName: string | null;
  gstin: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  accounts: Array<{
    name: string;
    accountType: string | null;
    opening: number;
    closing: number;
    totalDebit: number;
    totalCredit: number;
    transactions: Array<{
      date: string | null;
      narration: string | null;
      voucher: string | null;
      debit: number;
      credit: number;
      balance: number | null;
    }>;
  }>;
}

interface SideState {
  label: string;
  filename: string | null;
  extracted: ExtractedLedger | null;
  /** True while a freshly-picked file is being parsed (browser-side
   *  PDF/Excel/CSV read + grid extract) BEFORE the wizard opens or
   *  the result lands in `extracted`. Renders a spinner so the user
   *  sees the click registered — without it the upload button
   *  appears unresponsive for the 1-3s of extractPdfGrid work. */
  processing: boolean;
}

const ACCEPT = '.pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
const MAX_BYTES = 10 * 1024 * 1024;

function fmtINR(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + '₹' + Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function SideUploader({
  side, state, onLabelChange, onPickFile, onClear, busy,
}: {
  side: Side;
  state: SideState;
  onLabelChange: (label: string) => void;
  onPickFile: () => void;
  onClear: () => void;
  busy: boolean;
}) {
  const ready = state.extracted !== null;
  const txCount = state.extracted?.accounts.reduce((s, a) => s + a.transactions.length, 0) ?? 0;
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-sm font-bold">
          {side}
        </span>
        <input
          type="text"
          value={state.label}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder={`Entity ${side} name (e.g. Acme Traders)`}
          className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          maxLength={80}
        />
      </div>
      {ready ? (
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-800/60">
          <div className="flex items-center gap-2 min-w-0">
            <FileCheck2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{state.filename}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{txCount.toLocaleString('en-IN')} transactions extracted</p>
            </div>
          </div>
          <button type="button" onClick={onClear} className="p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/30">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      ) : state.processing ? (
        <div className="flex items-center gap-3 px-3 py-4 rounded-lg bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/60">
          <Loader2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 animate-spin shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">Reading {state.filename ?? 'file'}…</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Detecting ERP, mapping columns, extracting accounts</p>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPickFile}
          disabled={busy}
          className="w-full flex flex-col items-center gap-2 py-6 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors disabled:opacity-50"
        >
          <Upload className="w-6 h-6 text-gray-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Choose ledger PDF / CSV / Excel</span>
          <span className="text-xs text-gray-400">max 10 MB</span>
        </button>
      )}
    </div>
  );
}

function ReportTable<T>({
  title, rows, columns,
}: {
  title: string;
  rows: T[];
  columns: Array<{ header: string; cell: (row: T) => React.ReactNode; align?: 'left' | 'right' }>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">{title} <span className="text-gray-400 font-normal">({rows.length})</span></h3>
      </div>
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/30 sticky top-0">
            <tr>
              {columns.map((c, i) => (
                <th key={i} className={cn('px-4 py-2 font-medium text-gray-500 dark:text-gray-400', c.align === 'right' ? 'text-right' : 'text-left')}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                {columns.map((c, j) => (
                  <td key={j} className={cn('px-4 py-2 text-gray-700 dark:text-gray-300', c.align === 'right' ? 'text-right tabular-nums' : '')}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LedgerCompareView() {
  const inputRefA = useRef<HTMLInputElement>(null);
  const inputRefB = useRef<HTMLInputElement>(null);
  const [sideA, setSideA] = useState<SideState>({ label: '', filename: null, extracted: null, processing: false });
  const [sideB, setSideB] = useState<SideState>({ label: '', filename: null, extracted: null, processing: false });
  const [pendingGrid, setPendingGrid] = useState<{
    side: Side;
    grid: PdfGrid;
    filename: string;
    /** The original File reference so the wizard's "Use AI Vision
     *  instead" button can re-POST it to the extract-only endpoint
     *  if the deterministic mapping doesn't fit. */
    file: File | null;
    presetMapping?: ColumnMapping;
    detectedErp?: string;
  } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [report, setReport] = useState<LedgerComparisonReport | null>(null);
  const [usedLabels, setUsedLabels] = useState<{ A: string; B: string } | null>(null);

  const handleFile = async (side: Side, files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const lname = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || lname.endsWith('.pdf');
    const isCsv = file.type === 'text/csv' || lname.endsWith('.csv');
    const isExcel = lname.endsWith('.xlsx') || lname.endsWith('.xls');
    if (!isPdf && !isCsv && !isExcel) {
      toast.error('Only PDF, CSV, and Excel ledger exports are accepted.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('File exceeds 10 MB. Split the export and try again.');
      return;
    }

    // Show the per-side spinner with the filename as soon as parse
    // work begins. Cleared by a `finally` below — covers the wizard-
    // open path, the error-toast path, and the CSV/Excel quick paths
    // alike. Without this the upload button just disabled itself for
    // the 1-3s of extractPdfGrid work and the user couldn't tell if
    // anything was happening.
    const setProcessing = (on: boolean) => {
      const updater = (prev: SideState) => ({ ...prev, processing: on, filename: on ? file.name : prev.filename });
      if (side === 'A') setSideA(updater);
      else setSideB(updater);
    };
    setProcessing(true);
    try {

    if (isCsv) {
      const text = await file.text();
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
      const grid = rowsToFakeGrid(parsed.data as string[][]);
      if (!grid) { toast.error('CSV appears empty.'); return; }
      setPendingGrid({ side, grid, filename: file.name, file: null });
      return;
    }
    if (isExcel) {
      try {
        const rows = await excelToRows(file);
        const grid = rows ? rowsToFakeGrid(rows) : null;
        if (!grid) { toast.error('Excel appears empty.'); return; }
        setPendingGrid({ side, grid, filename: file.name, file: null });
      } catch (err) {
        console.error(err);
        toast.error('Could not read Excel file.');
      }
      return;
    }
    // PDF
    try {
      const grid = await extractPdfGrid(file);
      if (grid && grid.rows.length >= 3) {
        // Per-ERP deterministic auto-mapping. If the grid matches
        // a known Tally / Busy / Marg / Finsys layout, pre-fill the
        // wizard with the rule's mapping + a banner identifying
        // the ERP — the user reviews and confirms rather than
        // having transactions silently extracted on the wrong
        // columns. Finsys is included: its 2-rows-per-transaction
        // layout used to defeat the grid extractor (row-2 voucher
        // rows fail parseDate) and force AI vision, but with the
        // mergeHeaderDataColumnPairs pass + applyMapping's
        // continuation-merge that joins row-2 onto row-1, the
        // deterministic path now handles Finsys cleanly — same as
        // the single-ledger uploader.
        //
        // Use detected.grid (post-preprocess) — when a rule's
        // preprocess hook reshapes the grid (e.g. Tally splits the
        // merged "Vch No. Debit" column into two), the mapping is
        // indexed against the new grid. Feeding the wizard the raw
        // grid would render an off-by-one preview.
        const detected = detectAndMapLedgerErp(grid);
        if (detected) {
          console.log(`[LedgerCompareView] side ${side} auto-detected ${detected.erp} — pre-filling wizard for review`);
          setPendingGrid({
            side,
            grid: detected.grid,
            filename: file.name,
            file,
            presetMapping: detected.mapping,
            detectedErp: detected.erp,
          });
          return;
        }
        setPendingGrid({ side, grid, filename: file.name, file });
        return;
      }
      // No text layer — compare mode requires structured input on
      // both sides for the diff to be reliable, so scanned PDFs
      // are refused here. The user can run the file through
      // single-ledger scrutiny first (which uses vision) then
      // export the parsed result to bring into compare.
      toast.error('This PDF has no readable text layer. Compare mode requires a digital PDF / CSV / Excel on both sides. Scanned files: run single-ledger scrutiny first, then bring the parsed result into compare.', { duration: 9000 });
    } catch (err) {
      console.error(err);
      toast.error('Could not read this PDF.');
    }

    } finally {
      // Always clear the spinner — whether we exited via the wizard
      // (pendingGrid set, the wizard takes over visually), via toast
      // error, or via successful CSV/Excel commit.
      setProcessing(false);
    }
  };

  /** Shared finish path. Used by both the per-ERP auto-mapping
   *  shortcut (no wizard) and the user-confirmed wizard mapping.
   *  Pulls the extracted ledger into the relevant side's state and
   *  surfaces the transaction count + ERP name (when auto-detected)
   *  so the user can see which side mapped automatically. */
  const applyAndStore = (
    side: Side,
    grid: PdfGrid,
    mapping: ColumnMapping,
    filename: string,
    autoErp?: string,
  ) => {
    const { rows: mapped, stats } = applyMapping(grid, mapping, 'ledger');
    if (mapped.length === 0) {
      const reason = stats.skippedNoAmount > 0
        ? `Found ${stats.skippedNoAmount.toLocaleString('en-IN')} candidate row${stats.skippedNoAmount === 1 ? '' : 's'} with parseable dates, but none had a usable Debit / Credit / Amount value. Re-check the amount column mapping.`
        : stats.totalGridRows === 0
          ? 'Grid is empty — re-upload the file.'
          : `Scanned ${stats.totalGridRows.toLocaleString('en-IN')} grid rows but none had a parseable date in the column you mapped to "Date". Open the wizard again and pick the column that actually contains dates.`;
      toast.error(`No transactions extracted. ${reason}`, { duration: 8000 });
      return;
    }
    // Pull party name from the Tally / Finsys "Ledger Account :
    // <NAME>" banner so single-account exports don't bucket
    // everything under literal 'Default'. Same pattern as the
    // single-ledger uploader.
    const bannerText = grid.rows.slice(0, 30).flat().filter(Boolean).join(' ');
    const partyMatch = /(?:ledger\s+account|account|statement\s+of\s+account|acc\s*[:.])\s*[:.]?\s*([A-Z][A-Z0-9 &.,'\-/()]{3,80})/i.exec(bannerText);
    const partyFromBanner = partyMatch?.[1]?.trim().replace(/\s{2,}/g, ' ');
    const extracted = mappedRowsToExtractedLedger(mapped, partyFromBanner);
    if (side === 'A') {
      setSideA(prev => ({ ...prev, filename, extracted }));
    } else {
      setSideB(prev => ({ ...prev, filename, extracted }));
    }
    const prefix = autoErp ? `${autoErp} — ` : '';
    toast.success(`Side ${side}: ${prefix}${mapped.length.toLocaleString('en-IN')} transactions ready.`);
  };

  const handleMappingConfirm = (mapping: ColumnMapping) => {
    if (!pendingGrid) return;
    const { side, grid, filename } = pendingGrid;
    setPendingGrid(null);
    applyAndStore(side, grid, mapping, filename);
  };

  const canCompare = !!sideA.extracted && !!sideB.extracted && !comparing;

  const runCompare = async () => {
    if (!sideA.extracted || !sideB.extracted) return;
    setComparing(true);
    setReport(null);
    const labelA = sideA.label.trim() || 'Entity A';
    const labelB = sideB.label.trim() || 'Entity B';
    try {
      const res = await createLedgerComparison({
        labelA, labelB,
        filenameA: sideA.filename,
        filenameB: sideB.filename,
        preExtractedA: sideA.extracted,
        preExtractedB: sideB.extracted,
      });
      setReport(res.report);
      setUsedLabels({ A: labelA, B: labelB });
      toast.success('Reconciliation complete.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Comparison failed');
    } finally {
      setComparing(false);
    }
  };

  const reset = () => {
    setSideA({ label: '', filename: null, extracted: null, processing: false });
    setSideB({ label: '', filename: null, extracted: null, processing: false });
    setReport(null);
    setUsedLabels(null);
  };

  const labelA = usedLabels?.A ?? (sideA.label.trim() || 'Entity A');
  const labelB = usedLabels?.B ?? (sideB.label.trim() || 'Entity B');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
          <Scale className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">Compare two ledgers</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Upload the same ledger as kept by two entities — we match by date + amount + narration and flag every gap.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SideUploader
          side="A"
          state={sideA}
          onLabelChange={(l) => setSideA(prev => ({ ...prev, label: l }))}
          onPickFile={() => inputRefA.current?.click()}
          onClear={() => setSideA({ label: sideA.label, filename: null, extracted: null, processing: false })}
          busy={comparing}
        />
        <SideUploader
          side="B"
          state={sideB}
          onLabelChange={(l) => setSideB(prev => ({ ...prev, label: l }))}
          onPickFile={() => inputRefB.current?.click()}
          onClear={() => setSideB({ label: sideB.label, filename: null, extracted: null, processing: false })}
          busy={comparing}
        />
      </div>

      <input ref={inputRefA} type="file" accept={ACCEPT} className="hidden"
        onChange={(e) => { void handleFile('A', e.target.files); if (inputRefA.current) inputRefA.current.value = ''; }} />
      <input ref={inputRefB} type="file" accept={ACCEPT} className="hidden"
        onChange={(e) => { void handleFile('B', e.target.files); if (inputRefB.current) inputRefB.current.value = ''; }} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={runCompare}
          disabled={!canCompare}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {comparing ? <><Loader2 className="w-4 h-4 animate-spin" /> Reconciling…</> : 'Reconcile ledgers'}
        </button>
        {(report || comparing) && (
          <button type="button" onClick={reset} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            Start over
          </button>
        )}
      </div>

      {pendingGrid && (
        <ColumnMappingWizard
          kind="ledger"
          grid={pendingGrid.grid}
          filename={pendingGrid.filename}
          initialMapping={pendingGrid.presetMapping}
          detectedSource={pendingGrid.detectedErp}
          onConfirm={handleMappingConfirm}
          onCancel={() => setPendingGrid(null)}
          /* No onUseVision in compare mode — vision output isn't
             reliable enough for a structural diff (see handleFile
             comment). User cancels and re-runs the file through
             single-ledger scrutiny instead. */
        />
      )}

      {report && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-900/15 p-5">
            <p className="font-semibold text-gray-900 dark:text-gray-100">{report.summary.headline}</p>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
              <Stat label="Matched" value={report.summary.matchedCount} tone="ok" />
              <Stat label="Amount mismatches" value={report.summary.amountMismatchCount} tone={report.summary.amountMismatchCount ? 'warn' : 'ok'} />
              <Stat label="Date mismatches" value={report.summary.dateMismatchCount} tone={report.summary.dateMismatchCount ? 'warn' : 'ok'} />
              <Stat label={`Only in ${labelA}`} value={report.summary.onlyInACount} tone={report.summary.onlyInACount ? 'warn' : 'ok'} />
              <Stat label={`Only in ${labelB}`} value={report.summary.onlyInBCount} tone={report.summary.onlyInBCount ? 'warn' : 'ok'} />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Balance check</h3>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <BalanceCell label={`Opening — ${labelA}`} value={report.balanceCheck.openingA} />
              <BalanceCell label={`Opening — ${labelB}`} value={report.balanceCheck.openingB} />
              <BalanceCell label="Opening gap" value={report.balanceCheck.openingGap} highlight />
              <BalanceCell label={`Closing — ${labelA}`} value={report.balanceCheck.closingA} />
              <BalanceCell label={`Closing — ${labelB}`} value={report.balanceCheck.closingB} />
              <BalanceCell label="Closing gap" value={report.balanceCheck.closingGap} highlight />
            </div>
            {report.balanceCheck.note && (
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{report.balanceCheck.note}</p>
            )}
          </div>

          <ReportTable
            title="Amount mismatches"
            rows={report.amountMismatches}
            columns={[
              { header: 'Date', cell: (r) => r.date },
              { header: `${labelA} narration`, cell: (r) => r.narrationA },
              { header: `${labelB} narration`, cell: (r) => r.narrationB },
              { header: `${labelA} amount`, align: 'right', cell: (r) => fmtINR(r.amountA) },
              { header: `${labelB} amount`, align: 'right', cell: (r) => fmtINR(r.amountB) },
              { header: 'Diff', align: 'right', cell: (r) => fmtINR(r.diff) },
            ]}
          />

          <ReportTable
            title="Date mismatches"
            rows={report.dateMismatches}
            columns={[
              { header: 'Amount', align: 'right', cell: (r) => fmtINR(r.amount) },
              { header: `${labelA} date`, cell: (r) => r.dateA },
              { header: `${labelB} date`, cell: (r) => r.dateB },
              { header: 'Days apart', align: 'right', cell: (r) => r.daysDiff },
              { header: `${labelA} narration`, cell: (r) => r.narrationA },
              { header: `${labelB} narration`, cell: (r) => r.narrationB },
            ]}
          />

          <ReportTable
            title={`Only in ${labelA}`}
            rows={report.onlyInA}
            columns={[
              { header: 'Date', cell: (r) => r.date },
              { header: 'Amount', align: 'right', cell: (r) => fmtINR(r.amount) },
              { header: 'Narration', cell: (r) => r.narration },
              { header: 'Voucher', cell: (r) => r.voucher ?? '—' },
            ]}
          />

          <ReportTable
            title={`Only in ${labelB}`}
            rows={report.onlyInB}
            columns={[
              { header: 'Date', cell: (r) => r.date },
              { header: 'Amount', align: 'right', cell: (r) => fmtINR(r.amount) },
              { header: 'Narration', cell: (r) => r.narration },
              { header: 'Voucher', cell: (r) => r.voucher ?? '—' },
            ]}
          />

          <ReportTable
            title="Matched"
            rows={report.matched}
            columns={[
              { header: 'Date', cell: (r) => r.date },
              { header: 'Amount', align: 'right', cell: (r) => fmtINR(r.amount) },
              { header: `${labelA} narration`, cell: (r) => r.narrationA },
              { header: `${labelB} narration`, cell: (r) => r.narrationB },
            ]}
          />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'warn' }) {
  return (
    <div>
      <p className={cn('text-2xl font-bold tabular-nums', tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400')}>
        {value.toLocaleString('en-IN')}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}

function BalanceCell({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  const isNonZero = Math.abs(value) >= 0.01;
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={cn('font-semibold tabular-nums',
        highlight && isNonZero ? 'text-amber-600 dark:text-amber-400'
          : highlight ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-gray-900 dark:text-gray-100')}>
        {fmtINR(value)}
      </p>
    </div>
  );
}
