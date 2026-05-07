import { useCallback, useEffect, useState } from 'react';
import { Clock, RefreshCw, ChevronLeft, ChevronRight, Search, Plug, Tag } from 'lucide-react';
import { cn } from '../../lib/utils';
import { adminFetchRecentCalls, RecentApiCall } from '../../services/api';
import { LoadingAnimation } from '../ui/LoadingAnimation';

const PAGE_SIZE = 100;

const CATEGORY_COLORS: Record<string, string> = {
  chat: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  notice: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  notice_extract: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300',
  partnership_deed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400',
  suggestion: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
  bank_statement: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400',
  ledger_scrutiny: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  ledger_extract: 'bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-400',
  style_profile: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-400',
  document: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400',
  form16: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400',
};

const CATEGORY_LABELS: Record<string, string> = {
  chat: 'Chat',
  notice: 'Notice',
  notice_extract: 'Notice extract',
  partnership_deed: 'Partnership Deed',
  suggestion: 'Suggestion',
  bank_statement: 'Bank Statement',
  ledger_scrutiny: 'Ledger Scrutiny',
  ledger_extract: 'Ledger Extract',
  style_profile: 'Style Profile',
  document: 'Document',
  form16: 'Form 16',
};

// Active models get distinct colours; retired models keep grey so
// historic api_usage rows are visually deprioritised in the breakdown.
const MODEL_COLORS: Record<string, string> = {
  'gemini-2.5-flash-lite':         'bg-blue-500',     // T2 active primary
  'gemini-3.1-flash-lite-preview': 'bg-violet-400',   // T1 active fallback
  'gemini-3-flash-preview':        'bg-gray-400',     // retired
  'gemini-2.5-flash':              'bg-gray-400',     // retired
  'claude-haiku-4-5':              'bg-gray-400',     // retired
  'unknown':                       'bg-gray-400',
};

