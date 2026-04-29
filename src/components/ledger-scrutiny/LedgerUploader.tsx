import { useRef, useState } from 'react';
import { Upload, FileText, Loader2 } from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import type { LedgerScrutinyManager } from '../../hooks/useLedgerScrutinyManager';
import type { LedgerScrutinyProgress } from '../../services/api';
import { cn } from '../../lib/utils';
import { ColumnMappingWizard } from '../shared/ColumnMappingWizard';
import {
  applyMapping,
  extractPdfGrid,
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
  chunksDone,
  chunksTotal,
  startedAt,
}: {
  phase: 'extracting' | 'scrutinizing';
  progress: LedgerScrutinyProgress | null;
  /** From the polled job row. Surfaces upload-time auto-chained
   *  scrutiny progress (the SSE-streamed /scrutinize endpoint uses
   *  `progress.completed/total` in bytes; this path uses chunks). */
  chunksDone?: number;
  chunksTotal?: number;
  /** Wall-clock when the job switched to scrutinizing. Used with
   *  chunksDone to estimate remaining time. */
  startedAt?: number;
}) {
  // Prefer chunk-based progress (auto-chained inline path) when
  // available — it's a real fraction. Fall back to the byte-stream
  // estimate (SSE streamed scrutinize). Extract pass is indeterminate.
  const usingChunks = phase === 'scrutinizing' && (chunksTotal ?? 0) > 0;
  const total = usingChunks ? chunksTotal! : (progress?.total ?? 0);
  const completed = usingChunks ? (chunksDone ?? 0) : (progress?.completed ?? 0);
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const indeterminate = phase === 'extracting' || total === 0;

  // ETA: average per-chunk wall time × chunks remaining. Only meaningful
  // for the chunk-based path (the byte-stream path completes in seconds).
  let eta: string | null = null;
  if (usingChunks && completed > 0 && startedAt && completed < total) {
    const elapsedMs = Date.now() - startedAt;
    const avgMsPerChunk = elapsedMs / completed;
    const remainingMs = avgMsPerChunk * (total - completed);
    const mins = Math.ceil(remainingMs / 60000);
    eta = mins <= 1 ? '~1 min remaining' : `~${mins} min remaining`;
  }

  const label = phase === 'extracting'
    ? 'Reading the ledger structure…'
    : usingChunks
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
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_LEDGER_TXNS_PER_FILE = 20_000;

export function LedgerUploader({ manager }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingGrid, setPendingGrid] = useState<{ grid: PdfGrid; filename: string } | null>(null);

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
      toast.error('Ledger file exceeds the 3 MB size limit. Split the export and re-upload.');
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
    // Scanned PDFs without a text layer fall through to the legacy
    // vision path.
    try {
      const grid = await extractPdfGrid(file);
      if (grid && grid.rows.length >= 3) {
        setPendingGrid({ grid, filename: file.name });
        return;
      }
    } catch (err) {
      console.warn('[LedgerUploader] grid extraction failed; falling back to vision:', err);
    }

    try {
      const result = await manager.upload(file);
      toast.success(`Audit complete: ${result.observations.length} observation${result.observations.length === 1 ? '' : 's'} across ${result.accounts.length} accounts`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    }
  };

  const handleMappingConfirm = async (mapping: ColumnMapping) => {
    if (!pendingGrid) return;
    const { grid, filename } = pendingGrid;
    setPendingGrid(null);
    const mapped = applyMapping(grid, mapping, 'ledger');
    if (mapped.length === 0) {
      toast.error('No transaction rows found after applying the mapping. Re-check the Date column.');
      return;
    }
    if (mapped.length > MAX_LEDGER_TXNS_PER_FILE) {
      toast.error(`This ledger has ${mapped.length.toLocaleString('en-IN')} transactions, but a single upload is capped at ${MAX_LEDGER_TXNS_PER_FILE.toLocaleString('en-IN')}. Split by quarter / by account and re-upload.`);
      return;
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
  const chunksDone = manager.current?.job.scrutinyChunksDone ?? 0;
  const chunksTotal = manager.current?.job.scrutinyChunksTotal ?? 0;
  // Track the moment scrutiny started locally so we can compute an
  // ETA from average chunk time. We can't trust createdAt because
  // the job sat in 'extracting' first; we just remember the first
  // poll where chunksTotal flipped non-zero.
  const scrutinyStartedAt = useRef<number | null>(null);
  if (chunksTotal > 0 && scrutinyStartedAt.current === null) {
    scrutinyStartedAt.current = Date.now();
  }
  if (chunksTotal === 0 && scrutinyStartedAt.current !== null) {
    scrutinyStartedAt.current = null;
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
        {busy
          ? <Loader2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 animate-spin" />
          : <Upload className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />}
      </div>
      <div className="text-center w-full max-w-md">
        <p className="font-semibold text-gray-800 dark:text-gray-100">{stage}</p>
        {busy ? (
          <ScrutinyProgressBar
            phase={currentStatus === 'scrutinizing' ? 'scrutinizing' : 'extracting'}
            progress={manager.scrutinizeProgress}
            chunksDone={chunksDone}
            chunksTotal={chunksTotal}
            startedAt={scrutinyStartedAt.current ?? undefined}
          />
        ) : (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Tally / Busy / Marg PDF or CSV export · max 3 MB
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
    </div>
  );
}
