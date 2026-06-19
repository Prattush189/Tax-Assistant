import { useState } from 'react';
import { FileText, Plus, X } from 'lucide-react';
import {
  generateSalarySlip,
  sumLineItems,
  type SalarySlipInput,
  type PayslipLineItem,
} from '../../lib/salarySlipPdf';

const MONTH_OPTIONS = [
  { value: 4, label: 'April' }, { value: 5, label: 'May' }, { value: 6, label: 'June' },
  { value: 7, label: 'July' }, { value: 8, label: 'August' }, { value: 9, label: 'September' },
  { value: 10, label: 'October' }, { value: 11, label: 'November' }, { value: 12, label: 'December' },
  { value: 1, label: 'January' }, { value: 2, label: 'February' }, { value: 3, label: 'March' },
];

// Default earnings / deductions heads — the standard Indian payslip
// structure. The user edits amounts and can add / remove rows.
const DEFAULT_EARNINGS: PayslipLineItem[] = [
  { label: 'Basic', amount: 0 },
  { label: 'House Rent Allowance', amount: 0 },
  { label: 'Conveyance Allowance', amount: 0 },
  { label: 'Special Allowance', amount: 0 },
];
const DEFAULT_DEDUCTIONS: PayslipLineItem[] = [
  { label: 'Provident Fund (EPF)', amount: 0 },
  { label: 'Professional Tax', amount: 0 },
  { label: 'TDS', amount: 0 },
];

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export function SalarySlipTab() {
  const [form, setForm] = useState({
    companyName: '',
    companyAddress: '',
    month: 4,
    year: 2025,
    employeeName: '',
    employeeId: '',
    designation: '',
    department: '',
    pan: '',
    bankAccount: '',
    paidDays: '',
    lopDays: '',
  });
  const [earnings, setEarnings] = useState<PayslipLineItem[]>(DEFAULT_EARNINGS);
  const [deductions, setDeductions] = useState<PayslipLineItem[]>(DEFAULT_DEDUCTIONS);

  const patch = (p: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...p }));

  const gross = sumLineItems(earnings);
  const totalDed = sumLineItems(deductions);
  const net = gross - totalDed;

  const canGenerate =
    form.companyName.trim().length > 0 &&
    form.employeeName.trim().length > 0 &&
    gross > 0;

  const setLine = (
    list: PayslipLineItem[],
    setList: (v: PayslipLineItem[]) => void,
    idx: number,
    patchItem: Partial<PayslipLineItem>,
  ) => {
    setList(list.map((it, i) => (i === idx ? { ...it, ...patchItem } : it)));
  };
  const addLine = (
    list: PayslipLineItem[],
    setList: (v: PayslipLineItem[]) => void,
  ) => setList([...list, { label: '', amount: 0 }]);
  const removeLine = (
    list: PayslipLineItem[],
    setList: (v: PayslipLineItem[]) => void,
    idx: number,
  ) => setList(list.filter((_, i) => i !== idx));

  const handleGenerate = () => {
    const input: SalarySlipInput = {
      companyName: form.companyName.trim(),
      companyAddress: form.companyAddress.trim() || undefined,
      month: form.month,
      year: form.year,
      employeeName: form.employeeName.trim(),
      employeeId: form.employeeId.trim() || undefined,
      designation: form.designation.trim() || undefined,
      department: form.department.trim() || undefined,
      pan: form.pan.trim() || undefined,
      bankAccount: form.bankAccount.trim() || undefined,
      paidDays: form.paidDays.trim() ? Number(form.paidDays) : undefined,
      lopDays: form.lopDays.trim() ? Number(form.lopDays) : undefined,
      // Drop fully-blank rows (no label and zero amount).
      earnings: earnings.filter((e) => e.label.trim() || (Number(e.amount) || 0) !== 0),
      deductions: deductions.filter((d) => d.label.trim() || (Number(d.amount) || 0) !== 0),
    };
    generateSalarySlip(input);
  };

  const inputCls =
    'w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-gray-900 dark:text-gray-100';
  const labelCls =
    'block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1';

  const LineTable = ({
    title,
    list,
    setList,
    accent,
  }: {
    title: string;
    list: PayslipLineItem[];
    setList: (v: PayslipLineItem[]) => void;
    accent: 'emerald' | 'rose';
  }) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">{title}</h4>
        <button
          type="button"
          onClick={() => addLine(list, setList)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
        >
          <Plus className="w-3 h-3" /> Add row
        </button>
      </div>
      <div className="space-y-1.5">
        {list.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              value={item.label}
              onChange={(e) => setLine(list, setList, idx, { label: e.target.value })}
              className={inputCls + ' flex-1'}
              placeholder="Component"
            />
            <div className="relative w-32">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">₹</span>
              <input
                type="number"
                value={item.amount === 0 ? '' : item.amount}
                onChange={(e) => setLine(list, setList, idx, { amount: Number(e.target.value) || 0 })}
                className={inputCls + ' pl-6 text-right'}
                placeholder="0"
              />
            </div>
            <button
              type="button"
              onClick={() => removeLine(list, setList, idx)}
              className="p-1.5 text-gray-400 hover:text-rose-500 transition-colors"
              aria-label="Remove row"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      <div className={`flex items-center justify-between px-1 pt-1 text-sm font-semibold ${accent === 'emerald' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
        <span>{title === 'Earnings' ? 'Gross earnings' : 'Total deductions'}</span>
        <span className="tabular-nums">{inr(sumLineItems(list))}</span>
      </div>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
          <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Salary Slip Generator</h2>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">Generate a monthly payslip PDF with earnings, deductions, and net pay</p>
        </div>
      </div>

      {/* Employer + period + employee details */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Company name <span className="text-red-500">*</span></label>
            <input value={form.companyName} onChange={(e) => patch({ companyName: e.target.value })} className={inputCls} placeholder="Acme Technologies Pvt Ltd" />
          </div>
          <div>
            <label className={labelCls}>Company address</label>
            <input value={form.companyAddress} onChange={(e) => patch({ companyAddress: e.target.value })} className={inputCls} placeholder="Registered office address" />
          </div>
          <div>
            <label className={labelCls}>Pay month</label>
            <select value={form.month} onChange={(e) => patch({ month: Number(e.target.value) })} className={inputCls}>
              {MONTH_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Pay year</label>
            <select value={form.year} onChange={(e) => patch({ year: Number(e.target.value) })} className={inputCls}>
              {[2023, 2024, 2025, 2026].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Employee name <span className="text-red-500">*</span></label>
            <input value={form.employeeName} onChange={(e) => patch({ employeeName: e.target.value })} className={inputCls} placeholder="Employee full name" />
          </div>
          <div>
            <label className={labelCls}>Employee ID</label>
            <input value={form.employeeId} onChange={(e) => patch({ employeeId: e.target.value })} className={inputCls} placeholder="EMP-001" />
          </div>
          <div>
            <label className={labelCls}>Designation</label>
            <input value={form.designation} onChange={(e) => patch({ designation: e.target.value })} className={inputCls} placeholder="Software Engineer" />
          </div>
          <div>
            <label className={labelCls}>Department</label>
            <input value={form.department} onChange={(e) => patch({ department: e.target.value })} className={inputCls} placeholder="Engineering" />
          </div>
          <div>
            <label className={labelCls}>PAN</label>
            <input value={form.pan} onChange={(e) => patch({ pan: e.target.value.toUpperCase() })} maxLength={10} className={inputCls + ' font-mono tracking-wider'} placeholder="ABCDE1234F" />
          </div>
          <div>
            <label className={labelCls}>Bank A/C</label>
            <input value={form.bankAccount} onChange={(e) => patch({ bankAccount: e.target.value })} className={inputCls} placeholder="XXXXXXXX1234" />
          </div>
          <div>
            <label className={labelCls}>Paid days</label>
            <input type="number" value={form.paidDays} onChange={(e) => patch({ paidDays: e.target.value })} className={inputCls} placeholder="30" />
          </div>
          <div>
            <label className={labelCls}>LOP days</label>
            <input type="number" value={form.lopDays} onChange={(e) => patch({ lopDays: e.target.value })} className={inputCls} placeholder="0" />
          </div>
        </div>
      </div>

      {/* Earnings + deductions */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
        <LineTable title="Earnings" list={earnings} setList={setEarnings} accent="emerald" />
        <LineTable title="Deductions" list={deductions} setList={setDeductions} accent="rose" />
      </div>

      {/* Net pay summary + generate */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <div className="flex items-center justify-between rounded-xl bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">Net pay</span>
          <span className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{inr(net)}</span>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Gross {inr(gross)} − deductions {inr(totalDed)}. Net pay must be positive to generate.
        </p>
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
          Generate Salary Slip PDF
        </button>
      </div>
    </div>
  );
}
