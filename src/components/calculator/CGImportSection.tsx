import { useRef, useState } from 'react';
import { Upload, FileText, TrendingUp, TrendingDown } from 'lucide-react';
import { parseCapitalGainsCSV, CGSummary } from '../../lib/capitalGainsImport';
import { cn } from '../../lib/utils';

function fmt(n: number): string {
  return '₹ ' + Math.round(Math.abs(n)).toLocaleString('en-IN');
}

export function CGImportSection() {
  const [summary, setSummary] = useState<CGSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSummary(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const result = parseCapitalGainsCSV(text);
        if (result.totalTrades === 0) {
          setError('No trades found. Please check the CSV format (needs columns like Symbol, Buy Date, Sell Date, Buy Price, Sell Price, Quantity).');
          return;
        }
        setSummary(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse CSV');
      }
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      <label className={cn(
        'flex flex-col items-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors',
        'border-gray-200 dark:border-gray-700 hover:border-emerald-400 dark:hover:border-emerald-600',
        'bg-gray-50 dark:bg-gray-900/40 hover:bg-emerald-50/30 dark:hover:bg-emerald-900/10',
      )}>
        <Upload className="w-6 h-6 text-gray-400" />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Upload a <span className="font-medium text-gray-700 dark:text-gray-300">CSV</span> from your broker (Zerodha, Groww, Angel One)
        </p>
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
      </label>

      {error && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {summary && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Total Trades" value={String(summary.totalTrades)} />
            <SummaryCard label="STCG" value={fmt(summary.totalSTCG)} positive={summary.totalSTCG >= 0} />
            <SummaryCard label="LTCG" value={fmt(summary.totalLTCG)} positive={summary.totalLTCG >= 0} />
            <SummaryCard label="LTCG Exemption" value={fmt(summary.ltcgExemption)} />
          </div>

          {/* Tax summary */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-2">
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Estimated Tax</p>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">STCG Tax (20% + cess)</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{fmt(summary.stcgTax)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">LTCG Tax (12.5% + cess, after ₹1.25L exemption)</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{fmt(summary.ltcgTax)}</span>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t border-gray-200 dark:border-gray-800">
              <span className="font-bold text-gray-800 dark:text-gray-100">Total CG Tax</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{fmt(summary.stcgTax + summary.ltcgTax)}</span>
            </div>
          </div>

          {/* Trade list */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Trade Details</p>
            </div>
            <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800/50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 text-gray-500">Symbol</th>
                    <th className="text-left px-3 py-2 text-gray-500">Buy Date</th>
                    <th className="text-left px-3 py-2 text-gray-500">Sell Date</th>
                    <th className="text-right px-3 py-2 text-gray-500">Days</th>
                    <th className="text-right px-3 py-2 text-gray-500">P&L</th>
                    <th className="text-center px-3 py-2 text-gray-500">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.trades.slice(0, 100).map((t, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-3 py-1.5 font-medium text-gray-900 dark:text-gray-100">{t.symbol}</td>
                      <td className="px-3 py-1.5 text-gray-500">{t.buyDate}</td>
                      <td className="px-3 py-1.5 text-gray-500">{t.sellDate}</td>
                      <td className="px-3 py-1.5 text-right text-gray-500">{t.holdingDays}</td>
                      <td className={cn('px-3 py-1.5 text-right font-medium', t.pnl >= 0 ? 'text-emerald-600' : 'text-red-500')}>
                        {t.pnl >= 0 ? '+' : '-'}{fmt(t.pnl)}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold',
                          t.type === 'LTCG' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                        )}>{t.type}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {summary.trades.length > 100 && (
                <p className="text-[11px] text-gray-400 text-center py-2">Showing first 100 of {summary.trades.length} trades</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={cn('text-sm font-bold mt-1', positive === false ? 'text-red-500' : positive === true ? 'text-emerald-600' : 'text-gray-900 dark:text-gray-100')}>
        {value}
      </p>
    </div>
  );
}
