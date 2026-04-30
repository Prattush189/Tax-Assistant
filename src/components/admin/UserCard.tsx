import { useState, type ComponentType } from 'react';
import {
  ChevronDown, CheckCircle, BadgeCheck, Coins, Clock,
  Activity, BarChart3, Loader2, Wallet,
} from 'lucide-react';
import {
  adminFetchUserDetails, type AdminUserDetails,
} from '../../services/api';
import { cn } from '../../lib/utils';

const SUSPEND_OPTIONS = [
  { label: '1 hour', hours: 1 },
  { label: '6 hours', hours: 6 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
];

interface AdminUserSummary {
  id: string;
  email: string;
  name: string;
  role: string;
  plan: string;
  suspended_until: string | null;
  created_at: string;
  chat_count: number;
  message_count: number;
  ips: string;
  last_api_call: string | null;
  // Cumulative usage from /api/admin/users — surfaced in the
  // always-visible header so admins can spot heavy-spend users
  // without clicking expand on every card.
  requests: number;
  total_tokens: number;
  total_cost_inr: number;
  avg_cost_per_1m_inr: number;
}

interface Props {
  user: AdminUserSummary;
  /** Format ISO timestamp to relative time (passed in so we share the
   *  parent's IST-aware formatter rather than reimplementing it). */
  relativeTime: (ts: string | null) => string;
  onPlanChange: (userId: string, plan: 'free' | 'pro' | 'enterprise') => void | Promise<void>;
  onSuspend: (userId: string, hours: number) => void | Promise<void>;
  onUnsuspend: (userId: string) => void | Promise<void>;
}

const PLAN_BADGE: Record<string, string> = {
  free: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300',
  pro: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  enterprise: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
};

function formatINR(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-IN');
}

export function UserCard({
  user, relativeTime, onPlanChange, onSuspend, onUnsuspend,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<AdminUserDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !details && !loadingDetails) {
      setLoadingDetails(true);
      setError(null);
      try {
        const d = await adminFetchUserDetails(user.id);
        setDetails(d);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load details');
      } finally {
        setLoadingDetails(false);
      }
    }
  };

  const isAdmin = user.role === 'admin';
  const isSuspended = !!user.suspended_until;

  return (
    <div className="bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      {/* ── Card header (always visible) ── */}
      <div className="px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={toggleExpand}
          className="flex items-center gap-2 flex-1 min-w-0 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40 -mx-2 px-2 py-1 rounded-md transition-colors"
        >
          <ChevronDown
            className={cn(
              'w-4 h-4 text-gray-400 shrink-0 transition-transform',
              expanded && 'rotate-180',
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                {user.name}
              </span>
              {isAdmin && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                  ADMIN
                </span>
              )}
              {isSuspended && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300">
                  SUSPENDED
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{user.email}</div>
          </div>
        </button>

        {/* Compact per-user stats — visible without expanding so the
            sort-by-usage admin filters land on something readable. */}
        <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 shrink-0">
          <span title="Total API requests (cumulative)">
            <span className="font-medium text-gray-700 dark:text-gray-200">{user.requests.toLocaleString('en-IN')}</span> req
          </span>
          <span title="Total tokens (input + output, cumulative)">
            <span className="font-medium text-gray-700 dark:text-gray-200">{formatTokens(user.total_tokens)}</span> tok
          </span>
          <span title="Total cost in INR (cumulative)">
            <span className="font-medium text-gray-700 dark:text-gray-200">Rs. {formatINR(user.total_cost_inr)}</span>
          </span>
          <span title="Average cost per 1M tokens, INR">
            <span className="font-medium text-gray-700 dark:text-gray-200">Rs. {formatINR(user.avg_cost_per_1m_inr)}</span>/1M
          </span>
          <span className="whitespace-nowrap" title={user.last_api_call ?? 'Never'}>
            <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />
            {relativeTime(user.last_api_call)}
          </span>
        </div>

        {/* Plan picker */}
        <div className="shrink-0">
          {isAdmin ? (
            <span className={cn(
              'px-2 py-1 rounded-full text-xs font-medium',
              PLAN_BADGE[user.plan] ?? PLAN_BADGE.free,
            )}>
              {user.plan}
            </span>
          ) : (
            <select
              value={user.plan}
              onChange={e => onPlanChange(user.id, e.target.value as 'free' | 'pro' | 'enterprise')}
              className={cn(
                'px-2 py-1 text-xs rounded-md border cursor-pointer',
                'bg-transparent border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300',
              )}
            >
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          )}
        </div>

        {/* Suspend / Unsuspend */}
        {!isAdmin && (
          <div className="shrink-0">
            {isSuspended ? (
              <button
                type="button"
                onClick={() => onUnsuspend(user.id)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-md transition-colors"
              >
                <CheckCircle className="w-3 h-3" /> Unsuspend
              </button>
            ) : (
              <select
                onChange={e => {
                  const h = parseInt(e.target.value, 10);
                  if (h > 0) onSuspend(user.id, h);
                  e.target.value = '';
                }}
                defaultValue=""
                className="px-2 py-1 text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded-md text-rose-500 cursor-pointer"
              >
                <option value="" disabled>Suspend…</option>
                {SUSPEND_OPTIONS.map(o => (
                  <option key={o.hours} value={o.hours}>{o.label}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30 px-4 py-4">
          {loadingDetails && (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading user details…
            </div>
          )}
          {error && (
            <div className="text-sm text-rose-600 dark:text-rose-400">
              {error}
            </div>
          )}
          {details && !loadingDetails && (
            <div className="space-y-4">
              {/* Monthly token-budget bar */}
              <div className="bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400">
                    <BarChart3 className="w-3.5 h-3.5" />
                    This month's token budget ({details.user.effectivePlan})
                  </div>
                  <div className="text-xs font-mono text-gray-700 dark:text-gray-200">
                    {formatTokens(details.monthly.tokensUsed)} / {formatTokens(details.monthly.tokenBudget)}
                    <span className="text-gray-400 ml-2">{details.monthly.pct}%</span>
                  </div>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                  <div
                    className={cn(
                      'h-full transition-all',
                      details.monthly.pct >= 90
                        ? 'bg-rose-500'
                        : details.monthly.pct >= 70
                          ? 'bg-amber-500'
                          : 'bg-emerald-500',
                    )}
                    style={{ width: `${Math.min(100, details.monthly.pct)}%` }}
                  />
                </div>
              </div>

              {/* Stat grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat icon={Activity} label="Requests" value={details.totals.requests.toLocaleString('en-IN')} />
                <Stat icon={Coins} label="Total tokens" value={formatTokens(details.totals.totalTokens)} sub={`${formatTokens(details.totals.inputTokens)} in · ${formatTokens(details.totals.outputTokens)} out`} />
                <Stat icon={Wallet} label="Total cost" value={`Rs. ${formatINR(details.totals.totalCostInr)}`} sub={`$${details.totals.totalCostUsd.toFixed(4)}`} />
                <Stat icon={BadgeCheck} label="Avg / 1M tokens" value={`Rs. ${formatINR(details.totals.avgCostPer1MInr)}`} sub={`$${details.totals.avgCostPer1MUsd.toFixed(3)}`} />
              </div>

              {/* Daily token history */}
              {details.daily.length > 0 && (
                <div className="bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 rounded-lg p-3">
                  <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                    Daily token history (last 30 days)
                  </div>
                  <DailyBars daily={details.daily} />
                </div>
              )}

              {/* Recent API calls */}
              <div className="bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                <div className="px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                  Recent API calls ({details.recent.length})
                </div>
                {details.recent.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-gray-400">No API calls yet.</div>
                ) : (
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-900/60 sticky top-0">
                        <tr className="text-left text-gray-500 dark:text-gray-400">
                          <th className="px-3 py-1.5 font-medium">When</th>
                          <th className="px-3 py-1.5 font-medium">Category</th>
                          <th className="px-3 py-1.5 font-medium">Model</th>
                          <th className="px-3 py-1.5 font-medium text-right">In</th>
                          <th className="px-3 py-1.5 font-medium text-right">Out</th>
                          <th className="px-3 py-1.5 font-medium text-right">Rs.</th>
                          <th className="px-3 py-1.5 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.recent.map(r => (
                          <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                            <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap" title={r.created_at}>
                              {relativeTime(r.created_at)}
                            </td>
                            <td className="px-3 py-1.5 text-gray-700 dark:text-gray-200">
                              {r.category ?? '—'}
                            </td>
                            <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 truncate max-w-[160px]" title={r.model ?? ''}>
                              {r.model ?? '—'}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-gray-700 dark:text-gray-200">
                              {formatTokens(r.input_tokens)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-gray-700 dark:text-gray-200">
                              {formatTokens(r.output_tokens)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-gray-700 dark:text-gray-200">
                              {r.cost_inr.toFixed(3)}
                            </td>
                            <td className="px-3 py-1.5">
                              {r.status === 'cancelled' ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">cancelled</span>
                              ) : r.status === 'failed' ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300">failed</span>
                              ) : (
                                <span className="text-emerald-500">●</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon, label, value, sub,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string; value: string; sub?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 rounded-lg p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 mb-1">
        <Icon className="w-3 h-3" />
        <span>{label}</span>
      </div>
      <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{value}</div>
      {sub && <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function DailyBars({ daily }: { daily: AdminUserDetails['daily'] }) {
  const max = Math.max(1, ...daily.map(d => d.input_tokens + d.output_tokens));
  return (
    <div className="flex items-end gap-1 h-20">
      {daily.map(d => {
        const total = d.input_tokens + d.output_tokens;
        const h = Math.max(2, Math.round((total / max) * 80));
        return (
          <div
            key={d.date}
            className="flex-1 group relative"
            title={`${d.date}: ${formatTokens(total)} tokens, ${d.requests} requests, Rs. ${d.cost_inr.toFixed(3)}`}
          >
            <div
              className="w-full bg-emerald-400 dark:bg-emerald-500 rounded-t hover:bg-emerald-500 dark:hover:bg-emerald-400 transition-colors"
              style={{ height: `${h}px` }}
            />
          </div>
        );
      })}
    </div>
  );
}
