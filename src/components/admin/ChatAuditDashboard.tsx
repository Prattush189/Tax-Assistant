import { useState } from 'react';
import { Download, MessageSquareWarning, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchChatAuditExport } from '../../services/api';

/**
 * Admin tool: export recent chatbot (question, answer) pairs for an external
 * LLM-judge audit pass. Downloads JSON straight to the browser (nothing is
 * stored server-side). Feed the file to the judge prompt in
 * server/scripts/chat-audit-judge-prompt.md; the agent fills the empty
 * verdict/severity/issue/correction fields, then review the flagged rows.
 */
export function ChatAuditDashboard() {
  const [sinceDays, setSinceDays] = useState(30);
  const [limit, setLimit] = useState(500);
  const [busy, setBusy] = useState(false);
  const [lastStats, setLastStats] = useState<{ count: number; sinceDays: number } | null>(null);

  const download = async () => {
    setBusy(true);
    try {
      const res = await fetchChatAuditExport(sinceDays, limit);
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-audit-${new Date().toISOString().slice(0, 10)}-last${res.sinceDays}d.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Defer revoke so the download isn't cancelled mid-flight.
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setLastStats({ count: res.count, sinceDays: res.sinceDays });
      toast.success(`Exported ${res.count} Q&A pair(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
        <div className="flex items-center gap-2 mb-1">
          <MessageSquareWarning className="w-4 h-4 text-indigo-500" />
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Chat QA audit export</h3>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 max-w-2xl">
          Downloads recent chatbot <span className="font-medium">(question, answer)</span> pairs, newest first,
          with empty <span className="font-mono">verdict/severity/issue/correction</span> fields. Feed the file to
          the judge prompt in <span className="font-mono">server/scripts/chat-audit-judge-prompt.md</span> (use a
          Pro-tier model with search) to grade tax-correctness, then review the flagged rows by hand. Built on
          demand, never stored on the server.
          <br />
          <span className="text-amber-600 dark:text-amber-400">Contains real user questions &amp; answers — keep the file private.</span>
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Since (days)</span>
            <input
              type="number"
              min={1}
              max={365}
              value={sinceDays}
              onChange={(e) => setSinceDays(Math.min(365, Math.max(1, parseInt(e.target.value, 10) || 1)))}
              className="w-28 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Max pairs</span>
            <input
              type="number"
              min={1}
              max={5000}
              value={limit}
              onChange={(e) => setLimit(Math.min(5000, Math.max(1, parseInt(e.target.value, 10) || 1)))}
              className="w-28 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
            />
          </label>
          <button
            type="button"
            onClick={() => void download()}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {busy ? 'Building…' : 'Download chats for audit'}
          </button>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            keep the first batch small — judging costs per pair
          </span>
        </div>

        {lastStats && (
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-3">
            Last export: <span className="font-medium">{lastStats.count.toLocaleString()}</span> Q&amp;A pair(s)
            from the last <span className="font-medium">{lastStats.sinceDays}</span> day(s).
          </p>
        )}
      </div>
    </div>
  );
}
