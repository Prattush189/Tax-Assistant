import { useState, useEffect, useCallback } from 'react';
import { Users, Activity, DollarSign, Shield, CheckCircle, RefreshCw, ShieldOff } from 'lucide-react';
import { adminFetchStats, adminFetchUsers, adminSuspendUser, adminUnsuspendUser, adminChangePlan } from '../../services/api';
import toast from 'react-hot-toast';

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
}

const SUSPEND_OPTIONS = [
  { label: '1 hour', hours: 1 },
  { label: '6 hours', hours: 6 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
];

export function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [period, setPeriod] = useState('month');
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, u] = await Promise.all([
        adminFetchStats(period),
        adminFetchUsers(),
      ]);
      setStats(s);
      setUsers(u);
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

  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#D4A020]" />
            Admin Dashboard
          </h1>
          <div className="flex items-center gap-2">
            <select
              value={period}
              onChange={e => setPeriod(e.target.value)}
              className="px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300"
            >
              <option value="day">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>
            <button onClick={loadData} disabled={loading} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
              <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

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

        {/* Users Table */}
        <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm border border-slate-200/50 dark:border-slate-800/50 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200/50 dark:border-slate-800/50">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Users ({users.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Plan</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">IPs</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Chats</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Msgs</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 text-slate-800 dark:text-slate-200 font-medium">{u.name}</td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">{u.email}</td>
                    <td className="px-4 py-3">
                      {u.role === 'admin' ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#D4A020]/20 text-[#B8860B] dark:text-[#D4A020]">
                          {u.plan}
                        </span>
                      ) : (
                        <select
                          value={u.plan}
                          onChange={e => handlePlanChange(u.id, e.target.value as 'free' | 'pro' | 'enterprise')}
                          className="px-2 py-1 text-xs bg-transparent border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 cursor-pointer"
                        >
                          <option value="free">Free</option>
                          <option value="pro">Pro</option>
                          <option value="enterprise">Enterprise</option>
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-[#D4A020]/20 text-[#B8860B] dark:text-[#D4A020]' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-400 max-w-[150px] truncate" title={u.ips}>
                      {u.ips ? u.ips.split(',').length + ' IP' + (u.ips.split(',').length > 1 ? 's' : '') : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{u.chat_count}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{u.message_count}</td>
                    <td className="px-4 py-3">
                      {u.suspended_until ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">Suspended</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.role !== 'admin' && (
                        u.suspended_until ? (
                          <button onClick={() => handleUnsuspend(u.id)} className="flex items-center gap-1 px-2 py-1 text-xs text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors">
                            <CheckCircle className="w-3 h-3" /> Unsuspend
                          </button>
                        ) : (
                          <select
                            onChange={e => { const h = parseInt(e.target.value); if (h > 0) handleSuspend(u.id, h); e.target.value = ''; }}
                            defaultValue=""
                            className="px-2 py-1 text-xs bg-transparent border border-slate-200 dark:border-slate-700 rounded-lg text-red-500 cursor-pointer"
                          >
                            <option value="" disabled>Suspend...</option>
                            {SUSPEND_OPTIONS.map(o => <option key={o.hours} value={o.hours}>{o.label}</option>)}
                          </select>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string | number }) {
  return (
    <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm border border-slate-200/50 dark:border-slate-800/50 rounded-xl p-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#D4A020]/10 flex items-center justify-center">
          <Icon className="w-5 h-5 text-[#D4A020]" />
        </div>
        <div>
          <p className="text-[11px] text-slate-400 uppercase font-medium">{label}</p>
          <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{value}</p>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm border border-slate-200/50 dark:border-slate-800/50 rounded-xl px-4 py-3 flex items-center justify-between">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{value}</span>
    </div>
  );
}
