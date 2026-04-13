import { cn, formatINR } from '../../lib/utils';
import { Download, FileBarChart } from 'lucide-react';
import { exportTaxComputationPDF } from '../../lib/pdfExport';
import { generateTaxPlanningReport } from '../../lib/taxPlanningReport';
import { useAuth } from '../../contexts/AuthContext';
import type { IncomeTaxResult } from '../../lib/taxEngine';

import type { TaxpayerCategory } from '../../types';

interface RegimeComparisonProps {
  oldResult: IncomeTaxResult;
  newResult: IncomeTaxResult;
  fy: string;
  taxpayerCategory?: TaxpayerCategory;
}

interface RegimeCardProps {
  label: string;
  result: IncomeTaxResult;
  isWinner: boolean;
  showOldOnlyFields: boolean;
  fy: string;
}

function RegimeCard({ label, result, isWinner, showOldOnlyFields, fy }: RegimeCardProps) {
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

      {/* Prominent total-tax banner */}
      <div className="mb-4 pb-3 border-b border-gray-100 dark:border-gray-700">
        <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Total tax for FY {fy}
        </div>
        <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-0.5">
          {formatINR(result.totalTax)}
        </div>
        <div className="mt-1 flex gap-4 text-xs text-gray-500 dark:text-gray-400">
          <span>
            Effective{' '}
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {result.effectiveRate.toFixed(2)}%
            </span>
          </span>
          <span>
            Marginal{' '}
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {(result.marginalRate * 100).toFixed(0)}%
            </span>
          </span>
        </div>
      </div>

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
      </div>
    </div>
  );
}

export function RegimeComparison({ oldResult, newResult, fy, taxpayerCategory = 'Individual' }: RegimeComparisonProps) {
  const isFlatRate = taxpayerCategory === 'Firm' || taxpayerCategory === 'Company';
  const { user } = useAuth();
  const savings = Math.abs(newResult.totalTax - oldResult.totalTax);
  const betterRegime: 'new' | 'old' =
    newResult.totalTax <= oldResult.totalTax ? 'new' : 'old';
  const isPro = (user?.plan ?? 'free') !== 'free';

  return (
    <div className="mt-6">
      {/* Recommendation banner — only for individuals/HUF */}
      {!isFlatRate && (
        savings === 0 ? (
          <div className="bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600 rounded-xl p-4 mb-4 text-gray-600 dark:text-gray-300 font-medium text-sm">
            Both regimes result in equal tax for FY {fy}.
          </div>
        ) : (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 mb-4 text-green-800 dark:text-green-300 font-medium text-sm">
            {betterRegime === 'new' ? 'New' : 'Old'} Regime saves you{' '}
            <span className="font-bold">{formatINR(savings)}</span> for FY {fy}.
          </div>
        )
      )}

      {/* Cards — single card for Firm/Company, side-by-side for Individual/HUF */}
      <div className={cn('flex flex-col gap-4', !isFlatRate && 'md:flex-row')}>
        {isFlatRate ? (
          <RegimeCard
            label={taxpayerCategory === 'Firm' ? 'Firm / LLP (Flat 30%)' : 'Company (Section 115BAA — 22%)'}
            result={newResult}
            isWinner={false}
            showOldOnlyFields={false}
            fy={fy}
          />
        ) : (
          <>
        <RegimeCard
          label="Old Regime"
          result={oldResult}
          isWinner={betterRegime === 'old'}
          showOldOnlyFields={true}
          fy={fy}
        />
        <RegimeCard
          label="New Regime"
          result={newResult}
          isWinner={betterRegime === 'new'}
          showOldOnlyFields={false}
          fy={fy}
        />
          </>
        )}
      </div>

      {/* PDF Exports */}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {isPro ? (
          <>
            <button
              onClick={() => exportTaxComputationPDF(oldResult, newResult, fy, user?.name)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-800/30 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/25 transition-all"
            >
              <Download className="w-4 h-4" />
              Tax Computation PDF
            </button>
            <button
              onClick={() => generateTaxPlanningReport(oldResult, newResult, fy, user?.name)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/15 border border-blue-200 dark:border-blue-800/30 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/25 transition-all"
            >
              <FileBarChart className="w-4 h-4" />
              Tax Planning Report
            </button>
          </>
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
