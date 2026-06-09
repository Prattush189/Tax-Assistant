import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Repeat, CheckCircle2, Brain, X, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { BankTransaction } from '../../services/api';
import { formatINR, formatINRSmart, formatDate } from '../../lib/utils';
import { BankStatementManager } from '../../hooks/useBankStatementManager';
import { BANK_STATEMENT_CATEGORIES, CATEGORY_META, BankStatementCategory } from './lib/categories';

interface Props {
  transactions: BankTransaction[];
  manager: BankStatementManager;
}

// Accumulator for the "Remember selected" batch toast. One entry per
// corrected row; entries are added as the user changes categories
// across the statement and consumed when the user clicks Remember on
// the persistent panel. Same row corrected twice = its entry is
// overwritten (latest category wins).
interface PendingLearn {
  txId: string;
  category: string;
  /** Truncated display sample for the panel row. */
  sample: string;
  /** Full narration for the title hover. */
  fullSample: string;
  /** Checkbox state. Defaults to true so the bulk Remember does the
   *  expected thing — uncheck the obvious one-offs before clicking. */
  checked: boolean;
}

const PENDING_TOAST_ID = 'pending-learns';

export function TransactionTable({ transactions, manager }: Props) {
  if (!transactions.length) {
    return (
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-8 text-center text-gray-500 dark:text-gray-400">
        No transactions parsed from this statement.
      </div>
    );
  }

  // ── Accumulating Remember-panel state ─────────────────────────
  //
  // Every category change immediately persists the new category on
  // the row (we never gate persistence on a Remember click). The
  // optional follow-up — converting that correction into a learned
  // rule the firm reuses — gets BATCHED into a single persistent
  // panel that accumulates across the session.
  //
  // Why one panel instead of N toasts:
  //   - User correcting 8 rows of "Segpay" should be able to make
  //     all 8 corrections, then click Remember ONCE. Per-row toasts
  //     mean 8 Remember clicks (or 8 dismissals plus a lost rule).
  //   - The panel also lets the user UNCHECK obvious one-offs they
  //     don't want stored as rules ("adjustment", "test entry").
  //   - Single persistent panel is unobtrusive compared to a stack
  //     of toasts in the corner.
  //
  // State shape: Map keyed by txId so re-correcting the same row
  // updates the existing entry rather than creating a duplicate.
  const [pendingLearns, setPendingLearns] = useState<Map<string, PendingLearn>>(new Map());

  // Search / filter state. Matches narration + counterparty +
  // reference + category + formatted amount + date — anything visible
  // in the row, so a user typing "phonepe", "2025-05-07", "135000",
  // or "transfers" all just work. Case-insensitive substring.
  const [query, setQuery] = useState('');
  const filteredTransactions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter((t) => {
      const hay = [
        t.narration,
        t.counterparty,
        t.reference,
        t.category,
        t.subcategory,
        t.date,
        // amount in three forms: plain integer, plain paisa-precise,
        // and comma-formatted INR. So "135000", "5.90", and
        // "1,35,000" all match.
        String(Math.round(Math.abs(t.amount))),
        Math.abs(t.amount).toFixed(2),
        formatINR(Math.abs(t.amount)),
        formatINRSmart(Math.abs(t.amount)),
      ]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [transactions, query]);

  const toggleChecked = useCallback((txId: string) => {
    setPendingLearns((prev) => {
      const next = new Map(prev);
      const entry = next.get(txId);
      if (entry) next.set(txId, { ...entry, checked: !entry.checked });
      return next;
    });
  }, []);

  const removeFromPending = useCallback((txId: string) => {
    setPendingLearns((prev) => {
      const next = new Map(prev);
      next.delete(txId);
      return next;
    });
  }, []);

  const dismissAll = useCallback(() => {
    setPendingLearns(new Map());
    toast.dismiss(PENDING_TOAST_ID);
  }, []);

  // Bulk Remember — upsert a learned rule for every checked row.
  // Uses Promise.allSettled so a single failure doesn't poison the
  // batch (e.g. one row's narration produces an empty fingerprint;
  // others succeed). At-best-effort feedback: toast counts successes
  // and warns about failures.
  const rememberSelected = useCallback(async () => {
    const selected = Array.from(pendingLearns.values()).filter((p) => p.checked);
    if (selected.length === 0) return;
    toast.dismiss(PENDING_TOAST_ID);
    setPendingLearns(new Map());
    const results = await Promise.allSettled(
      selected.map((p) =>
        manager.reassignCategory(p.txId, p.category, null, { remember: 'always' }),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as { learned: unknown } | undefined)?.learned).length;
    const failed = results.length - ok;
    if (ok > 0) {
      toast.success(
        `Remembered ${ok} rule${ok === 1 ? '' : 's'}. Will auto-apply to similar entries going forward.`,
        { duration: 4000 },
      );
    }
    if (failed > 0) {
      toast.error(`${failed} rule${failed === 1 ? '' : 's'} could not be saved (narration too generic).`, { duration: 5000 });
    }
  }, [manager, pendingLearns]);

  // Re-render the persistent panel whenever pendingLearns changes.
  // Using a stable toast id means react-hot-toast updates the
  // existing toast in place rather than stacking new ones.
  // Stash the latest handlers in refs so the toast's closure
  // always calls the freshest versions — without this, the
  // initial toast captures the first render's handlers and stale
  // pendingLearns leak through.
  const pendingLearnsRef = useRef(pendingLearns);
  const handlersRef = useRef({ toggleChecked, removeFromPending, dismissAll, rememberSelected });
  useEffect(() => {
    pendingLearnsRef.current = pendingLearns;
    handlersRef.current = { toggleChecked, removeFromPending, dismissAll, rememberSelected };
  }, [pendingLearns, toggleChecked, removeFromPending, dismissAll, rememberSelected]);

  useEffect(() => {
    if (pendingLearns.size === 0) {
      toast.dismiss(PENDING_TOAST_ID);
      return;
    }
    const entries = Array.from(pendingLearns.values());
    const checkedCount = entries.filter((e) => e.checked).length;
    toast.custom(
      () => (
        <div className="w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-violet-50 dark:bg-violet-900/20 flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Remember these classifications?
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                We'll auto-apply selected rules to future similar entries across your firm.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handlersRef.current.dismissAll()}
              className="p-1 rounded hover:bg-violet-100 dark:hover:bg-violet-900/40 shrink-0"
              aria-label="Dismiss all"
            >
              <X className="w-3.5 h-3.5 text-gray-500" />
            </button>
          </div>
          <ul className="max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
            {entries.map((e) => (
              <li key={e.txId} className="px-3 py-2 flex items-start gap-2 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                <input
                  type="checkbox"
                  checked={e.checked}
                  onChange={() => handlersRef.current.toggleChecked(e.txId)}
                  className="mt-0.5 w-3.5 h-3.5 accent-emerald-600 cursor-pointer shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Set to <span className="font-medium text-gray-800 dark:text-gray-200">{e.category}</span>
                  </p>
                  <p className="text-[11px] text-gray-600 dark:text-gray-400 break-all" title={e.fullSample}>
                    {e.sample}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handlersRef.current.removeFromPending(e.txId)}
                  className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 shrink-0"
                  aria-label="Remove from pending"
                  title="Don't ask about this one"
                >
                  <X className="w-3 h-3 text-gray-400" />
                </button>
              </li>
            ))}
          </ul>
          <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60 flex items-center justify-between gap-2">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              {checkedCount} of {entries.length} selected
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handlersRef.current.dismissAll()}
                className="text-xs px-2 py-1 rounded text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => { void handlersRef.current.rememberSelected(); }}
                disabled={checkedCount === 0}
                className="text-xs font-medium px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Remember {checkedCount > 0 ? checkedCount : ''}
              </button>
            </div>
          </div>
        </div>
      ),
      { id: PENDING_TOAST_ID, duration: Infinity, position: 'bottom-right' },
    );
  }, [pendingLearns]);

  // ── Per-row category change handler ───────────────────────────
  //
  // 1. Persist the category change immediately (no gating).
  // 2. Append/replace the row in pendingLearns so the accumulating
  //    panel surfaces it.
  // Same row corrected multiple times keeps only the latest category.
  const handleChange = async (txId: string, category: string) => {
    const tx = transactions.find((t) => t.id === txId);
    try {
      await manager.reassignCategory(txId, category);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update category');
      return;
    }
    const fullSample = (tx?.counterparty || tx?.narration || '') || 'similar entries';
    const truncatedSample = fullSample.length > 80 ? fullSample.slice(0, 80) + '…' : fullSample;
    setPendingLearns((prev) => {
      const next = new Map(prev);
      next.set(txId, { txId, category, sample: truncatedSample, fullSample, checked: true });
      return next;
    });
  };

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search narration, counterparty, amount, date, category..."
            className="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {query
            ? `${filteredTransactions.length} of ${transactions.length}`
            : `${transactions.length} txns`}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/60 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Date</th>
              <th className="px-4 py-3 text-left font-medium">Narration</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 text-left font-medium">Category</th>
              <th className="px-4 py-3 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {filteredTransactions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No transactions match &ldquo;{query}&rdquo;.
                </td>
              </tr>
            )}
            {filteredTransactions.map((t) => {
              const cat = (BANK_STATEMENT_CATEGORIES as readonly string[]).includes(t.category)
                ? t.category as BankStatementCategory
                : 'Other';
              const meta = CATEGORY_META[cat];
              const isCredit = t.amount >= 0;
              return (
                // id={`tx-${id}`} so the FlaggedTransactions component
                // can scroll a flagged row into view via scrollIntoView.
                // Adds zero visual weight; pure anchor target.
                <tr key={t.id} id={`tx-${t.id}`} className="hover:bg-gray-50 dark:hover:bg-gray-900/20 transition-shadow">
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-700 dark:text-gray-300">{formatDate(t.date)}</td>
                  <td className="px-4 py-2.5 max-w-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-gray-800 dark:text-gray-200" title={t.narration ?? ''}>{t.narration}</span>
                      {t.isRecurring && <Repeat className="w-3.5 h-3.5 text-violet-500 flex-none" aria-label="Recurring" />}
                      {t.userOverride && <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 flex-none" aria-label="Manually categorised" />}
                    </div>
                    {(t.counterparty || t.reference) && (
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 truncate">
                        {t.counterparty && <span className="truncate" title={t.counterparty}>{t.counterparty}</span>}
                        {t.counterparty && t.reference && <span className="text-gray-300 dark:text-gray-600">·</span>}
                        {t.reference && <span className="truncate font-mono" title={t.reference}>ref {t.reference}</span>}
                      </div>
                    )}
                  </td>
                  <td className={`px-4 py-2.5 whitespace-nowrap text-right font-medium ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {isCredit ? '+' : '−'}{formatINRSmart(Math.abs(t.amount))}
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={cat}
                      onChange={(e) => void handleChange(t.id, e.target.value)}
                      className={`text-xs rounded-md px-2 py-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 ${meta.color}`}
                    >
                      {BANK_STATEMENT_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-right text-gray-500 dark:text-gray-400">
                    {t.balance != null ? formatINRSmart(t.balance) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
