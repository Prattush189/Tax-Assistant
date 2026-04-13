import { useCallback, useEffect, useState } from 'react';
import { Cpu, Zap, TrendingUp, Shield } from 'lucide-react';
import { cn } from '../../lib/utils';
import { fetchApiCosts, ApiCostData } from '../../services/api';

const PERIODS = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: '7 Days' },
  { value: 'month', label: 'This Month' },
];

function fmtInr(n: number): string {
  return 'Rs. ' + (Math.round(n * 100) / 100);
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

const MODEL_COLORS: Record<string, string> = {
  'gemini-3.1-flash-lite-preview': 'bg-purple-500',
  'gemini-2.5-flash-lite': 'bg-blue-500',
  'grok-4-1-fast-reasoning': 'bg-amber-500',
  'unknown': 'bg-gray-400',
};

const MODEL_LABELS: Record<string, string> = {
  'gemini-3.1-flash-lite-preview': 'Gemini 3.1 Flash-Lite (Tier 1)',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite (Tier 2)',
  'grok-4-1-fast-reasoning': 'Grok 4.1 Fast (Tier 3)',
};

interface ModelEntry {
  model: string;
  requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  total_cost_inr: number;
  avg_cost: number;
  avg_cost_inr: number;
}

export function ModelUsageDashboard() {
  const [data, setData] = useState<ApiCostData | null>(null);
  const [period, setPeriod] = useState('month');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchApiCosts(period));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <p className="text-sm text-gray-400 text-center py-8">Loading model data...</p>;
  if (!data) return null;

  const models: ModelEntry[] = (data as any).byModel ?? [];
  const quota = (data as any).searchQuota ?? { tier1: { used: 0, limit: 4800 }, tier2: { used: 0, limit: 480 } };
  const totalRequests = models.reduce((a, m) => a + m.requests, 0) || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Cpu className="w-5 h-5 text-purple-500" />
          Model Usage &amp; Cascade
        </h2>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              className={cn('px-3 py-1 text-xs font-medium rounded-md transition-colors',
                period === p.value ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* Cascade architecture diagram */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">3-Tier Cascade Architecture</h3>
        <div className="flex flex-col md:flex-row gap-3">
          {[
            { tier: 'Tier 1 (Primary)', model: 'Gemini 3.1 Flash-Lite', search: '5,000 free/month', tokens: '$0.25/$1.50 per M', color: 'border-purple-400 bg-purple-50 dark:bg-purple-900/10', badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
            { tier: 'Tier 2 (Overflow)', model: 'Gemini 2.5 Flash-Lite', search: '500 free/day', tokens: '$0.10/$0.40 per M', color: 'border-blue-400 bg-blue-50 dark:bg-blue-900/10', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
            { tier: 'Tier 3 (Fallback)', model: 'Grok 4.1 Fast', search: '$5/1K calls (paid)', tokens: '$0.20/$0.50 per M', color: 'border-amber-400 bg-amber-50 dark:bg-amber-900/10', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
          ].map((t, i) => (
            <div key={i} className={cn('flex-1 rounded-xl border-2 p-4', t.color)}>
              <span className={cn('text-[10px] font-bold uppercase px-2 py-0.5 rounded-full', t.badge)}>{t.tier}</span>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-2">{t.model}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">Search: {t.search}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">Tokens: {t.tokens}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-2 mt-3 text-xs text-gray-400">
          <span>Request</span> <span>→</span> <span className="text-purple-500 font-medium">Tier 1</span>
          <span>→ if exhausted →</span> <span className="text-blue-500 font-medium">Tier 2</span>
          <span>→ if exhausted →</span> <span className="text-amber-500 font-medium">Tier 3</span>
        </div>
      </div>

      {/* Search quota status — per API key */}
      <div className="space-y-3">
        {(quota.keys ?? [{ label: 'Key 1', tier1: quota.tier1, tier2: quota.tier2 }]).map((key: any, ki: number) => (
          <div key={ki} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className={cn('w-2 h-2 rounded-full', key.active !== false ? 'bg-emerald-500' : 'bg-gray-400')} />
              <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300">{key.label ?? `API Key ${ki + 1}`}</h4>
              {key.active !== false && <span className="text-[9px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded">ACTIVE</span>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <QuotaCard
                label={key.tier1?.model ?? 'Gemini 3.1 Flash-Lite'}
                tier="Tier 1"
                used={key.tier1?.used ?? 0}
                limit={key.tier1?.limit ?? 4800}
                period={key.tier1?.period ?? 'monthly'}
                color="purple"
              />
              <QuotaCard
                label={key.tier2?.model ?? 'Gemini 2.5 Flash-Lite'}
                tier="Tier 2"
                used={key.tier2?.used ?? 0}
                limit={key.tier2?.limit ?? 480}
                period={key.tier2?.period ?? 'daily'}
                color="blue"
              />
            </div>
          </div>
        ))}
        {quota.totalFreeSearchCapacity && (
          <p className="text-[10px] text-gray-400 px-2">{quota.totalFreeSearchCapacity.description}</p>
        )}
      </div>

      {/* Per-model breakdown */}
      {models.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Usage by Model</h3>
          </div>

          {/* Visual bar breakdown */}
          <div className="px-4 py-3">
            <div className="flex h-6 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800">
              {models.map(m => {
                const pct = (m.requests / totalRequests) * 100;
                if (pct < 0.5) return null;
                const colorClass = MODEL_COLORS[m.model] ?? 'bg-gray-400';
                return (
                  <div key={m.model} className={cn('h-full transition-all', colorClass)} style={{ width: `${pct}%` }}
                    title={`${MODEL_LABELS[m.model] ?? m.model}: ${m.requests} requests (${pct.toFixed(1)}%)`} />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-3 mt-2">
              {models.map(m => (
                <div key={m.model} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                  <div className={cn('w-2.5 h-2.5 rounded-full', MODEL_COLORS[m.model] ?? 'bg-gray-400')} />
                  <span>{MODEL_LABELS[m.model] ?? m.model}</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{m.requests}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="text-left px-4 py-2 text-gray-500">Model</th>
                  <th className="text-right px-4 py-2 text-gray-500">Requests</th>
                  <th className="text-right px-4 py-2 text-gray-500">% Share</th>
                  <th className="text-right px-4 py-2 text-gray-500">Input Tokens</th>
                  <th className="text-right px-4 py-2 text-gray-500">Output Tokens</th>
                  <th className="text-right px-4 py-2 text-gray-500">Total Cost</th>
                  <th className="text-right px-4 py-2 text-gray-500">Avg/Msg</th>
                </tr>
              </thead>
              <tbody>
                {models.map(m => (
                  <tr key={m.model} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', MODEL_COLORS[m.model] ?? 'bg-gray-400')} />
                        <span className="font-medium text-gray-900 dark:text-gray-100">{MODEL_LABELS[m.model] ?? m.model}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300 font-medium">{m.requests.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{((m.requests / totalRequests) * 100).toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right text-gray-500">{fmtTokens(m.total_input_tokens)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{fmtTokens(m.total_output_tokens)}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-100">{fmtInr(m.total_cost_inr)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{fmtInr(m.avg_cost_inr)}</td>
                  </tr>
                ))}
                {models.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No model usage data for this period</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function QuotaCard({ label, tier, used, limit, period, color }: {
  label: string; tier: string; used: number; limit: number; period: string; color: 'purple' | 'blue';
}) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const isHigh = pct > 80;
  const barColor = color === 'purple' ? 'bg-purple-500' : 'bg-blue-500';
  const bgColor = color === 'purple' ? 'bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-800' : 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800';

  return (
    <div className={cn('rounded-xl border p-4', bgColor)}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-[10px] font-bold uppercase text-gray-400">{tier}</span>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{used} <span className="text-xs font-normal text-gray-400">/ {limit}</span></p>
          <p className="text-[10px] text-gray-400">resets {period}</p>
        </div>
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', isHigh ? 'bg-red-500' : barColor)} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-gray-400 mt-1">{limit - used} remaining · {pct.toFixed(1)}% used</p>
    </div>
  );
}
