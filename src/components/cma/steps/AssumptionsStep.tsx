import { Card, NumberInput } from '../../itr/shared/Inputs';
import type { CmaDraft, LineAssumption } from '../lib/uiModel';
import { ACCOUNT_BY_KEY, type CanonicalSection } from '../lib/canonicalAccounts';

interface Props {
  draft: CmaDraft;
  onChange: (patch: Partial<CmaDraft>) => void;
}

// P&L lines that meaningfully accept a growth lever. BS lines (other
// than fixed assets / equity) are driven by working-capital
// assumptions or term-loan schedules — handled in those steps, not
// here.
const ASSUMPTION_LINES: CanonicalSection[] = [
  'pl_revenue',
  'pl_other_income',
  'pl_cogs',
  'pl_operating_expense',
  'pl_depreciation',
  'pl_tax',
  'bs_gross_fixed_assets',
  'bs_paid_up_capital',
];

const DEFAULT_GROWTH: Record<CanonicalSection, number> = {
  pl_revenue: 15,
  pl_other_income: 5,
  pl_cogs: 12,
  pl_operating_expense: 10,
  pl_depreciation: 8,
  pl_tax: 12,
  bs_gross_fixed_assets: 5,
  bs_paid_up_capital: 0,
} as Record<CanonicalSection, number>;

export function AssumptionsStep({ draft, onChange }: Props) {
  const horizon = draft.projectionHorizon ?? 3;
  const assumptions = draft.assumptions ?? [];
  const byKey = new Map(assumptions.map((a) => [a.canonicalKey as CanonicalSection, a]));

  const setGrowth = (key: CanonicalSection, yearIdx: number, pct: number | undefined) => {
    const existing = byKey.get(key);
    const arr = existing?.growthPctByYear ? [...existing.growthPctByYear] : new Array(horizon).fill(undefined);
    arr[yearIdx] = pct;
    const next: LineAssumption = { canonicalKey: key, growthPctByYear: arr };
    const others = assumptions.filter((a) => a.canonicalKey !== key);
    onChange({ assumptions: [...others, next] });
  };

  const seedDefaults = () => {
    const next: LineAssumption[] = ASSUMPTION_LINES.map((key) => ({
      canonicalKey: key,
      growthPctByYear: new Array(horizon).fill(DEFAULT_GROWTH[key] ?? 10),
    }));
    onChange({ assumptions: next });
  };

  return (
    <Card
      title="Per-line growth assumptions"
      action={assumptions.length === 0 ? (
        <button
          type="button"
          onClick={seedDefaults}
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
        >
          Seed defaults
        </button>
      ) : undefined}
    >
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Growth % over the prior year. Leave blank to flatline from the latest historical.
        Sales is the dominant lever — most other lines move with it.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/60 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Line</th>
              {Array.from({ length: horizon }, (_, i) => (
                <th key={i} className="px-3 py-2 text-right font-medium">Yr +{i + 1} %</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {ASSUMPTION_LINES.map((key) => {
              const acc = ACCOUNT_BY_KEY[key];
              const entry = byKey.get(key);
              return (
                <tr key={key} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                  <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{acc.label}</td>
                  {Array.from({ length: horizon }, (_, i) => (
                    <td key={i} className="px-3 py-2 text-right">
                      <div className="w-20 ml-auto">
                        <NumberInput
                          value={entry?.growthPctByYear?.[i]}
                          onChange={(v) => setGrowth(key, i, v ?? undefined)}
                          placeholder="—"
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
