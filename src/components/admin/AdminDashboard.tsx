import { useState, useEffect, useCallback } from 'react';
import { Users, Activity, DollarSign, Shield, RefreshCw, ShieldOff, BarChart3, Cpu, Clock, RotateCcw } from 'lucide-react';
import { ApiCostDashboard } from './ApiCostDashboard';
import { ModelUsageDashboard } from './ModelUsageDashboard';
import { RecentApiCallsDashboard } from './RecentApiCallsDashboard';
import { UserCard } from './UserCard';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { adminFetchStats, adminFetchUsers, adminSuspendUser, adminUnsuspendUser, adminChangePlan, adminFetchTrend, adminFetchPlans, adminResetOwnUsage } from '../../services/api';
import { LoadingAnimation } from '../ui/LoadingAnimation';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { ConfirmDialog } from '../ui/ConfirmDialog';

type AdminTab = 'overview' | 'users' | 'api-costs' | 'recent-calls' | 'model-usage';

interface Stats {
  total_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  unique_ips: number;
  unique_users: number;
  total_users: number;
  total_chats: number;
  total_messages: number;
}

interface AdminUser {
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
}

interface TrendPoint {
  day: string;
  requests: number;
  cost: number;
  users: number;
}

interface PlanCount {
  plan: string;
  count: number;
}

const PLAN_COLORS: Record<string, string> = {
  free: '#94a3b8',
  pro: '#10b981',
  enterprise: '#6366f1',
};

/** Format ISO timestamp to relative time (e.g., "5m ago", "2h ago", "3d ago") */
function relativeTime(ts: string | null): string {
  if (!ts) return '—';
  // DB stores IST with no tz — parse as UTC offset +05:30
  const then = new Date(ts + '+05:30').getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  return `${Math.floor(mon / 12)}y ago`;
}

