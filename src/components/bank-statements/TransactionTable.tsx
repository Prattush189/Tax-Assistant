import { Repeat, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { BankTransaction } from '../../services/api';
import { formatINR, formatDate } from '../../lib/utils';
import { BankStatementManager } from '../../hooks/useBankStatementManager';
import { BANK_STATEMENT_CATEGORIES, CATEGORY_META, BankStatementCategory } from './lib/categories';

interface Props {
  transactions: BankTransaction[];
  manager: BankStatementManager;
}

export function TransactionTable({ transactions, manager }: Props) {
  if (!transactions.length) {
    return (
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-8 text-center text-gray-500 dark:text-gray-400">
        No transactions parsed from this statement.
      </div>
    );
  }

  // After a category change, prompt the user to remember it for
  // future similar entries. Locked precedence: every correction is
  // saved immediately; learning is opt-in via the explicit Remember
  // click.
  //
  // UX choices (revised 2026-05-22):
  //   - VERTICAL layout: long sample labels (full-narration UPI
  //     references like "PCI/9710/Segpay.com*...") were truncating
  //     the Remember button off-screen with the previous horizontal
  //     row. Stacking puts buttons on their own line, always visible.
  //   - PERSISTENT (duration: Infinity): toast stays until the user
  //     clicks Remember or Dismiss. Lets them batch-correct multiple
  //     rows and decide which to remember without each toast
  //     expiring on a timer. Multiple toasts stack in the corner; the
  //     user can leave the most-likely-to-remember ones up and
  //     dismiss the obviously-one-off ones first.
  //   - Sample is truncated to 60 chars in the visible text; the
  //     full text sits in the title attribute for hover.
  const handleChange = async (txId: string, category: string) => {
    const tx = transactions.find((t) => t.id === txId);
    try {
      await manager.reassignCategory(txId, category);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update category');
      return;
    }
    const fullSample = (tx?.counterparty || tx?.narration || '') || 'similar entries';
    const truncatedSample = fullSample.length > 60 ? fullSample.slice(0, 60) + '…' : fullSample;
    toast((t) => (
      <div className="flex flex-col gap-2 max-w-xs">
        <p className="text-sm text-gray-800 dark:text-gray-100">
          Set to <span className="font-medium">{category}</span>.
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400" title={fullSample}>
          Remember for similar entries to <span className="font-medium text-gray-700 dark:text-gray-200 break-all">{truncatedSample}</span>?
        </p>
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 shrink-0"
            onClick={() => {
              // Fire the upsert in the background. The reassignCategory
              // hook sends remember:'always' so the server upserts a
              // learned rule (the row's category was already set by
              // the first PATCH, so this is a pure rule-create on the
              // server with no impact on the row itself).
              void manager.reassignCategory(txId, category, null, { remember: 'always' }).then((res) => {
                toast.dismiss(t.id);
                if (res?.learned) {
                  toast.success('Remembered. Will auto-apply to similar entries going forward.', { duration: 4000 });
                }
              });
            }}
          >
            Remember
          </button>
          <button
            type="button"
            className="text-xs px-2 py-1.5 rounded-md text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => toast.dismiss(t.id)}
          >
            Dismiss
          </button>
        </div>
      </div>
    ), {
      // Persistent — user explicitly Remembers or Dismisses. Lets them
      // batch-process several corrections without losing any to a
      // 6-second timer expiry.
      duration: Infinity,
    });
  };

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 overflow-hidden">
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
            {transactions.map((t) => {
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
                    {isCredit ? '+' : '−'}{formatINR(Math.abs(t.amount))}
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
                    {t.balance != null ? formatINR(t.balance) : '—'}
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
