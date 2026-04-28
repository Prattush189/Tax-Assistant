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

          {/* In-progress banner mirroring the bank-statement landing
              page — even though Recent Scrutinies below shows the
              running job too, this puts the live progress at the top
              of the page so a freshly-uploaded ledger surfaces
              immediately above the (now-disabled) uploader. */}
          {(() => {
            const inFlight = manager.jobs.find(j => j.status === 'extracting' || j.status === 'scrutinizing' || j.status === 'pending');
            if (!inFlight) return null;
            const phase = inFlight.status === 'scrutinizing' ? 'Auditing'
              : inFlight.status === 'extracting' ? 'Extracting'
              : 'Queued';
            return (
              <button
                type="button"
                onClick={() => void manager.load(inFlight.id)}
                className="w-full text-left rounded-2xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-900/15 p-4 hover:bg-emerald-50 dark:hover:bg-emerald-900/25 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 animate-spin shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                      {phase}: {inFlight.partyName ?? inFlight.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Click to view live progress · keeps running if you close this tab
                    </p>
                  </div>
                </div>
                <div className="mt-2 h-1 w-full rounded-full bg-emerald-100 dark:bg-emerald-900/40 overflow-hidden">
                  <div className="h-full w-1/3 bg-emerald-500 dark:bg-emerald-400" style={{ animation: 'ledgerBannerProgress 1.6s ease-in-out infinite' }} />
                </div>
                <style>{`@keyframes ledgerBannerProgress { 0% { transform: translateX(-120%); } 50% { transform: translateX(120%); } 100% { transform: translateX(320%); } }`}</style>
              </button>
            );
          })()}

          {/* Credit usage as a percentage only — page counts are
              hidden per UI direction so users focus on % consumed
              rather than the page math. */}
          {(() => {
            const limit = manager.usage.creditsLimit || manager.usage.limit || 0;
            const used = manager.usage.creditsUsed || manager.usage.used || 0;
            const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
            const m = manager.usage.csvRowsPerCredit || 100;
            const usedTxns = (used * m).toLocaleString('en-IN');
            const limitTxns = (limit * m).toLocaleString('en-IN');
            return (
              <div className="space-y-1">
                <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-end gap-1.5">
                  <span className="font-semibold text-gray-700 dark:text-gray-200">{usedTxns} / {limitTxns}</span>
                  <span>transactions used this month</span>
                  <span className="text-gray-400">·</span>
                  <span className="font-semibold text-gray-700 dark:text-gray-200">{pct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div className="h-full bg-emerald-500 dark:bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })()}

          {(() => {
            // "Recent scrutinies" is a quick-access tile. We show:
            //   - all in-progress jobs at the top (so a tab close + reload
            //     mid-audit always re-surfaces the running job and the
            //     user can click into it to see live progress); plus
            //   - up to 5 successfully-finished runs below.
            // Errored jobs are kept out — they remain visible in the
            // list view ("history") via the sidebar switcher.
            const inProgress = manager.jobs.filter(j =>
              j.status === 'extracting' || j.status === 'scrutinizing' || j.status === 'pending');
            const done = manager.jobs.filter(j => j.status === 'done').slice(0, 5);
            const rows = [...inProgress, ...done];
            if (rows.length === 0) return null;
            return (
              <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Recent scrutinies</h3>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {rows.map((j) => {
                    const running = j.status === 'extracting' || j.status === 'scrutinizing' || j.status === 'pending';
                    return (
                      <li key={j.id}>
                        <button
                          type="button"
                          onClick={() => void manager.load(j.id)}
                          className="w-full py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-900/30 -mx-2 px-2 rounded-lg transition-colors"
                        >
                          <div className="min-w-0 flex items-center gap-2">
                            {running && <Loader2 className="w-4 h-4 text-emerald-500 animate-spin shrink-0" />}
                            <div className="min-w-0">
                              <p className="font-medium text-gray-800 dark:text-gray-100 truncate">
                                {j.partyName ?? j.name}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {running
                                  ? 'Audit in progress — click to view live status'
                                  : `${j.periodFrom ?? '?'} – ${j.periodTo ?? '?'} · ${j.totalFlagsHigh} high · ${j.totalFlagsWarn} warn · ${j.totalFlagsInfo} info`}
                              </p>
                            </div>
                          </div>
                          <span className={`text-[11px] uppercase tracking-wider font-medium ml-3 shrink-0 ${running ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                            {j.status}
                          </span>
                        </button>
                      </li>
                    );
                  })}
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
