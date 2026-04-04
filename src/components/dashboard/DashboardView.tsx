import { useTaxCalculator } from '../../contexts/TaxCalculatorContext';
import { TaxWaterfallChart } from './TaxWaterfallChart';
import { TaxSummaryCards } from './TaxSummaryCards';
import { RegimeComparison } from '../calculator/RegimeComparison';

export function DashboardView() {
  const { grossSalary, oldResult, newResult, fy } = useTaxCalculator();

  const betterResult = newResult.totalTax <= oldResult.totalTax ? newResult : oldResult;
  const betterLabel = newResult.totalTax <= oldResult.totalTax ? 'New Regime' : 'Old Regime';

  if (!grossSalary || Number(grossSalary) === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500 p-8">
        <p className="text-4xl">📊</p>
        <p className="text-base font-medium text-slate-600 dark:text-slate-300">No data yet</p>
        <p className="text-sm text-center max-w-xs">
          Enter your gross income in the <strong>Calculator</strong> tab to see your personalised tax dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Tax Dashboard</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Based on {betterLabel} — FY {fy}
          </p>
        </div>

        <TaxSummaryCards result={betterResult} regimeLabel={betterLabel} />

        <TaxWaterfallChart result={betterResult} />

        {/* VIZ-04: RegimeComparison already implements full slab-by-slab table — reuse, do not rebuild */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Regime Comparison</h3>
          <RegimeComparison oldResult={oldResult} newResult={newResult} fy={fy} />
        </div>
      </div>
    </div>
  );
}
