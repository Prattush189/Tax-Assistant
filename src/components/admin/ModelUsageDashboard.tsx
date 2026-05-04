import { useCallback, useEffect, useState } from 'react';
import { Cpu, Zap, Shield, Key, Save, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import {
  fetchApiCosts, ApiCostData,
  adminFetchGeminiConfig, adminSetGeminiLimits, adminSetActiveKey, GeminiConfig,
} from '../../services/api';

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

// Bar colours and human labels for the per-model breakdown table.
// Active models live alongside "(retired)" entries so historic
// api_usage rows logged before the trim still render with a sensible
// label instead of the raw string. Add new active models above the
// retired block so they get a distinct colour.
const MODEL_COLORS: Record<string, string> = {
  'gemini-2.5-flash-lite':         'bg-blue-500',     // T2 — active primary
  'gemini-3.1-flash-lite-preview': 'bg-violet-400',   // T1 — active fallback
  // Retired — kept only so historic rows are still recognisable.
  'gemini-3-flash-preview':        'bg-gray-400',
  'gemini-2.5-flash':              'bg-gray-400',
  'claude-haiku-4-5':              'bg-gray-400',
  'unknown':                       'bg-gray-400',
};

const MODEL_LABELS: Record<string, string> = {
  'gemini-2.5-flash-lite':         'Gemini 2.5 Flash-Lite (primary, all features)',
  'gemini-3.1-flash-lite-preview': 'Gemini 3.1 Flash-Lite (fallback, all features)',
  // Retired models still appear in historic rows.
  'gemini-3-flash-preview':        'Gemini 3 Flash Preview (retired)',
  'gemini-2.5-flash':              'Gemini 2.5 Flash (retired)',
  'claude-haiku-4-5':              'Claude Haiku 4.5 (retired)',
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
  const [config, setConfig] = useState<GeminiConfig | null>(null);
  const [period, setPeriod] = useState('month');
  const [loading, setLoading] = useState(true);
  const [t1Input, setT1Input] = useState<string>('');
  const [t2Input, setT2Input] = useState<string>('');
  const [savingLimits, setSavingLimits] = useState(false);
  const [switchingKey, setSwitchingKey] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [costs, cfg] = await Promise.all([
        fetchApiCosts(period),
        adminFetchGeminiConfig(),
      ]);
      setData(costs);
      setConfig(cfg);
      setT1Input(String(cfg.t1Limit));
      setT2Input(String(cfg.t2Limit));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const saveLimits = async () => {
    if (!config) return;
    const t1 = parseInt(t1Input, 10);
    const t2 = parseInt(t2Input, 10);
    if (!Number.isFinite(t1) || !Number.isFinite(t2) || t1 < 0 || t2 < 0) {
      toast.error('Limits must be non-negative numbers');
      return;
    }
    setSavingLimits(true);
    try {
      const next = await adminSetGeminiLimits({ t1Limit: t1, t2Limit: t2 });
      setConfig(next);
      setT1Input(String(next.t1Limit));
      setT2Input(String(next.t2Limit));
      if (next.t1Limit !== t1 || next.t2Limit !== t2) {
        toast.success(`Limits clamped to free tier (${next.t1Limit} / ${next.t2Limit})`);
      } else {
        toast.success('AI search limits updated');
      }
    } catch {
      toast.error('Failed to update limits');
    } finally {
      setSavingLimits(false);
    }
  };

  const resetLimits = async () => {
    if (!config) return;
    setSavingLimits(true);
    try {
      const next = await adminSetGeminiLimits({ t1Limit: config.defaults.t1, t2Limit: config.defaults.t2 });
      setConfig(next);
      setT1Input(String(next.t1Limit));
      setT2Input(String(next.t2Limit));
      toast.success('Limits reset to free-tier defaults');
    } catch {
      toast.error('Failed to reset limits');
    } finally {
      setSavingLimits(false);
    }
  };

  const switchKey = async (idx: number) => {
    if (!config || idx === config.activeKeyIndex) return;
    setSwitchingKey(true);
    try {
      const next = await adminSetActiveKey(idx);
      setConfig(next);
      toast.success(`Switched to ${next.keys[next.activeKeyIndex]?.label ?? `Key ${idx + 1}`}`);
      // reload usage data so quota cards reflect the new active marker
      load();
    } catch {
      toast.error('Failed to switch key');
    } finally {
      setSwitchingKey(false);
    }
  };

  if (loading && !data) return <p className="text-sm text-gray-400 text-center py-8">Loading model data...</p>;
  if (!data) return null;

  const models: ModelEntry[] = (data as any).byModel ?? [];
  const quota = (data as any).searchQuota ?? { tier1: { used: 0, limit: 5000 }, tier2: { used: 0, limit: 1500 } };
  const rateLimits: Array<{ def: { provider: string; dimension: string; label: string; limit: number; period: string }; count: number; remaining: number; resetInSeconds: number }> = (data as any).rateLimits ?? [];
  const breakers: Array<{ upstream: string; state: 'closed' | 'open' | 'half_open'; failures: number; openedAgoMs: number }> = (data as any).circuitBreakers ?? [];
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

      {/* Active model cascade. Same two-tier line-up across every AI
          feature now — chat, notices, suggestions, bank-statement
          analysis, ledger scrutiny, document upload, Form 16 import. */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Model Cascade</h3>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-4">
          Two-tier cascade used by every AI feature: chat, notices, suggestions, bank-statement analysis, ledger scrutiny, document upload, Form 16 import. The previous "think-tier" cascade (gemini-2.5-flash, gemini-3-flash-preview) is retired — those models charged 5–7× per token with no proportional reliability gain on the structured-output workloads we run.
        </p>
        <div className="rounded-xl border-2 border-blue-400 bg-blue-50 dark:bg-blue-900/10 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-bold uppercase text-blue-700 dark:text-blue-400">All AI features</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-blue-500 bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">PRIMARY (T2)</span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Gemini 2.5 Flash-Lite</span>
              <span className="text-[10px] text-gray-500 dark:text-gray-400">$0.10 in / $0.40 out per 1M</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-violet-500 bg-violet-100 dark:bg-violet-900/30 px-1.5 py-0.5 rounded">FALLBACK (T1)</span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Gemini 3.1 Flash-Lite Preview</span>
              <span className="text-[10px] text-gray-500 dark:text-gray-400">$0.25 in / $1.50 out per 1M</span>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">Thinking disabled on both. Search grounding for chat: 2.5 family 1,500/day, 3.x family 5,000/month — limits below.</p>
          </div>
        </div>
      </div>

      {/* Rate limiters (Anthropic RPM etc.) */}
      {rateLimits.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-500" /> Provider Rate Limits
          </h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">Per-upstream buckets. tryAcquire() gates new requests so burst traffic fails fast locally instead of producing upstream 429s.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rateLimits.map((b, i) => {
              const pct = Math.min(100, (b.count / Math.max(1, b.def.limit)) * 100);
              const tint = pct >= 90 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-500' : 'bg-emerald-500';
              return (
                <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">{b.def.provider} · {b.def.dimension}</span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">{b.def.label} · per {b.def.period}</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all', tint)} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-[10px] text-gray-500 dark:text-gray-400">
                    <span>{b.count} / {b.def.limit}</span>
                    <span>resets in {b.resetInSeconds}s</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Circuit breakers */}
      {breakers.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-500" /> Circuit Breakers
          </h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">5 consecutive failures opens the breaker for 60s; the next request is then a probe (HALF_OPEN). A success closes it; a failure reopens.</p>
          <div className="flex flex-wrap gap-2">
            {breakers.map((b) => {
              const color =
                b.state === 'closed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                : b.state === 'half_open' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
              return (
                <div key={b.upstream} className={cn('rounded-full px-3 py-1 text-xs font-medium flex items-center gap-2', color)}>
                  <span className="font-semibold">{b.upstream}</span>
                  <span className="uppercase text-[10px]">{b.state.replace('_', ' ')}</span>
                  <span className="text-[10px] opacity-75">· {b.failures} fails</span>
                  {b.state === 'open' && <span className="text-[10px] opacity-75">· open {Math.round(b.openedAgoMs / 1000)}s</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Free-tier limit overrides (admin can LOWER only) */}
      {config && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-500" />
                Free-Tier Limit Overrides
              </h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                Lower the AI search-grounding limits below the free-tier maximum. Values above the default are clamped — admin cannot raise limits above free tier.
              </p>
            </div>
            <button
              onClick={resetLimits}
              disabled={savingLimits}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              title="Reset to free-tier defaults"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/10 p-3">
              <label className="block">
                <span className="text-[10px] font-bold uppercase text-purple-600 dark:text-purple-400">3.x Pool — Monthly</span>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min={0}
                    max={config.defaults.t1}
                    value={t1Input}
                    onChange={e => setT1Input(e.target.value)}
                    className="flex-1 px-2 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100"
                  />
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">/ mo</span>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] text-gray-400">Current: <span className="font-semibold text-gray-600 dark:text-gray-300">{config.t1Limit.toLocaleString()}</span></span>
                  <span className="text-[10px] text-gray-400">Default: {config.defaults.t1.toLocaleString()}</span>
                </div>
              </label>
            </div>
            <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10 p-3">
              <label className="block">
                <span className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400">2.5 Pool — Daily</span>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min={0}
                    max={config.defaults.t2}
                    value={t2Input}
                    onChange={e => setT2Input(e.target.value)}
                    className="flex-1 px-2 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100"
                  />
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">/ day</span>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] text-gray-400">Current: <span className="font-semibold text-gray-600 dark:text-gray-300">{config.t2Limit.toLocaleString()}</span></span>
                  <span className="text-[10px] text-gray-400">Default: {config.defaults.t2.toLocaleString()}</span>
                </div>
              </label>
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <button
              onClick={saveLimits}
              disabled={savingLimits}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> {savingLimits ? 'Saving...' : 'Save Limits'}
            </button>
          </div>
        </div>
      )}

      {/* Active API Key selector */}
      {config && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-1">
            <Key className="w-4 h-4 text-amber-500" />
            Active API Key
          </h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
            Chooses which API key is used as the primary for chat requests. Fallback rotation still considers all keys.
          </p>
          <div className="space-y-2">
            {config.keys.map(k => {
              const isActive = k.index === config.activeKeyIndex;
              const disabled = !k.hasKey || switchingKey;
              return (
                <label
                  key={k.index}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors',
                    isActive
                      ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/10'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900',
                    disabled && !isActive ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="active-key"
                      checked={isActive}
                      disabled={disabled}
                      onChange={() => switchKey(k.index)}
                      className="accent-emerald-500"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{k.label}</div>
                      <div className="text-[10px] text-gray-400">
                        {k.hasKey ? `Index ${k.index}` : 'Not configured (env var missing)'}
                      </div>
                    </div>
                  </div>
                  {isActive && (
                    <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 rounded">ACTIVE</span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

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
                label={key.tier1?.model ?? 'Gemini 3.1 Flash-Lite Preview'}
                tier="3.x Pool (T1 fallback)"
                used={key.tier1?.used ?? 0}
                limit={key.tier1?.limit ?? 5000}
                period={key.tier1?.period ?? 'monthly'}
                color="purple"
              />
              <QuotaCard
                label={key.tier2?.model ?? 'Gemini 2.5 Flash-Lite'}
                tier="2.5 Pool (T2 primary)"
                used={key.tier2?.used ?? 0}
                limit={key.tier2?.limit ?? 1500}
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
