import { useState, useMemo } from 'react';
import { optimizeSalary } from '../../lib/salaryOptimizer';
import { SUPPORTED_FY } from '../../data/taxRules';
import { cn } from '../../lib/utils';

function formatINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

export function SalaryOptimizerTab() {
  const [fy, setFy] = useState<string>(SUPPORTED_FY[0]);
  const [ctc, setCtc] = useState('');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [isMetro, setIsMetro] = useState(true);

  const result = useMemo(() => {
    const c = parseFloat(ctc) || 0;
    const r = parseFloat(monthlyRent) || 0;
    if (c <= 0) return null;
    return optimizeSalary({ ctc: c, isMetroCity: isMetro, monthlyRent: r, fy });
  }, [fy, ctc, monthlyRent, isMetro]);

  const inputClass = "w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* FY Selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Financial Year</label>
        <div className="flex gap-3">
          {SUPPORTED_FY.map(f => (
            <label key={f} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="fy" value={f} checked={fy === f} onChange={() => setFy(f)} className="accent-blue-600" />
              <span className="text-sm text-gray-700 dark:text-gray-300">FY {f}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Annual CTC</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
            <input type="number" min="0" value={ctc} onChange={e => setCtc(e.target.value)} placeholder="e.g., 1500000" className={inputClass} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monthly Rent Paid</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
            <input type="number" min="0" value={monthlyRent} onChange={e => setMonthlyRent(e.target.value)} placeholder="e.g., 25000" className={inputClass} />
          </div>
        </div>
      </div>

      {/* Metro toggle */}
      <div className="flex gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" name="city" checked={isMetro} onChange={() => setIsMetro(true)} className="accent-blue-600" />
          <span className="text-sm text-gray-700 dark:text-gray-300">Metro city</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" name="city" checked={!isMetro} onChange={() => setIsMetro(false)} className="accent-blue-600" />
          <span className="text-sm text-gray-700 dark:text-gray-300">Non-metro</span>
        </label>
      </div>

      {/* Results */}
      {result && result.annualSavings > 0 && (
        <div className="space-y-4">
          {/* Savings banner */}
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 text-center">
            <p className="text-sm text-green-600 dark:text-green-400">Optimized structure saves</p>
            <p className="text-2xl font-bold text-green-700 dark:text-green-300">{formatINR(result.annualSavings)}/year</p>
          </div>

          {/* Side-by-side comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Current */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3">Current Structure</h4>
              {[
                ['Basic', result.currentBreakdown.basic],
                ['HRA', result.currentBreakdown.hra],
                ['Special Allowance', result.currentBreakdown.specialAllowance],
                ['Employer NPS', result.currentBreakdown.npsEmployer],
              ].map(([label, val]) => (
                <div key={label as string} className="flex justify-between text-xs py-1">
                  <span className="text-gray-500 dark:text-gray-400">{label}</span>
                  <span className="text-gray-800 dark:text-gray-200">{formatINR(val as number)}</span>
                </div>
              ))}
              <div className="border-t border-gray-100 dark:border-gray-700 mt-2 pt-2 flex justify-between text-sm font-semibold">
                <span>Tax</span>
                <span className="text-red-600 dark:text-red-400">{formatINR(result.currentTax.totalTax)}</span>
              </div>
            </div>

            {/* Optimized */}
            <div className="border border-blue-300 dark:border-blue-600 ring-2 ring-blue-500/20 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-blue-600 dark:text-blue-400">Optimized Structure</h4>
                <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">Recommended</span>
              </div>
              {[
                ['Basic', result.optimizedBreakdown.basic],
                ['HRA', result.optimizedBreakdown.hra],
                ['Special Allowance', result.optimizedBreakdown.specialAllowance],
                ['Employer NPS', result.optimizedBreakdown.npsEmployer],
              ].map(([label, val]) => (
                <div key={label as string} className="flex justify-between text-xs py-1">
                  <span className="text-gray-500 dark:text-gray-400">{label}</span>
                  <span className="text-gray-800 dark:text-gray-200">{formatINR(val as number)}</span>
                </div>
              ))}
              <div className="border-t border-blue-100 dark:border-blue-800 mt-2 pt-2 flex justify-between text-sm font-semibold">
                <span>Tax</span>
                <span className="text-green-600 dark:text-green-400">{formatINR(result.optimizedTax.totalTax)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {result && result.annualSavings <= 0 && (
        <div className="bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center text-sm text-gray-500">
          Your current salary structure is already optimal. No further optimization possible.
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500">
        This optimizer uses old regime calculations. Consult a CA for personalized restructuring advice.
      </p>
    </div>
  );
}
