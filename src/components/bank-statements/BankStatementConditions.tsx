import { useMemo, useState } from 'react';
import { Plus, X, Filter } from 'lucide-react';
import toast from 'react-hot-toast';
import { BankStatementManager } from '../../hooks/useBankStatementManager';
import { BANK_STATEMENT_CONDITION_MAX_WORDS } from '../../services/api';

interface Props {
  manager: BankStatementManager;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function BankStatementConditions({ manager }: Props) {
  const [isAdding, setIsAdding] = useState(false);
  const [text, setText] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const words = useMemo(() => wordCount(text), [text]);
  const overLimit = words > BANK_STATEMENT_CONDITION_MAX_WORDS;

  const reset = () => {
    setText('');
    setIsAdding(false);
  };

  const save = async () => {
    if (!text.trim()) {
      toast.error('Enter a condition');
      return;
    }
    if (overLimit) {
      toast.error(`Keep it under ${BANK_STATEMENT_CONDITION_MAX_WORDS} words`);
      return;
    }
    setIsSaving(true);
    try {
      await manager.addCondition(text.trim());
      toast.success('Condition saved');
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await manager.removeCondition(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-sky-500" />
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Conditions</h3>
        </div>
        {!isAdding && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
          >
            <Plus className="w-3.5 h-3.5" />
            Add condition
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Free-form instructions for the AI on every new statement — filters, exclusions, special tagging.
        e.g. "Ignore transactions under ₹100", "Treat all ZOMATO debits as Personal", "Exclude ATM withdrawals".
      </p>

      {isAdding && (
        <div className="mb-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={`What should the AI do?  (max ${BANK_STATEMENT_CONDITION_MAX_WORDS} words)`}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 resize-y"
          />
          <div className="flex items-center justify-between mt-2">
            <span className={`text-[11px] ${overLimit ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'}`}>
              {words} / {BANK_STATEMENT_CONDITION_MAX_WORDS} words
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={reset}
                className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={isSaving || overLimit || !text.trim()}
                className="px-3 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving…' : 'Save condition'}
              </button>
            </div>
          </div>
        </div>
      )}

      {manager.conditions.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">No conditions yet. Add one to steer the AI on every new statement.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {manager.conditions.map((c) => (
            <li key={c.id} className="py-2 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">{c.text}</p>
              </div>
              <button
                type="button"
                onClick={() => void remove(c.id)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                aria-label="Delete condition"
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
