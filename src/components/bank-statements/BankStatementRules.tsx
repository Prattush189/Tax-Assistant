import { useState } from 'react';
import { Plus, X, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { BankStatementManager } from '../../hooks/useBankStatementManager';
import { BANK_STATEMENT_CATEGORIES } from './lib/categories';

interface Props {
  manager: BankStatementManager;
}

export function BankStatementRules({ manager }: Props) {
  const [isAdding, setIsAdding] = useState(false);
  const [matchText, setMatchText] = useState('');
  const [category, setCategory] = useState<string>('');
  const [counterpartyLabel, setCounterpartyLabel] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const reset = () => {
    setMatchText('');
    setCategory('');
    setCounterpartyLabel('');
    setIsAdding(false);
  };

  const save = async () => {
    if (!matchText.trim()) {
      toast.error('Enter text to match');
      return;
    }
    if (!category && !counterpartyLabel.trim()) {
      toast.error('Pick a category or enter a label');
      return;
    }
    setIsSaving(true);
    try {
      await manager.addRule({
        matchText: matchText.trim(),
        category: category || null,
        counterpartyLabel: counterpartyLabel.trim() || null,
      });
      toast.success('Rule saved');
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await manager.removeRule(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Auto-tagging rules</h3>
        </div>
        {!isAdding && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
          >
            <Plus className="w-3.5 h-3.5" />
            Add rule
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Applied automatically to every new statement. Rules match anywhere inside the narration (case-insensitive).
      </p>

      {isAdding && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800">
          <input
            value={matchText}
            onChange={(e) => setMatchText(e.target.value)}
            placeholder="Narration contains… (e.g. ZOMATO, HDFC HL)"
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
          />
          <input
            value={counterpartyLabel}
            onChange={(e) => setCounterpartyLabel(e.target.value)}
            placeholder="Counterparty label (optional)"
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
          >
            <option value="">— Keep AI category —</option>
            {BANK_STATEMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <div className="flex gap-2 justify-end">
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
              disabled={isSaving}
              className="px-3 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Save rule'}
            </button>
          </div>
        </div>
      )}

      {manager.rules.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">No rules yet. Add one to auto-label transactions.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {manager.rules.map((rule) => (
            <li key={rule.id} className="py-2 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 dark:text-gray-100 truncate">
                  <span className="text-gray-400 dark:text-gray-500">if narration contains</span>{' '}
                  <span className="font-mono text-[13px]">"{rule.matchText}"</span>
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                  {rule.category && <>→ {rule.category}</>}
                  {rule.category && rule.counterpartyLabel && ' · '}
                  {rule.counterpartyLabel && <>label as <span className="font-medium">{rule.counterpartyLabel}</span></>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(rule.id)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                aria-label="Delete rule"
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
