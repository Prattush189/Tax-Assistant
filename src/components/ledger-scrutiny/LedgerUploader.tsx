import { useRef, useState } from 'react';
import { Upload, FileText, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { LedgerScrutinyManager } from '../../hooks/useLedgerScrutinyManager';
import type { LedgerScrutinyProgress } from '../../services/api';
import { cn } from '../../lib/utils';

interface Props {
  manager: LedgerScrutinyManager;
}

function ScrutinyProgressBar({
  phase,
  progress,
}: {
  phase: 'extracting' | 'scrutinizing';
  progress: LedgerScrutinyProgress | null;
}) {
  // Extract pass is a single synchronous Gemini call — no real progress
  // signal, so we render an indeterminate sliver. Scrutinize pass streams
  // bytes from the model and the server emits periodic {completed,total}
  // events; we cap completed at total-1 server-side so the bar never
  // visually completes before the `done` event lands.
  const total = progress?.total ?? 0;
  const completed = progress?.completed ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const indeterminate = phase === 'extracting' || total === 0;

  const label = phase === 'extracting'
    ? 'Reading the ledger structure…'
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
      </p>
    </div>
  );
}

const ACCEPT = '.pdf,application/pdf';
const MAX_BYTES = 3 * 1024 * 1024;

export function LedgerUploader({ manager }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Please upload a PDF ledger export.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('Ledger PDF exceeds the 3 MB size limit. Split the export and re-upload.');
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

    try {
      // Server now auto-chains extract → scrutiny inline, so a single upload
      // call returns the fully-audited result with observations populated.
      // No separate "Run scrutiny" button or trigger — the user just sees
      // continuous progress (extracting → scrutinizing → done) and the
      // final report.
      const result = await manager.upload(file);
      toast.success(`Audit complete: ${result.observations.length} observation${result.observations.length === 1 ? '' : 's'} across ${result.accounts.length} accounts`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    }
  };

  const currentStatus = manager.current?.job.status;
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
          <>
            <ScrutinyProgressBar
              phase={currentStatus === 'scrutinizing' ? 'scrutinizing' : 'extracting'}
              progress={manager.scrutinizeProgress}
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Long ledgers (50+ pages) can take up to 20 minutes — you can close this tab and come back. The audit keeps running.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Tally / Busy / Marg PDF export · max 3 MB
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Extract + audit run as one step — no buttons to click after upload. Long ledgers can take up to 20 minutes.
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
    </div>
  );
}
