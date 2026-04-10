import { useState, useMemo } from 'react';
import { cn } from '../../lib/utils';
import { formatINR } from '../../lib/utils';
import { calculateAdvanceTax } from '../../lib/advanceTaxEngine';
import { SUPPORTED_FY } from '../../data/taxRules';

function NumberInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
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
          placeholder="0"
          className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}

export function AdvanceTaxTab() {
  const [fy, setFy] = useState<string>(SUPPORTED_FY[0]);
  const [estimatedIncome, setEstimatedIncome] = useState('');
  const [tdsDeducted, setTdsDeducted] = useState('');
  const [selfAssessment, setSelfAssessment] = useState('');

  const result = useMemo(() => {
    const income = Number(estimatedIncome) || 0;
    if (income <= 0) return null;

    return calculateAdvanceTax({
      estimatedAnnualIncome: income,
      tdsAlreadyDeducted: Number(tdsDeducted) || 0,
      selfAssessmentPaid: Number(selfAssessment) || 0,
      fy,
    });
  }, [fy, estimatedIncome, tdsDeducted, selfAssessment]);

  return (
    <div className="max-w-2xl">
      {/* FY selector */}
      <div className="mb-5">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Financial Year</p>
        <div className="flex gap-3">
          {SUPPORTED_FY.map((f) => (
            <label key={f} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="adv-fy"
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

      {/* Income inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <NumberInput
          label="Estimated Annual Income (₹)"
          value={estimatedIncome}
          onChange={setEstimatedIncome}
          hint="Total expected income for the FY"
        />
        <NumberInput
          label="TDS Already Deducted (₹)"
          value={tdsDeducted}
          onChange={setTdsDeducted}
          hint="Tax deducted at source so far"
        />
      </div>

      <div className="mb-5">
        <NumberInput
          label="Self Assessment Tax Paid (₹)"
          value={selfAssessment}
          onChange={setSelfAssessment}
          hint="Any self-assessment tax already paid"
        />
      </div>

      {/* Summary card */}
      {result && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 p-5 mb-5">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Tax Summary
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Total Tax Liability</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">{formatINR(result.totalTaxLiability)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Less: TDS Credit</span>
              <span className="text-green-600 dark:text-green-400">- {formatINR(result.totalTdsCredit)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Less: Self Assessment</span>
              <span className="text-green-600 dark:text-green-400">- {formatINR(Number(selfAssessment) || 0)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-100 dark:border-gray-700 pt-2 mt-2">
              <span className="text-gray-700 dark:text-gray-200 font-semibold">Net Tax Payable</span>
              <span className="font-bold text-gray-800 dark:text-gray-100">{formatINR(result.netTaxPayable)}</span>
            </div>
            <div className="flex justify-center mt-3">
              <span
                className={cn(
                  'px-3 py-1 rounded-full text-sm font-semibold',
                  result.advanceTaxRequired
                    ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                    : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
                )}
              >
                {result.advanceTaxRequired ? 'Advance tax required' : 'Advance tax not required'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Quarterly installment table */}
      {result && result.advanceTaxRequired && result.installments.length > 0 && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 p-5 mb-5">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Quarterly Installments
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">Quarter</th>
                  <th className="text-left py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">Due Date</th>
                  <th className="text-right py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">Cumulative %</th>
                  <th className="text-right py-2 text-gray-500 dark:text-gray-400 font-medium">Amount Due</th>
                </tr>
              </thead>
              <tbody>
                {result.installments.map((inst, i) => (
                  <tr key={i} className="border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">Q{i + 1}</td>
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{inst.dueDate}</td>
                    <td className="py-2 pr-4 text-right text-gray-700 dark:text-gray-300">{inst.cumulativePercent}%</td>
                    <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-100">{formatINR(inst.installmentAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Interest section */}
      {result && result.advanceTaxRequired && (result.interest234B > 0 || result.interest234C > 0) && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 p-5 mb-5">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Interest (if no advance tax paid)
          </p>
          <div className="space-y-2 text-sm">
            {result.interest234B > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Section 234B (default in payment)</span>
                <span className="font-medium text-red-600 dark:text-red-400">{formatINR(result.interest234B)}</span>
              </div>
            )}
            {result.interest234C > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Section 234C (deferral of installments)</span>
                <span className="font-medium text-red-600 dark:text-red-400">{formatINR(result.interest234C)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Info note */}
      <div className="mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300">
        Note: Advance tax is computed using New Regime slab rates. Interest amounts shown assume zero advance tax payments — actual interest depends on when payments are made.
      </div>
    </div>
  );
}
