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

interface Props {
  manager: BankStatementManager;
}

export function BankStatementView({ manager }: Props) {
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
                Upload a bank statement — Gemini will extract and tax-categorise every transaction.
              </p>
            </div>
          </div>

          <BankStatementUploader manager={manager} />

          <BankStatementRules manager={manager} />

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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <CategoryBreakdown transactions={manager.current.transactions} />
          <CounterpartySummary transactions={manager.current.transactions} />
        </div>
        <TransactionTable transactions={manager.current.transactions} manager={manager} />
      </div>
    </motion.div>
  );
}
