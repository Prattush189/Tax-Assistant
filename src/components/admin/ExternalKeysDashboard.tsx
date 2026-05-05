import { useCallback, useEffect, useState } from 'react';
import { Plug, Plus, Ban, Copy, Edit3, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import {
  adminFetchExternalKeys, adminCreateExternalKey,
  adminRevokeExternalKey, adminUpdateExternalKeyWebhook,
  type AdminExternalKey,
} from '../../services/api';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ExternalKeysDashboard() {
  const [keys, setKeys] = useState<AdminExternalKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [showPlaintextFor, setShowPlaintextFor] = useState<{ id: string; key: string } | null>(null);
  const [editingWebhookFor, setEditingWebhookFor] = useState<string | null>(null);
  const [editingWebhookValue, setEditingWebhookValue] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminFetchExternalKeys();
      setKeys(r.keys);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRevoke = async (k: AdminExternalKey) => {
    if (!confirm(`Revoke ${k.label}? Subsequent calls using this key will be rejected. Cannot be undone.`)) return;
    try {
      await adminRevokeExternalKey(k.id);
      toast.success('Key revoked');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Revoke failed');
    }
  };

  const startWebhookEdit = (k: AdminExternalKey) => {
    setEditingWebhookFor(k.id);
    setEditingWebhookValue(k.webhook_url ?? '');
  };

  const saveWebhook = async (id: string) => {
    try {
      const url = editingWebhookValue.trim() || null;
      await adminUpdateExternalKeyWebhook(id, url);
      toast.success(url ? 'Webhook URL saved' : 'Webhook URL cleared');
      setEditingWebhookFor(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('Copied'); }
    catch { /* clipboard blocked */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Plug className="w-5 h-5 text-violet-500" /> External API Keys
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Authenticate sister apps (assist.smartbizin.com, future integrations) calling /api/external/*. Each key is shown ONCE at creation — capture it then.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Plus className="w-4 h-4" /> Issue API Key
        </button>
      </div>

      {showPlaintextFor && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700/60 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">⚠ Capture this key now — it cannot be recovered</p>
          <p className="text-xs text-amber-800 dark:text-amber-300">Once you close this banner, only the SHA-256 hash is stored. Lost keys must be revoked and re-issued.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 text-sm font-mono bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 rounded-lg text-gray-900 dark:text-gray-100 break-all">
              {showPlaintextFor.key}
            </code>
            <button onClick={() => copy(showPlaintextFor.key)} className="px-3 py-2 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-lg">
              <Copy className="w-3.5 h-3.5 inline mr-1" /> Copy
            </button>
            <button onClick={() => setShowPlaintextFor(null)} className="px-3 py-2 text-xs font-medium bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-lg border border-gray-200 dark:border-gray-700">
              I've saved it
            </button>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr className="text-left text-gray-500">
                <th className="px-3 py-2 font-medium">Label</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Last used</th>
                <th className="px-3 py-2 font-medium">Webhook URL</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">Loading…</td></tr>}
              {!loading && keys.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No external keys yet.</td></tr>}
              {keys.map(k => {
                const revoked = !!k.revoked_at;
                const editing = editingWebhookFor === k.id;
                return (
                  <tr key={k.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{k.label}</td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        'px-2 py-0.5 rounded text-[10px] font-medium',
                        revoked
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                      )}>{revoked ? 'revoked' : 'active'}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{fmtDate(k.created_at)}</td>
                    <td className="px-3 py-2 text-gray-500">{fmtDate(k.last_used_at)}</td>
                    <td className="px-3 py-2 text-gray-500 max-w-xs">
                      {editing ? (
                        <div className="flex items-center gap-1">
                          <input
                            value={editingWebhookValue}
                            onChange={e => setEditingWebhookValue(e.target.value)}
                            placeholder="https://assist.smartbizin.com/webhooks/license"
                            className="flex-1 px-2 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded"
                          />
                          <button onClick={() => saveWebhook(k.id)} title="Save" className="p-1 text-emerald-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"><Check className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setEditingWebhookFor(null)} title="Cancel" className="p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] truncate flex-1">{k.webhook_url ?? '—'}</span>
                          {!revoked && (
                            <button onClick={() => startWebhookEdit(k)} title="Edit webhook URL" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!revoked && (
                        <button onClick={() => handleRevoke(k)} title="Revoke" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-rose-600 dark:text-rose-400">
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen && (
        <CreateExternalKeyDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(id, plaintextKey) => {
            setCreateOpen(false);
            setShowPlaintextFor({ id, key: plaintextKey });
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateExternalKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string, plaintextKey: string) => void }) {
  const [label, setLabel] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!label.trim() || submitting) return;
    setSubmitting(true);
    try {
      const r = await adminCreateExternalKey({ label: label.trim(), webhookUrl: webhookUrl.trim() || undefined });
      onCreated(r.id, r.plaintextKey);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to issue key');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = "w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 max-w-lg w-full p-5 shadow-xl space-y-4">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Issue External API Key</h2>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Label</label>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="e.g. assist.smartbizin.com — production"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Webhook URL <span className="text-gray-400">(optional)</span>
          </label>
          <input
            value={webhookUrl}
            onChange={e => setWebhookUrl(e.target.value)}
            placeholder="https://assist.smartbizin.com/webhooks/license"
            className={inputClass}
          />
          <p className="text-[11px] text-gray-400 mt-1">If set, Tax-Assistant will POST license + payment events to this URL when Razorpay activates a plan.</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">Cancel</button>
          <button onClick={submit} disabled={!label.trim() || submitting} className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
            {submitting ? 'Issuing…' : 'Issue key'}
          </button>
        </div>
      </div>
    </div>
  );
}
