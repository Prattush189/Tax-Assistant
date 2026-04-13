import { useState } from 'react';
import { FileText } from 'lucide-react';
import { generateRentReceipts, RentReceiptInput } from '../../lib/rentReceiptPdf';

const MONTH_OPTIONS = [
  { value: 4, label: 'April' }, { value: 5, label: 'May' }, { value: 6, label: 'June' },
  { value: 7, label: 'July' }, { value: 8, label: 'August' }, { value: 9, label: 'September' },
  { value: 10, label: 'October' }, { value: 11, label: 'November' }, { value: 12, label: 'December' },
  { value: 1, label: 'January' }, { value: 2, label: 'February' }, { value: 3, label: 'March' },
];

export function RentReceiptTab() {
  const [form, setForm] = useState({
    tenantName: '',
    landlordName: '',
    landlordPan: '',
    propertyAddress: '',
    monthlyRent: '',
    fromMonth: 4,
    fromYear: 2024,
    toMonth: 3,
    toYear: 2025,
  });

  const patch = (p: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...p }));

  const canGenerate = form.tenantName.trim().length > 0 &&
    form.landlordName.trim().length > 0 &&
    form.propertyAddress.trim().length > 0 &&
    Number(form.monthlyRent) > 0;

  const handleGenerate = () => {
    const input: RentReceiptInput = {
      tenantName: form.tenantName.trim(),
      landlordName: form.landlordName.trim(),
      landlordPan: form.landlordPan.trim() || undefined,
      propertyAddress: form.propertyAddress.trim(),
      monthlyRent: Number(form.monthlyRent) || 0,
      fromMonth: form.fromMonth,
      fromYear: form.fromYear,
      toMonth: form.toMonth,
      toYear: form.toYear,
    };
    generateRentReceipts(input);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
          <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Rent Receipt Generator</h2>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">Generate monthly rent receipts for HRA claims</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              Tenant name <span className="text-red-500">*</span>
            </label>
            <input
              value={form.tenantName}
              onChange={(e) => patch({ tenantName: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-gray-900 dark:text-gray-100"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              Landlord name <span className="text-red-500">*</span>
            </label>
            <input
              value={form.landlordName}
              onChange={(e) => patch({ landlordName: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-gray-900 dark:text-gray-100"
              placeholder="Landlord full name"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              Landlord PAN
            </label>
            <input
              value={form.landlordPan}
              onChange={(e) => patch({ landlordPan: e.target.value.toUpperCase() })}
              maxLength={10}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-gray-900 dark:text-gray-100 font-mono tracking-wider"
              placeholder="ABCDE1234F"
            />
            <p className="text-[10px] text-gray-400 mt-0.5">Required if annual rent exceeds ₹1,00,000</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              Monthly rent <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
              <input
                type="number"
                value={form.monthlyRent}
                onChange={(e) => patch({ monthlyRent: e.target.value })}
                className="w-full pl-7 pr-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-gray-900 dark:text-gray-100"
                placeholder="15000"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
            Property address <span className="text-red-500">*</span>
          </label>
          <textarea
            value={form.propertyAddress}
            onChange={(e) => patch({ propertyAddress: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-gray-900 dark:text-gray-100 resize-y"
            placeholder="Flat 4B, Sunrise Heights, MG Road, Powai, Mumbai 400076"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">From month</label>
            <select value={form.fromMonth} onChange={(e) => patch({ fromMonth: Number(e.target.value) })}
              className="w-full px-2 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
              {MONTH_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">From year</label>
            <select value={form.fromYear} onChange={(e) => patch({ fromYear: Number(e.target.value) })}
              className="w-full px-2 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
              {[2023, 2024, 2025, 2026].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">To month</label>
            <select value={form.toMonth} onChange={(e) => patch({ toMonth: Number(e.target.value) })}
              className="w-full px-2 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
              {MONTH_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">To year</label>
            <select value={form.toYear} onChange={(e) => patch({ toYear: Number(e.target.value) })}
              className="w-full px-2 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
              {[2023, 2024, 2025, 2026].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
            canGenerate
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
          }`}
        >
          <FileText className="w-4 h-4" />
          Generate Rent Receipts PDF
        </button>
      </div>
    </div>
  );
}