export function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [period, setPeriod] = useState('month');
  const [loading, setLoading] = useState(true);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [plans, setPlans] = useState<PlanCount[]>([]);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPending, setResetPending] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, u, t, p] = await Promise.all([
        adminFetchStats(period),
        adminFetchUsers(),
        adminFetchTrend(),
        adminFetchPlans(),
      ]);
      setStats(s);
      setUsers(u);
      setTrend(t.trend ?? []);
      setPlans(p.plans ?? []);
    } catch (err) {
      toast.error('Failed to load admin data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSuspend = async (userId: string, hours: number) => {
    try {
      await adminSuspendUser(userId, hours);
      toast.success('User suspended');
      loadData();
    } catch { toast.error('Failed to suspend'); }
  };

  const handleUnsuspend = async (userId: string) => {
    try {
      await adminUnsuspendUser(userId);
      toast.success('User unsuspended');
      loadData();
    } catch { toast.error('Failed to unsuspend'); }
  };

  const handlePlanChange = async (userId: string, plan: 'free' | 'pro' | 'enterprise') => {
    try {
      await adminChangePlan(userId, plan);
      toast.success(`Plan changed to ${plan}`);
      loadData();
    } catch { toast.error('Failed to change plan'); }
  };

  const [adminTab, setAdminTab] = useState<AdminTab>('overview');

  // `ai: true` tabs expose AI-specific telemetry (per-model costs / usage /
  // recent calls). Rendered with a small [AI] badge so admins can see at a
  // glance which tabs drill into AI infrastructure.
  const ADMIN_TABS: { id: AdminTab; label: string; icon: typeof Activity; ai?: boolean }[] = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'api-costs', label: 'API Costs', icon: DollarSign, ai: true },
    { id: 'recent-calls', label: 'Recent Calls', icon: Clock, ai: true },
    { id: 'model-usage', label: 'Model Usage', icon: Cpu, ai: true },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#059669]" />
            Admin Dashboard
          </h1>
          <div className="flex items-center gap-2">
            <select
              value={period}
              onChange={e => setPeriod(e.target.value)}
              className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300"
            >
              <option value="day">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>
            <button onClick={loadData} disabled={loading} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
              {loading ? <LoadingAnimation size="xs" /> : <RefreshCw className="w-4 h-4 text-gray-500" />}
            </button>
            {/* Self-only quota reset. Only clears the calling admin's
                own monthly feature_usage rows (server enforces;
                button just dispatches the request). */}
            <button
              onClick={() => setResetOpen(true)}
              disabled={resetPending}
              title="Reset my own monthly usage counters to 0%"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-amber-200 dark:border-amber-800/60 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors disabled:opacity-50"
            >
              <RotateCcw className={cn('w-3.5 h-3.5', resetPending && 'animate-spin')} />
              Reset my usage
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
          {ADMIN_TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setAdminTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                  adminTab === tab.id
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.ai && (
                  <span
                    className={cn(
                      'text-[9px] font-bold tracking-wider px-1 py-0.5 rounded border leading-none',
                      adminTab === tab.id
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300/60 dark:border-emerald-700/60'
                        : 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-300 border-purple-200 dark:border-purple-800/60',
                    )}
                    title="AI telemetry"
                  >AI</span>
                )}
              </button>
            );
          })}
        </div>

        {/* API Costs tab */}
        {adminTab === 'api-costs' && <ApiCostDashboard />}

        {/* Recent Calls tab */}
        {adminTab === 'recent-calls' && <RecentApiCallsDashboard />}

        {/* Model Usage tab */}
        {adminTab === 'model-usage' && <ModelUsageDashboard />}

        {/* Overview + Users tabs use existing content below */}
        {adminTab !== 'api-costs' && adminTab !== 'recent-calls' && adminTab !== 'model-usage' && (
        <>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={Users} label="Users" value={stats.total_users} />
            <StatCard icon={Activity} label="API Calls" value={stats.total_requests} />
            <StatCard icon={DollarSign} label="Cost" value={`$${stats.total_cost.toFixed(4)}`} />
            <StatCard icon={ShieldOff} label="Chats" value={stats.total_chats} />
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {stats && (
            <>
              <MiniStat label="Total Messages" value={stats.total_messages} />
              <MiniStat label="Active Users" value={stats.unique_users} />
              <MiniStat label="Tokens Used" value={`${((stats.total_input_tokens + stats.total_output_tokens) / 1000).toFixed(1)}K`} />
            </>
          )}
        </div>

        {/* Cost Trend Line Chart */}
        {trend.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Usage Trend (Last 30 Days)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis yAxisId="cost" tick={{ fontSize: 11 }} stroke="#f97316" />
                <YAxis yAxisId="requests" orientation="right" tick={{ fontSize: 11 }} stroke="#6366f1" />
                <Tooltip />
                <Line yAxisId="cost" type="monotone" dataKey="cost" stroke="#f97316" name="Cost ($)" dot={false} strokeWidth={2} />
                <Line yAxisId="requests" type="monotone" dataKey="requests" stroke="#6366f1" name="Requests" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Plan Distribution Pie Chart */}
        {plans.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Plan Distribution</h2>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={plans}
                  dataKey="count"
                  nameKey="plan"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  label={(props: { name?: string | number; value?: number }) => `${props.name}: ${props.value}`}
                >
                  {plans.map((entry) => (
                    <Cell key={entry.plan} fill={PLAN_COLORS[entry.plan] ?? '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Users Table — visible on overview and users tabs */}
        {(adminTab === 'overview' || adminTab === 'users') && (
        <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm border border-gray-200/50 dark:border-gray-800/50 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200/50 dark:border-gray-800/50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Users ({users.length}) <span className="text-xs font-normal text-gray-400 ml-1">sorted by latest activity</span>
            </h2>
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-800/30 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="Reload users"
            >
              {loading ? (
                <LoadingAnimation size="xs" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Reload
            </button>
          </div>
          <div className="p-3 space-y-2">
            {users.length === 0 ? (
              <div className="text-center text-sm text-gray-400 py-8">No users yet.</div>
            ) : (
              users.map(u => (
                <UserCard
                  key={u.id}
                  user={u}
                  relativeTime={relativeTime}
                  onPlanChange={handlePlanChange}
                  onSuspend={handleSuspend}
                  onUnsuspend={handleUnsuspend}
                />
              ))
            )}
          </div>
        </div>

        )}
        </>
        )}
      </div>
      <ConfirmDialog
        open={resetOpen}
        title="Reset your monthly usage?"
        description="This wipes THIS month's quota counters for your account only — all bars will return to 0%. Cost history, transactions, and saved drafts are untouched. Use for testing or after hitting a limit during QA."
        confirmLabel="Reset usage"
        cancelLabel="Keep current"
        destructive
        pending={resetPending}
        onConfirm={async () => {
          setResetPending(true);
          try {
            const r = await adminResetOwnUsage();
            toast.success(`Usage reset (${r.cleared} row${r.cleared === 1 ? '' : 's'} cleared)`);
            setResetOpen(false);
            await loadData();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Reset failed');
          } finally {
            setResetPending(false);
          }
        }}
        onCancel={() => setResetOpen(false)}
      />
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string | number }) {
  return (
    <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm border border-gray-200/50 dark:border-gray-800/50 rounded-xl p-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#059669]/10 flex items-center justify-center">
          <Icon className="w-5 h-5 text-[#059669]" />
        </div>
        <div>
          <p className="text-[11px] text-gray-400 uppercase font-medium">{label}</p>
          <p className="text-lg font-bold text-gray-800 dark:text-gray-100">{value}</p>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm border border-gray-200/50 dark:border-gray-800/50 rounded-xl px-4 py-3 flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{value}</span>
    </div>
  );
}
