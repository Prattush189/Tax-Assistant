import { useEffect, useState } from 'react';
import { Download, MessageSquareWarning, Loader2, Flag } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchChatAuditExport, fetchChatReports, type ReportedAnswer, type ChatReportReason } from '../../services/api';

const REASON_LABEL: Record<ChatReportReason, string> = {
  wrong_info: 'Wrong / outdated info',
  not_answered: "Didn't answer",
  confusing: 'Too long / confusing',
  other: 'Other',
};

function ReportedAnswers() {
  const [reports, setReports] = useState<ReportedAnswer[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    fetchChatReports(100)
      .then(r => setReports(r.reports))
      .catch(() => setReports([]));
  }, []);

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
      <div className="flex items-center gap-2 mb-1">
        <Flag className="w-4 h-4 text-red-500" />
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Reported answers</h3>
        {reports && <span className="text-xs text-gray-400">{reports.length}</span>}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Answers users flagged with the chat's report button, newest first. Reported pairs are also marked
        <span className="font-mono"> userReported</span> in the export below.
      </p>
      {reports === null ? (
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
      ) : reports.length === 0 ? (
        <p className="text-xs text-gray-400">No reports yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {reports.map(r => (
            <li key={r.id} className="py-2.5">
              <button
                type="button"
                onClick={() => setOpen(open === r.id ? null : r.id)}
                className="w-full text-left flex flex-wrap items-baseline gap-x-3 gap-y-1"
              >
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 shrink-0">
                  {REASON_LABEL[r.reason] ?? r.reason}
                </span>
                <span className="text-sm text-gray-800 dark:text-gray-100 min-w-0 flex-1 truncate">{r.question ?? '(question not found)'}</span>
                <span className="text-[11px] text-gray-400 shrink-0">{r.user_email ?? 'deleted user'} · {r.created_at.slice(0, 16)}</span>
              </button>
              {open === r.id && (
                <div className="mt-2 space-y-2">
                  {r.note && <p className="text-xs text-gray-600 dark:text-gray-300"><span className="font-medium">Note:</span> {r.note}</p>}
                  <pre className="text-xs whitespace-pre-wrap break-words max-h-80 overflow-auto rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3 text-gray-700 dark:text-gray-200">{r.answer}</pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
      <ReportedAnswers />
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
