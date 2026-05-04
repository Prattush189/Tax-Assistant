import { useRef, useState } from 'react';
import { Upload, FileText, Loader2 } from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import type { LedgerScrutinyManager } from '../../hooks/useLedgerScrutinyManager';
import type { LedgerScrutinyProgress } from '../../services/api';
import { cn } from '../../lib/utils';
import { ColumnMappingWizard } from '../shared/ColumnMappingWizard';
import { PasswordPromptDialog } from '../shared/PasswordPromptDialog';
import {
  applyMapping,
  extractPdfGrid,
  PdfPasswordError,
  mappedRowsToExtractedLedger,
  rowsToFakeGrid,
  type ColumnMapping,
  type PdfGrid,
} from '../../lib/pdfGrid';

interface Props {
  manager: LedgerScrutinyManager;
}

function ScrutinyProgressBar({
  phase,
  progress,
  scrutinyDone,
  scrutinyTotal,
  extractDone,
  extractTotal,
  startedAt,
}: {
  phase: 'extracting' | 'scrutinizing';
  progress: LedgerScrutinyProgress | null;
  scrutinyDone?: number;
  scrutinyTotal?: number;
  extractDone?: number;
  extractTotal?: number;
  /** Wall-clock when the current phase started. Used with done/total
   *  to estimate remaining time. */
  startedAt?: number;
}) {
  // Prefer the phase-appropriate chunk progress when available.
  // Extract phase has its own counter (pages_total / pages_processed
  // on the server); scrutiny phase has scrutiny_chunks_*. Falls back
  // to the byte-stream estimate from the SSE /scrutinize endpoint
  // (single-call path that doesn't chunk).
  const usingExtractChunks = phase === 'extracting' && (extractTotal ?? 0) > 0;
  const usingScrutinyChunks = phase === 'scrutinizing' && (scrutinyTotal ?? 0) > 0;
  const total = usingExtractChunks ? extractTotal! : (usingScrutinyChunks ? scrutinyTotal! : (progress?.total ?? 0));
  const completed = usingExtractChunks ? (extractDone ?? 0) : (usingScrutinyChunks ? (scrutinyDone ?? 0) : (progress?.completed ?? 0));
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const indeterminate = total === 0;

  let eta: string | null = null;
  if ((usingExtractChunks || usingScrutinyChunks) && completed > 0 && startedAt && completed < total) {
    const elapsedMs = Date.now() - startedAt;
    const avgMsPerChunk = elapsedMs / completed;
    const remainingMs = avgMsPerChunk * (total - completed);
    const mins = Math.ceil(remainingMs / 60000);
    eta = mins <= 1 ? '~1 min remaining' : `~${mins} min remaining`;
  }

  const label = phase === 'extracting'
    ? usingExtractChunks
      ? `Reading ledger structure — chunk ${completed} of ${total}`
      : 'Reading the ledger structure…'
    : usingScrutinyChunks
      ? `Auditing chunk ${completed} of ${total} against §40A(3) / §269ST / TDS rubric`
      : progress?.accountsTotal
        ? `Auditing ${progress.accountsTotal} account${progress.accountsTotal === 1 ? '' : 's'} against §40A(3) / §269ST / TDS rubric`
        : 'Auditing accounts…';

  return (
    <div className="mt-3">
      <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
        <div
          className="h-full bg-emerald-600 dark:bg-emerald-500 transition-all duration-300 ease-out"
          style={{ width: indeterminate ? '15%' : `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {label}{!indeterminate ? ` · ${pct}%` : ''}
        {eta ? ` · ${eta}` : ''}
      </p>
    </div>
  );
}

const ACCEPT = '.pdf,.csv,application/pdf,text/csv';
const MAX_BYTES = 10 * 1024 * 1024;

export function LedgerUploader({ manager }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingGrid, setPendingGrid] = useState<{ grid: PdfGrid; filename: string } | null>(null);
  // Password-protected PDFs go here; the dialog re-runs extractPdfGrid
  // with the supplied password. wrongPassword flips on a retry so the
  // user gets the inline "try again" hint.
  const [pendingPassword, setPendingPassword] = useState<{
    file: File;
    wrongPassword: boolean;
  } | null>(null);
  // True while extractPdfGrid is parsing a freshly-picked PDF, before
  // the column-mapping wizard opens. Bridges the silent 1-3s gap so
  // the dropzone doesn't look idle after the user clicks.
  const [isReadingPdf, setIsReadingPdf] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isCsv = file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv');
    if (!isPdf && !isCsv) {
      toast.error('Only PDF and CSV ledger exports are accepted.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('Ledger file exceeds the 10 MB size limit. Split the export and re-upload.');
      return;
    }
    // Hard guard against starting a second audit while the first is
    // still running. The server-side findInProgressByHashForUser would
    // refuse a duplicate of the SAME file, but a different file would
    // still spawn a parallel run that doubles cost. Front-end check is
    // friendlier than waiting for the rejection.
    if (manager.hasInProgressJob) {
      toast.error('An audit is already running. Wait for it to finish before starting another.');
      return;
    }

    // CSV → wrap into the same grid shape the wizard expects, then
    // run through the same wizard → preExtracted → audit pipeline as
    // PDFs. Tally / Busy CSV exports have varying column orders so
    // the mapping wizard isn't optional even here.
    if (isCsv) {
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

    // Digital PDF → extract grid + run column-mapping wizard. Skips
    // Gemini extraction entirely (server runs only the audit pass) and
    // makes credit/debit signs deterministic from the user's mapping.
    //
    // Scanned PDFs are BLOCKED here. Ledger audits depend on
    // deterministic credit/debit signs from the user's column mapping,
    // and a vision-extracted ledger can't reliably produce that — the
    // §40A(3) / §269ST checks would silently mis-fire on any
    // sign-flipped row. Better to refuse and ask for a digital export
    // than to ship audit findings the user can't trust.
    setIsReadingPdf(true);
    try {
      const grid = await extractPdfGrid(file);
      if (grid && grid.rows.length >= 3) {
        setIsReadingPdf(false);
        setPendingGrid({ grid, filename: file.name });
        return;
      }
      setIsReadingPdf(false);
      toast.error('This PDF appears to be scanned or image-only. Ledger audits need a digital PDF or CSV export — please upload one of those.');
      return;
    } catch (err) {
      if (err instanceof PdfPasswordError) {
        setIsReadingPdf(false);
        setPendingPassword({ file, wrongPassword: false });
        return;
      }
      console.warn('[LedgerUploader] grid extraction failed:', err);
      toast.error('Could not read this PDF. If it is scanned or image-only, export the ledger as a digital PDF or CSV and re-upload.');
      setIsReadingPdf(false);
    }
  };

  const handleMappingConfirm = async (mapping: ColumnMapping) => {
    if (!pendingGrid) return;
    const { grid, filename } = pendingGrid;
    setPendingGrid(null);
    const { rows: mapped, stats } = applyMapping(grid, mapping, 'ledger');
    if (mapped.length === 0) {
      toast.error('No transaction rows found after applying the mapping. Re-check the Date column.');
      return;
    }
    const filteredCount = stats.totalGridRows - stats.transactions;
    if (filteredCount > 0) {
      const parts: string[] = [];
      if (stats.accountHeaders > 0) parts.push(`${stats.accountHeaders} account-separator row${stats.accountHeaders === 1 ? '' : 's'}`);
      if (stats.mergedContinuations > 0) parts.push(`${stats.mergedContinuations} wrapped narration line${stats.mergedContinuations === 1 ? '' : 's'} merged`);
      if (stats.skippedNoAmount > 0) parts.push(`${stats.skippedNoAmount} non-transaction row${stats.skippedNoAmount === 1 ? '' : 's'} skipped (opening / closing balance, page totals)`);
      if (parts.length > 0) {
        toast(`From ${stats.totalGridRows.toLocaleString('en-IN')} grid rows: ${stats.transactions.toLocaleString('en-IN')} transactions — ${parts.join(', ')}.`, { duration: 6000 });
      }
    }
    const extracted = mappedRowsToExtractedLedger(mapped);
    // Tally / Busy party-books bundle many GL accounts (often 100s)
    // in a single PDF separated by header rows. Surface the detected
    // account count so the user can spot the "single Default account"
    // failure mode before paying for an audit on a misparsed file.
    if (extracted.accounts.length === 1 && extracted.accounts[0].name === 'Default') {
      toast.error('Could not detect any account headers (Tally-style "-Account Name" rows). The audit would treat all transactions as one account and produce wrong totals. Verify the PDF has account headers between blocks, or pre-split it.');
      return;
    }
    toast(`Detected ${extracted.accounts.length.toLocaleString('en-IN')} account${extracted.accounts.length === 1 ? '' : 's'} · ${mapped.length.toLocaleString('en-IN')} transactions — running audit…`);
    try {
      const result = await manager.uploadMapped(extracted, filename);
      toast.success(`Audit complete: ${result.observations.length} observation${result.observations.length === 1 ? '' : 's'} across ${result.accounts.length} accounts`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    }
  };

  const currentStatus = manager.current?.job.status;
  const scrutinyDone = manager.current?.job.scrutinyChunksDone ?? 0;
  const scrutinyTotal = manager.current?.job.scrutinyChunksTotal ?? 0;
  const extractDone = manager.current?.job.extractChunksDone ?? 0;
  const extractTotal = manager.current?.job.extractChunksTotal ?? 0;
  // Per-phase start timestamps for ETA. Reset when the phase changes
  // (extract → scrutinize) so the ETA is accurate to that phase only.
  const phaseStartedAt = useRef<number | null>(null);
  const lastPhase = useRef<string | undefined>(undefined);
  if (currentStatus !== lastPhase.current) {
    phaseStartedAt.current = (currentStatus === 'extracting' || currentStatus === 'scrutinizing') ? Date.now() : null;
    lastPhase.current = currentStatus;
  }
  // `busy` covers both the in-flight upload AND any other in-progress job
  // visible in the user's job list — so the upload zone is locked even
  // if the user navigated away from the running audit's detail view.
  const busy = manager.isUploading
    || manager.hasInProgressJob
    || currentStatus === 'extracting'
    || currentStatus === 'scrutinizing'
    || currentStatus === 'pending';
  const stage = currentStatus === 'scrutinizing' ? 'Auditing for tax exposure…'
    : currentStatus === 'extracting' || manager.isUploading ? 'Extracting accounts…'
    : isReadingPdf ? 'Reading PDF…'
    : 'Drop your ledger PDF here';

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
          ? 'border-emerald-400 bg-emerald-50/50 dark:border-emerald-500 dark:bg-emerald-900/10'
          : 'border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/30',
      )}
    >
      <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
        {(busy || isReadingPdf)
          ? <Loader2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 animate-spin" />
          : <Upload className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />}
      </div>
      <div className="text-center w-full max-w-md">
        <p className="font-semibold text-gray-800 dark:text-gray-100">{stage}</p>
        {busy ? (
          <ScrutinyProgressBar
            phase={currentStatus === 'scrutinizing' ? 'scrutinizing' : 'extracting'}
            progress={manager.scrutinizeProgress}
            scrutinyDone={scrutinyDone}
            scrutinyTotal={scrutinyTotal}
            extractDone={extractDone}
            extractTotal={extractTotal}
            startedAt={phaseStartedAt.current ?? undefined}
          />
        ) : (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Tally / Busy / Marg PDF or CSV export · max 10 MB
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Extract + audit run as one step — no buttons to click after upload.
            </p>
          </>
        )}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        <FileText className="w-4 h-4" />
        Choose ledger PDF
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPT}
        onChange={(e) => { void handleFiles(e.target.files); if (inputRef.current) inputRef.current.value = ''; }}
      />
      <p className="text-xs text-gray-400 dark:text-gray-500 max-w-md text-center">
        Every account is graded against §40A(3), §269ST/SS/T, TDS scope, RCM cues, and reconciliation — observations cite the section so a CA can quote them directly.
      </p>
      {pendingGrid && (
        <ColumnMappingWizard
          kind="ledger"
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
              setPendingPassword(null);
              toast.error('Could not read this PDF after unlocking.');
            } catch (err) {
              if (err instanceof PdfPasswordError) {
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
