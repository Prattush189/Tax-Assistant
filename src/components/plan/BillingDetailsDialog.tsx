import { useEffect, useState } from 'react';
import { X, MapPin, Building2, Loader2 } from 'lucide-react';
import { fetchBillingDetails, saveBillingDetails, type BillingDetails } from '../../services/api';
import { cn } from '../../lib/utils';

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan',
  'Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Andaman & Nicobar Islands','Chandigarh','Dadra & Nagar Haveli and Daman & Diu',
  'Delhi','Jammu & Kashmir','Ladakh','Lakshadweep','Puducherry',
];

const inputCls = "w-full px-3 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0D9668]/30 focus:border-[#0D9668] text-gray-800 dark:text-gray-100 text-sm placeholder:text-gray-400";
const labelCls = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";

interface Props {
  planName: string;
  userEmail: string;
  onConfirm: (details: BillingDetails) => void;
  onCancel: () => void;
}

export function BillingDetailsDialog({ planName, userEmail, onConfirm, onCancel }: Props) {
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [form, setForm] = useState<BillingDetails>({
    name: '', addressLine1: '', addressLine2: '', city: '', state: '', pincode: '', gstin: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof BillingDetails, string>>>({});

  useEffect(() => {
    fetchBillingDetails()
      .then(({ billingDetails }) => {
        if (billingDetails) {
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

  const set = (field: keyof BillingDetails) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(f => ({ ...f, [field]: e.target.value }));
    if (errors[field]) setErrors(e => ({ ...e, [field]: undefined }));
  };

  const validate = (): boolean => {
    const errs: Partial<Record<keyof BillingDetails, string>> = {};
    if (!form.name.trim())         errs.name         = 'Name is required';
    if (!form.addressLine1.trim()) errs.addressLine1 = 'Address is required';
    if (!form.city.trim())         errs.city         = 'City is required';
    if (!form.state.trim())        errs.state        = 'State is required';
    if (!form.pincode.trim())      errs.pincode      = 'Pincode is required';
    else if (!/^\d{6}$/.test(form.pincode.trim())) errs.pincode = 'Enter a valid 6-digit pincode';
    if (form.gstin?.trim() && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(form.gstin.trim().toUpperCase())) {
      errs.gstin = 'Invalid GSTIN format';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const details: BillingDetails = {
        name:         form.name.trim(),
        addressLine1: form.addressLine1.trim(),
        addressLine2: form.addressLine2?.trim() || undefined,
        city:         form.city.trim(),
        state:        form.state.trim(),
        pincode:      form.pincode.trim(),
        gstin:        form.gstin?.trim().toUpperCase() || undefined,
      };
      await saveBillingDetails(details);
      onConfirm(details);
    } catch (err) {
      console.error('Failed to save billing details:', err);
      // Still proceed — billing details save failure shouldn't block payment
      const details: BillingDetails = {
        name: form.name.trim(), addressLine1: form.addressLine1.trim(),
        addressLine2: form.addressLine2?.trim() || undefined,
        city: form.city.trim(), state: form.state.trim(), pincode: form.pincode.trim(),
        gstin: form.gstin?.trim().toUpperCase() || undefined,
      };
      onConfirm(details);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#0D9668]/10 dark:bg-[#0D9668]/20 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-[#0D9668] dark:text-[#2DD4A0]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-800 dark:text-white">Billing Details</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">For your {planName} plan invoice</p>
            </div>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-[#0D9668]" />
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Email (read-only) */}
            <div>
              <label className={labelCls}>Email (for invoice)</label>
              <input type="email" value={userEmail} disabled
                className={cn(inputCls, 'opacity-60 cursor-not-allowed')} />
            </div>

            {/* Name */}
            <div>
              <label className={labelCls}>Full Name / Business Name <span className="text-red-500">*</span></label>
              <input type="text" value={form.name} onChange={set('name')}
                placeholder="As it should appear on invoice" className={inputCls} maxLength={100} />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
            </div>

            {/* Address Line 1 */}
            <div>
              <label className={labelCls}>Address Line 1 <span className="text-red-500">*</span></label>
              <input type="text" value={form.addressLine1} onChange={set('addressLine1')}
                placeholder="Street address, flat/house no." className={inputCls} maxLength={120} />
              {errors.addressLine1 && <p className="text-xs text-red-500 mt-1">{errors.addressLine1}</p>}
            </div>

            {/* Address Line 2 */}
            <div>
              <label className={labelCls}>Address Line 2 <span className="text-gray-400">(optional)</span></label>
              <input type="text" value={form.addressLine2} onChange={set('addressLine2')}
                placeholder="Area, landmark" className={inputCls} maxLength={120} />
            </div>

            {/* City + State */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>City <span className="text-red-500">*</span></label>
                <input type="text" value={form.city} onChange={set('city')}
                  placeholder="City" className={inputCls} maxLength={60} />
                {errors.city && <p className="text-xs text-red-500 mt-1">{errors.city}</p>}
              </div>
              <div>
                <label className={labelCls}>State <span className="text-red-500">*</span></label>
                <select value={form.state} onChange={set('state')} className={inputCls}>
                  <option value="">Select state</option>
                  {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {errors.state && <p className="text-xs text-red-500 mt-1">{errors.state}</p>}
              </div>
            </div>

            {/* Pincode + GSTIN */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Pincode <span className="text-red-500">*</span></label>
                <input type="text" value={form.pincode} onChange={set('pincode')}
                  placeholder="6-digit pincode" className={inputCls} maxLength={6} />
                {errors.pincode && <p className="text-xs text-red-500 mt-1">{errors.pincode}</p>}
              </div>
              <div>
                <label className={labelCls}>
                  <span className="flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> GSTIN
                    <span className="text-gray-400">(optional)</span>
                  </span>
                </label>
                <input type="text" value={form.gstin} onChange={set('gstin')}
                  placeholder="For businesses claiming ITC"
                  className={cn(inputCls, 'uppercase')} maxLength={15} />
                {errors.gstin && <p className="text-xs text-red-500 mt-1">{errors.gstin}</p>}
              </div>
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-500">
              These details will appear on your invoice and be saved for future billing.
            </p>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button onClick={onCancel}
                className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={saving}
                className="flex-1 py-2.5 bg-[#0D9668] hover:bg-[#0A7B55] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : 'Proceed to Payment'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
