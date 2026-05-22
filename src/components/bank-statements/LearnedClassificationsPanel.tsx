/**
 * Management surface for per-firm learned classifications — the
 * memory layer that captures the user's correction history and
 * auto-applies it to future bank-statement rows.
 *
 * Placement: lives next to BankStatementRules (legacy explicit
 * match_text rules) in BankStatementView. Conceptually adjacent
 * (both alter how rows get categorised) but mechanically distinct:
 *   - BankStatementRules: per-user, manually-entered, match_text.
 *   - LearnedClassifications: per-firm, implicitly captured via
 *     "Remember" actions on individual corrections, narration-
 *     fingerprint key.
 *
 * UX:
 *   - Collapsed by default with a one-line summary ("3 active rules").
 *   - Expanded view: searchable list, per-row category dropdown,
 *     disable/enable toggle, bulk-select + bulk-reassign.
 *   - Empty-state copy explains how to populate the table (correct
 *     a row, click "Remember" in the toast).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, Search, ChevronDown, ChevronRight, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listLearnedClassifications,
  updateLearnedClassification,
  deleteLearnedClassification,
  bulkUpdateLearnedClassifications,
  type LearnedClassification,
} from '../../services/api';
import { BANK_STATEMENT_CATEGORIES } from './lib/categories';
import { formatDate, cn } from '../../lib/utils';

export function LearnedClassificationsPanel() {
  const [rules, setRules] = useState<LearnedClassification[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState<string>('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { rules: list } = await listLearnedClassifications();
      setRules(list);
    } catch (err) {
      // Silent on the count tile — failure here usually means
      // unauthenticated state being torn down; visible loads from
      // an explicit user expand will retry.
      console.error('[learned-rules] failed to list:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeCount = useMemo(() => rules.filter((r) => !r.disabled).length, [rules]);
  const filtered = useMemo(() => {
    if (!search.trim()) return rules;
    const q = search.toLowerCase();
    return rules.filter((r) =>
      (r.sampleNarration ?? r.fingerprint).toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q) ||
      (r.subcategory ?? '').toLowerCase().includes(q),
    );
  }, [rules, search]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleDisabled = async (rule: LearnedClassification) => {
    try {
      await updateLearnedClassification(rule.id, { disabled: !rule.disabled });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update rule');
    }
  };

  const handleEditCategory = async (rule: LearnedClassification, nextCategory: string) => {
    try {
      await updateLearnedClassification(rule.id, { category: nextCategory });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update rule');
    }
  };

  const handleDelete = async (rule: LearnedClassification) => {
    if (!confirm(`Delete the learned rule for "${rule.sampleNarration ?? rule.fingerprint}"? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteLearnedClassification(rule.id);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete rule');
    }
  };

  const handleBulkReassign = async () => {
    if (selected.size === 0 || !bulkCategory) return;
    try {
      const { changed } = await bulkUpdateLearnedClassifications({
        ids: Array.from(selected),
        category: bulkCategory,
      });
      toast.success(`Updated ${changed} rule${changed === 1 ? '' : 's'} to ${bulkCategory}`);
      setSelected(new Set());
      setBulkCategory('');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk update failed');
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 overflow-hidden">
      {/* Collapsible header — clicking the bar expands the panel. The
        * count is shown in the collapsed state so the user can see
        * the system has memory without opening the panel. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
            <Brain className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Remembered classifications</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {activeCount === 0
                ? 'Correct a category and click "Remember" to teach the system'
                : `${activeCount} active rule${activeCount === 1 ? '' : 's'} — auto-applied to matching narrations across your firm`}
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
        <div className="border-t border-gray-100 dark:border-gray-800 p-5 space-y-3">
          {rules.length === 0 && !loading && (
            <div className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
              <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">No remembered classifications yet</p>
              <p className="text-xs">
                When you correct a transaction's category, click <span className="font-medium">Remember</span> in the
                toast that appears. The next statement that contains a similar narration will be auto-classified.
              </p>
            </div>
          )}

          {rules.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by narration or category"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 text-gray-900 dark:text-gray-100"
                  />
                </div>
                {selected.size > 0 && (
                  <div className="flex items-center gap-2">
                    <select
                      value={bulkCategory}
                      onChange={(e) => setBulkCategory(e.target.value)}
                      className="text-xs rounded-md px-2 py-1.5 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                    >
                      <option value="">Reassign {selected.size} selected to…</option>
                      {BANK_STATEMENT_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleBulkReassign()}
                      disabled={!bulkCategory}
                      className="text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Apply
                    </button>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto max-h-96 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/60 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 w-8">
                        <input
                          type="checkbox"
                          checked={filtered.length > 0 && filtered.every((r) => selected.has(r.id))}
                          onChange={(e) => {
                            setSelected((prev) => {
                              if (e.target.checked) {
                                const next = new Set(prev);
                                for (const r of filtered) next.add(r.id);
                                return next;
                              }
                              const next = new Set(prev);
                              for (const r of filtered) next.delete(r.id);
                              return next;
                            });
                          }}
                        />
                      </th>
                      <th className="px-3 py-2 text-left font-medium">Sample narration</th>
                      <th className="px-3 py-2 text-left font-medium">Category</th>
                      <th className="px-3 py-2 text-right font-medium">Hits</th>
                      <th className="px-3 py-2 text-left font-medium">Last applied</th>
                      <th className="px-3 py-2 text-left font-medium">Added by</th>
                      <th className="px-3 py-2 w-24" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filtered.map((r) => (
                      <tr
                        key={r.id}
                        className={cn(
                          'hover:bg-gray-50 dark:hover:bg-gray-900/30',
                          r.disabled && 'opacity-50',
                        )}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selected.has(r.id)}
                            onChange={() => toggleSelect(r.id)}
                          />
                        </td>
                        <td className="px-3 py-2 max-w-xs">
                          <div className="truncate text-gray-800 dark:text-gray-200" title={r.sampleNarration ?? r.fingerprint}>
                            {r.sampleNarration ?? <span className="text-gray-400">(no sample)</span>}
                          </div>
                          <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate" title={r.fingerprint}>
                            {r.fingerprint}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={r.category}
                            onChange={(e) => void handleEditCategory(r, e.target.value)}
                            disabled={r.disabled}
                            className="text-xs rounded-md px-2 py-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 disabled:opacity-50"
                          >
                            {BANK_STATEMENT_CATEGORIES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                          {r.subcategory && (
                            <p className="text-[10px] text-gray-400 mt-0.5">{r.subcategory}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                          {r.hitCount.toLocaleString('en-IN')}
                        </td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-[12px]">
                          {r.lastAppliedAt ? formatDate(r.lastAppliedAt.slice(0, 10)) : '—'}
                        </td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-[12px]">
                          {r.createdByName ?? '—'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              type="button"
                              title={r.disabled ? 'Enable rule' : 'Disable rule'}
                              onClick={() => void handleToggleDisabled(r)}
                              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                            >
                              {r.disabled ? <ToggleLeft className="w-4 h-4" /> : <ToggleRight className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                            </button>
                            <button
                              type="button"
                              title="Delete rule"
                              onClick={() => void handleDelete(r)}
                              className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md text-gray-500 hover:text-red-600"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filtered.length === 0 && search.trim() && (
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-2">
                  No rules match "{search}"
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
