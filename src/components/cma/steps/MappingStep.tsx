/**
 * Mapping step — the user assigns each row of their uploaded sheet
 * to a canonical CMA account. Auto-suggest fires on rows whose name
 * fuzzy-matches a known hint (so a row called "Sundry Debtors"
 * pre-selects bs_receivables); the user reviews and corrects.
 *
 * Why this UX vs a fully-automated mapper: false-positive cost is
 * high. A misclassified row pollutes both the BS and the projections.
 * Auto-suggest as a starting point + explicit confirmation by the
 * user is the safest pattern.
 *
 * The user also picks WHICH columns are the two historical years'
 * value columns. We don't auto-detect because BS sheets often have
 * "Particulars / Schedule / Year 1 / Year 2" or "Account / Year 1 /
 * Year 2 / Notes" — the column index varies.
 */
import { useMemo } from 'react';
import { Card } from '../../itr/shared/Inputs';
import type { CmaDraft, MappingEntry } from '../lib/uiModel';
import { CANONICAL_ACCOUNTS, GROUP_LABELS, suggestCanonicalKey, type CanonicalSection } from '../lib/canonicalAccounts';

interface Props {
  draft: CmaDraft;
  onChange: (patch: Partial<CmaDraft>) => void;
}

export function MappingStep({ draft, onChange }: Props) {
  const rows = draft.historical?.rows ?? [];
  const mapping = draft.mapping ?? [];
  const mappingByRow = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of mapping) m.set(e.sourceRowIndex, e.canonicalKey);
    return m;
  }, [mapping]);

  // Build a "best-guess" mapping for rows that the user hasn't
  // touched yet. This is computed locally — we don't persist
  // auto-suggested mappings until the user explicitly confirms.
  const suggested = useMemo(() => {
    const out = new Map<number, CanonicalSection>();
    for (let i = 0; i < rows.length; i++) {
      // The first column is almost always the row label.
      const label = (rows[i][0] ?? '').trim();
      if (!label) continue;
      const s = suggestCanonicalKey(label);
      if (s) out.set(i, s);
    }
    return out;
  }, [rows]);

  const totalCols = useMemo(() => {
    return rows.reduce((max, r) => Math.max(max, r.length), 0);
  }, [rows]);

  // Year-column picker. Default to the last two non-empty columns
  // (typical BS / P&L layout). User can override.
  const defaultYearColumns: [number, number] = useMemo(() => {
    if (totalCols < 3) return [Math.max(1, totalCols - 2), Math.max(2, totalCols - 1)];
    return [totalCols - 2, totalCols - 1];
  }, [totalCols]);
  // Year column selections are persisted on the historical block;
  // for now we derive defaults if not set.
  const yearColA = draft.historical?.yearColumnA ?? defaultYearColumns[0];
  const yearColB = draft.historical?.yearColumnB ?? defaultYearColumns[1];

  const setYearColumn = (which: 'A' | 'B', col: number) => {
    onChange({
      historical: {
        ...(draft.historical ?? {}),
        [which === 'A' ? 'yearColumnA' : 'yearColumnB']: col,
      },
    });
  };

  const setMapping = (rowIdx: number, canonicalKey: string | '') => {
    const next: MappingEntry[] = mapping.filter((m) => m.sourceRowIndex !== rowIdx);
    if (canonicalKey) {
      next.push({ sourceRowIndex: rowIdx, canonicalKey });
    }
    onChange({ mapping: next });
  };

  const acceptAllSuggestions = () => {
    const next: MappingEntry[] = [...mapping];
    const existing = new Set(mapping.map((m) => m.sourceRowIndex));
    for (const [idx, key] of suggested) {
      if (existing.has(idx)) continue;
      next.push({ sourceRowIndex: idx, canonicalKey: key });
    }
    onChange({ mapping: next });
  };

  if (rows.length === 0) {
    return (
      <Card>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
          Upload a file in the previous step first.
        </p>
      </Card>
    );
  }

  const mappedCount = mapping.length;
  const suggestedCount = suggested.size;

  return (
    <div className="space-y-4">
      <Card title="Pick the year-value columns">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Which columns of your uploaded sheet hold the two historical years' numbers?
          Defaulted to the last two columns.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="block text-[11px] uppercase text-gray-500 dark:text-gray-400 tracking-wider mb-1">
              {draft.historical?.yearLabels?.[0] || 'Earlier year'} column
            </span>
            <select
              value={yearColA}
              onChange={(e) => setYearColumn('A', parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700"
            >
              {Array.from({ length: totalCols }, (_, i) => (
                <option key={i} value={i}>Col {i + 1} ({rows[0]?.[i] || '—'})</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="block text-[11px] uppercase text-gray-500 dark:text-gray-400 tracking-wider mb-1">
              {draft.historical?.yearLabels?.[1] || 'Latest year'} column
            </span>
            <select
              value={yearColB}
              onChange={(e) => setYearColumn('B', parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700"
            >
              {Array.from({ length: totalCols }, (_, i) => (
                <option key={i} value={i}>Col {i + 1} ({rows[0]?.[i] || '—'})</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <Card
        title={`Map your rows (${mappedCount} of ${rows.length} mapped${suggestedCount > 0 ? `, ${suggestedCount} suggestions available` : ''})`}
        action={suggestedCount > 0 && mappedCount < suggestedCount ? (
          <button
            type="button"
            onClick={acceptAllSuggestions}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Accept all {suggestedCount} suggestions
          </button>
        ) : undefined}
      >
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Pick the canonical CMA account each row maps to, or mark "Skip" for sub-totals / blank rows.
          Multiple rows mapping to the same account are summed.
        </p>
        <div className="max-h-[420px] overflow-y-auto border border-gray-100 dark:border-gray-800 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/60 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-2/5">Row label</th>
                <th className="px-3 py-2 text-right font-medium">{draft.historical?.yearLabels?.[0] || 'Y1'}</th>
                <th className="px-3 py-2 text-right font-medium">{draft.historical?.yearLabels?.[1] || 'Y2'}</th>
                <th className="px-3 py-2 text-left font-medium">Canonical account</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((row, idx) => {
                const label = row[0] ?? '';
                const valA = row[yearColA] ?? '';
                const valB = row[yearColB] ?? '';
                const current = mappingByRow.get(idx);
                const suggestion = !current ? suggested.get(idx) : undefined;
                return (
                  <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                    <td className="px-3 py-1.5 text-gray-800 dark:text-gray-200 truncate max-w-xs" title={label}>{label}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{valA}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{valB}</td>
                    <td className="px-3 py-1.5">
                      <select
                        value={current ?? ''}
                        onChange={(e) => setMapping(idx, e.target.value)}
                        className={`text-xs rounded-md px-2 py-1 border bg-white dark:bg-gray-900 ${suggestion ? 'border-amber-300 dark:border-amber-700' : 'border-gray-200 dark:border-gray-700'}`}
                      >
                        <option value="">— Skip —</option>
                        {Object.entries(GROUP_LABELS).map(([group, gLabel]) => (
                          <optgroup key={group} label={gLabel}>
                            {CANONICAL_ACCOUNTS.filter((a) => a.group === group).map((a) => (
                              <option key={a.key} value={a.key}>{a.label}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      {suggestion && (
                        <span className="ml-2 text-[10px] text-amber-700 dark:text-amber-400">
                          (suggested)
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
