import { useEffect, useState } from 'react';
import {
  User, Mail, Lock, Trash2, AlertTriangle, Check, Sliders, PenTool,
  CreditCard, MessageSquare, Paperclip, Lightbulb, FileText, FileSignature,
  Landmark, Users, TrendingUp, Clock, Download, CheckCircle2, XCircle, Hourglass,
  MapPin, Pencil, Building2, Loader2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  updateAccountName,
  updateAccountEmail,
  updateAccountPassword,
  deleteAccount,
  fetchUserUsage,
  fetchPaymentHistory,
  fetchBillingDetails,
  saveBillingDetails,
  type UserUsageResponse,
  type PaymentHistoryResponse,
  type BillingDetails,
} from '../../services/api';
import { usePreferences } from '../../hooks/usePreferences';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';
import { TeamSection } from './TeamSection';
import { StyleSection } from './StyleSection';
import { generatePaymentReceipt, generatePaymentInvoice, type PaymentData } from '../../lib/paymentPdf';

// ── types ─────────────────────────────────────────────────────────────────────

type Tab = 'account' | 'billing' | 'preferences' | 'team' | 'danger';

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'account',     label: 'Account',     icon: User       },
  { id: 'billing',     label: 'Billing',     icon: CreditCard },
  { id: 'preferences', label: 'Preferences', icon: Sliders    },
  { id: 'team',        label: 'Team',        icon: Users      },
  { id: 'danger',      label: 'Danger Zone', icon: Trash2     },
];

// ── shared sub-components ─────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  danger?: boolean;
}

function Section({ title, description, icon: Icon, children, danger }: SectionProps) {
  return (
    <div className={cn(
      'rounded-2xl border p-6',
      danger
        ? 'bg-red-50/50 dark:bg-red-950/10 border-red-200 dark:border-red-900/50'
        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800'
    )}>
      <div className="flex items-start gap-3 mb-4">
        <div className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
          danger
            ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
            : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
        )}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={cn(
            'text-base font-semibold',
            danger ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-white'
          )}>{title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

const inputClass = "w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 text-gray-800 dark:text-gray-100 text-sm placeholder:text-gray-400";
const buttonPrimary = "px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const buttonDanger  = "px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
        enabled ? 'bg-emerald-600' : 'bg-gray-300 dark:bg-gray-600'
      )}
      aria-checked={enabled} role="switch"
    >
      <span className={cn(
        'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
        enabled ? 'translate-x-6' : 'translate-x-1'
      )} />
    </button>
  );
}

// ── UsageBar ──────────────────────────────────────────────────────────────────

function UsageBar({
  icon: Icon, label, used, limit, period,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; used: number; limit: number;
  period?: 'day' | 'month' | 'total';
}) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const barColor =
    pct >= 90 ? 'bg-red-500' :
    pct >= 75 ? 'bg-amber-500' :
    pct >= 50 ? 'bg-yellow-500' :
    'bg-[#0D9668] dark:bg-[#2DD4A0]';
  const periodLabel = period === 'day' ? '/day' : '';

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-[#0D9668]/10 dark:bg-[#0D9668]/20 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-[#0D9668] dark:text-[#2DD4A0]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">{label}</p>
          <p className="text-sm font-bold text-gray-800 dark:text-white">
            {used.toLocaleString('en-IN')} / {limit.toLocaleString('en-IN')}
            <span className="text-xs font-normal text-gray-400 ml-1">{periodLabel}</span>
          </p>
        </div>
        <span className={cn(
          'text-xs font-bold shrink-0',
          pct >= 90 ? 'text-red-600 dark:text-red-400' :
          pct >= 75 ? 'text-amber-600 dark:text-amber-400' :
          'text-gray-500 dark:text-gray-400'
        )}>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', barColor)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── PaymentStatusBadge ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === 'paid') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
      <CheckCircle2 className="w-3 h-3" /> Paid
    </span>
  );
  if (status === 'failed') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
      <XCircle className="w-3 h-3" /> Failed
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
      <Hourglass className="w-3 h-3" /> Pending
    </span>
  );
}

// ── INDIAN_STATES (for billing details form) ──────────────────────────────────

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan',
  'Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Andaman & Nicobar Islands','Chandigarh','Dadra & Nagar Haveli and Daman & Diu',
  'Delhi','Jammu & Kashmir','Ladakh','Lakshadweep','Puducherry',
];

const billingInputCls = "w-full px-3 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 text-gray-800 dark:text-gray-100 text-sm placeholder:text-gray-400";
const billingLabelCls = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";