const MODEL_LABELS: Record<string, string> = {
  'gemini-2.5-flash-lite':         'Gemini 2.5 Flash-Lite',
  'gemini-3.1-flash-lite-preview': 'Gemini 3.1 Flash-Lite',
  'gemini-3-flash-preview':        'Gemini 3 Flash (retired)',
  'gemini-2.5-flash':              'Gemini 2.5 Flash (retired)',
  'claude-haiku-4-5':              'Claude Haiku 4.5 (retired)',
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

/** Categories report input_units in different real-world units. The
 *  dashboard renders the right unit so an admin can read "337 txns"
 *  vs "5 pages" at a glance and compute per-unit cost accurately. */
function inputUnitLabel(category: string | null, units: number): string {
  if (!units || units === 0) return '—';
  switch (category) {
    case 'bank_statement':
    case 'ledger_extract':
    case 'ledger_scrutiny':
      return `${units.toLocaleString('en-IN')} txns`;
    case 'notice':
    case 'notice_extract':
    case 'document':
    case 'form16':
      return `${units.toLocaleString('en-IN')} ${units === 1 ? 'page' : 'pages'}`;
    case 'chat':
    case 'suggestion':
      return `${units.toLocaleString('en-IN')} ${units === 1 ? 'msg' : 'msgs'}`;
    default:
      return units.toLocaleString('en-IN');
  }
}

function fmtInr(n: number): string {
  return 'Rs. ' + (Math.round(n * 10000) / 10000).toFixed(4);
}

/** Relative time from IST-stored timestamp. */
function relativeTime(ts: string | null): string {
  if (!ts) return '—';
  const then = new Date(ts + '+05:30').getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
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

export function RecentApiCallsDashboard() {
  const [calls, setCalls] = useState<RecentApiCall[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  const offset = page * PAGE_SIZE;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetchRecentCalls(PAGE_SIZE, offset);
      setCalls(res.calls);
      setTotal(res.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Clock className="w-5 h-5 text-emerald-500" />
            Recent API Calls
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
            <span><span className="font-semibold text-gray-700 dark:text-gray-300">Gemini 2.5 Flash-Lite:</span> $0.10 in / $0.40 out per 1M (weight 1× / 4×)</span>
            <span className="text-gray-300 dark:text-gray-700">·</span>
            <span><span className="font-semibold text-gray-700 dark:text-gray-300">Gemini 3.1 Flash-Lite:</span> $0.25 in / $1.50 out per 1M (weight 2.5× / 15×)</span>
            <span className="text-gray-300 dark:text-gray-700">·</span>
            <span><span className="font-semibold text-gray-700 dark:text-gray-300">Claude Sonnet 4.5:</span> $3.00 in / $15.00 out per 1M (weight 30× / 150×)</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {total === 0 ? 'No calls' : `${from}–${to} of ${total.toLocaleString()}`}
          </span>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
            title="Reload"
          >
            {loading ? <LoadingAnimation size="xs" /> : <RefreshCw className="w-4 h-4 text-gray-500" />}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800/50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Time</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">User</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Category</th>
                <th className="text-center px-3 py-2 text-gray-500 font-medium" title="success / cancelled / failed. Cancelled tokens count toward user budget; failed tokens do not.">Status</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Model</th>
                <th className="text-center px-3 py-2 text-gray-500 font-medium">Search</th>
                <th className="text-center px-3 py-2 text-gray-500 font-medium">Plugin</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium" title="Raw input tokens billed by the model — multiply by the model's input weight to get the contribution to the weighted total.">In tok</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium" title="Raw output tokens billed by the model — multiply by the model's output weight to get the contribution to the weighted total.">Out tok</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium" title="Weighted total = In × wIn + Out × wOut. This is what the cross-feature monthly quota gate sums against the user's budget.">Weighted</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium" title="Pre-flight WEIGHTED token estimate from the quota gate. Only set on the summary row of a request; — when not estimated.">Est.</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium" title="Estimate drift on weighted tokens: (weighted − estimate) / estimate. Amber = under-estimated by 20-50%, rose = under-estimated by >50% (the dangerous direction). Over-estimates are neutral grey.">Δ %</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium" title="User-input size — txns for bank/ledger, pages for notice/document, msgs for chat">User input</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Cost</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium" title="Cost per user-input unit (cost ÷ input units)">₹ / unit</th>
              </tr>
            </thead>
            <tbody>
              {calls.map(c => {
                const modelKey = c.model ?? 'unknown';
                const modelColor = MODEL_COLORS[modelKey] ?? 'bg-gray-400';
                const modelLabel = MODEL_LABELS[modelKey] ?? (c.model ?? 'unknown');
                return (
                  <tr key={c.id} className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap" title={c.created_at}>
                      {relativeTime(c.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{c.user_name}</div>
                      {c.user_email && (
                        <div className="text-[10px] text-gray-400">{c.user_email}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {c.category ? (
                        <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium', CATEGORY_COLORS[c.category] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400')}>
                          <Tag className="w-2.5 h-2.5" />
                          {CATEGORY_LABELS[c.category] ?? c.category}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {c.status === 'cancelled' ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">cancelled</span>
                      ) : c.status === 'failed' ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400">failed</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <div className={cn('w-2 h-2 rounded-full shrink-0', modelColor)} />
                        <span className="text-gray-700 dark:text-gray-300 whitespace-nowrap">{modelLabel}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {c.search_used ? <Search className="w-3.5 h-3.5 text-emerald-500 inline" /> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {c.is_plugin ? <Plug className="w-3.5 h-3.5 text-indigo-500 inline" /> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtTokens(c.input_tokens)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtTokens(c.output_tokens)}</td>
                    <td
                      className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap"
                      title={c.weighted_tokens > 0 ? `${c.input_tokens.toLocaleString()} × wIn + ${c.output_tokens.toLocaleString()} × wOut = ${c.weighted_tokens.toLocaleString()} weighted (model: ${c.model ?? 'n/a'})` : 'Not weighted'}
                    >
                      {c.weighted_tokens > 0 ? fmtTokens(c.weighted_tokens) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-500 dark:text-gray-400">
                      {c.estimated_tokens > 0 ? fmtTokens(c.estimated_tokens) : '—'}
                    </td>
                    <td className={cn(
                      'px-3 py-2 text-right font-mono whitespace-nowrap',
                      // Drift on WEIGHTED tokens vs the WEIGHTED estimate.
                      // Under-estimate (weighted > estimate) is the dangerous
                      // direction — amber at >20%, rose at >50%. Over-estimate
                      // stays neutral grey.
                      (() => {
                        if (c.estimated_tokens <= 0 || c.weighted_tokens <= 0) return 'text-gray-400';
                        const drift = (c.weighted_tokens - c.estimated_tokens) / c.estimated_tokens;
                        if (drift > 0.5) return 'text-rose-500 dark:text-rose-400';
                        if (drift > 0.2) return 'text-amber-500 dark:text-amber-400';
                        return 'text-gray-500 dark:text-gray-400';
                      })(),
                    )}>
                      {c.estimated_tokens > 0 && c.weighted_tokens > 0
                        ? `${((c.weighted_tokens - c.estimated_tokens) / c.estimated_tokens * 100).toFixed(0)}%`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {inputUnitLabel(c.category, c.input_units ?? 0)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">{fmtInr(c.cost_inr)}</td>
                    <td className="px-3 py-2 text-right text-gray-500 whitespace-nowrap">
                      {c.input_units > 0 ? fmtInr(c.cost_inr / c.input_units) : '—'}
                    </td>
                  </tr>
                );
              })}
              {calls.length === 0 && !loading && (
                <tr>
                  <td colSpan={15} className="px-3 py-8 text-center text-gray-400">No API calls recorded</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          Page {page + 1} of {totalPages}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </button>
          <button
            onClick={() => setPage(p => (p + 1 < totalPages ? p + 1 : p))}
            disabled={page + 1 >= totalPages || loading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
