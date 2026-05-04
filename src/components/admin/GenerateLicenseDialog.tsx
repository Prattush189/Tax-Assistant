import { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminFetchUsers, adminGenerateLicense } from '../../services/api';

interface AdminUser { id: string; name: string; email: string; plan: string; }

interface Props {
  onClose: () => void;
  onIssued: (info: { invoiceUrl: string | null; receiptUrl: string | null }) => void;
}

export function GenerateLicenseDialog({ onClose, onIssued }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [plan, setPlan] = useState<'free' | 'pro' | 'enterprise'>('pro');
  const [durationMonths, setDurationMonths] = useState('12');
  const [generateInvoice, setGenerateInvoice] = useState(false);
  const [generateReceipt, setGenerateReceipt] = useState(false);
  const [amountInr, setAmountInr] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminFetchUsers().then((res: { users?: AdminUser[] } | AdminUser[]) => {
      if (cancelled) return;
      const list = Array.isArray(res) ? res : (res.users ?? []);
      setUsers(list);
    }).catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, []);

  const filteredUsers = users.filter(u => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  }).slice(0, 50);

  const previewExpiry = (() => {
    const m = parseInt(durationMonths, 10);
    if (!Number.isFinite(m) || m < 1) return '—';
    const d = new Date();
    d.setMonth(d.getMonth() + m);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  })();

  const wantInvoiceOrReceipt = generateInvoice || generateReceipt;
  const amountValid = !wantInvoiceOrReceipt || (Number.isFinite(parseFloat(amountInr)) && parseFloat(amountInr) > 0);
  const canSubmit = !!userId && !!plan && Number.isFinite(parseInt(durationMonths, 10)) && amountValid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await adminGenerateLicense({
        userId,
        plan,
        durationMonths: parseInt(durationMonths, 10),
        generateInvoice,
        generateReceipt,
        amount: wantInvoiceOrReceipt ? Math.round(parseFloat(amountInr) * 100) : undefined,
        notes: notes.trim() || undefined,
      });
      toast.success(`Issued ${result.license.key}`);
      onIssued({ invoiceUrl: result.invoiceUrl, receiptUrl: result.receiptUrl });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to issue license');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = "w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500";
  const labelClass = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-5 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Plus className="w-4 h-4 text-emerald-600" />
            Generate License
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className={labelClass}>User</label>
            <input
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              placeholder="Search by name or email…"
              className={inputClass}
            />
            <div className="mt-2 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              {filteredUsers.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-400">No users match.</p>
              ) : (
                filteredUsers.map(u => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => { setUserId(u.id); setUserSearch(`${u.name} (${u.email})`); }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-900/20 ${userId === u.id ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}
                  >
                    <span className="font-medium text-gray-900 dark:text-gray-100">{u.name || u.email}</span>
                    <span className="text-gray-500"> · {u.email} · {u.plan}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Plan</label>
              <select value={plan} onChange={e => setPlan(e.target.value as 'free' | 'pro' | 'enterprise')} className={inputClass}>
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Duration (months)</label>
              <input
                type="number"
                min={1}
                max={60}
                value={durationMonths}
                onChange={e => setDurationMonths(e.target.value)}
                className={inputClass}
              />
              <p className="text-[11px] text-gray-400 mt-1">Expires on {previewExpiry}</p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">Optional documents</p>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={generateInvoice} onChange={e => setGenerateInvoice(e.target.checked)} className="accent-emerald-500" />
              Generate invoice (PDF)
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={generateReceipt} onChange={e => setGenerateReceipt(e.target.checked)} className="accent-emerald-500" />
              Generate receipt (PDF)
            </label>
            {wantInvoiceOrReceipt && (
              <div>
                <label className={labelClass}>Amount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={amountInr}
                  onChange={e => setAmountInr(e.target.value)}
                  placeholder="e.g. 5999"
                  className={inputClass}
                />
                <p className="text-[11px] text-gray-400 mt-1">Required to print on the invoice/receipt. Logged as a payment row tagged 'offline'.</p>
              </div>
            )}
          </div>

          <div>
            <label className={labelClass}>Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Paid by NEFT to dealer Pankaj Sethi on 12 Apr 2026"
              className={inputClass}
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-5 py-3 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">Cancel</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Generating…' : 'Generate license'}
          </button>
        </div>
      </div>
    </div>
  );
}
