import { useState } from 'react';
import { Landmark, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import toast from 'react-hot-toast';
import { BankStatementManager } from '../../hooks/useBankStatementManager';
import { BankStatementUploader } from './BankStatementUploader';
import { BankStatementSummary } from './BankStatementSummary';
import { CategoryBreakdown } from './CategoryBreakdown';
import { CounterpartySummary } from './CounterpartySummary';
import { TransactionTable } from './TransactionTable';
import { BankStatementRules } from './BankStatementRules';
import { BankStatementConditions } from './BankStatementConditions';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface Props {
  manager: BankStatementManager;
}

export function BankStatementView({ manager }: Props) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);

  const handleDelete = async () => {
    if (!manager.current) return;
    if (!confirm('Delete this statement? This cannot be undone.')) return;
    try {
      await manager.remove(manager.current.statement.id);
      toast.success('Statement deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  if (manager.isLoading && !manager.current) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  // No selection — show uploader + (optionally) empty-state
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
            <div className="w-11 h-11 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
              <Landmark className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">Statement Analyzer</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Upload a bank statement — AI will extract and tax-categorise every transaction.
              </p>
            </div>
          </div>

          <BankStatementUploader manager={manager} />

          {/* In-progress banner: if any statement is being analyzed
              (server still running, polling watching it), show a
              prominent indeterminate bar above the credit usage so
              the user knows a task is active. Clicking opens the
              detail view with the live progress UI. Mirrors the
              ledger landing pattern. */}
          {(() => {
            const inFlight = manager.statements.find(s => s.status === 'analyzing');
            if (!inFlight) return null;
            return (
              <button
                type="button"
                onClick={() => void manager.load(inFlight.id)}
                className="w-full text-left rounded-2xl border border-blue-200 dark:border-blue-800/60 bg-blue-50/60 dark:bg-blue-900/15 p-4 hover:bg-blue-50 dark:hover:bg-blue-900/25 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                      Analyzing: {inFlight.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Click to view live progress · keeps running if you close this tab
                    </p>
                  </div>
                </div>
                <div className="mt-2 h-1 w-full rounded-full bg-blue-100 dark:bg-blue-900/40 overflow-hidden">
                  <div className="h-full w-1/3 bg-blue-500 dark:bg-blue-400" style={{ animation: 'bankBannerProgress 1.6s ease-in-out infinite' }} />
                </div>
                <style>{`@keyframes bankBannerProgress { 0% { transform: translateX(-120%); } 50% { transform: translateX(120%); } 100% { transform: translateX(320%); } }`}</style>
              </button>
            );
          })()}

          {/* Per-feature usage widget removed — Settings → Your Usage
              now has the single token-budget bar that covers all
              features. Showing both was confusing (different units,
              same data). */}

          <BankStatementRules manager={manager} />

          <BankStatementConditions manager={manager} />

          {manager.statements.length > 0 && (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Recent statements</h3>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {manager.statements.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => void manager.load(s.id)}
                      className="w-full py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-900/30 -mx-2 px-2 rounded-lg transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-800 dark:text-gray-100 truncate">{s.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {s.txCount} txns · {s.periodFrom ?? '?'} – {s.periodTo ?? '?'}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  // While the statement is still being analyzed on the server (via the
  // 5 s polling loop in the manager) we show a progress banner with a
  // Cancel button instead of the (empty) tables. Same shape as the
  // ledger ScrutinyReport progress UI.
  //
  // Source-of-truth for status: prefer the polled `statements` list row
  // over `current.statement.status`. The list is refreshed every 5s
  // while any analysis is in flight; `current` is loaded on click and
  // re-loaded by the same polling tick, but the polling effect tears
  // itself down the moment NO statements are 'analyzing' — so the
  // last refresh that flipped status to 'error' or 'done' may not have
  // a matching `load(currentId)` companion. Reading the list value
  // directly closes that race so the user doesn't see an "Analyzing…"
  // banner stuck under an "ERROR" sidebar badge.
  const polledStatus = manager.statements.find(s => s.id === manager.current?.statement.id)?.status;
  const stmtStatus = polledStatus ?? manager.current.statement.status;
  const isAnalyzing = stmtStatus === 'analyzing';
  const isError = stmtStatus === 'error';
  const isCancelled = stmtStatus === 'cancelled';

  return (
    <motion.div
      key={manager.current.statement.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex-1 overflow-y-auto"
    >
      <div className="max-w-5xl mx-auto p-6 space-y-5">
        <BankStatementSummary detail={manager.current} onDelete={handleDelete} />
        {manager.current.reconciliationWarning && (
          <div className="rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-900/15 p-4 text-sm text-amber-800 dark:text-amber-200">
            <span className="font-semibold">Heads up:</span> {manager.current.reconciliationWarning}
          </div>
        )}
        {isAnalyzing && (
          <div className="rounded-2xl border border-blue-200 dark:border-blue-800/60 bg-blue-50/60 dark:bg-blue-900/15 p-5">
            <div className="flex items-start gap-3">
              <Loader2 className="w-5 h-5 mt-0.5 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900 dark:text-gray-100">Analyzing your statement…</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  The server keeps running even if you close this tab — just come back here to see the result.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCancelOpen(true)}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20"
              >
                Cancel
              </button>
            </div>
            <div className="mt-3 h-1.5 w-full rounded-full bg-blue-100 dark:bg-blue-900/40 overflow-hidden">
              <div className="h-full w-1/3 bg-blue-500 dark:bg-blue-400" style={{ animation: 'bankProgress 1.6s ease-in-out infinite' }} />
            </div>
            <style>{`@keyframes bankProgress { 0% { transform: translateX(-120%); } 50% { transform: translateX(120%); } 100% { transform: translateX(320%); } }`}</style>
          </div>
        )}
        {isError && (() => {
          const raw = manager.current.statement.errorMessage ?? '';
          // Friendly mapping for transient upstream errors. The raw
          // upstream messages ("503 status code (no body)") are
          // unhelpful for the end user — they imply something is
          // broken in our app when actually Gemini just hiccuped.
          const isTransient = /\b50[234]\b|service unavailable|no body|temporarily unavailable|ECONNRESET|ETIMEDOUT/i.test(raw);
          const friendly = isTransient
            ? "The AI service was temporarily unavailable. This usually clears in a minute — re-upload the same file to try again. The credit hasn't been charged."
            : (raw || 'Unknown error. Try uploading the statement again.');
          return (
            <div className="rounded-2xl border border-rose-200 dark:border-rose-800/60 bg-rose-50/60 dark:bg-rose-900/15 p-5">
              <p className="font-semibold text-rose-800 dark:text-rose-200">Analysis failed</p>
              <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">{friendly}</p>
              {isTransient && raw && (
                <p className="text-[10px] text-rose-600/70 dark:text-rose-400/70 mt-2 font-mono">{raw.slice(0, 200)}</p>
              )}
            </div>
          );
        })()}
        {isCancelled && (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-5">
            <p className="font-semibold text-gray-800 dark:text-gray-200">Cancelled</p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              You cancelled this analysis. The slot was counted toward your monthly limit.
            </p>
          </div>
        )}
        {!isAnalyzing && !isError && !isCancelled && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <CategoryBreakdown transactions={manager.current.transactions} />
              <CounterpartySummary transactions={manager.current.transactions} />
            </div>
            <TransactionTable transactions={manager.current.transactions} manager={manager} />
          </>
        )}
      </div>
      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this analysis?"
        description="It will still count toward your monthly limit. The analysis can't be resumed once cancelled."
        confirmLabel="Cancel analysis"
        cancelLabel="Keep running"
        destructive
        pending={cancelPending}
        onConfirm={async () => {
          if (!manager.current) return;
          setCancelPending(true);
          try {
            await manager.cancel(manager.current.statement.id);
            toast.success('Analysis cancelled');
            setCancelOpen(false);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Cancel failed');
          } finally {
            setCancelPending(false);
          }
        }}
        onCancel={() => setCancelOpen(false)}
      />
    </motion.div>
  );
}