// ── BillingDetailsSection ─────────────────────────────────────────────────────

function BillingDetailsSection() {
  const [details, setDetails]   = useState<BillingDetails | null>(null);
  const [editing, setEditing]   = useState(false);
  const [saving,  setSaving]    = useState(false);
  const [loading, setLoading]   = useState(true);
  const [form, setForm]         = useState<BillingDetails>({
    name: '', addressLine1: '', addressLine2: '', city: '', state: '', pincode: '', gstin: '',
  });
  const [errors, setErrors]     = useState<Partial<Record<keyof BillingDetails, string>>>({});

  useEffect(() => {
    fetchBillingDetails()
      .then(({ billingDetails }) => {
        if (billingDetails) {
          setDetails(billingDetails);
          setForm({
            name:         billingDetails.name         ?? '',
            addressLine1: billingDetails.addressLine1 ?? '',
            addressLine2: billingDetails.addressLine2 ?? '',
            city:         billingDetails.city         ?? '',
            state:        billingDetails.state        ?? '',
            pincode:      billingDetails.pincode      ?? '',
            gstin:        billingDetails.gstin        ?? '',
          });
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const setField = (field: keyof BillingDetails) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm(f => ({ ...f, [field]: e.target.value }));
      if (errors[field]) setErrors(e => ({ ...e, [field]: undefined }));
    };

  const validate = (): boolean => {
    const errs: Partial<Record<keyof BillingDetails, string>> = {};
    if (!form.name.trim())         errs.name         = 'Required';
    if (!form.addressLine1.trim()) errs.addressLine1 = 'Required';
    if (!form.city.trim())         errs.city         = 'Required';
    if (!form.state.trim())        errs.state        = 'Required';
    if (!form.pincode.trim())      errs.pincode      = 'Required';
    else if (!/^\d{6}$/.test(form.pincode.trim())) errs.pincode = '6-digit pincode required';
    if (form.gstin?.trim() && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(form.gstin.trim().toUpperCase())) {
      errs.gstin = 'Invalid GSTIN format';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const updated: BillingDetails = {
        name:         form.name.trim(),
        addressLine1: form.addressLine1.trim(),
        addressLine2: form.addressLine2?.trim() || undefined,
        city:         form.city.trim(),
        state:        form.state.trim(),
        pincode:      form.pincode.trim(),
        gstin:        form.gstin?.trim().toUpperCase() || undefined,
      };
      await saveBillingDetails(updated);
      setDetails(updated);
      setEditing(false);
      toast.success('Billing details saved');
    } catch {
      toast.error('Failed to save billing details');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex justify-center py-6">
      <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
    </div>
  );

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center shrink-0">
            <MapPin className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Billing Details</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Appears on your receipts and tax invoices</p>
          </div>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" /> {details ? 'Edit' : 'Add'}
          </button>
        )}
      </div>

      {!editing ? (
        details ? (
          <div className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
            <p className="font-semibold text-gray-900 dark:text-white">{details.name}</p>
            <p>{details.addressLine1}</p>
            {details.addressLine2 && <p>{details.addressLine2}</p>}
            <p>{[details.city, details.state].filter(Boolean).join(', ')}{details.pincode ? ' \u2013 ' + details.pincode : ''}</p>
            {details.gstin && (
              <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mt-1">
                <Building2 className="w-3.5 h-3.5" /> GSTIN: {details.gstin}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500">
            No billing details saved yet. Click Add to set them up for your invoices.
          </p>
        )
      ) : (
        <div className="space-y-3">
          <div>
            <label className={billingLabelCls}>Full Name / Business Name <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={setField('name')}
              placeholder="As it should appear on invoice" className={billingInputCls} maxLength={100} />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className={billingLabelCls}>Address Line 1 <span className="text-red-500">*</span></label>
            <input type="text" value={form.addressLine1} onChange={setField('addressLine1')}
              placeholder="Street address, flat/house no." className={billingInputCls} maxLength={120} />
            {errors.addressLine1 && <p className="text-xs text-red-500 mt-1">{errors.addressLine1}</p>}
          </div>
          <div>
            <label className={billingLabelCls}>Address Line 2 <span className="text-gray-400">(optional)</span></label>
            <input type="text" value={form.addressLine2} onChange={setField('addressLine2')}
              placeholder="Area, landmark" className={billingInputCls} maxLength={120} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={billingLabelCls}>City <span className="text-red-500">*</span></label>
              <input type="text" value={form.city} onChange={setField('city')}
                placeholder="City" className={billingInputCls} maxLength={60} />
              {errors.city && <p className="text-xs text-red-500 mt-1">{errors.city}</p>}
            </div>
            <div>
              <label className={billingLabelCls}>State <span className="text-red-500">*</span></label>
              <select value={form.state} onChange={setField('state')} className={billingInputCls}>
                <option value="">Select state</option>
                {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {errors.state && <p className="text-xs text-red-500 mt-1">{errors.state}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={billingLabelCls}>Pincode <span className="text-red-500">*</span></label>
              <input type="text" value={form.pincode} onChange={setField('pincode')}
                placeholder="6-digit pincode" className={billingInputCls} maxLength={6} />
              {errors.pincode && <p className="text-xs text-red-500 mt-1">{errors.pincode}</p>}
            </div>
            <div>
              <label className={billingLabelCls}>
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> GSTIN <span className="text-gray-400">(optional)</span>
                </span>
              </label>
              <input type="text" value={form.gstin} onChange={setField('gstin')}
                placeholder="For businesses claiming ITC"
                className={cn(billingInputCls, 'uppercase')} maxLength={15} />
              {errors.gstin && <p className="text-xs text-red-500 mt-1">{errors.gstin}</p>}
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => { setEditing(false); setErrors({}); }}
              className="flex-1 py-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : 'Save Details'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── BillingTab ────────────────────────────────────────────────────────────────

function BillingTab({ userName, userEmail }: { userName: string; userEmail: string }) {
  const [usage,          setUsage]          = useState<UserUsageResponse | null>(null);
  const [history,        setHistory]        = useState<PaymentHistoryResponse | null>(null);
  const [billingDetails, setBillingDetails] = useState<BillingDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchUserUsage(), fetchPaymentHistory(), fetchBillingDetails()])
      .then(([u, h, b]) => { setUsage(u); setHistory(h); setBillingDetails(b.billingDetails); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const makeUserInfo = () => ({
    name: userName, email: userEmail,
    ...(billingDetails ?? {}),
  });

  const handleReceipt = (p: PaymentData) =>
    generatePaymentReceipt(p, makeUserInfo());
  const handleInvoice = (p: PaymentData) =>
    generatePaymentInvoice(p, makeUserInfo());

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Usage */}
      {usage && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Your Usage</h3>
                {usage.plan === 'free' && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                    <Clock className="w-3 h-3" /> 30-day trial
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Plan: <span className="font-semibold text-[#0D9668] dark:text-[#2DD4A0] capitalize">{usage.plan}</span>
                {usage.planExpiresAt && (
                  <span className="ml-2 text-gray-400">
                    · Renews {new Date(usage.planExpiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                )}
              </p>
            </div>
            <TrendingUp className="w-5 h-5 text-gray-400 shrink-0" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <UsageBar icon={MessageSquare} label={usage.usage.messages.label}        used={usage.usage.messages.used}        limit={usage.usage.messages.limit}        period={usage.usage.messages.period} />
            <UsageBar icon={Paperclip}     label={usage.usage.attachments.label}     used={usage.usage.attachments.used}     limit={usage.usage.attachments.limit}     period={usage.usage.attachments.period} />
            <UsageBar icon={Lightbulb}     label={usage.usage.suggestions.label}     used={usage.usage.suggestions.used}     limit={usage.usage.suggestions.limit}     period={usage.usage.suggestions.period} />
            <UsageBar icon={FileText}      label={usage.usage.notices.label}         used={usage.usage.notices.used}         limit={usage.usage.notices.limit}         period={usage.usage.notices.period} />
            <UsageBar icon={FileSignature} label={usage.usage.boardResolutions.label} used={usage.usage.boardResolutions.used} limit={usage.usage.boardResolutions.limit} period={usage.usage.boardResolutions.period} />
            <UsageBar icon={Landmark}      label={usage.usage.bankStatements.label}  used={usage.usage.bankStatements.used}  limit={usage.usage.bankStatements.limit}  period={usage.usage.bankStatements.period} />
            <UsageBar icon={User}          label={usage.usage.profiles.label}        used={usage.usage.profiles.used}        limit={usage.usage.profiles.limit}        period={usage.usage.profiles.period} />
          </div>
        </div>
      )}

      {/* Billing Details */}
      <BillingDetailsSection />

      {/* Payment History */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center shrink-0">
            <CreditCard className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Payment History</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Download receipts and tax invoices for your payments</p>
          </div>
        </div>

        {!history || history.payments.length === 0 ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500">
            <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No payments yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.payments.map((p) => {
              const total   = p.amount / 100;
              const base    = Math.round(total / (1 + 0.18) * 100) / 100;
              const gst     = Math.round((total - base) * 100) / 100;
              const rcptNo  = 'AI-' + p.id.slice(0, 10).toUpperCase();
              const isPaid  = p.status === 'paid';
              const payData: PaymentData = {
                id: p.id, plan: p.plan, billing: p.billing,
                amount: p.amount, paidAt: p.paidAt, expiresAt: p.expiresAt,
              };

              return (
                <div key={p.id} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    {/* Left: details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-semibold text-gray-800 dark:text-white capitalize">
                          {p.plan} · {p.billing}
                        </span>
                        <StatusBadge status={p.status} />
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{rcptNo}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {p.paidAt
                          ? new Date(p.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                          : new Date(p.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>

                    {/* Centre: amount breakdown */}
                    <div className="text-right sm:text-center shrink-0">
                      <p className="text-sm font-bold text-gray-800 dark:text-white">
                        ₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        ₹{base.toLocaleString('en-IN', { minimumFractionDigits: 2 })} + ₹{gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })} GST
                      </p>
                    </div>

                    {/* Right: download buttons (only for paid) */}
                    {isPaid && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleReceipt(payData)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0D9668] dark:text-[#2DD4A0] bg-[#0D9668]/10 dark:bg-[#0D9668]/20 rounded-lg hover:bg-[#0D9668]/20 dark:hover:bg-[#0D9668]/30 transition-colors"
                          title="Download Receipt"
                        >
                          <Download className="w-3.5 h-3.5" /> Receipt
                        </button>
                        <button
                          onClick={() => handleInvoice(payData)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
                          title="Download Tax Invoice"
                        >
                          <Download className="w-3.5 h-3.5" /> Invoice
                        </button>
                      </div>
                    )}
                  </div>

                  {isPaid && p.expiresAt && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                      Valid until {new Date(p.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main SettingsPage ─────────────────────────────────────────────────────────

export function SettingsPage() {
  const { user, logout, refreshUser } = useAuth();
  const { prefs, updatePreference } = usePreferences();
  const [activeTab, setActiveTab] = useState<Tab>('account');

  // Account tab state
  const [name, setName] = useState(user?.name ?? '');
  const [savingName, setSavingName] = useState(false);

  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

  // Danger tab state
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deletePwd, setDeletePwd] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === user?.name) return;
    setSavingName(true);
    try {
      await updateAccountName(name.trim());
      await refreshUser();
      toast.success('Name updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update name');
    } finally { setSavingName(false); }
  };

  const handleChangeEmail = async () => {
    if (!newEmail.trim() || !emailPassword) return;
    setSavingEmail(true);
    try {
      const data = await updateAccountEmail(newEmail.trim(), emailPassword);
      if (data.accessToken && data.refreshToken) {
        localStorage.setItem('tax_access_token', data.accessToken);
        localStorage.setItem('tax_refresh_token', data.refreshToken);
      }
      await refreshUser();
      setNewEmail(''); setEmailPassword('');
      toast.success('Email updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update email');
    } finally { setSavingEmail(false); }
  };

  const handleChangePassword = async () => {
    if (!currentPwd || !newPwd) return;
    if (newPwd !== confirmPwd) { toast.error('New passwords do not match'); return; }
    if (newPwd.length < 8)     { toast.error('Password must be at least 8 characters'); return; }
    setSavingPwd(true);
    try {
      await updateAccountPassword(currentPwd, newPwd);
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
      toast.success('Password changed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password');
    } finally { setSavingPwd(false); }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE MY ACCOUNT') {
      toast.error('Please type the confirmation phrase exactly'); return;
    }
    setDeleting(true);
    try {
      await deleteAccount(deletePwd || null, deleteConfirm);
      toast.success('Account deleted');
      setTimeout(() => logout(), 500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete account');
      setDeleting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-1">Settings</h1>
          <p className="text-gray-500 dark:text-gray-400">Manage your account, billing, and preferences</p>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-6 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap',
                activeTab === id
                  ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>

        {/* ── Account Tab ────────────────────────────────────────────────────── */}
        {activeTab === 'account' && (
          <div className="space-y-5">
            <Section title="Display Name" description="This is how your name appears in the app" icon={User}>
              <div className="flex gap-2">
                <input
                  type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Your name" className={inputClass} maxLength={80}
                />
                <button
                  onClick={handleSaveName}
                  disabled={savingName || !name.trim() || name.trim() === user?.name}
                  className={buttonPrimary}
                >
                  {savingName ? 'Saving...' : 'Save'}
                </button>
              </div>
            </Section>

            <Section title="Change Email" description="Update the email address used to log in" icon={Mail}>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Current Email</label>
                  <input type="email" value={user?.email ?? ''} disabled className={cn(inputClass, 'opacity-60 cursor-not-allowed')} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">New Email</label>
                  <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="you@example.com" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Current Password</label>
                  <input type="password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} placeholder="Required to confirm" className={inputClass} />
                </div>
                <button onClick={handleChangeEmail} disabled={savingEmail || !newEmail.trim() || !emailPassword} className={buttonPrimary}>
                  {savingEmail ? 'Updating...' : 'Update Email'}
                </button>
              </div>
            </Section>

            <Section title="Change Password" description="Use a strong password with at least 8 characters" icon={Lock}>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Current Password</label>
                  <input type="password" value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} placeholder="Leave blank if you signed up with Google" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">New Password</label>
                  <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="Minimum 8 characters" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Confirm New Password</label>
                  <input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} placeholder="Re-enter new password" className={inputClass} />
                </div>
                {newPwd && confirmPwd && newPwd === confirmPwd && (
                  <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <Check className="w-3 h-3" /> Passwords match
                  </p>
                )}
                <button onClick={handleChangePassword} disabled={savingPwd || !newPwd || !confirmPwd} className={buttonPrimary}>
                  {savingPwd ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </Section>
          </div>
        )}

        {/* ── Billing Tab ─────────────────────────────────────────────────────── */}
        {activeTab === 'billing' && (
          <BillingTab userName={user?.name ?? ''} userEmail={user?.email ?? ''} />
        )}

        {/* ── Preferences Tab ─────────────────────────────────────────────────── */}
        {activeTab === 'preferences' && (
          <div className="space-y-5">
            <Section title="Preferences" description="Customize how the app behaves" icon={Sliders}>
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Confirm before deleting chats</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Show a confirmation dialog when deleting a chat from the sidebar
                    </p>
                  </div>
                  <Toggle
                    enabled={prefs.confirmBeforeDeletingChats}
                    onChange={(v) => updatePreference('confirmBeforeDeletingChats', v)}
                  />
                </div>
              </div>
            </Section>

            <Section title="Writing Style" description="Upload a sample notice to teach the AI your preferred writing style" icon={PenTool}>
              <StyleSection />
            </Section>
          </div>
        )}

        {/* ── Team Tab ──────────────────────────────────────────────────────────── */}
        {activeTab === 'team' && (
          <div className="space-y-5">
            <TeamSection />
          </div>
        )}

        {/* ── Danger Zone Tab ───────────────────────────────────────────────────── */}
        {activeTab === 'danger' && (
          <div className="space-y-5">
            <Section title="Delete Account" description="Permanently delete your account and all associated data" icon={Trash2} danger>
              <div className="space-y-3">
                <div className="flex items-start gap-2 p-3 bg-red-100/50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700 dark:text-red-300">
                    <strong>This cannot be undone.</strong> All your chats, notices, tax profiles, and saved data will be permanently deleted.
                  </p>
                </div>
                {!showDeleteDialog ? (
                  <button onClick={() => setShowDeleteDialog(true)} className={buttonDanger}>
                    Delete My Account
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-red-700 dark:text-red-400 mb-1">
                        Type <code className="px-1 py-0.5 bg-red-100 dark:bg-red-900/40 rounded">DELETE MY ACCOUNT</code> to confirm
                      </label>
                      <input type="text" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="DELETE MY ACCOUNT" className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-red-700 dark:text-red-400 mb-1">Current Password (if set)</label>
                      <input type="password" value={deletePwd} onChange={(e) => setDeletePwd(e.target.value)} placeholder="Leave blank for Google-only accounts" className={inputClass} />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleDeleteAccount}
                        disabled={deleting || deleteConfirm !== 'DELETE MY ACCOUNT'}
                        className={buttonDanger}
                      >
                        {deleting ? 'Deleting...' : 'Permanently Delete Account'}
                      </button>
                      <button
                        onClick={() => { setShowDeleteDialog(false); setDeleteConfirm(''); setDeletePwd(''); }}
                        disabled={deleting}
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium text-sm rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </Section>
          </div>
        )}

      </div>
    </div>
  );
}
