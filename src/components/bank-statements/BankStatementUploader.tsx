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
  PdfPasswordError,
  type ColumnMapping,
  type PdfGrid,
} from '../../lib/pdfGrid';
import { PasswordPromptDialog } from '../shared/PasswordPromptDialog';

function AnalyzeProgressBar({
  progress,
  chunksDone,
  chunksTotal,
  startedAt,
}: {
  progress: BankStatementAnalyzeProgress;
  /** From the polled statement row — surfaces the wizard CSV path's
   *  per-batch progress (TSV chunked path uses `progress` from SSE). */
  chunksDone?: number;
  chunksTotal?: number;
  startedAt?: number;
}) {
  // Prefer DB-polled chunk progress (wizard CSV path). Fall back to
  // SSE-streamed progress (TSV chunked path).
  const usingChunks = (chunksTotal ?? 0) > 0;
  const total = usingChunks ? chunksTotal! : (progress.total || 0);
  const completed = usingChunks ? (chunksDone ?? 0) : progress.completed;
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  let eta: string | null = null;
  if (usingChunks && completed > 0 && startedAt && completed < total) {
    const elapsedMs = Date.now() - startedAt;
    const avgMsPerChunk = elapsedMs / completed;
    const remainingMs = avgMsPerChunk * (total - completed);
    const mins = Math.ceil(remainingMs / 60000);
    eta = mins <= 1 ? '~1 min remaining' : `~${mins} min remaining`;
  }

  const label = total > 0
    ? usingChunks
      ? `Categorising batch ${completed} of ${total}`
      : `Section ${Math.min(progress.completed + (progress.completed === total ? 0 : 1), total)} of ${total}${progress.pages ? ` · pages ${progress.pages[0]}–${progress.pages[1]}` : ''}`
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
        {eta ? ` · ${eta}` : ''}
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
  // Password-protected PDFs go here. The dialog calls onSubmit with
  // the entered password; we re-run extractPdfGrid with it. If it
  // still fails, wrongPassword flips and the user can try again.
  const [pendingPassword, setPendingPassword] = useState<{
    file: File;
    wrongPassword: boolean;
  } | null>(null);
  // True while extractPdfGrid is parsing a freshly-picked PDF, before
  // the column-mapping wizard opens. Without this the dropzone looks
  // idle for the 1-3s pdfjs takes on a multi-page statement, which
  // reads as "did my click register?". Cleared when the wizard opens
  // OR when we route to the analyze pipeline.
  const [isReadingPdf, setIsReadingPdf] = useState(false);

  // Pull batch progress off the in-flight statement (the placeholder
  // row's analyze_chunks_* fields, polled every 5s by the manager).
  const inFlight = manager.statements.find(s => s.status === 'analyzing');
  const chunksDone = inFlight?.analyzeChunksDone ?? 0;
  const chunksTotal = inFlight?.analyzeChunksTotal ?? 0;
  const analyzeStartedAt = useRef<number | null>(null);
  if (chunksTotal > 0 && analyzeStartedAt.current === null) {
    analyzeStartedAt.current = Date.now();
  }
  if (chunksTotal === 0 && analyzeStartedAt.current !== null) {
    analyzeStartedAt.current = null;
  }

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
      setIsReadingPdf(true);
      try {
        const grid = await extractPdfGrid(file);
        if (grid && grid.rows.length >= 3) {
          setIsReadingPdf(false);
          setPendingGrid({ grid, filename: file.name });
          return;
        }
        // No text layer — fall through to the AI vision path silently.
        // The token-cost difference vs digital PDFs is real but not
        // material enough to interrupt the user with a confirmation
        // dialog every time.
      } catch (err) {
        if (err instanceof PdfPasswordError) {
          // Encrypted bank PDFs are common — pop the unlock prompt
          // instead of falling through to the vision path (which
          // would also fail without the password).
          setIsReadingPdf(false);
          setPendingPassword({ file, wrongPassword: false });
          return;
        }
        console.warn('[BankStatementUploader] grid extraction failed; falling back to vision:', err);
      }
      setIsReadingPdf(false);
    }

    await analyzeRawFile(file);
  };

  const analyzeRawFile = async (file: File) => {
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
    const { rows: mapped, stats } = applyMapping(grid, mapping, 'bank');
    if (mapped.length === 0) {
      toast.error('No transaction rows found after applying the mapping. Re-check the Date column.');
      return;
    }
    // Surface what was filtered so the user can see why the
    // transaction count might be lower than the visual row count
    // in the source PDF. Common case: opening / closing balance
    // markers and wrapped narrations (no date) get correctly merged
    // into the previous transaction.
    const filteredCount = stats.totalGridRows - stats.transactions;
    if (filteredCount > 0) {
      const parts: string[] = [];
      if (stats.mergedContinuations > 0) {
        parts.push(`${stats.mergedContinuations} wrapped narration line${stats.mergedContinuations === 1 ? '' : 's'} merged into previous transactions`);
      }
      if (stats.skippedNoAmount > 0) {
        parts.push(`${stats.skippedNoAmount} row${stats.skippedNoAmount === 1 ? '' : 's'} skipped (date but no debit / credit — usually opening / closing balance or page totals)`);
      }
      if (parts.length > 0) {
        toast(`From ${stats.totalGridRows.toLocaleString('en-IN')} grid rows: ${stats.transactions.toLocaleString('en-IN')} transactions — ${parts.join(', ')}.`, { duration: 6000 });
      }
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
        {(manager.isAnalyzing || isReadingPdf)
          ? <Loader2 className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin" />
          : <Upload className="w-8 h-8 text-blue-600 dark:text-blue-400" />}
      </div>
      <div className="text-center w-full max-w-md">
        <p className="font-semibold text-gray-800 dark:text-gray-100">
          {manager.isAnalyzing
            ? 'Analyzing your statement…'
            : isReadingPdf
              ? 'Reading PDF…'
              : 'Drop your bank statement here'}
        </p>
        {manager.isAnalyzing || chunksTotal > 0 ? (
          <AnalyzeProgressBar
            progress={manager.analyzeProgress ?? { completed: 0, total: 0 }}
            chunksDone={chunksDone}
            chunksTotal={chunksTotal}
            startedAt={analyzeStartedAt.current ?? undefined}
          />
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            PDF up to 10 MB — or a CSV export from your bank
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={manager.hasInProgressJob}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          <FileText className="w-4 h-4" />
          Choose file
        </button>
        {/* Cancel button surfaces here (next to the disabled
            Choose-file button) so the user can stop a long
            chunked-categorisation run without scrolling to the
            statement detail view. inFlight is the placeholder
            row that the analyze handler is operating on. */}
        {inFlight && (
          <button
            type="button"
            onClick={async () => {
              try {
                await manager.cancel(inFlight.id);
                toast.success('Analysis cancelled');
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Cancel failed');
              }
            }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
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
      {pendingPassword && (
        <PasswordPromptDialog
          filename={pendingPassword.file.name}
          wrongPassword={pendingPassword.wrongPassword}
          onCancel={() => setPendingPassword(null)}
          onSubmit={async (password) => {
            const file = pendingPassword.file;
            try {
              const grid = await extractPdfGrid(file, password);
              if (grid && grid.rows.length >= 3) {
                setPendingPassword(null);
                setPendingGrid({ grid, filename: file.name });
                return;
              }
              // Decrypted but no usable text layer: fall through to
              // AI vision silently — column mapping is unavailable on
              // image-only PDFs but the cost difference isn't worth a
              // separate confirmation step.
              setPendingPassword(null);
              await analyzeRawFile(file);
            } catch (err) {
              if (err instanceof PdfPasswordError) {
                // Wrong password — re-show with the inline error.
                setPendingPassword({ file, wrongPassword: true });
                return;
              }
              setPendingPassword(null);
              toast.error(err instanceof Error ? err.message : 'Failed to read PDF');
            }
          }}
        />
      )}
    </div>
  );
}
