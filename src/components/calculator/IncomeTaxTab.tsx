import { useState } from 'react';
import { cn } from '../../lib/utils';
import type { AgeCategory } from '../../types';
import { RegimeComparison } from './RegimeComparison';
import { useTaxCalculator } from '../../contexts/TaxCalculatorContext';
import { LoadFromProfile } from '../profile/shared/LoadFromProfile';
import { profileToCalculator } from '../profile/lib/prefillAdapters';
import { PROFILE_AYS, ProfileAy } from '../profile/lib/profileModel';

import { SUPPORTED_FY } from '../../data/taxRules';

type FY = typeof SUPPORTED_FY[number];

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

  const [prefillAy, setPrefillAy] = useState<ProfileAy>('2025-26');

  return (
    <div className="max-w-3xl">
      {/* Profile prefill */}
      <div className="flex items-center justify-end gap-2 mb-4">
        <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">AY</label>
        <select
          value={prefillAy}
          onChange={(e) => setPrefillAy(e.target.value as ProfileAy)}
          className="px-2 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none"
        >
          {PROFILE_AYS.map((ay) => (
            <option key={ay} value={ay}>{ay}</option>
          ))}
        </select>
        <LoadFromProfile
          onPick={(profile) => {
            const p = profileToCalculator(profile, prefillAy);
            if (p.grossSalary !== undefined) setGrossSalary(p.grossSalary);
            if (p.otherIncome !== undefined) setOtherIncome(p.otherIncome);
            if (p.deductions) {
              setDeductions((prev) => ({
                ...prev,
                section80C: p.deductions?.section80C ?? prev.section80C,
                section80D_self: p.deductions?.section80D_self ?? prev.section80D_self,
                section80D_parents: p.deductions?.section80D_parents ?? prev.section80D_parents,
                section80CCD1B: p.deductions?.section80CCD1B ?? prev.section80CCD1B,
                section80E: p.deductions?.section80E ?? prev.section80E,
                section80G: p.deductions?.section80G ?? prev.section80G,
                section80TTA: p.deductions?.section80TTA ?? prev.section80TTA,
                section24b: p.deductions?.section24b ?? prev.section24b,
                section80EEB: p.deductions?.section80EEB ?? prev.section80EEB,
              }));
              setShowDeductions(true);
            }
          }}
          label="Load from profile"
          compact
        />
      </div>
      {/* FY + Age selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Financial Year</p>
          <div className="flex gap-3">
            {SUPPORTED_FY.map((f) => (
              <label key={f} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="fy"
                  value={f}
                  checked={fy === f}
                  onChange={() => setFy(f as any)}
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
            <NumberInput
              label="Section 24(b) — Home Loan Interest"
              value={deductions.section24b}
              onChange={(v) => setDeductions((d) => ({ ...d, section24b: v }))}
              hint="Max ₹2L for self-occupied"
            />
            <NumberInput
              label="Section 80E — Education Loan Interest"
              value={deductions.section80E}
              onChange={(v) => setDeductions((d) => ({ ...d, section80E: v }))}
              hint="No upper limit"
            />
            <NumberInput
              label="Section 80G — Donations"
              value={deductions.section80G}
              onChange={(v) => setDeductions((d) => ({ ...d, section80G: v }))}
              hint="50% or 100% deduction"
            />
            <NumberInput
              label="Section 80TTA — Savings Interest"
              value={deductions.section80TTA}
              onChange={(v) => setDeductions((d) => ({ ...d, section80TTA: v }))}
              hint="Max ₹10K (₹50K for seniors)"
            />
            <NumberInput
              label="Section 80EEB — EV Loan Interest"
              value={deductions.section80EEB}
              onChange={(v) => setDeductions((d) => ({ ...d, section80EEB: v }))}
              hint="Max ₹1.5L"
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
