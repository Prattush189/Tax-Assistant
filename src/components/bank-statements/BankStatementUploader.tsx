import { useRef, useState } from 'react';
import { Upload, FileText, Loader2 } from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { BankStatementManager } from '../../hooks/useBankStatementManager';
import type { BankStatementAnalyzeProgress } from '../../services/api';
import { cn } from '../../lib/utils';
import { ColumnMappingWizard } from '../shared/ColumnMappingWizard';
import {
  applyMapping,
  extractPdfGrid,
  mappedRowsToBankCsv,
  rowsToFakeGrid,
  type ColumnMapping,
  type PdfGrid,
} from '../../lib/pdfGrid';

function AnalyzeProgressBar({ progress }: { progress: BankStatementAnalyzeProgress }) {
  // While the first `start` event is in flight the server hasn't reported
  // chunk count yet — show an indeterminate hint rather than a 0/0 bar.
  const total = progress.total || 0;
  const pct = total > 0 ? Math.min(100, Math.round((progress.completed / total) * 100)) : 0;
  const label = total > 0
    ? `Section ${Math.min(progress.completed + (progress.completed === total ? 0 : 1), total)} of ${total}${progress.pages ? ` · pages ${progress.pages[0]}–${progress.pages[1]}` : ''}`
    : 'Preparing sections…';
  return (
    <div className="mt-3">
      <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
        <div
          className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-300 ease-out"
          style={{ width: total > 0 ? `${pct}%` : '15%' }}
        />
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {label}{total > 0 ? ` · ${pct}%` : ''}
      </p>
    </div>
  );
}

interface Props {
  manager: BankStatementManager;
}

const ACCEPT = '.pdf,.csv,application/pdf,text/csv';

export function BankStatementUploader({ manager }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Wizard state. When set, the user is mid-mapping for a digital PDF;
  // we hold onto the grid + filename until they confirm or cancel.
  const [pendingGrid, setPendingGrid] = useState<{ grid: PdfGrid; filename: string } | null>(null);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    // Reject anything that isn't PDF or CSV — image upload was the
    // legacy vision path, but the wizard now handles digital PDFs
    // deterministically and the practical accuracy on cellphone-scan
    // images was poor anyway. Scanned PDFs that have no text layer
    // still fall through to the multipart vision path below.
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isCsv = file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv');
    if (!isPdf && !isCsv) {
      toast.error('Only PDF and CSV statements are accepted.');
      return;
    }

    // One analysis at a time. Server enforces the same via
    // findInProgressByHashForUser, but the toast is friendlier than
    // letting the request go through and bounce.
    if (manager.hasInProgressJob) {
      toast.error('A bank statement analysis is already running. Wait for it to finish.');
      return;
    }

    if (isCsv) {
      // Route CSVs through the same column-mapping wizard PDFs use,
      // not directly to the server CSV path. The server's CSV path
      // falls back to hardcoded header guesses
      // (r.date ?? r.Date ?? r['Txn Date'] ?? ...), and any CSV that
      // doesn't match one of those guesses ends up with the wrong
      // signed amount on some rows — the same sign-flip class of
      // failure the wizard was built to eliminate. Going through
      // applyMapping → mappedRowsToBankCsv normalizes to the canonical
      // header set the server expects, so the deterministic
      // categorisation pass produces totals that match the PDF path
      // exactly.
      const text = await file.text();
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
      const grid = rowsToFakeGrid(parsed.data as string[][]);
      if (!grid) {
        toast.error('CSV appears empty or has no data rows.');
        return;
      }
      setPendingGrid({ grid, filename: file.name });
      return;
    }

    // Digital PDF → extract a structured 2D grid and route through the
    // mandatory column-mapping wizard. The wizard maps user → CSV → the
    // existing CSV path, which builds signed amounts deterministically
    // (no LLM in the credit/debit decision). Scanned PDFs with no text
    // layer fall through to the legacy multipart vision path.
    if (isPdf) {
      try {
        const grid = await extractPdfGrid(file);
        if (grid && grid.rows.length >= 3) {
          setPendingGrid({ grid, filename: file.name });
          return;
        }
      } catch (err) {
        console.warn('[BankStatementUploader] grid extraction failed; falling back to vision:', err);
      }
    }

    try {
      const result = await manager.analyzeFile(file);
      toast.success(result.alreadyAnalyzed
        ? `This statement was already analyzed earlier — opened the existing one (${result.transactions.length} transactions).`
        : `Analyzed ${result.transactions.length} transactions`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Analysis failed');
    }
  };

  const handleMappingConfirm = async (mapping: ColumnMapping) => {
    if (!pendingGrid) return;
    const { grid, filename } = pendingGrid;
    setPendingGrid(null);
    const mapped = applyMapping(grid, mapping);
    if (mapped.length === 0) {
      toast.error('No transaction rows found after applying the mapping. Re-check the Date column.');
      return;
    }
    const csv = mappedRowsToBankCsv(mapped);
    try {
      const result = await manager.analyzeCsv(csv, filename);
      toast.success(result.alreadyAnalyzed
        ? `This statement was already analyzed earlier — opened the existing one (${result.transactions.length} transactions).`
        : `Analyzed ${result.transactions.length} transactions deterministically (no AI sign assignment).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Analysis failed');
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        'border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center gap-4 transition-colors',
        isDragging
          ? 'border-blue-400 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-900/10'
          : 'border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/30',
      )}
    >
      <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
        {manager.isAnalyzing
          ? <Loader2 className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin" />
          : <Upload className="w-8 h-8 text-blue-600 dark:text-blue-400" />}
      </div>
      <div className="text-center w-full max-w-md">
        <p className="font-semibold text-gray-800 dark:text-gray-100">
          {manager.isAnalyzing ? 'Analyzing your statement…' : 'Drop your bank statement here'}
        </p>
        {manager.isAnalyzing && manager.analyzeProgress ? (
          <AnalyzeProgressBar progress={manager.analyzeProgress} />
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            PDF up to 500 KB — or a CSV export from your bank
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={manager.hasInProgressJob}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        <FileText className="w-4 h-4" />
        Choose file
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPT}
        onChange={(e) => { void handleFiles(e.target.files); if (inputRef.current) inputRef.current.value = ''; }}
      />
      <p className="text-xs text-gray-400 dark:text-gray-500 max-w-md text-center">
        Transactions are categorised automatically — you can reassign any row before exporting.
      </p>
      {pendingGrid && (
        <ColumnMappingWizard
          kind="bank"
          grid={pendingGrid.grid}
          filename={pendingGrid.filename}
          onConfirm={handleMappingConfirm}
          onCancel={() => setPendingGrid(null)}
        />
      )}
    </div>
  );
}
