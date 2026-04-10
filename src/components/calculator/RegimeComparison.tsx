import { cn, formatINR } from '../../lib/utils';
import { Download } from 'lucide-react';
import { exportTaxComputationPDF } from '../../lib/pdfExport';
import { useAuth } from '../../contexts/AuthContext';
import type { IncomeTaxResult } from '../../lib/taxEngine';

interface RegimeComparisonProps {
  oldResult: IncomeTaxResult;
  newResult: IncomeTaxResult;
  fy: string;
}

interface RegimeCardProps {
  label: string;
  result: IncomeTaxResult;
  isWinner: boolean;
  showOldOnlyFields: boolean;
}

function RegimeCard({ label, result, isWinner, showOldOnlyFields }: RegimeCardProps) {
  return (
    <div
      className={cn(
        'flex-1 rounded-xl border bg-white dark:bg-gray-800 p-4',
        isWinner
          ? 'border-blue-300 dark:border-blue-600 ring-2 ring-blue-500'
          : 'border-gray-200 dark:border-gray-700',
      )}
    >
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 pb-2 border-b border-gray-100 dark:border-gray-700">
        {label}
        {isWinner && (
          <span className="ml-2 text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
            Better
          </span>
        )}
      </h3>

      {/* Income breakdown */}
      <div className="space-y-1 text-xs mb-3">
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">Gross income</span>
          <span className="font-medium text-gray-700 dark:text-gray-300">{formatINR(result.grossIncome)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">Standard deduction</span>
          <span className="text-red-600 dark:text-red-400">- {formatINR(result.standardDeduction)}</span>
        </div>
        {showOldOnlyFields && result.hraExemption > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">HRA exemption</span>
            <span className="text-red-600 dark:text-red-400">- {formatINR(result.hraExemption)}</span>
          </div>
        )}
        {showOldOnlyFields && result.totalDeductions - result.standardDeduction - result.hraExemption > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Other deductions</span>
            <span className="text-red-600 dark:text-red-400">
              - {formatINR(result.totalDeductions - result.standardDeduction - result.hraExemption)}
            </span>
          </div>
        )}
        <div className="flex justify-between border-t border-gray-100 dark:border-gray-700 pt-1 mt-1">
          <span className="text-gray-600 dark:text-gray-300 font-medium">Taxable income</span>
          <span className="font-semibold text-gray-700 dark:text-gray-200">{formatINR(result.taxableIncome)}</span>
        </div>
      </div>

      {/* Slab breakdown */}
      {result.slabBreakdown.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1 font-medium uppercase tracking-wide">Slab tax</p>
          <div className="space-y-1">
            {result.slabBreakdown.map((row, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className="text-gray-500 dark:text-gray-400">{row.slab}</span>
                <span className="text-gray-700 dark:text-gray-300">{formatINR(row.tax)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rebate / marginal relief / cess / total */}
      <div className="space-y-1 text-xs border-t border-gray-100 dark:border-gray-700 pt-2">
        {result.rebate87A > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Section 87A rebate</span>
            <span className="text-green-600 dark:text-green-400">- {formatINR(result.rebate87A)}</span>
          </div>
        )}
        {result.marginalRelief > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Marginal relief</span>
            <span className="text-green-600 dark:text-green-400">- {formatINR(result.marginalRelief)}</span>
          </div>
        )}
        {result.surcharge > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Surcharge ({(result.surchargeRate * 100).toFixed(0)}%)</span>
            <span className="text-red-600 dark:text-red-400">{formatINR(result.surcharge)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">Cess (4%)</span>
          <span className="text-gray-700 dark:text-gray-300">{formatINR(result.cess)}</span>
        </div>
        <div className="flex justify-between border-t border-gray-200 dark:border-gray-600 pt-1 mt-1">
          <span className="text-gray-800 dark:text-gray-100 font-bold text-sm">Total Tax</span>
          <span className="text-gray-800 dark:text-gray-100 font-bold text-sm">{formatINR(result.totalTax)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400 dark:text-gray-500">Effective rate</span>
          <span className="text-gray-500 dark:text-gray-400">{result.effectiveRate.toFixed(2)}%</span>
        </div>
      </div>
    </div>
  );
}

export function RegimeComparison({ oldResult, newResult, fy }: RegimeComparisonProps) {
  const { user } = useAuth();
  const savings = Math.abs(newResult.totalTax - oldResult.totalTax);
  const betterRegime: 'new' | 'old' =
    newResult.totalTax <= oldResult.totalTax ? 'new' : 'old';
  const isPro = (user?.plan ?? 'free') !== 'free';

  return (
    <div className="mt-6">
      {/* Recommendation banner */}
      {savings === 0 ? (
        <div className="bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600 rounded-xl p-4 mb-4 text-gray-600 dark:text-gray-300 font-medium text-sm">
          Both regimes result in equal tax for FY {fy}.
        </div>
      ) : (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 mb-4 text-green-800 dark:text-green-300 font-medium text-sm">
          {betterRegime === 'new' ? 'New' : 'Old'} Regime saves you{' '}
          <span className="font-bold">{formatINR(savings)}</span> for FY {fy}.
        </div>
      )}

      {/* Side-by-side cards */}
      <div className="flex flex-col md:flex-row gap-4">
        <RegimeCard
          label="Old Regime"
          result={oldResult}
          isWinner={betterRegime === 'old'}
          showOldOnlyFields={true}
        />
        <RegimeCard
          label="New Regime"
          result={newResult}
          isWinner={betterRegime === 'new'}
          showOldOnlyFields={false}
        />
      </div>

      {/* PDF Export */}
      <div className="mt-4 flex justify-center">
        {isPro ? (
          <button
            onClick={() => exportTaxComputationPDF(oldResult, newResult, fy, user?.name)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-800/30 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/25 transition-all"
          >
            <Download className="w-4 h-4" />
            Download Tax Computation PDF
          </button>
        ) : (
          <div className="flex items-center gap-2 px-4 py-2 text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg cursor-not-allowed">
            <Download className="w-4 h-4" />
            PDF Export (Pro plan)
          </div>
        )}
      </div>
    </div>
  );
}
