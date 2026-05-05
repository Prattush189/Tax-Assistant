import { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  adminFetchUsers, adminGenerateLicense, adminFetchBillingPrefill,
  type AdminPaymentMethod, type AdminBillingDetails,
} from '../../services/api';

interface AdminUser { id: string; name: string; email: string; plan: string; }

interface Props {
  onClose: () => void;
  onIssued: (info: { invoiceUrl: string | null; receiptUrl: string | null }) => void;
}

const PLAN_OPTIONS: Array<{ value: 'pro' | 'enterprise'; label: string }> = [
  { value: 'pro', label: 'Pro (yearly)' },
  { value: 'enterprise', label: 'Enterprise (yearly)' },
];

const METHOD_OPTIONS: Array<{ value: AdminPaymentMethod; label: string; needsRef: boolean; refLabel?: string }> = [
  { value: 'cash',   label: 'Cash',                       needsRef: false },
  { value: 'cheque', label: 'Cheque',                     needsRef: true,  refLabel: 'Cheque number' },
  { value: 'neft',   label: 'NEFT',                       needsRef: true,  refLabel: 'NEFT UTR' },
  { value: 'imps',   label: 'IMPS',                       needsRef: true,  refLabel: 'IMPS reference' },
  { value: 'upi',    label: 'UPI',                        needsRef: true,  refLabel: 'UPI transaction id' },
  { value: 'rtgs',   label: 'RTGS',                       needsRef: true,  refLabel: 'RTGS UTR' },
  { value: 'card',   label: 'Card (terminal / POS)',      needsRef: false },
  { value: 'other',  label: 'Other',                      needsRef: false },
];

const EMPTY_BILLING: AdminBillingDetails = {
  name: '', addressLine1: '', addressLine2: '', city: '', state: '', pincode: '', gstin: '',
};

export function GenerateLicenseDialog({ onClose, onIssued }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [plan, setPlan] = useState<'pro' | 'enterprise'>('pro');
  const [paymentMethod, setPaymentMethod] = useState<AdminPaymentMethod>('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [amountInr, setAmountInr] = useState('');
  const [billing, setBilling] = useState<AdminBillingDetails>(EMPTY_BILLING);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastReferenceHint, setLastReferenceHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminFetchUsers().then((res: { users?: AdminUser[] } | AdminUser[]) => {
      if (cancelled) return;
      const list = Array.isArray(res) ? res : (res.users ?? []);
      setUsers(list);
    }).catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, []);

  // Pre-fill billing + payment method when a user is selected. Saves
  // the admin from re-typing the same billing block on every renewal.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    adminFetchBillingPrefill(userId).then(prefill => {
      if (cancelled) return;
      if (prefill.billingDetails) {
        setBilling({
          name: prefill.billingDetails.name ?? '',
          addressLine1: prefill.billingDetails.addressLine1 ?? '',
          addressLine2: prefill.billingDetails.addressLine2 ?? '',
          city: prefill.billingDetails.city ?? '',
          state: prefill.billingDetails.state ?? '',
          pincode: prefill.billingDetails.pincode ?? '',
          gstin: prefill.billingDetails.gstin ?? '',
        });
      }
      if (prefill.lastPaymentMethod) setPaymentMethod(prefill.lastPaymentMethod);
      // Reference is hint-only — admin needs to enter the new
      // cheque/UTR for THIS payment, but seeing the previous one
      // helps confirm they're picking the right method.
      setLastReferenceHint(prefill.lastPaymentReference);
    }).catch(() => { /* silent — first-time issuance */ });
    return () => { cancelled = true; };
  }, [userId]);

  const filteredUsers = users.filter(u => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  }).slice(0, 50);

  const previewExpiry = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  })();

  const methodOpt = METHOD_OPTIONS.find(m => m.value === paymentMethod) ?? METHOD_OPTIONS[0];
  const refRequired = methodOpt.needsRef;
  const refValid = !refRequired || paymentReference.trim().length > 0;
  const amountValid = Number.isFinite(parseFloat(amountInr)) && parseFloat(amountInr) > 0;
  const billingValid = ['name', 'addressLine1', 'city', 'state', 'pincode']
    .every(k => (billing[k as keyof AdminBillingDetails] ?? '').trim().length > 0);

  const canSubmit = !!userId && refValid && amountValid && billingValid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const payload = {
        userId,
        plan,
        paymentMethod,
        paymentReference: refRequired ? paymentReference.trim() : undefined,
        amount: Math.round(parseFloat(amountInr) * 100),
        billingDetails: {
          name: billing.name.trim(),
          addressLine1: billing.addressLine1.trim(),
          addressLine2: billing.addressLine2?.trim() || undefined,
          city: billing.city.trim(),
          state: billing.state.trim(),
          pincode: billing.pincode.trim(),
          gstin: billing.gstin?.trim() || undefined,
        },
        notes: notes.trim() || undefined,
      };
      const result = await adminGenerateLicense(payload);
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
              <select value={plan} onChange={e => setPlan(e.target.value as 'pro' | 'enterprise')} className={inputClass}>
                {PLAN_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Expires on</label>
              <div className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300">
                {previewExpiry}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Payment method</label>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as AdminPaymentMethod)} className={inputClass}>
                {METHOD_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
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
            </div>
          </div>

          {refRequired && (
            <div>
              <label className={labelClass}>{methodOpt.refLabel ?? 'Reference'}</label>
              <input
                value={paymentReference}
                onChange={e => setPaymentReference(e.target.value)}
                placeholder={lastReferenceHint ? `Last: ${lastReferenceHint}` : ''}
                className={inputClass}
              />
              {lastReferenceHint && (
                <p className="text-[11px] text-gray-400 mt-1">Previous {methodOpt.label} reference for this user: {lastReferenceHint}</p>
              )}
            </div>
          )}

          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">Billing address (saved for next time)</p>
            <div>
              <label className={labelClass}>Name</label>
              <input value={billing.name} onChange={e => setBilling(b => ({ ...b, name: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Address line 1</label>
              <input value={billing.addressLine1} onChange={e => setBilling(b => ({ ...b, addressLine1: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Address line 2 <span className="text-gray-400">(optional)</span></label>
              <input value={billing.addressLine2 ?? ''} onChange={e => setBilling(b => ({ ...b, addressLine2: e.target.value }))} className={inputClass} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelClass}>City</label>
                <input value={billing.city} onChange={e => setBilling(b => ({ ...b, city: e.target.value }))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>State</label>
                <input value={billing.state} onChange={e => setBilling(b => ({ ...b, state: e.target.value }))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>PIN</label>
                <input value={billing.pincode} onChange={e => setBilling(b => ({ ...b, pincode: e.target.value }))} className={inputClass} />
              </div>
            </div>
            <div>
              <label className={labelClass}>GSTIN <span className="text-gray-400">(optional)</span></label>
              <input value={billing.gstin ?? ''} onChange={e => setBilling(b => ({ ...b, gstin: e.target.value }))} className={inputClass} />
            </div>
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
