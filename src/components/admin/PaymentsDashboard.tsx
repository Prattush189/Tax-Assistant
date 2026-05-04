import { useCallback, useEffect, useState } from 'react';
import { Wallet, Search, Download, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { adminFetchPayments, type AdminPaymentRow } from '../../services/api';

function fmtINR(paise: number): string {
  return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusBadge(s: AdminPaymentRow['status']): string {
  switch (s) {
    case 'paid': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'created': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'failed': return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
  }
}

function parseBilling(json: string | null): { name?: string; addressLine1?: string; city?: string; state?: string; pincode?: string; gstin?: string } | null {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

function billingSummary(json: string | null): string {
  const b = parseBilling(json);
  if (!b) return '—';
  const parts = [b.city, b.state].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '—';
}

export function PaymentsDashboard() {
  const [rows, setRows] = useState<AdminPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminFetchPayments({ search: search.trim() || undefined });
      setRows(r.rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => { load(); }, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Wallet className="w-5 h-5 text-emerald-500" /> Payments
      </h2>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, or order id…"
          className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg"
        />
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr className="text-left text-gray-500">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 font-medium text-right">Amount</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Billing</th>
                <th className="px-3 py-2 font-medium">License</th>
                <th className="px-3 py-2 font-medium">Documents</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">No payments match.</td></tr>}
              {rows.map(r => {
                const isExpanded = expanded === r.id;
                const billing = parseBilling(r.billing_details);
                return (
                  <>
                    <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{fmtDate(r.paid_at ?? r.created_at)}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{r.user_name || '—'}</div>
                        <div className="text-gray-500">{r.user_email}</div>
                      </td>
                      <td className="px-3 py-2 uppercase font-medium">{r.plan}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-900 dark:text-gray-100">{fmtINR(r.amount)}</td>
                      <td className="px-3 py-2">
                        <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium', statusBadge(r.status))}>{r.status}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        {billing ? (
                          <button onClick={() => setExpanded(isExpanded ? null : r.id)} className="text-emerald-600 dark:text-emerald-400 hover:underline">
                            {billingSummary(r.billing_details)}
                          </button>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-500">
                        {r.license ? r.license.key : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {r.status === 'paid' ? (
                          <div className="flex gap-1">
                            <a
                              href={`/api/admin/payments/${r.id}/invoice.pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Download invoice"
                              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </a>
                            <a
                              href={`/api/admin/payments/${r.id}/receipt.pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Download receipt"
                              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        ) : '—'}
                      </td>
                    </tr>
                    {isExpanded && billing && (
                      <tr className="border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                        <td colSpan={8} className="px-3 py-3">
                          <div className="text-[11px] text-gray-600 dark:text-gray-400 space-y-0.5">
                            <div><span className="font-semibold">{billing.name ?? '—'}</span></div>
                            <div>{billing.addressLine1 ?? '—'}</div>
                            <div>{[billing.city, billing.state, billing.pincode].filter(Boolean).join(', ') || '—'}</div>
                            {billing.gstin && <div>GSTIN: <span className="font-mono">{billing.gstin}</span></div>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
