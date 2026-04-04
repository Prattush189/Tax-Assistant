import type { IncomeTaxResult } from '../../lib/taxEngine';
import { formatINR, cn } from '../../lib/utils';

interface TaxSummaryCardsProps {
  result: IncomeTaxResult;
  regimeLabel: string;   // 'New Regime' or 'Old Regime' — displayed in subtitle
  className?: string;
}

export function TaxSummaryCards({ result, regimeLabel, className }: TaxSummaryCardsProps) {
  const cards = [
    {
      label: 'Gross Income',
      value: formatINR(result.grossIncome),
      subLabel: null,
    },
    {
      label: 'Taxable Income',
      value: formatINR(result.taxableIncome),
      subLabel: null,
    },
    {
      label: 'Tax Payable',
      value: formatINR(result.totalTax),
      subLabel: 'incl. 4% cess',
    },
    {
      label: 'Effective Rate',
      value: `${result.effectiveRate.toFixed(1)}%`,
      subLabel: regimeLabel,
    },
  ];

  return (
    <div className={cn('grid grid-cols-2 lg:grid-cols-4 gap-4', className)}>
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{card.label}</p>
          <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{card.value}</p>
          {card.subLabel && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{card.subLabel}</p>
          )}
        </div>
      ))}
    </div>
  );
}
