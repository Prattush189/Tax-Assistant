import { useRef, useState } from 'react';
import { Upload, FileText, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { LedgerScrutinyManager } from '../../hooks/useLedgerScrutinyManager';
import { cn } from '../../lib/utils';

interface Props {
  manager: LedgerScrutinyManager;
}

const ACCEPT = '.pdf,application/pdf';
const MAX_BYTES = 1 * 1024 * 1024;

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
      toast.error('Ledger PDF exceeds the 1 MB size limit. Split the export and re-upload.');
      return;
    }

    try {
      const result = await manager.upload(file);
      toast.success(`Extracted ${result.accounts.length} accounts — running scrutiny…`);
      try {
        await manager.scrutinize(result.job.id);
        toast.success('Scrutiny complete');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Scrutiny failed');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    }
  };

  const busy = manager.isUploading || manager.isScrutinizing;
  const stage = manager.isUploading ? 'Extracting accounts…'
    : manager.isScrutinizing ? 'Auditing for tax exposure…'
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
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Tally / Busy / Marg PDF export · max 1 MB
        </p>
        {manager.isScrutinizing && manager.streamBuffer && (
          <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500">
            Streaming {manager.streamBuffer.length.toLocaleString()} chars from the model…
          </p>
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
