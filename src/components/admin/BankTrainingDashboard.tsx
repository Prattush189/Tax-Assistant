import { useState } from 'react';
import { Download, Database, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchPayeeExport } from '../../services/api';

/**
 * Admin tool: export the deduped payee list for a high-quality labeling
 * pass. Downloads JSON straight to the browser (nothing is stored
 * server-side). The labeled file is re-imported later to seed gold
 * labels + the semantic index and clean historical categories.
 */
export function BankTrainingDashboard() {
  const [minCount, setMinCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [lastStats, setLastStats] = useState<{ count: number; rowsCovered: number } | null>(null);

  const download = async () => {
    setBusy(true);
    try {
      const res = await fetchPayeeExport(minCount);
      const blob = new Blob([JSON.stringify(res.payees, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payees-review-min${minCount}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Defer revoke so the download isn't cancelled mid-flight.
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setLastStats({ count: res.count, rowsCovered: res.rowsCovered });
      toast.success(`Exported ${res.count} payees (${res.rowsCovered} rows)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
        <div className="flex items-center gap-2 mb-1">
          <Database className="w-4 h-4 text-indigo-500" />
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Payee labeling export</h3>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 max-w-2xl">
          Downloads the deduped payee list (one row per distinct narration fingerprint, most-frequent
          first) for a labeling pass. The file is built on demand and never stored on the server.
          Start with <span className="font-mono">min&nbsp;5</span> — the recurring payees that cover the
          bulk of your volume — then re-import the labeled file to seed gold labels and clean history.
          <br />
          <span className="text-amber-600 dark:text-amber-400">Contains payee names — keep the file private.</span>
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Min occurrences</span>
            <input
              type="number"
              min={1}
              value={minCount}
              onChange={(e) => setMinCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-28 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
            />
          </label>
          <button
            type="button"
            onClick={() => void download()}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {busy ? 'Building…' : 'Download payees for review'}
          </button>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            1 = full long tail · 5 = recurring head
          </span>
        </div>

        {lastStats && (
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-3">
            Last export: <span className="font-medium">{lastStats.count.toLocaleString()}</span> distinct payees,
            covering <span className="font-medium">{lastStats.rowsCovered.toLocaleString()}</span> transactions.
          </p>
        )}
      </div>
    </div>
  );
}
