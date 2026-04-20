import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { BankTransaction } from '../../services/api';
import { formatINRCompact } from '../../lib/utils';

interface Props {
  transactions: BankTransaction[];
}

interface Row {
  counterparty: string;
  inflow: number;
  outflow: number;
  count: number;
}

const MAX_ROWS = 10;

export function CounterpartySummary({ transactions }: Props) {
  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, Row>();
    for (const t of transactions) {
      const key = (t.counterparty ?? '').trim();
      if (!key) continue;
      const row = map.get(key) ?? { counterparty: key, inflow: 0, outflow: 0, count: 0 };
      if (t.amount >= 0) row.inflow += t.amount;
      else row.outflow += Math.abs(t.amount);
      row.count += 1;
      map.set(key, row);
    }
    return Array.from(map.values())
      .sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow))
      .slice(0, MAX_ROWS);
  }, [transactions]);

  if (!rows.length) return null;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-4 h-4 text-indigo-500" />
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Top counterparties</h3>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {rows.map((row) => (
          <li key={row.counterparty} className="py-2 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate" title={row.counterparty}>
                {row.counterparty}
              </p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">{row.count} txn{row.count === 1 ? '' : 's'}</p>
            </div>
            <div className="flex items-center gap-3 text-xs whitespace-nowrap">
              {row.inflow > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{formatINRCompact(row.inflow)}</span>}
              {row.outflow > 0 && <span className="text-rose-600 dark:text-rose-400">−{formatINRCompact(row.outflow)}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
