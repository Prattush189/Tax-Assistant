import { useRef, useState } from 'react';
import { Upload, FileText, Loader2, Sparkles } from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { FormatSupportNotice } from '../shared/FormatSupportNotice';
import { SUPPORTED_BANKS } from '../../lib/perBankRules';
import { BankStatementManager } from '../../hooks/useBankStatementManager';
import type { BankStatementAnalyzeProgress, StatementFormatMeta } from '../../services/api';
import { cn } from '../../lib/utils';
import { PdfTooLargeDialog } from '../shared/ScannedPdfConfirmDialog';
import { excelToRows } from '../../lib/excelToRows';
import {
  applyMapping,
  extractPdfGrid,
  mappedRowsToBankCsv,
  rowsToFakeGrid,
  PdfPasswordError,
} from '../../lib/pdfGrid';
import { routePdf, routeSpreadsheet, rowsToTsv, type StatementRoute } from '../../lib/statementRouting';
import { PasswordPromptDialog } from '../shared/PasswordPromptDialog';

function AnalyzeProgressBar({
  progress,
  chunksDone,
  chunksTotal,
  startedAt,
  providerFallback,
}: {
  progress: BankStatementAnalyzeProgress;
  /** From the polled statement row — surfaces the wizard CSV path's
   *  per-batch progress (TSV chunked path uses `progress` from SSE). */
  chunksDone?: number;
  chunksTotal?: number;
  startedAt?: number;
  providerFallback?: boolean;
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
      {providerFallback && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          Server busy — switched to backup model. Hang tight.
        </p>
      )}
    </div>
  );
}


type Mapped = ReturnType<typeof applyMapping>;

interface Props {
  manager: BankStatementManager;
}

const ACCEPT = '.pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

