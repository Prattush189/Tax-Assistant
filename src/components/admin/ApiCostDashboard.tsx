import { useCallback, useEffect, useState } from 'react';
import { Activity, DollarSign, Users, Zap, TrendingUp, Clock } from 'lucide-react';
import { cn, formatDate } from '../../lib/utils';
import { fetchApiCosts, ApiCostData } from '../../services/api';

const PERIODS = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: '7 Days' },
  { value: 'month', label: 'This Month' },
];

function fmtInr(n: number): string {
  return 'Rs. ' + Math.round(n * 100) / 100;
}

function fmtUsd(n: number): string {
  return '$' + (Math.round(n * 10000) / 10000).toFixed(4);
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export function ApiCostDashboard() {
  const [data, setData] = useState<ApiCostData | null>(null);
  const [period, setPeriod] = useState('month');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApiCosts(period);
      setData(res);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return <p className="text-sm text-gray-400 text-center py-8">Loading API cost data...</p>;
  }
  if (!data) return null;

  const s = data.summary;
  const plans = Object.entries(data.costByPlan);

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-emerald-500" />
          API Cost Analytics
        </h2>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                period === p.value
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={Activity} label="Total Requests" value={String(s.totalRequests)} />
        <SummaryCard icon={DollarSign} label="Total Cost" value={fmtInr(s.totalCostInr)} sub={fmtUsd(s.totalCostUsd)} />
        <SummaryCard icon={Zap} label="Avg Cost / Message" value={fmtInr(s.avgCostPerMsgInr)} sub={fmtUsd(s.avgCostPerMsgUsd)} />
        <SummaryCard icon={Users} label="Active Users" value={String(s.uniqueUsers)} />
      </div>

      {/* Token summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Input Tokens</p>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-1">{fmtTokens(s.totalInputTokens)}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Output Tokens</p>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-1">{fmtTokens(s.totalOutputTokens)}</p>
        </div>
      </div>

      {/* Cost by Plan */}
      {plans.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Cost by Plan</h3>
          <div className="grid grid-cols-3 gap-3">
            {plans.map(([plan, d]) => (
              <div key={plan} className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <p className="text-[10px] font-semibold text-gray-400 uppercase">{plan}</p>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{fmtInr(d.cost * 85)}</p>
                <p className="text-[10px] text-gray-400">{d.users} users · {d.requests} reqs</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily trend */}
      {data.daily.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            Daily Cost Trend
          </h3>
          <div className="space-y-1">
            {data.daily.map(d => {
              const maxCost = Math.max(...data.daily.map(x => x.total_cost_inr), 1);
              const pct = (d.total_cost_inr / maxCost) * 100;
              return (
                <div key={d.date} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-gray-400 shrink-0">{d.date.slice(5)}</span>
                  <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${Math.max(1, pct)}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-gray-600 dark:text-gray-300 font-medium shrink-0">
                    {fmtInr(d.total_cost_inr)}
                  </span>
                  <span className="w-10 text-right text-gray-400 shrink-0">{d.requests}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-user breakdown */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Cost by User</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                <th className="text-left px-3 py-2 text-gray-500">User</th>
                <th className="text-left px-3 py-2 text-gray-500">Plan</th>
                <th className="text-right px-3 py-2 text-gray-500">Requests</th>
                <th className="text-right px-3 py-2 text-gray-500">Input Tokens</th>
                <th className="text-right px-3 py-2 text-gray-500">Output Tokens</th>
                <th className="text-right px-3 py-2 text-gray-500">Total Cost</th>
                <th className="text-right px-3 py-2 text-gray-500">Avg/Msg</th>
                <th className="text-right px-3 py-2 text-gray-500">Last Used</th>
              </tr>
            </thead>
            <tbody>
              {data.byUser.map(u => (
                <tr key={u.user_id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900 dark:text-gray-100">{u.user_name}</p>
                    <p className="text-[10px] text-gray-400">{u.user_email}</p>
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold',
                      u.user_plan === 'enterprise' ? 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400' :
                      u.user_plan === 'pro' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' :
                      'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    )}>{u.user_plan}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{u.requests}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{fmtTokens(u.total_input_tokens)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{fmtTokens(u.total_output_tokens)}</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-gray-100">{fmtInr(u.total_cost_inr)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{fmtInr(u.avg_cost_per_msg_inr)}</td>
                  <td className="px-3 py-2 text-right text-gray-400">{formatDate(u.last_used)}</td>
                </tr>
              ))}
              {data.byUser.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">No usage data for this period</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent requests */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" />
            Recent API Calls (last 100)
          </h3>
        </div>
        <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800/50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 text-gray-500">User</th>
                <th className="text-right px-3 py-2 text-gray-500">In</th>
                <th className="text-right px-3 py-2 text-gray-500">Out</th>
                <th className="text-right px-3 py-2 text-gray-500">Cost</th>
                <th className="text-right px-3 py-2 text-gray-500">Time</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map(r => (
                <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{r.user_name}</td>
                  <td className="px-3 py-1.5 text-right text-gray-500">{fmtTokens(r.input_tokens)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-500">{fmtTokens(r.output_tokens)}</td>
                  <td className="px-3 py-1.5 text-right font-medium text-gray-900 dark:text-gray-100">{fmtInr(r.cost_inr)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-400">{r.created_at.slice(11, 19)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, sub }: { icon: typeof Activity; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-emerald-500" />
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
