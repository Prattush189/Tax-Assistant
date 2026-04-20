import { useMemo } from 'react';
import { BankTransaction } from '../../services/api';
import { formatINRCompact } from '../../lib/utils';
import { BANK_STATEMENT_CATEGORIES, BankStatementCategory, CATEGORY_META } from './lib/categories';

interface Props {
  transactions: BankTransaction[];
}

interface Row {
  category: BankStatementCategory;
  inflow: number;
  outflow: number;
  count: number;
}

export function CategoryBreakdown({ transactions }: Props) {
  const rows: Row[] = useMemo(() => {
    const map = new Map<BankStatementCategory, Row>();
    for (const t of transactions) {
      const cat = (BANK_STATEMENT_CATEGORIES as readonly string[]).includes(t.category)
        ? (t.category as BankStatementCategory)
        : 'Other';
      const row = map.get(cat) ?? { category: cat, inflow: 0, outflow: 0, count: 0 };
      if (t.amount >= 0) row.inflow += t.amount;
      else row.outflow += Math.abs(t.amount);
      row.count += 1;
      map.set(cat, row);
    }
    return Array.from(map.values()).sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow));
  }, [transactions]);

  const maxTotal = Math.max(1, ...rows.map(r => r.inflow + r.outflow));

  if (!rows.length) return null;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">By Category</h3>
      <div className="space-y-3">
        {rows.map((row) => {
          const meta = CATEGORY_META[row.category];
          const Icon = meta.icon;
          const total = row.inflow + row.outflow;
          const widthPct = Math.round((total / maxTotal) * 100);
          return (
            <div key={row.category} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${meta.bg}`}>
                    <Icon className={`w-4 h-4 ${meta.color}`} />
                  </div>
                  <span className={`text-sm font-medium truncate ${meta.color}`}>{row.category}</span>
                  <span className="text-xs text-gray-400">· {row.count}</span>
                </div>
                <div className="flex items-center gap-3 text-xs whitespace-nowrap">
                  {row.inflow > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{formatINRCompact(row.inflow)}</span>}
                  {row.outflow > 0 && <span className="text-rose-600 dark:text-rose-400">−{formatINRCompact(row.outflow)}</span>}
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div className={`h-full ${meta.bg}`} style={{ width: `${widthPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