export function BankStatementUploader({ manager }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // There is no column-mapping screen for statements — see
  // lib/statementRouting for where each upload goes.
  // Password-protected PDFs go here. The dialog calls onSubmit with
  // the entered password; we re-run extractPdfGrid with it. If it
  // still fails, wrongPassword flips and the user can try again.
  const [pendingPassword, setPendingPassword] = useState<{
    file: File;
    wrongPassword: boolean;
  } | null>(null);
  // True while extractPdfGrid is parsing a freshly-picked PDF. Without
  // this the dropzone looks idle for the 1-3s pdfjs takes on a
  // multi-page statement, which reads as "did my click register?".
  // Cleared when we route to the analyze pipeline.
  const [isReadingPdf, setIsReadingPdf] = useState(false);
  // Scanned-PDF warning + over-100-page block dialogs. Shown when the
  // PDF has no text layer and we'd route to AI vision — at which point
  // the cost difference vs digital PDFs is large enough to warrant a
  // confirmation step.
  // 2026-06: pendingScannedPdf removed — scanned PDFs route straight
  // to the OCR pipeline without a confirm step. State kept in commit
  // history for one cycle in case we need to re-introduce a different
  // gate (e.g. for very large scans).
  const [pdfTooLarge, setPdfTooLarge] = useState<{ file: File; pageCount: number } | null>(null);

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
    const lname = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || lname.endsWith('.pdf');
    const isCsv = file.type === 'text/csv' || lname.endsWith('.csv');
    const isExcel = lname.endsWith('.xlsx') || lname.endsWith('.xls');
    if (!isPdf && !isCsv && !isExcel) {
      toast.error('Only PDF, CSV, and Excel (.xlsx / .xls) statements are accepted.');
      return;
    }

    // One analysis at a time. Server enforces the same via
    // findInProgressByHashForUser, but the toast is friendlier than
    // letting the request go through and bounce.
    if (manager.hasInProgressJob) {
      toast.error('A bank statement analysis is already running. Wait for it to finish.');
      return;
    }

    if (isExcel) {
      setIsReadingPdf(true);
      try {
        const rows = await excelToRows(file);
        const grid = rows ? rowsToFakeGrid(rows) : null;
        if (!rows || !grid) {
          toast.error('Excel appears empty or has no data rows.');
          setIsReadingPdf(false);
          return;
        }
        setIsReadingPdf(false);
        await followSheetRoute(routeSpreadsheet(grid), rows, file);
      } catch (err) {
        console.error('[BankStatementUploader] excel parse failed:', err);
        toast.error('Could not read this Excel file. Re-export as .xlsx and try again.');
        setIsReadingPdf(false);
      }
      return;
    }

    if (isCsv) {
      // CSVs are mapped in the browser (applyMapping → mappedRowsToBankCsv
      // normalizes to the canonical header set the server expects), not
      // posted raw: the server CSV path's hardcoded header guesses
      // (r.date ?? r.Date ?? r['Txn Date'] ?? ...) mis-sign rows on any
      // CSV that doesn't match them.
      setIsReadingPdf(true);
      const text = await file.text();
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
      const rows = parsed.data as string[][];
      const grid = rowsToFakeGrid(rows);
      if (!grid) {
        toast.error('CSV appears empty or has no data rows.');
        setIsReadingPdf(false);
        return;
      }
      setIsReadingPdf(false);
      await followSheetRoute(routeSpreadsheet(grid), rows, file);
      return;
    }

    // Digital PDF → extract a structured 2D grid. A matching bank rule
    // maps it → CSV → the existing CSV path, which builds signed amounts
    // deterministically (no LLM in the credit/debit decision). Anything
    // else, and scanned PDFs with no text layer, go to the server's AI
    // reader.
    if (isPdf) {
      setIsReadingPdf(true);
      try {
        const route = await routePdf(await extractPdfGrid(file), file);
        setIsReadingPdf(false);
        await followPdfRoute(route, file);
        return;
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

  const analyzeRawFile = async (file: File, formatMeta?: StatementFormatMeta) => {
    try {
      const result = await manager.analyzeFile(file, formatMeta);
      toast.success(result.alreadyAnalyzed
        ? `This statement was already analyzed earlier — opened the existing one (${result.transactions.length} transactions).`
        : `Analyzed ${result.transactions.length} transactions`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Analysis failed');
    }
  };

  const followPdfRoute = async (route: StatementRoute, file: File, pdfPassword?: string) => {
    if (route.kind === 'ledger') {
      toast.error(`This looks like ${route.erp === 'a ledger' ? 'a ledger export' : `a ${route.erp} ledger`}, not a bank statement. Open the Ledger Scrutiny page from the sidebar and upload it there — the ledger flow handles ERP-specific layouts (and routes Finsys exports to AI vision automatically).`, { duration: 9000 });
      return;
    }
    if (route.kind === 'mapped') {
      await submitMapped(route.checked.mapped, file.name, `Auto-mapped ${route.bank} layout`);
      return;
    }
    // A protected PDF: the server needs the password to open it.
    await analyzeRawFile(file, pdfPassword ? { ...route.meta, pdfPassword } : route.meta);
  };

  const followSheetRoute = async (route: StatementRoute, rows: string[][], file: File) => {
    if (route.kind === 'mapped') {
      await submitMapped(route.checked.mapped, file.name, route.bank === 'Columns recognised' ? route.bank : `Auto-mapped ${route.bank} layout`);
      return;
    }
    try {
      const result = await manager.analyzeTable(rowsToTsv(rows), file.name, route.kind === 'reader' && route.meta ? route.meta : { formatReason: 'no-rule' });
      toast.success(result.alreadyAnalyzed
        ? `This statement was already analyzed earlier — opened the existing one (${result.transactions.length} transactions).`
        : `Analyzed ${result.transactions.length} transactions`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Analysis failed');
    }
  };

  /** Shared finish path: surfaces filter stats, builds the CSV, and
   *  submits to the analyze endpoint. successPrefix labels the toast
   *  (e.g. "Auto-mapped HDFC Bank layout — analyzed N transactions"). */
  const submitMapped = async (
    { rows: mapped, stats }: Mapped,
    filename: string,
    successPrefix?: string,
  ) => {
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
    // Cash Credit / Overdraft accounts have an inverted sign
    // convention vs savings — applyMapping detects this from the
    // balance column's Dr/Cr suffix mix and flags it on stats. Pass
    // it through to the server so its balance-delta reconciler
    // doesn't flip every deposit's sign back to outflow.
    const accountKind: 'asset' | 'liability' = stats.isCashCredit ? 'liability' : 'asset';
    try {
      const result = await manager.analyzeCsv(csv, filename, accountKind);
      const prefix = successPrefix ? `${successPrefix} — ` : '';
      toast.success(result.alreadyAnalyzed
        ? `This statement was already analyzed earlier — opened the existing one (${result.transactions.length} transactions).`
        : `${prefix}analyzed ${result.transactions.length} transactions deterministically (no AI sign assignment).`);
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
          <>
            <AnalyzeProgressBar
              progress={manager.analyzeProgress ?? { completed: 0, total: 0 }}
              chunksDone={chunksDone}
              chunksTotal={chunksTotal}
              startedAt={analyzeStartedAt.current ?? undefined}
              providerFallback={inFlight?.providerFallback}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Scanned PDFs use OCR + AI — this uses tokens and can take 2–3 minutes.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              PDF up to 25 MB — or a CSV / Excel export from your bank
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-full px-2.5 py-1">
              <Sparkles className="w-3.5 h-3.5" />
              Optimised — most rows are categorised on-device, so statements use very few tokens
            </p>
            <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
              Only the few AI-assisted rows count toward your token budget; scanned PDFs (OCR) use more.
            </p>
            {/* Supported-bank list is derived from the per-bank rules
                themselves, so it can't drift from what actually works. */}
            <div className="mt-3 text-left" onClick={(e) => e.stopPropagation()}>
              <FormatSupportNotice kind="bank" supported={SUPPORTED_BANKS} allowRequests={false} />
            </div>
          </>
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
      {pendingPassword && (
        <PasswordPromptDialog
          filename={pendingPassword.file.name}
          wrongPassword={pendingPassword.wrongPassword}
          onCancel={() => setPendingPassword(null)}
          onSubmit={async (password) => {
            const file = pendingPassword.file;
            try {
              const grid = await extractPdfGrid(file, password);
              setPendingPassword(null);
              // Same routing as an unprotected PDF (the SBI net-banking
              // PDF is password-protected, so it only ever arrives here).
              await followPdfRoute(await routePdf(grid, file), file, password);
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
      {/* ScannedPdfConfirmDialog removed 2026-06: scanned PDFs now
          route directly to the OCR pipeline (free server-side), so
          no confirm step is needed. The state + dialog block can be
          deleted once we're confident no path needs it. */}
      {pdfTooLarge && (
        <PdfTooLargeDialog
          filename={pdfTooLarge.file.name}
          pageCount={pdfTooLarge.pageCount}
          documentLabel="statement"
          onClose={() => setPdfTooLarge(null)}
        />
      )}
    </div>
  );
}
