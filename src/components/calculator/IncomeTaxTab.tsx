import { cn } from '../../lib/utils';
import type { AgeCategory } from '../../types';
import { RegimeComparison } from './RegimeComparison';
import { useTaxCalculator } from '../../contexts/TaxCalculatorContext';

type FY = '2025-26' | '2024-25';

const AGE_OPTIONS: { value: AgeCategory; label: string }[] = [
  { value: 'below60', label: 'Below 60' },
  { value: 'senior60to80', label: 'Senior (60–80)' },
  { value: 'superSenior80plus', label: 'Super Senior (80+)' },
];

function NumberInput({
  label,
  value,
  onChange,
  placeholder = '0',
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{hint}</p>}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">₹</span>
        <input
          type="number"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}

export function IncomeTaxTab() {
  const {
    fy, setFy,
    grossSalary, setGrossSalary,
    otherIncome, setOtherIncome,
    ageCategory, setAgeCategory,
    showDeductions, setShowDeductions,
    deductions, setDeductions,
    showHRA, setShowHRA,
    hra, setHra,
    oldResult, newResult,
  } = useTaxCalculator();

  return (
    <div className="max-w-3xl">
      {/* FY + Age selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Financial Year</p>
          <div className="flex gap-3">
            {(['2025-26', '2024-25'] as FY[]).map((f) => (
              <label key={f} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="fy"
                  value={f}
                  checked={fy === f}
                  onChange={() => setFy(f)}
                  className="accent-blue-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">FY {f}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Age Category</p>
          <div className="flex flex-col gap-1">
            {AGE_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ageCategory"
                  value={opt.value}
                  checked={ageCategory === opt.value}
                  onChange={() => setAgeCategory(opt.value)}
                  className="accent-blue-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Income fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <NumberInput
          label="Gross Annual Salary (₹)"
          value={grossSalary}
          onChange={setGrossSalary}
        />
        <NumberInput
          label="Other Income (₹)"
          value={otherIncome}
          onChange={setOtherIncome}
          hint="Interest, rental income, etc."
        />
      </div>

      {/* Old Regime Deductions (expandable) */}
      <div className="mb-4 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowDeductions(!showDeductions)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800/60 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors"
        >
          <span>Old Regime Deductions</span>
          <span className={cn('transition-transform', showDeductions && 'rotate-180')}>▼</span>
        </button>
        {showDeductions && (
          <div className="p-4 bg-white dark:bg-gray-800 grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Section 80C"
              value={deductions.section80C}
              onChange={(v) => setDeductions((d) => ({ ...d, section80C: v }))}
              hint="Max ₹1.5L (EPF, PPF, ELSS, etc.)"
            />
            <NumberInput
              label="80D — Health Insurance (Self)"
              value={deductions.section80D_self}
              onChange={(v) => setDeductions((d) => ({ ...d, section80D_self: v }))}
            />
            <NumberInput
              label="80D — Health Insurance (Parents)"
              value={deductions.section80D_parents}
              onChange={(v) => setDeductions((d) => ({ ...d, section80D_parents: v }))}
            />
            <NumberInput
              label="Section 80CCD(1B) — NPS"
              value={deductions.section80CCD1B}
              onChange={(v) => setDeductions((d) => ({ ...d, section80CCD1B: v }))}
              hint="Max ₹50K additional NPS"
            />
            <label className="flex items-center gap-2 cursor-pointer col-span-full">
              <input
                type="checkbox"
                checked={deductions.isSelfSenior}
                onChange={(e) => setDeductions((d) => ({ ...d, isSelfSenior: e.target.checked }))}
                className="accent-blue-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">I am a senior citizen (affects 80D self limit)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer col-span-full">
              <input
                type="checkbox"
                checked={deductions.isParentsSenior}
                onChange={(e) => setDeductions((d) => ({ ...d, isParentsSenior: e.target.checked }))}
                className="accent-blue-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Parents are senior citizens (affects 80D parents limit)</span>
            </label>
          </div>
        )}
      </div>

      {/* HRA Exemption (expandable) */}
      <div className="mb-6 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowHRA(!showHRA)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800/60 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors"
        >
          <span>HRA Exemption (Old Regime only)</span>
          <span className={cn('transition-transform', showHRA && 'rotate-180')}>▼</span>
        </button>
        {showHRA && (
          <div className="p-4 bg-white dark:bg-gray-800 grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Actual HRA Received (₹)"
              value={hra.actualHRA}
              onChange={(v) => setHra((h) => ({ ...h, actualHRA: v }))}
            />
            <NumberInput
              label="Basic + DA (₹)"
              value={hra.basicPlusDa}
              onChange={(v) => setHra((h) => ({ ...h, basicPlusDa: v }))}
              hint="HRA is calculated on Basic+DA, not gross salary"
            />
            <NumberInput
              label="Annual Rent Paid (₹)"
              value={hra.rentPaid}
              onChange={(v) => setHra((h) => ({ ...h, rentPaid: v }))}
            />
            <label className="flex items-center gap-2 cursor-pointer self-center">
              <input
                type="checkbox"
                checked={hra.isMetroCity}
                onChange={(e) => setHra((h) => ({ ...h, isMetroCity: e.target.checked }))}
                className="accent-blue-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Metro city (Mumbai, Delhi, Kolkata, Chennai)</span>
            </label>
          </div>
        )}
      </div>

      {/* Results */}
      <RegimeComparison
        oldResult={oldResult}
        newResult={newResult}
        fy={fy}
      />
    </div>
  );
}
