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

  const handleChange = async (txId: string, category: string) => {
    try {
      await manager.reassignCategory(txId, category);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update category');
    }
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
                <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/20">
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-700 dark:text-gray-300">{formatDate(t.date)}</td>
                  <td className="px-4 py-2.5 max-w-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-gray-800 dark:text-gray-200" title={t.narration ?? ''}>{t.narration}</span>
                      {t.isRecurring && <Repeat className="w-3.5 h-3.5 text-violet-500 flex-none" aria-label="Recurring" />}
                      {t.userOverride && <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 flex-none" aria-label="Manually categorised" />}
                    </div>
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
