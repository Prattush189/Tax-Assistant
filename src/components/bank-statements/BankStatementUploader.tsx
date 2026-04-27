import { useRef, useState } from 'react';
import { Upload, FileText, Loader2 } from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { BankStatementManager } from '../../hooks/useBankStatementManager';
import type { BankStatementAnalyzeProgress } from '../../services/api';
import { cn } from '../../lib/utils';

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

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.csv,application/pdf,image/jpeg,image/png,image/webp,text/csv';

export function BankStatementUploader({ manager }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    const isCsv = file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv');
    if (isCsv) {
      const text = await file.text();
      const preview = Papa.parse(text, { header: true, skipEmptyLines: true, preview: 1 });
      if (!preview.data.length) {
        toast.error('CSV appears empty or has no header row.');
        return;
      }
      try {
        const result = await manager.analyzeCsv(text, file.name);
        toast.success(`Analyzed ${result.transactions.length} transactions`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Analysis failed');
      }
      return;
    }

    try {
      const result = await manager.analyzeFile(file);
      toast.success(`Analyzed ${result.transactions.length} transactions`);
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
          <>
            <AnalyzeProgressBar progress={manager.analyzeProgress} />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Long statements (50+ pages) can take up to 5 minutes — keep this tab open.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              PDF, JPG, PNG, WebP up to 500 KB — or a CSV export from your bank
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Long statements (50+ pages) can take up to 5 minutes to analyse.
            </p>
          </>
        )}
      </div>
      <button
        type="button"
        disabled={manager.isAnalyzing}
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
    </div>
  );
}
