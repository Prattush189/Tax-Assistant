import { useCallback, useEffect, useState } from 'react';
import { Key, RefreshCw, Ban, Search, Plus, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import {
  adminFetchLicenses, adminRenewLicense, adminRevokeLicense, adminReconcileLicenses,
  type AdminLicenseRow,
} from '../../services/api';
import { GenerateLicenseDialog } from './GenerateLicenseDialog';

const PLANS = [
  { value: '', label: 'All plans' },
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'admin', label: 'Admin' },
];

const STATUSES = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'superseded', label: 'Superseded' },
];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusBadge(status: AdminLicenseRow['status']): string {
  switch (status) {
    case 'active': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'expired': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'revoked': return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
    case 'superseded': return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  }
}

export function LicensesDashboard() {
  const [rows, setRows] = useState<AdminLicenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState('');
  const [generateOpen, setGenerateOpen] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const handleReconcile = async () => {
    if (reconciling) return;
    if (!confirm('Re-issue licenses for every user whose plan column doesn\'t match their active license?\n\nUseful when plans were changed directly (DB edit or before the licensing system) and the license needs to catch up. Each affected user gets a new key starting today, running for 1 year. Their old key is marked superseded.')) return;
    setReconciling(true);
    try {
      const r = await adminReconcileLicenses();
      toast.success(`Reconciled ${r.reconciled} user(s)`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reconcile failed');
    } finally {
      setReconciling(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminFetchLicenses({ search: search.trim() || undefined, plan: plan || undefined, status: status || undefined });
      setRows(r.rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load licenses');
    } finally {
      setLoading(false);
    }
  }, [search, plan, status]);

  useEffect(() => {
    const t = setTimeout(() => { load(); }, 250); // debounce search
    return () => clearTimeout(t);
  }, [load]);

  const handleRenew = async (lic: AdminLicenseRow) => {
    const months = parseInt(prompt('Renew for how many months?', '12') ?? '', 10);
    if (!Number.isFinite(months) || months < 1) return;
    try {
      await adminRenewLicense(lic.id, months);
      toast.success('License renewed');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Renew failed');
    }
  };

  const handleRevoke = async (lic: AdminLicenseRow) => {
    const reason = prompt(`Revoke license ${lic.key}? Optional reason:`, 'Manual revocation');
    if (reason === null) return;
    try {
      await adminRevokeLicense(lic.id, reason || 'Revoked by admin');
      toast.success('License revoked');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Revoke failed');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Key className="w-5 h-5 text-amber-500" /> Licenses
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReconcile}
            disabled={reconciling}
            title="Re-issue licenses for users whose plan column doesn't match their active license — fixes manually-edited plans that bypassed the licensing system."
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-300 disabled:opacity-50"
          >
            <Wrench className="w-4 h-4" /> {reconciling ? 'Reconciling…' : 'Reconcile mismatches'}
          </button>
          <button
            onClick={() => setGenerateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Plus className="w-4 h-4" /> Generate License
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, or key…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg"
          />
        </div>
        <select value={plan} onChange={e => setPlan(e.target.value)} className="px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
          {PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className="px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
          {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr className="text-left text-gray-500">
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Issued</th>
                <th className="px-3 py-2 font-medium">Expires</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">No licenses match.</td></tr>}
              {rows.map(r => (
                <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-2 font-mono text-gray-900 dark:text-gray-100">{r.key}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{r.user_name || '—'}</div>
                    <div className="text-gray-500">{r.user_email}</div>
                  </td>
                  <td className="px-3 py-2 uppercase font-medium">{r.plan}</td>
                  <td className="px-3 py-2">
                    <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium', statusBadge(r.status))}>{r.status}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-500">{formatDate(r.starts_at)}</td>
                  <td className="px-3 py-2 text-gray-500">{r.expires_at ? formatDate(r.expires_at) : 'Never'}</td>
                  <td className="px-3 py-2 text-gray-500">{r.generated_via}</td>
                  <td className="px-3 py-2 text-right">
                    {r.status === 'active' && r.plan !== 'admin' && (
                      <div className="inline-flex gap-1">
                        <button onClick={() => handleRenew(r)} title="Renew" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-emerald-600 dark:text-emerald-400">
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleRevoke(r)} title="Revoke" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-rose-600 dark:text-rose-400">
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {generateOpen && (
        <GenerateLicenseDialog
          onClose={() => setGenerateOpen(false)}
          onIssued={() => { setGenerateOpen(false); load(); }}
        />
      )}
    </div>
  );
}
