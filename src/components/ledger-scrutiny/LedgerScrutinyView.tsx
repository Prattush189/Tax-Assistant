import { BookOpenCheck, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import type { LedgerScrutinyManager } from '../../hooks/useLedgerScrutinyManager';
import { LedgerUploader } from './LedgerUploader';
import { ScrutinyReport } from './ScrutinyReport';

interface Props {
  manager: LedgerScrutinyManager;
}

export function LedgerScrutinyView({ manager }: Props) {
  if (manager.isLoading && !manager.current) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!manager.current) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="flex-1 overflow-y-auto"
      >
        <div className="max-w-3xl mx-auto p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
              <BookOpenCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">Ledger Scrutiny</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Upload a year-long Tally / Busy / Marg ledger — AI grades every account against the Income-tax Act and GST.
              </p>
            </div>
          </div>

          <LedgerUploader manager={manager} />

          <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-end">
            Used <span className="mx-1 font-semibold text-gray-700 dark:text-gray-200">{manager.usage.used}</span> of{' '}
            <span className="ml-1 font-semibold text-gray-700 dark:text-gray-200">{manager.usage.limit}</span> this month
          </div>

          {(() => {
            // "Recent scrutinies" is a quick-access tile, not a full history.
            // Show only successfully-finished runs (status === 'done') and
            // cap at 5 — errors and in-progress jobs clutter this view; they
            // remain visible in the list view ("history") that the user can
            // switch to from the sidebar.
            const recent = manager.jobs.filter(j => j.status === 'done').slice(0, 5);
            if (recent.length === 0) return null;
            return (
              <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Recent scrutinies</h3>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {recent.map((j) => (
                    <li key={j.id}>
                      <button
                        type="button"
                        onClick={() => void manager.load(j.id)}
                        className="w-full py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-900/30 -mx-2 px-2 rounded-lg transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-gray-800 dark:text-gray-100 truncate">
                            {j.partyName ?? j.name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {j.periodFrom ?? '?'} – {j.periodTo ?? '?'} · {j.totalFlagsHigh} high · {j.totalFlagsWarn} warn · {j.totalFlagsInfo} info
                          </p>
                        </div>
                        <span className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium ml-3 shrink-0">
                          {j.status}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      key={manager.current.job.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex-1 overflow-y-auto"
    >
      <div className="max-w-5xl mx-auto p-6 space-y-5">
        <button
          type="button"
          onClick={manager.clear}
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          ← Back to ledger uploads
        </button>
        <ScrutinyReport manager={manager} />
      </div>
    </motion.div>
  );
}
