/**
 * Surfaces Phase 2 anomaly detector output above the transaction
 * table. The four anomaly types each have a distinct icon + tone:
 *
 *   outlier_amount         info  — large-relative-to-category
 *   new_counterparty       warn  — first-time payer/payee ≥ ₹1L
 *   round_cash_deposit     warn  — round ≥ ₹50K cash (269ST exposure)
 *   same_day_cash_cluster  warn  — multiple cash deposits same day
 *
 * Layout:
 *   - Renders nothing when `anomalies.length === 0` (silence is good
 *     news — don't dilute with a "no anomalies" empty state).
 *   - Header counts (warn / info) so the user can triage at a glance.
 *   - Each anomaly row is clickable; clicking scrolls the underlying
 *     transaction row into view via window.location.hash anchor
 *     pattern (TransactionTable rows expose `id={`tx-${id}`}`).
 *   - Collapsed by default when count > 10; otherwise expanded.
 *
 * Why a separate component vs inline in BankStatementView: the
 * anomaly logic is self-contained and might grow (more rule types,
 * dismissal UX, "mark as reviewed" — Phase 2.1 candidates).
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, TrendingUp, UserPlus, Banknote, Layers, ChevronDown, ChevronRight } from 'lucide-react';
import type { BankTransaction, BankTransactionAnomaly } from '../../services/api';
import { cn, formatINR } from '../../lib/utils';

interface Props {
  anomalies: BankTransactionAnomaly[];
  transactions: BankTransaction[];
}

const TYPE_META: Record<
  BankTransactionAnomaly['type'],
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  outlier_amount: { label: 'Unusually large for category', icon: TrendingUp },
  new_counterparty: { label: 'First-time counterparty', icon: UserPlus },
  round_cash_deposit: { label: 'Round-figure cash deposit', icon: Banknote },
  same_day_cash_cluster: { label: 'Same-day cash cluster', icon: Layers },
};

const COLLAPSE_THRESHOLD = 10;

export function FlaggedTransactions({ anomalies, transactions }: Props) {
  const [expanded, setExpanded] = useState<boolean>(anomalies.length <= COLLAPSE_THRESHOLD);

  // Build a transaction lookup so we can show the underlying row's
  // narration, date, and amount alongside each anomaly. Cheap memo —
  // statements rarely exceed a few hundred rows.
  const txById = useMemo(() => {
    const map = new Map<string, BankTransaction>();
    for (const t of transactions) map.set(t.id, t);
    return map;
  }, [transactions]);

  // Group anomalies by type for the header counts. We still RENDER
  // them in a single severity-first list, but the counts help the
  // user triage ("3 round cash deposits, 2 unusually large").
  const counts = useMemo(() => {
    const byType: Record<string, number> = {};
    let warn = 0;
    let info = 0;
    for (const a of anomalies) {
      byType[a.type] = (byType[a.type] ?? 0) + 1;
      if (a.severity === 'warn') warn++;
      else info++;
    }
    return { byType, warn, info };
  }, [anomalies]);

  if (anomalies.length === 0) return null;

  // Sort: warn before info, then by type so similar anomalies cluster.
  const sorted = [...anomalies].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'warn' ? -1 : 1;
    return a.type.localeCompare(b.type);
  });

  return (
    <div className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-900/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-amber-100/40 dark:hover:bg-amber-900/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Flagged transactions
              <span className="ml-2 text-gray-400 font-normal">({anomalies.length})</span>
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              {counts.warn > 0 && (
                <span className="text-amber-700 dark:text-amber-300 font-medium mr-2">
                  {counts.warn} need review
                </span>
              )}
              {counts.info > 0 && <span>{counts.info} info</span>}
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-amber-200/60 dark:border-amber-900/30 divide-y divide-amber-100 dark:divide-amber-900/20">
          {sorted.map((a) => {
            const meta = TYPE_META[a.type];
            const tx = txById.get(a.transactionId);
            const Icon = meta.icon;
            return (
              <a
                key={a.id}
                href={`#tx-${a.transactionId}`}
                className="flex items-start gap-3 px-5 py-3 hover:bg-amber-100/40 dark:hover:bg-amber-900/20 transition-colors"
                onClick={(e) => {
                  // Smooth-scroll instead of a hard-jump — the
                  // transactions table is deep in the page and a
                  // jump can disorient.
                  e.preventDefault();
                  const el = document.getElementById(`tx-${a.transactionId}`);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Brief highlight pulse so the user's eye lands
                    // on the row. CSS does the animation; we just
                    // toggle the class.
                    el.classList.add('ring-2', 'ring-amber-400');
                    window.setTimeout(() => {
                      el.classList.remove('ring-2', 'ring-amber-400');
                    }, 1800);
                  }
                }}
              >
                <div
                  className={cn(
                    'w-7 h-7 rounded-md flex items-center justify-center shrink-0',
                    a.severity === 'warn'
                      ? 'bg-amber-200/60 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                      : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
                      {meta.label}
                    </span>
                    {tx && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {tx.date} ·{' '}
                        <span className={tx.amount >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}>
                          {tx.amount >= 0 ? '+' : '−'}{formatINR(Math.abs(tx.amount))}
                        </span>
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-800 dark:text-gray-200 mt-0.5">{a.reason}</p>
                  {tx?.narration && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate" title={tx.narration}>
                      {tx.narration}
                    </p>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
