import { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { ProfileManager } from '../../../hooks/useProfileManager';
import { PerAySlice, DeductionsSlice, PROFILE_AYS } from '../lib/profileModel';
import { Card } from '../../itr/shared/Inputs';

interface Props {
  manager: ProfileManager;
}

interface AyMetrics {
  ay: string;
  grossSalary: number;
  totalDeductions: number;
  totalTds: number;
}

function sumDeductions(d: DeductionsSlice | undefined): number {
  if (!d) return 0;
  return (
    (d.section80C ?? 0) +
    (d.section80CCC ?? 0) +
    (d.section80CCDEmployeeOrSE ?? 0) +
    (d.section80CCD1B ?? 0) +
    (d.section80CCDEmployer ?? 0) +
    (d.section80D ?? 0) +
    (d.section80DD ?? 0) +
    (d.section80DDB ?? 0) +
    (d.section80E ?? 0) +
    (d.section80EE ?? 0) +
    (d.section80EEA ?? 0) +
    (d.section80EEB ?? 0) +
    (d.section80G ?? 0) +
    (d.section80GG ?? 0) +
    (d.section80GGA ?? 0) +
    (d.section80GGC ?? 0) +
    (d.section80U ?? 0) +
    (d.section80TTA ?? 0) +
    (d.section80TTB ?? 0)
  );
}

function formatRupees(amount: number): string {
  if (amount >= 10_00_000) return `${(amount / 10_00_000).toFixed(1)}L`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K`;
  return amount.toLocaleString('en-IN');
}

function formatRupeesFull(amount: number): string {
  return amount.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function TrendsTab({ manager }: Props) {
  const perAy = manager.currentProfile?.perAy ?? {};

  const metrics: AyMetrics[] = useMemo(() => {
    const results: AyMetrics[] = [];
    for (const ay of PROFILE_AYS) {
      const slice = perAy[ay] as PerAySlice | undefined;
      if (!slice?.salary?.employers?.length) continue;

      const grossSalary = (slice.salary.employers ?? []).reduce(
        (sum, emp) => sum + (Number(emp.grossSalary) || 0),
        0,
      );
      const totalTds = (slice.salary.employers ?? []).reduce(
        (sum, emp) => sum + (Number(emp.tdsOnSalary) || 0),
        0,
      );
      const totalDeductions = sumDeductions(slice.deductions);

      results.push({ ay, grossSalary, totalDeductions, totalTds });
    }
    return results;
  }, [perAy]);

  if (metrics.length === 0) {
    return (
      <div className="space-y-4">
        <Card title="Year-over-Year Trends">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <TrendingUp className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md">
              No year-over-year data available. Fill in salary and deduction data for multiple
              assessment years to see trends.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  // Compute maximums for bar scaling
  const maxGross = Math.max(...metrics.map((m) => m.grossSalary), 1);
  const maxDeductions = Math.max(...metrics.map((m) => m.totalDeductions), 1);
  const maxTds = Math.max(...metrics.map((m) => m.totalTds), 1);

  const barColors = {
    gross: { bg: 'bg-emerald-500', light: 'bg-emerald-100 dark:bg-emerald-900/30' },
    deductions: { bg: 'bg-amber-500', light: 'bg-amber-100 dark:bg-amber-900/30' },
    tds: { bg: 'bg-blue-500', light: 'bg-blue-100 dark:bg-blue-900/30' },
  };

  return (
    <div className="space-y-4">
      {/* Visual bar chart */}
      <Card title="Comparative Filing Dashboard">
        <div className="space-y-6">
          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-xs font-medium text-gray-600 dark:text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-emerald-500" />
              Gross Salary
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-amber-500" />
              Total Deductions
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-blue-500" />
              TDS on Salary
            </span>
          </div>

          {/* Bars per AY */}
          {metrics.map((m) => (
            <div key={m.ay} className="space-y-2">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                AY {m.ay}
              </p>
              <div className="space-y-1.5">
                {/* Gross Salary */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-20 text-right shrink-0">
                    Gross Salary
                  </span>
                  <div className={`flex-1 h-5 rounded ${barColors.gross.light}`}>
                    <div
                      className={`h-full rounded ${barColors.gross.bg} transition-all duration-500`}
                      style={{ width: `${Math.max((m.grossSalary / maxGross) * 100, 2)}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300 w-16 text-right shrink-0">
                    {formatRupees(m.grossSalary)}
                  </span>
                </div>
                {/* Total Deductions */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-20 text-right shrink-0">
                    Deductions
                  </span>
                  <div className={`flex-1 h-5 rounded ${barColors.deductions.light}`}>
                    <div
                      className={`h-full rounded ${barColors.deductions.bg} transition-all duration-500`}
                      style={{ width: `${Math.max((m.totalDeductions / maxDeductions) * 100, 2)}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300 w-16 text-right shrink-0">
                    {formatRupees(m.totalDeductions)}
                  </span>
                </div>
                {/* TDS */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-20 text-right shrink-0">
                    TDS
                  </span>
                  <div className={`flex-1 h-5 rounded ${barColors.tds.light}`}>
                    <div
                      className={`h-full rounded ${barColors.tds.bg} transition-all duration-500`}
                      style={{ width: `${Math.max((m.totalTds / maxTds) * 100, 2)}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300 w-16 text-right shrink-0">
                    {formatRupees(m.totalTds)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Data table */}
      <Card title="Year-over-Year Comparison">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Metric
                </th>
                {metrics.map((m) => (
                  <th
                    key={m.ay}
                    className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                  >
                    AY {m.ay}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-300 font-medium">
                  Gross Salary
                </td>
                {metrics.map((m) => (
                  <td
                    key={m.ay}
                    className="py-2.5 px-3 text-right text-gray-900 dark:text-gray-100 tabular-nums"
                  >
                    {formatRupeesFull(m.grossSalary)}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-300 font-medium">
                  Total Deductions
                </td>
                {metrics.map((m) => (
                  <td
                    key={m.ay}
                    className="py-2.5 px-3 text-right text-gray-900 dark:text-gray-100 tabular-nums"
                  >
                    {formatRupeesFull(m.totalDeductions)}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-300 font-medium">
                  TDS on Salary
                </td>
                {metrics.map((m) => (
                  <td
                    key={m.ay}
                    className="py-2.5 px-3 text-right text-gray-900 dark:text-gray-100 tabular-nums"
                  >
                    {formatRupeesFull(m.totalTds)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-300 font-medium">
                  Net Taxable (approx)
                </td>
                {metrics.map((m) => {
                  const net = Math.max(m.grossSalary - m.totalDeductions, 0);
                  return (
                    <td
                      key={m.ay}
                      className="py-2.5 px-3 text-right font-semibold text-gray-900 dark:text-gray-100 tabular-nums"
                    >
                      {formatRupeesFull(net)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* YoY change indicators */}
      {metrics.length >= 2 && (
        <Card title="Year-over-Year Change">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(() => {
              const prev = metrics[metrics.length - 2];
              const curr = metrics[metrics.length - 1];
              const changes = [
                {
                  label: 'Gross Salary',
                  prev: prev.grossSalary,
                  curr: curr.grossSalary,
                },
                {
                  label: 'Total Deductions',
                  prev: prev.totalDeductions,
                  curr: curr.totalDeductions,
                },
                {
                  label: 'TDS on Salary',
                  prev: prev.totalTds,
                  curr: curr.totalTds,
                },
              ];
              return changes.map((c) => {
                const diff = c.curr - c.prev;
                const pct = c.prev > 0 ? ((diff / c.prev) * 100).toFixed(1) : '--';
                const isUp = diff > 0;
                const isDown = diff < 0;
                return (
                  <div
                    key={c.label}
                    className="rounded-xl border border-gray-200 dark:border-gray-700 p-3"
                  >
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                      {c.label}
                    </p>
                    <p className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                      {formatRupees(c.curr)}
                    </p>
                    <p
                      className={`text-xs font-medium mt-0.5 ${
                        isUp
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : isDown
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-gray-400'
                      }`}
                    >
                      {isUp ? '+' : ''}
                      {pct !== '--' ? `${pct}%` : '--'} vs AY {prev.ay}
                    </p>
                  </div>
                );
              });
            })()}
          </div>
        </Card>
      )}
    </div>
  );
}
