/**
 * Map each TB row to a Schedule III line. Auto-suggest pre-selects
 * obvious matches (sundry debtors → trade receivables, etc.); user
 * reviews and corrects. Bulk-accept-all for the obvious cases.
 *
 * Mapping uses the current-year TB rows as the source of truth for
 * row labels. The previous-year TB is read by index alignment —
 * row N in previous-year is assumed to be the same account as row N
 * in current-year. If your TB has different rows across years
 * (an account opened/closed mid-period), the mapping step expects
 * you to align them manually outside the tool. v1 keeps this
 * simple; v1.1 could match by account name string.
 */
import { useMemo, useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../../itr/shared/Inputs';
import type { TbBsDraft, TbMappingEntry } from '../lib/uiModel';
import {
  SCHEDULE_THREE_ACCOUNTS,
  SCHEDULE_THREE_GROUP_LABELS,
  suggestScheduleThreeKey,
  type ScheduleThreeSection,
} from '../lib/scheduleThreeAccounts';
import { aiSuggestTbBsMapping } from '../../../services/api';

interface Props {
  draft: TbBsDraft;
  draftId: string | null;
  onChange: (patch: Partial<TbBsDraft>) => void;
}

function readNumber(raw: string): number {
  if (!raw) return 0;
  let s = String(raw).trim();
  if (!s || s === '-' || s === '—') return 0;
  const negative = /^\(.+\)$/.test(s);
  if (negative) s = s.slice(1, -1);
  s = s.replace(/[₹$,]/g, '').replace(/\s+/g, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

export function TbMappingStep({ draft, draftId, onChange }: Props) {
  const [aiLoading, setAiLoading] = useState(false);
  const tb = draft.currentTb;
  const rows = tb?.rows ?? [];
  const accountCol = tb?.accountColumn ?? 0;
  const debitCol = tb?.debitColumn ?? null;
  const creditCol = tb?.creditColumn ?? null;
  const mapping = draft.mapping ?? [];

  const mappingByRow = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of mapping) {
      if (e.yearKey === 'current') m.set(e.sourceRowIndex, e.canonicalKey);
    }
    return m;
  }, [mapping]);

  // Auto-suggest mapping for rows the user hasn't touched.
  const suggested = useMemo(() => {
    const out = new Map<number, ScheduleThreeSection>();
    for (let i = 0; i < rows.length; i++) {
      const label = (rows[i][accountCol] ?? '').trim();
      if (!label) continue;
      const s = suggestScheduleThreeKey(label);
      if (s) out.set(i, s);
    }
    return out;
  }, [rows, accountCol]);

  // Balance tie-out check: sum of all debits should equal sum of all
  // credits. Excludes unmapped/skipped rows (those won't appear in
  // the output, so their sums don't need to balance).
  const balanceCheck = useMemo(() => {
    let totalDr = 0;
    let totalCr = 0;
    for (const [idx, _key] of mappingByRow) {
      const row = rows[idx];
      if (!row) continue;
      if (debitCol !== null && debitCol !== undefined) {
        totalDr += readNumber(row[debitCol] ?? '');
      }
      if (creditCol !== null && creditCol !== undefined) {
        totalCr += readNumber(row[creditCol] ?? '');
      }
    }
    return { totalDr, totalCr, diff: totalDr - totalCr };
  }, [mappingByRow, rows, debitCol, creditCol]);

  const setMapping = (rowIdx: number, canonicalKey: string | '') => {
    const next: TbMappingEntry[] = mapping.filter((m) => !(m.sourceRowIndex === rowIdx && m.yearKey === 'current'));
    if (canonicalKey) {
      next.push({ sourceRowIndex: rowIdx, yearKey: 'current', canonicalKey });
    }
    onChange({ mapping: next });
  };

  /** Toggle the secured/unsecured flag on a long-term-borrowings
   *  mapping. Only meaningful when canonical key is bs_long_term_borrowings;
   *  the flag is ignored by Schedule III + ICAI exporters. */
  const toggleSecuredFlag = (rowIdx: number) => {
    const next = mapping.map((m) =>
      m.sourceRowIndex === rowIdx && m.yearKey === 'current'
        ? { ...m, isUnsecured: !m.isUnsecured }
        : m,
    );
    onChange({ mapping: next });
  };

  const mappingEntryByRow = useMemo(() => {
    const m = new Map<number, TbMappingEntry>();
    for (const e of mapping) {
      if (e.yearKey === 'current') m.set(e.sourceRowIndex, e);
    }
    return m;
  }, [mapping]);

  const acceptAllSuggestions = () => {
    const next: TbMappingEntry[] = [...mapping];
    const existing = new Set(mapping.filter((m) => m.yearKey === 'current').map((m) => m.sourceRowIndex));
    for (const [idx, key] of suggested) {
      if (existing.has(idx)) continue;
      next.push({ sourceRowIndex: idx, yearKey: 'current', canonicalKey: key });
    }
    onChange({ mapping: next });
  };

  const runAiSuggest = async () => {
    if (!draftId) {
      toast.error('Save the draft first.');
      return;
    }
    const existingIdx = new Set(mapping.filter((m) => m.yearKey === 'current').map((m) => m.sourceRowIndex));
    const unmappedRows = rows
      .map((r, idx) => ({ idx, label: (r[accountCol] ?? '').trim() }))
      .filter((r) => !existingIdx.has(r.idx) && r.label.length > 0);
    if (unmappedRows.length === 0) {
      toast('All rows are already mapped.', { icon: 'ℹ️' });
      return;
    }
    setAiLoading(true);
    try {
      const result = await aiSuggestTbBsMapping(
        draftId,
        unmappedRows.map((r) => ({ index: r.idx, label: r.label })),
        SCHEDULE_THREE_ACCOUNTS.map((a) => ({ key: a.key, label: a.label, group: a.group })),
      );
      const next: TbMappingEntry[] = [...mapping];
      let applied = 0;
      for (const s of result.suggestions) {
        if (!s.key) continue;
        if (existingIdx.has(s.index)) continue;
        next.push({ sourceRowIndex: s.index, yearKey: 'current', canonicalKey: s.key });
        applied++;
      }
      onChange({ mapping: next });
      toast.success(`AI mapped ${applied} of ${unmappedRows.length} unmapped rows.`, { duration: 4000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI mapping failed');
    } finally {
      setAiLoading(false);
    }
  };

  if (rows.length === 0) {
    return (
      <Card>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
          Upload a Trial Balance first.
        </p>
      </Card>
    );
  }

  const mappedCount = mappingByRow.size;
  const suggestedCount = suggested.size;
  const tieOutClean = Math.abs(balanceCheck.diff) < 1;

  return (
    <div className="space-y-4">
      <Card title={`Map ${rows.length} TB rows to Schedule III lines (${mappedCount} mapped${suggestedCount > 0 ? `, ${suggestedCount} suggested` : ''})`}
        action={
          <div className="flex items-center gap-2">
            {mappedCount < suggestedCount && (
              <button
                type="button"
                onClick={acceptAllSuggestions}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Accept all {suggestedCount} suggestions
              </button>
            )}
            <button
              type="button"
              onClick={() => void runAiSuggest()}
              disabled={aiLoading}
              className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Uses AI to classify unmapped rows. One Gemini call per use; counts against your token budget."
            >
              {aiLoading
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Sparkles className="w-3 h-3" />}
              AI-suggest
            </button>
          </div>
        }
      >
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Pick the Schedule III line for each TB account. Skip control accounts (Suspense / opening
          balance) that shouldn't appear in financials.
        </p>
        <div className="max-h-[440px] overflow-y-auto border border-gray-100 dark:border-gray-800 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/60 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-2/5">Account name</th>
                {debitCol !== null && debitCol !== undefined && <th className="px-3 py-2 text-right font-medium">Debit</th>}
                {creditCol !== null && creditCol !== undefined && <th className="px-3 py-2 text-right font-medium">Credit</th>}
                <th className="px-3 py-2 text-left font-medium">Schedule III line</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((row, idx) => {
                const label = row[accountCol] ?? '';
                const debit = debitCol !== null && debitCol !== undefined ? row[debitCol] ?? '' : '';
                const credit = creditCol !== null && creditCol !== undefined ? row[creditCol] ?? '' : '';
                const current = mappingByRow.get(idx);
                const suggestion = !current ? suggested.get(idx) : undefined;
                return (
                  <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                    <td className="px-3 py-1.5 text-gray-800 dark:text-gray-200 truncate max-w-xs" title={label}>{label}</td>
                    {debitCol !== null && debitCol !== undefined && <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{debit}</td>}
                    {creditCol !== null && creditCol !== undefined && <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{credit}</td>}
                    <td className="px-3 py-1.5">
                      <select
                        value={current ?? ''}
                        onChange={(e) => setMapping(idx, e.target.value)}
                        className={`text-xs rounded-md px-2 py-1 border bg-white dark:bg-gray-900 ${suggestion ? 'border-amber-300 dark:border-amber-700' : 'border-gray-200 dark:border-gray-700'}`}
                      >
                        <option value="">— Skip —</option>
                        {Object.entries(SCHEDULE_THREE_GROUP_LABELS).map(([group, gLabel]) => (
                          <optgroup key={group} label={gLabel}>
                            {SCHEDULE_THREE_ACCOUNTS.filter((a) => a.group === group).map((a) => (
                              <option key={a.key} value={a.key}>{a.label}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      {suggestion && <span className="ml-2 text-[10px] text-amber-700 dark:text-amber-400">(suggested)</span>}
                      {/* Secured / Unsecured toggle — only meaningful
                       *  for long-term borrowings, only consumed by the
                       *  Tally Sources/Application output. Schedule III
                       *  and ICAI exporters ignore the flag (they show
                       *  one combined "Long-term borrowings" line). */}
                      {current === 'bs_long_term_borrowings' && (() => {
                        const entry = mappingEntryByRow.get(idx);
                        const isUnsecured = !!entry?.isUnsecured;
                        return (
                          <button
                            type="button"
                            onClick={() => toggleSecuredFlag(idx)}
                            className={`ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                              isUnsecured
                                ? 'border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800'
                                : 'border-gray-300 bg-gray-50 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300 dark:border-gray-700'
                            }`}
                            title="Tally output splits this into Secured vs Unsecured Loans. Schedule III + ICAI ignore the flag."
                          >
                            {isUnsecured ? 'Unsecured' : 'Secured'}
                          </button>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {mappedCount > 0 && (debitCol !== null && creditCol !== null) && (
        <Card title="Tie-out check">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-medium">Mapped debits</p>
              <p className="text-base font-semibold tabular-nums text-gray-800 dark:text-gray-200 mt-0.5">
                ₹{balanceCheck.totalDr.toLocaleString('en-IN')}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-medium">Mapped credits</p>
              <p className="text-base font-semibold tabular-nums text-gray-800 dark:text-gray-200 mt-0.5">
                ₹{balanceCheck.totalCr.toLocaleString('en-IN')}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-medium">Difference</p>
              <p className={`text-base font-semibold tabular-nums mt-0.5 ${tieOutClean ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                {tieOutClean ? '✓ Balanced' : `₹${Math.abs(balanceCheck.diff).toLocaleString('en-IN')}`}
              </p>
            </div>
          </div>
          {!tieOutClean && (
            <p className="text-xs text-rose-600 dark:text-rose-400 mt-2">
              Trial balance doesn't tie — check for un-mapped rows or a mis-picked debit/credit column.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
