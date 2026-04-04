import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { IncomeTaxResult } from '../../lib/taxEngine';
import { formatINR, cn } from '../../lib/utils';

interface TaxWaterfallChartProps {
  result: IncomeTaxResult;
  className?: string;
}

function buildWaterfallData(result: IncomeTaxResult) {
  return [
    { name: 'Gross Income',   spacer: 0,                                      value: result.grossIncome,     fill: '#10b981' },
    { name: 'Deductions',     spacer: result.taxableIncome,                   value: result.totalDeductions, fill: '#f43f5e' },
    { name: 'Taxable Income', spacer: 0,                                      value: result.taxableIncome,   fill: '#6366f1' },
    { name: 'Tax + Cess',     spacer: result.taxableIncome - result.totalTax, value: result.totalTax,        fill: '#f97316' },
  ];
}

export function TaxWaterfallChart({ result, className }: TaxWaterfallChartProps) {
  const data = buildWaterfallData(result);

  return (
    <div className={cn('bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4', className)}>
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">Income to Tax Flow</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
            <XAxis dataKey="name" fontSize={11} stroke="#94a3b8" tick={{ fill: '#94a3b8' }} />
            <YAxis
              fontSize={11}
              stroke="#94a3b8"
              tick={{ fill: '#94a3b8' }}
              tickFormatter={(v: number) => `₹${(v / 100000).toFixed(0)}L`}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
              itemStyle={{ color: '#fff' }}
              formatter={(v: number) => [formatINR(v), '']}
              labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
            />
            <Bar dataKey="spacer" stackId="wf" fill="transparent" />
            <Bar dataKey="value" stackId="wf" radius={[4, 4, 0, 0]}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
