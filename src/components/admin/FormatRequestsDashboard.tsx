import { useState, useEffect, useCallback } from 'react';
import { Inbox, Download, Trash2, RefreshCw, Landmark, BookOpen, Paperclip } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  adminFetchFormatRequests,
  adminUpdateFormatRequest,
  adminDeleteFormatRequest,
  adminDownloadFormatSample,
  type FormatRequestItem,
  type FormatRequestKind,
  type FormatRequestStatus,
} from '../../services/api';

const STATUS_STYLES: Record<FormatRequestStatus, string> = {
  new: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  rejected: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
};
const STATUSES: FormatRequestStatus[] = ['new', 'in_progress', 'done', 'rejected'];

function formatBytes(n: number | null): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Ledger / bank format-support requests filed from the uploaders.
 *
 * The attached sample export is the reason this exists — it's what a
 * per-bank or per-ERP column rule gets written against — so the
 * download button is the primary action on every row.
 *
 * Samples are real customer financial data. They're only fetched on an
 * explicit click (never inlined in the listing), and Delete removes the
 * row AND the stored file, which is how you clear that data off the box
 * once a rule has shipped.
 */
export function FormatRequestsDashboard() {
  const [requests, setRequests] = useState<FormatRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<FormatRequestKind | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<FormatRequestStatus | 'all'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetchFormatRequests({
        kind: kindFilter === 'all' ? undefined : kindFilter,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      setRequests(res.requests ?? []);
    } catch {
      toast.error('Could not load format requests.');
    } finally {
      setLoading(false);
    }
  }, [kindFilter, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const setStatus = async (id: string, status: FormatRequestStatus) => {
    // Optimistic — the dropdown should feel instant; reload on failure.
    setRequests(rs => rs.map(r => (r.id === id ? { ...r, status } : r)));
    try {
      await adminUpdateFormatRequest(id, { status });
    } catch {
      toast.error('Could not update status.');
      void load();
    }
  };

  const remove = async (r: FormatRequestItem) => {
    if (!confirm(`Delete the "${r.software_name}" request${r.file_name ? ' and its sample file' : ''}? This cannot be undone.`)) return;
    try {
      await adminDeleteFormatRequest(r.id);
      setRequests(rs => rs.filter(x => x.id !== r.id));
      toast.success('Request deleted.');
    } catch {
      toast.error('Delete failed.');
    }
  };

  const download = async (r: FormatRequestItem) => {
    try {
      await adminDownloadFormatSample(r.id, r.file_name ?? 'sample');
    } catch {
      toast.error('Could not download the sample.');
    }
  };

  const newCount = requests.filter(r => r.status === 'new').length;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center shrink-0">
          <Inbox className="w-4.5 h-4.5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
            Format Support Requests
            {newCount > 0 && (
              <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                {newCount} new
              </span>
            )}
          </h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Banks and accounting packages users asked us to support, with their sample exports.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as FormatRequestKind | 'all')}
          className="px-2.5 py-1.5 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-200"
        >
          <option value="all">All types</option>
          <option value="bank">Banks</option>
          <option value="ledger">Ledger software</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as FormatRequestStatus | 'all')}
          className="px-2.5 py-1.5 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-200"
        >
          <option value="all">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>

      {loading && requests.length === 0 ? (
        <p className="text-xs text-gray-400 py-6 text-center">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="text-xs text-gray-400 py-6 text-center">No requests yet.</p>
      ) : (
        <div className="space-y-2">
          {requests.map(r => (
            <div
              key={r.id}
              className="flex flex-wrap items-start gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20"
            >
              <div className="w-7 h-7 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 flex items-center justify-center shrink-0">
                {r.kind === 'bank'
                  ? <Landmark className="w-3.5 h-3.5 text-blue-500" />
                  : <BookOpen className="w-3.5 h-3.5 text-violet-500" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {r.software_name}
                  </span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_STYLES[r.status]}`}>
                    {r.status.replace('_', ' ')}
                  </span>
                  {!r.file_name && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                      no sample
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                  {r.user_name || r.user_email || r.user_id} · {new Date(r.created_at).toLocaleString('en-IN')}
                </p>
                {r.notes && (
                  <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-1 whitespace-pre-wrap break-words">
                    {r.notes}
                  </p>
                )}
                {r.file_name && (
                  <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-1 truncate">
                    <Paperclip className="w-3 h-3 shrink-0" />
                    <span className="truncate">{r.file_name}</span>
                    <span className="shrink-0">· {formatBytes(r.file_size)}</span>
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <select
                  value={r.status}
                  onChange={(e) => void setStatus(r.id, e.target.value as FormatRequestStatus)}
                  className="px-2 py-1 text-[11px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-200"
                >
                  {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
                <button
                  onClick={() => void download(r)}
                  disabled={!r.file_name}
                  title={r.file_name ? 'Download the sample export' : 'No sample was attached'}
                  className="p-1.5 text-gray-400 hover:text-[#059669] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => void remove(r)}
                  title="Delete the request and its stored sample"
                  className="p-1.5 text-gray-400 hover:text-rose-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
